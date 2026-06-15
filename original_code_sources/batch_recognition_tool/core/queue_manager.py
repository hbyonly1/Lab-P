"""
学号队列管理器
"""
import threading
from typing import Set, List, Optional


class StudentQueue:
    """学号队列管理"""
    
    def __init__(self):
        self.queue: List[str] = []  # 待处理队列
        self.processing: Set[str] = set()  # 正在处理
        self.completed: Set[str] = set()  # 已完成
        self.failed: Set[str] = set()  # 失败
        self.lock = threading.Lock()
    
    def add_student(self, student_id: str) -> bool:
        """添加学号（动态添加，即使在处理中）"""
        with self.lock:
            # Check if active
            if student_id in self.queue or student_id in self.processing:
                return False
            
            # If previously completed or failed, reset status to allow re-run
            if student_id in self.completed:
                self.completed.remove(student_id)
            if student_id in self.failed:
                self.failed.remove(student_id)
            
            self.queue.append(student_id)
            return True
    
    def add_students(self, student_ids: List[str]) -> int:
        """批量添加学号"""
        count = 0
        for sid in student_ids:
            if self.add_student(sid):
                count += 1
        return count
    
    def get_next(self) -> Optional[str]:
        """获取下一个待处理学号"""
        with self.lock:
            if self.queue:
                student_id = self.queue.pop(0)
                self.processing.add(student_id)
                return student_id
        return None
    
    def mark_done(self, student_id: str, success: bool = True):
        """标记完成"""
        with self.lock:
            self.processing.discard(student_id)
            if success:
                self.completed.add(student_id)
            else:
                self.failed.add(student_id)
    
    def get_status(self) -> dict:
        """获取队列状态"""
        with self.lock:
            return {
                'total': len(self.queue) + len(self.processing) + len(self.completed) + len(self.failed),
                'pending': len(self.queue),
                'processing': len(self.processing),
                'completed': len(self.completed),
                'failed': len(self.failed)
            }
    
    def clear(self):
        """清空队列"""
        with self.lock:
            self.queue.clear()
            self.processing.clear()
            self.completed.clear()
            self.failed.clear()
    
    def is_empty(self) -> bool:
        """检查是否为空（包括处理中）"""
        with self.lock:
            return len(self.queue) == 0 and len(self.processing) == 0
