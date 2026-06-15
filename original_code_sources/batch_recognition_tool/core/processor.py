"""
批量处理器
"""
import os
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Callable, Optional

from .logger import logger
from .api_client import APIClient
from .queue_manager import StudentQueue
from .models import ProcessingResult
from utils.file_utils import (
    load_json, save_json,
    parse_recognition_response
)


class BatchProcessor:
    """批量处理器"""
    
    def __init__(self, max_workers: int = 1):
        self.max_workers = max_workers
        self.executor: Optional[ThreadPoolExecutor] = None
        self.running = False
        self.paused = False
        self.results: List[ProcessingResult] = []
        
        # 回调函数
        self.on_progress: Optional[Callable] = None
        self.on_complete: Optional[Callable] = None
        self.on_student_start: Optional[Callable] = None
        self.on_student_done: Optional[Callable] = None
    
    def start(self, student_queue: StudentQueue, base_dir: str, 
             api_client: APIClient, student_configs: Dict[str, List[str]] = None, 
             filename_suffix: str = ""):
        """启动批量处理"""
        if self.running:
            return
        
        self.running = True
        self.paused = False
        self.results.clear()
        
        # 保存配置
        self.student_configs = student_configs or {}
        
        # 设置API客户端的停止检查回调
        api_client.should_stop = lambda: not self.running
        
        # 加载配置文件
        try:
            data_json_path = os.path.join(base_dir, 'data.json')
            config_data = load_json(data_json_path)
            self.all_profiles = config_data.get('profiles', {})
            
            if not self.all_profiles:
                logger.log_simple("[失败] 配置文件中没有找到profiles", status='error')
                self.running = False
                return
                
            logger.log_simple(f"[成功] 加载配置完成，共 {len(self.all_profiles)} 个基础配置", status='success')
            if filename_suffix:
                logger.log_simple(f"[信息] 使用文件名后缀: {filename_suffix}", status='info')
            
        except Exception as e:
            logger.log_simple(f"[失败] 加载配置失败: {str(e)}", status='error')
            self.running = False
            return
        
        # 创建线程池
        self.executor = ThreadPoolExecutor(max_workers=self.max_workers)
        
        # 启动worker线程
        def worker():
            while self.running:
                # 检查暂停
                while self.paused and self.running:
                    time.sleep(0.1)
                
                # 再次检查running状态(可能在暂停期间被停止)
                if not self.running:
                    break
                
                # 获取下一个学号
                student_id = student_queue.get_next()
                if student_id is None:
                    # 检查是否全部完成
                    if student_queue.is_empty():
                        break
                    time.sleep(0.5)
                    continue
                
                # 处理学号
                try:
                    if self.on_student_start:
                        self.on_student_start(student_id)
                    
                    # 获取该学号的实验配置
                    selected_keys = self.student_configs.get(student_id)
                    if selected_keys is not None:
                        # 使用特定配置
                        profiles = {k: v for k, v in self.all_profiles.items() if k in selected_keys}
                    else:
                        # 默认全部 (兼容其他情况)
                        profiles = self.all_profiles
                        
                    if not profiles:
                        logger.log_simple(f"[跳过] 学号 {student_id} 未选择任何实验", status='warning')
                        student_queue.mark_done(student_id, success=True) # 算成功? 或者跳过
                        continue

                    result = self._process_student(
                        student_id, profiles, base_dir, api_client, filename_suffix
                    )
                    
                    self.results.append(result)
                    student_queue.mark_done(student_id, success=(result.status == 'success'))
                    
                    if self.on_student_done:
                        self.on_student_done(student_id, result)
                    
                except Exception as e:
                    logger.log_simple(f"[失败] 学号 {student_id} 处理异常: {str(e)}", status='error')
                    student_queue.mark_done(student_id, success=False)
        
        # 提交worker任务
        futures = []
        for _ in range(self.max_workers):
            future = self.executor.submit(worker)
            futures.append(future)
        
        # 等待所有worker完成（在后台线程中）
        def wait_completion():
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as e:
                    logger.log_simple(f"Worker异常: {str(e)}", status='error')
            
            self.running = False
            if self.on_complete:
                self.on_complete(self.results)
        
        import threading
        threading.Thread(target=wait_completion, daemon=True).start()
    
    def _process_student(self, student_id: str, profiles: Dict, 
                        base_dir: str, api_client: APIClient,
                        filename_suffix: str = "") -> ProcessingResult:
        """处理单个学号"""
        result = ProcessingResult(student_id)
        result.status = 'processing'
        result.start_time = datetime.now()
        
        logger.log_simple(f"[处理中] 开始处理学号: {student_id}", status='info')
        
        # 预检查图片
        missing_images = self._validate_images(student_id, profiles, base_dir)
        
        # 处理每个配置
        result_data = {}
        
        for idx, (profile_name, profile) in enumerate(profiles.items(), 1):
            logger.log_detailed(f"处理配置 {idx}/{len(profiles)}: {profile_name}", status='info')
            
            profile_result = {
                'expName': profile.get('expName', profile_name),
                'fill': [],
                'generatedAnswer': None
            }
            
            try:
                # 处理图片识别
                for prompt in profile.get('prompts', []):
                    if prompt.get('type') == 'textRecognition':
                        self._process_text_recognition(
                            student_id, profile_name, idx, prompt,
                            base_dir, api_client, profile_result, result
                        )
                
                # 处理答案生成
                for prompt in profile.get('prompts', []):
                    if prompt.get('type') == 'generateAnswer':
                        self._process_answer_generation(
                            profile_name, idx, prompt,
                            api_client, profile_result, result
                        )
                
                # 记录成功处理的配置
                result.profiles_processed.append(profile_name)
                result_data[profile_name] = profile_result
                
            except Exception as e:
                result.add_error(idx, profile_name, 'unknown_error', str(e))
                logger.log_simple(f"[失败] 配置 {profile_name} 处理失败: {str(e)}", status='error')
        
        # 保存结果
        try:
            output_path = os.path.join(
                base_dir, 'personalData', student_id,
                f"{student_id}_apiRecognizedData{filename_suffix}.json"
            )
            save_json(output_path, result_data)
            logger.log_detailed(f"[成功] 结果已保存: {output_path}", status='success')
        except Exception as e:
            logger.log_simple(f"[失败] 保存结果失败: {str(e)}", status='error')
        
        # 更新结果状态
        result.end_time = datetime.now()
        result.status = 'success' if not result.errors else 'failed'
        
        status_icon = '[成功]' if result.status == 'success' else '[失败]'
        logger.log_simple(
            f"{status_icon} 学号 {student_id} 处理完成 "
            f"(成功: {len(result.profiles_processed)}, 失败: {len(result.errors)})",
            status=result.status
        )
        
        return result
    
    def _validate_images(self, student_id: str, profiles: Dict, 
                        base_dir: str) -> List[Dict]:
        """预检查图片"""
        missing_images = []
        
        for idx, (profile_name, profile) in enumerate(profiles.items(), 1):
            for prompt in profile.get('prompts', []):
                if prompt.get('type') == 'textRecognition':
                    image_source = prompt.get('recognitionSource')
                    if image_source:
                        image_path = os.path.join(
                            base_dir, 'personalData', student_id, image_source
                        )
                        
                        if not os.path.exists(image_path):
                            missing_images.append({
                                'profile_index': idx,
                                'profile_name': profile_name,
                                'image_source': image_source
                            })
                            logger.log_simple(
                                f"[警告] 图片不存在: {student_id}/{image_source}",
                                status='warning'
                            )
        
        return missing_images
    
    def _process_text_recognition(self, student_id: str, profile_name: str,
                                  profile_idx: int, prompt: Dict,
                                  base_dir: str, api_client: APIClient,
                                  profile_result: Dict, result: ProcessingResult):
        """处理图片识别"""
        image_source = prompt.get('recognitionSource')
        if not image_source:
            return
        
        image_path = os.path.join(base_dir, 'personalData', student_id, image_source)
        
        # 检查图片是否存在
        if not os.path.exists(image_path):
            result.add_error(
                profile_idx, profile_name,
                'image_not_found',
                f"图片不存在: {image_source}"
            )
            return
        
        try:
            # 直接使用图片路径（不再转换base64）
            logger.log_detailed(f"准备识别图片: {image_source}", status='info')
            
            # 调用API（传递文件路径）
            model = prompt.get('model', 'doubao-seed-1-6-vision-250815')
            response = api_client.call_with_retry(
                prompt.get('value', ''),
                image_path,  # 传递文件路径而不是base64
                model
            )
            
            # 解析结果
            parsed_data = parse_recognition_response(response)
            profile_result['fill'].extend(parsed_data)
            
            logger.log_detailed(
                f"[成功] 图片识别成功: {image_source} (识别到 {len(parsed_data)} 项)",
                status='success'
            )
            
        except Exception as e:
            result.add_error(
                profile_idx, profile_name,
                'api_failed',
                f"图片识别失败: {str(e)}"
            )
            logger.log_detailed(f"[失败] 图片识别失败: {str(e)}", status='error')
    
    def _process_answer_generation(self, profile_name: str, profile_idx: int,
                                   prompt: Dict, api_client: APIClient,
                                   profile_result: Dict, result: ProcessingResult):
        """处理答案生成"""
        try:
            logger.log_detailed("生成答案中...", status='info')
            
            model = prompt.get('model', 'doubao-seed-1-6-vision-250815')
            response = api_client.call_with_retry(
                prompt.get('value', ''),
                None,
                model
            )
            
            profile_result['generatedAnswer'] = response
            logger.log_detailed("[成功] 答案生成成功", status='success')
            
        except Exception as e:
            result.add_error(
                profile_idx, profile_name,
                'api_failed',
                f"答案生成失败: {str(e)}"
            )
            logger.log_detailed(f"[失败] 答案生成失败: {str(e)}", status='error')
    
    def pause(self):
        """暂停处理"""
        self.paused = True
        logger.log_simple("[已暂停] 已暂停处理", status='warning')
    
    def resume(self):
        """恢复处理"""
        self.paused = False
        logger.log_simple("[已恢复] 已恢复处理", status='info')
    
    def stop(self):
        """停止处理"""
        self.running = False
        self.paused = False
        if self.executor:
            self.executor.shutdown(wait=False)
        logger.log_simple("[已停止] 已停止处理", status='warning')
    
    def update_workers(self, new_count: int):
        """更新并发数"""
        self.max_workers = new_count
        # 注意：需要重启才能生效
