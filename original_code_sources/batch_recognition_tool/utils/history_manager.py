"""
处理历史管理器
"""
import os
import json
from datetime import datetime
from typing import List, Dict, Optional


class HistoryManager:
    """处理历史记录管理器"""
    
    def __init__(self, history_file: str = "processing_history.json"):
        self.history_file = history_file
        self._ensure_file_exists()
    
    def _ensure_file_exists(self):
        """确保历史文件存在"""
        if not os.path.exists(self.history_file):
            self._save_history({})
    
    def _load_history(self) -> Dict:
        """加载历史记录"""
        try:
            with open(self.history_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    
    def _save_history(self, history: Dict):
        """保存历史记录"""
        with open(self.history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, indent=2)
    
    def add_record(self, student_id: str, data_file: str, status: str = 'success'):
        """添加处理记录
        
        Args:
            student_id: 学号
            data_file: 数据文件路径
            status: 处理状态
        """
        history = self._load_history()
        
        history[student_id] = {
            'last_processed': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'status': status,
            'data_file': data_file
        }
        
        self._save_history(history)
    
    def update_verification_status(self, student_id: str, verified: bool):
        """更新核对状态"""
        history = self._load_history()
        
        if student_id in history:
            history[student_id]['verified'] = verified
            self._save_history(history)

    def update_completion_status(self, student_id: str, completed: bool):
        """更新完成状态 (黄色标记)"""
        history = self._load_history()
        
        if student_id in history:
            history[student_id]['completed'] = completed
            self._save_history(history)
            
    def get_all_records(self) -> List[Dict]:
        """获取所有记录，按时间倒序排列"""
        history = self._load_history()
        
        records = []
        for student_id, info in history.items():
            records.append({
                'student_id': student_id,
                'last_processed': info.get('last_processed', ''),
                'status': info.get('status', 'unknown'),
                'data_file': info.get('data_file', ''),
                'verified': info.get('verified', False),
                'completed': info.get('completed', False)  # New field
            })
        
        # 按时间倒序排序
        records.sort(key=lambda x: x['last_processed'], reverse=True)
        
        return records
    
    def get_record(self, student_id: str) -> Optional[Dict]:
        """获取指定学号的记录
        
        Args:
            student_id: 学号
            
        Returns:
            记录信息，如果不存在返回None
        """
        history = self._load_history()
        
        if student_id in history:
            info = history[student_id]
            return {
                'student_id': student_id,
                'last_processed': info.get('last_processed', ''),
                'status': info.get('status', 'unknown'),
                'data_file': info.get('data_file', ''),
                'verified': info.get('verified', False)
            }
        
        return None
    
    def remove_record(self, student_id: str):
        """删除指定学号的记录
        
        Args:
            student_id: 学号
        """
        history = self._load_history()
        
        if student_id in history:
            del history[student_id]
            self._save_history(history)
