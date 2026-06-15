"""
文件工具函数
"""
import os
import json
import base64
from PIL import Image
from io import BytesIO
from typing import Dict, Any, Optional, List


def read_image_as_base64(image_path: str) -> str:
    """读取图片并转换为base64"""
    try:
        with Image.open(image_path) as img:
            # 转换为RGB（如果是RGBA或其他格式）
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            # 转换为字节流
            buffer = BytesIO()
            img.save(buffer, format='PNG')
            buffer.seek(0)
            
            # 编码为base64
            img_base64 = base64.b64encode(buffer.read()).decode('utf-8')
            return img_base64
    except Exception as e:
        raise Exception(f"读取图片失败: {str(e)}")


def load_json(file_path: str) -> Dict[str, Any]:
    """加载JSON文件"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        raise Exception(f"加载JSON失败: {str(e)}")


def save_json(file_path: str, data: Dict[str, Any]):
    """保存JSON文件"""
    try:
        # 确保目录存在
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise Exception(f"保存JSON失败: {str(e)}")


def validate_directory(directory: str) -> tuple[bool, str]:
    """验证目录结构"""
    if not os.path.exists(directory):
        return False, "目录不存在"
    
    # 检查 data.json
    data_json_path = os.path.join(directory, 'data.json')
    if not os.path.exists(data_json_path):
        return False, "未找到 data.json 文件"
    
    # 检查 personalData 文件夹
    personal_data_dir = os.path.join(directory, 'personalData')
    if not os.path.exists(personal_data_dir):
        return False, "未找到 personalData 文件夹"
    
    return True, "目录结构正确"


def get_student_folders(directory: str) -> List[str]:
    """获取所有学号文件夹"""
    personal_data_dir = os.path.join(directory, 'personalData')
    if not os.path.exists(personal_data_dir):
        return []
    
    folders = []
    for item in os.listdir(personal_data_dir):
        item_path = os.path.join(personal_data_dir, item)
        if os.path.isdir(item_path):
            folders.append(item)
    
    return sorted(folders)


def parse_recognition_response(response_text: str) -> List[Dict[str, Any]]:
    """解析识别响应（JSON格式）"""
    try:
        # 尝试直接解析JSON
        data = json.loads(response_text)
        
        # 如果是字典，转换为列表
        if isinstance(data, dict):
            result = []
            for key, value in data.items():
                result.append({
                    'id': key,
                    'value': value
                })
            return result
        elif isinstance(data, list):
            return data
        else:
            return []
            
    except json.JSONDecodeError:
        # 如果不是JSON，尝试提取JSON代码块
        import re
        
        # 查找 ```json ... ``` 或 ``` ... ```
        json_pattern = r'```(?:json)?\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*```'
        matches = re.findall(json_pattern, response_text)
        
        if matches:
            try:
                data = json.loads(matches[0])
                if isinstance(data, dict):
                    result = []
                    for key, value in data.items():
                        result.append({'id': key, 'value': value})
                    return result
                elif isinstance(data, list):
                    return data
            except:
                pass
        
        # LaTeX backslash rescue
        try:
            # 转义非标准反斜杠
            import re
            escaped = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', response_text)
            data = json.loads(escaped)
            if isinstance(data, dict):
                result = []
                for key, value in data.items():
                    result.append({'id': key, 'value': value})
                return result
        except:
            pass
        
        return []
