"""
API 客户端
"""
import os
import time
from typing import Optional
from volcenginesdkarkruntime import Ark
from .logger import logger


class APIClient:
    """豆包 API 客户端"""
    
    def __init__(self, api_key: str, max_retries: int = 2):
        self.api_key = api_key
        self.max_retries = max_retries
        self.should_stop = None  # 停止检查回调函数
        
        # 初始化 Ark 客户端
        self.client = Ark(
            base_url='https://ark.cn-beijing.volces.com/api/v3',
            api_key=api_key,
            timeout=(30, 180)  # (连接超时, 读取超时)
        )
    
    def call_with_retry(self, prompt_text: str, 
                       image_path: Optional[str] = None,
                       model: str = "doubao-seed-1-6-vision-250815") -> str:
        """带重试的API调用
        
        Args:
            prompt_text: 提示文本
            image_path: 图片文件路径（本地路径）
            model: 模型名称
        """
        last_error = None
        
        for attempt in range(self.max_retries + 1):
            # 检查是否需要停止
            if self.should_stop and self.should_stop():
                raise Exception("用户已停止处理")
            
            try:
                if attempt > 0:
                    logger.log_detailed(
                        f"重试 API 调用 ({attempt}/{self.max_retries})...",
                        status='warning'
                    )
                    # 指数退避
                    wait_time = 2 ** attempt
                    for _ in range(wait_time * 10):  # 分成小段sleep以便及时响应停止
                        if self.should_stop and self.should_stop():
                            raise Exception("用户已停止处理")
                        time.sleep(0.1)
                
                response = self._call_api(prompt_text, image_path, model)
                
                if attempt > 0:
                    logger.log_detailed("重试成功", status='success')
                
                return response
                
            except Exception as e:
                # 如果是用户停止，立即抛出
                if "用户已停止处理" in str(e):
                    raise
                
                last_error = e
                logger.log_detailed(
                    f"API调用失败: {str(e)}",
                    status='error'
                )
                
                if attempt == self.max_retries:
                    logger.log_simple(
                        f"API调用失败（已重试{self.max_retries}次）",
                        status='error'
                    )
                    raise
        
        raise last_error
    
    def _call_api(self, prompt_text: str, 
                  image_path: Optional[str],
                  model: str) -> str:
        """实际的API调用（使用chat.completions API）"""
        logger.log_detailed(f"调用豆包 API (Model: {model})", status='info')
        
        # 构建消息内容
        content = []
        
        # 如果有图片，添加图片（使用base64编码）
        if image_path:
            # 验证文件存在
            if not os.path.exists(image_path):
                raise Exception(f"图片文件不存在: {image_path}")
            
            # 获取文件大小(MB)
            file_size_mb = os.path.getsize(image_path) / (1024 * 1024)
            logger.log_detailed(f"图片大小: {file_size_mb:.2f} MB", status='info')
            
            # 检查文件大小（base64方式限制10MB）
            if file_size_mb > 10:
                raise Exception(f"图片文件过大（{file_size_mb:.2f} MB），base64方式仅支持10MB以内的图片")
            
            # 读取图片并转换为base64
            import base64
            with open(image_path, 'rb') as f:
                image_data = f.read()
            
            base64_image = base64.b64encode(image_data).decode('utf-8')
            
            # 获取图片格式
            import mimetypes
            mime_type, _ = mimetypes.guess_type(image_path)
            if not mime_type or not mime_type.startswith('image/'):
                mime_type = 'image/jpeg'  # 默认使用jpeg
            
            # 构建data URI
            image_url = f"data:{mime_type};base64,{base64_image}"
            
            logger.log_detailed(f"图片已转换为base64格式 (类型: {mime_type})", status='info')
            
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": image_url
                }
            })
        
        # 添加文本
        content.append({
            "type": "text",
            "text": prompt_text
        })
        
        # 调用chat.completions API
        try:
            # 构建请求参数
            messages = [{
                "role": "user",
                "content": content
            }]
            
            # 打印请求体信息（用于调试）
            import json
            logger.log_detailed(f"API请求参数:", status='info')
            logger.log_detailed(f"  model: {model}", status='info')
            #logger.log_detailed(f"  messages: {json.dumps(messages, ensure_ascii=False, indent=2)}", status='info')
            
            response = self.client.chat.completions.create(
                model=model,
                messages=messages
            )
            
            # 提取响应文本
            response_text = ""
            if response.choices and len(response.choices) > 0:
                first_choice = response.choices[0]
                if first_choice.message and first_choice.message.content:
                    response_text = first_choice.message.content
            
            response_text = response_text.strip()
            
            if not response_text:
                raise Exception("API 返回为空")
            
            logger.log_detailed("API 调用成功", status='success')
            return response_text
            
        except Exception as e:
            error_msg = str(e)
            # 提取更友好的错误信息
            if "OversizeImage" in error_msg:
                raise Exception("图片文件过大（超过512MB限制），请压缩后重试")
            elif "InvalidParameter" in error_msg:
                raise Exception(f"参数错误: {error_msg}")
            else:
                raise Exception(f"API 调用失败: {error_msg}")
