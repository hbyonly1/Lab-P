"""
数据模型定义
"""
from datetime import datetime
from typing import List, Dict, Optional


class ProcessingResult:
    """处理结果模型"""
    
    def __init__(self, student_id: str):
        self.student_id = student_id
        self.status = 'pending'  # pending, processing, success, failed
        self.start_time: Optional[datetime] = None
        self.end_time: Optional[datetime] = None
        self.profiles_processed: List[str] = []  # 成功处理的配置名称
        self.errors: List[Dict] = []  # 错误列表
    
    def add_error(self, profile_index: int, profile_name: str, 
                  error_type: str, error_msg: str):
        """添加错误记录"""
        self.errors.append({
            'profile_index': profile_index,
            'profile_name': profile_name,
            'error_type': error_type,  # image_not_found, api_failed, parse_error
            'error_message': error_msg,
            'timestamp': datetime.now().isoformat()
        })
    
    def to_dict(self) -> Dict:
        """转换为字典"""
        duration = None
        if self.start_time and self.end_time:
            duration = (self.end_time - self.start_time).total_seconds()
        
        return {
            'student_id': self.student_id,
            'status': self.status,
            'start_time': self.start_time.isoformat() if self.start_time else None,
            'end_time': self.end_time.isoformat() if self.end_time else None,
            'duration_seconds': duration,
            'success_count': len(self.profiles_processed),
            'error_count': len(self.errors),
            'profiles_processed': self.profiles_processed,
            'errors': self.errors
        }
