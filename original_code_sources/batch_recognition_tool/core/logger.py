"""
日志系统
"""
from datetime import datetime
from typing import Callable, List


class Logger:
    """日志管理器"""
    
    SIMPLE = 0  # 简要日志
    DETAILED = 1  # 详细日志
    
    def __init__(self, level: int = SIMPLE):
        self.level = level
        self.callbacks: List[Callable] = []
    
    def set_level(self, level: int):
        """设置日志级别"""
        self.level = level
    
    def add_callback(self, callback: Callable):
        """添加日志回调函数"""
        self.callbacks.append(callback)
    
    def remove_callback(self, callback: Callable):
        """移除日志回调函数"""
        if callback in self.callbacks:
            self.callbacks.remove(callback)
    
    def log_simple(self, message: str, status: str = 'info'):
        """简要日志：学号级别"""
        timestamp = datetime.now().strftime('%H:%M:%S')
        formatted_msg = f"[{timestamp}] {message}"
        self._emit(formatted_msg, 'simple', status)
    
    def log_detailed(self, message: str, status: str = 'info'):
        """详细日志：API调用级别"""
        if self.level >= self.DETAILED:
            formatted_msg = f"  └─ {message}"
            self._emit(formatted_msg, 'detailed', status)
    
    def _emit(self, message: str, log_type: str, status: str):
        """发送日志到所有回调"""
        for callback in self.callbacks:
            try:
                callback(message, log_type, status)
            except Exception as e:
                print(f"日志回调错误: {e}")


# 全局日志实例
logger = Logger()
