"""
配置管理器
"""
import json
import os
from typing import Dict, Any


class ConfigManager:
    """配置管理"""
    
    DEFAULT_CONFIG = {
        'last_directory': '',
        'api_key': '',
        'concurrent_workers': 1,
        'max_retries': 2,
        'log_level': 0,  # 0=简要, 1=详细
        'enable_notification': True,
        'enable_sound': True,
        'window_geometry': {
            'width': 1000,
            'height': 600,
            'x': 100,
            'y': 100
        },
        'recent_directories': []
    }
    
    def __init__(self, config_file: str = 'config.json'):
        self.config_file = config_file
        self.config = self.load()
    
    def load(self) -> Dict[str, Any]:
        """加载配置"""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    loaded_config = json.load(f)
                    # 合并默认配置和加载的配置
                    config = self.DEFAULT_CONFIG.copy()
                    config.update(loaded_config)
                    return config
            except Exception as e:
                print(f"加载配置失败: {e}")
        
        return self.DEFAULT_CONFIG.copy()
    
    def save(self):
        """保存配置"""
        try:
            with open(self.config_file, 'w', encoding='utf-8') as f:
                json.dump(self.config, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"保存配置失败: {e}")
    
    def get(self, key: str, default=None):
        """获取配置项"""
        return self.config.get(key, default)
    
    def set(self, key: str, value: Any):
        """设置配置项"""
        self.config[key] = value
        self.save()
    
    def add_recent_directory(self, directory: str):
        """添加最近使用的目录"""
        recent = self.config.get('recent_directories', [])
        if directory in recent:
            recent.remove(directory)
        recent.insert(0, directory)
        # 只保留最近5个
        self.config['recent_directories'] = recent[:5]
        self.save()
