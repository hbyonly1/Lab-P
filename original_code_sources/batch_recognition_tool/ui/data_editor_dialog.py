"""
数据编辑器对话框
"""
import os
import json
import copy
from PyQt5.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QPushButton, QLineEdit, QLabel, QScrollArea, QGroupBox,
    QDockWidget, QListWidget, QMessageBox, QSizePolicy
)
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QPixmap
from utils.file_utils import load_json, save_json
from utils.format_parser import parse_format, group_by_prefix
from .dark_theme import DARK_THEME


class DataEditorDialog(QMainWindow):
    """数据编辑器对话框"""
    
    def __init__(self, student_id: str, data_file: str, base_dir: str, parent=None):
        super().__init__(parent)
        self.student_id = student_id
        self.data_file = data_file
        self.base_dir = base_dir
        self.student_dir = os.path.join(base_dir, 'personalData', student_id)
        
        # 加载数据
        self.original_data = None
        self.current_data = None
        self.config_data = None
        self.text_fields = {}  # 存储所有文本框 {key: QLineEdit}
        
        self.load_data()
        self.init_ui()
        self.populate_data()
    
    def load_data(self):
        """加载数据"""
        # 加载识别结果数据
        data_path = os.path.join(self.base_dir, self.data_file)
        self.original_data = load_json(data_path)
        self.current_data = copy.deepcopy(self.original_data)
        
        # 加载配置文件
        config_path = os.path.join(self.base_dir, 'data.json')
        self.config_data = load_json(config_path)
    
    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle(f"学号 {self.student_id} - 数据核对")
        self.setMinimumSize(1200, 800)
        self.setStyleSheet(DARK_THEME)
        
        # 创建中央部件
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        
        main_layout = QVBoxLayout()
        central_widget.setLayout(main_layout)
        
        # 创建滚动区域
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        
        # 创建内容容器
        content_widget = QWidget()
        self.content_layout = QVBoxLayout()
        content_widget.setLayout(self.content_layout)
        scroll.setWidget(content_widget)
        
        main_layout.addWidget(scroll)
        
        # 底部按钮
        button_layout = QHBoxLayout()
        button_layout.addStretch()
        
        self.cancel_btn = QPushButton("取消")
        self.cancel_btn.clicked.connect(self.on_cancel)
        button_layout.addWidget(self.cancel_btn)
        
        self.save_btn = QPushButton("保存修改")
        self.save_btn.setObjectName("save_btn")
        self.save_btn.clicked.connect(self.on_save)
        button_layout.addWidget(self.save_btn)
        
        main_layout.addLayout(button_layout)
        
        # 创建可拖拽的图片查看器
        self.create_image_viewer()
    
    def create_image_viewer(self):
        """创建图片查看器（可拖拽）"""
        dock = QDockWidget("图片查看器", self)
        dock.setAllowedAreas(Qt.AllDockWidgetAreas)
        dock.setFeatures(
            QDockWidget.DockWidgetMovable |
            QDockWidget.DockWidgetFloatable |
            QDockWidget.DockWidgetClosable
        )
        
        # 创建图片查看器内容
        viewer_widget = QWidget()
        viewer_layout = QVBoxLayout()
        viewer_widget.setLayout(viewer_layout)
        
        # 图片列表
        self.image_list = QListWidget()
        self.image_list.currentItemChanged.connect(self.on_image_selected)
        viewer_layout.addWidget(QLabel("选择图片:"))
        viewer_layout.addWidget(self.image_list, 1)
        
        # 图片预览
        self.image_preview = QLabel()
        self.image_preview.setAlignment(Qt.AlignCenter)
        self.image_preview.setMinimumSize(200, 200)
        self.image_preview.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.image_preview.setScaledContents(False)
        viewer_layout.addWidget(QLabel("预览:"))
        viewer_layout.addWidget(self.image_preview, 3)
        
        dock.setWidget(viewer_widget)
        
        # 添加到右侧
        self.addDockWidget(Qt.RightDockWidgetArea, dock)
        
        # 加载图片列表
        self.load_images()
    
    def load_images(self):
        """加载图片列表"""
        if not os.path.exists(self.student_dir):
            return
        
        # 查找所有jpg文件
        for filename in sorted(os.listdir(self.student_dir)):
            if filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                self.image_list.addItem(filename)
    
    def on_image_selected(self, current, previous):
        """图片选择改变"""
        if not current:
            return
        
        image_path = os.path.join(self.student_dir, current.text())
        if os.path.exists(image_path):
            pixmap = QPixmap(image_path)
            # 缩放图片以适应预览区域
            scaled_pixmap = pixmap.scaled(
                self.image_preview.size(),
                Qt.KeepAspectRatio,
                Qt.SmoothTransformation
            )
            self.image_preview.setPixmap(scaled_pixmap)
    
    def populate_data(self):
        """填充数据到UI"""
        profiles = self.config_data.get('profiles', {})
        
        for profile_name, profile_config in profiles.items():
            # 获取对应的数据
            profile_data = self.current_data.get(profile_name, {})
            exp_name = profile_config.get('expName', profile_name)
            
            # 创建配置分组
            group_box = QGroupBox(f" {exp_name}")
            group_layout = QVBoxLayout()
            group_box.setLayout(group_layout)
            
            # 处理fill数据
            fill_data = profile_data.get('fill', [])
            if fill_data:
                self.create_fill_section(group_layout, profile_name, profile_config, fill_data)
            
            # 处理generatedAnswer
            generated_answer = profile_data.get('generatedAnswer')
            if generated_answer:
                self.create_answer_section(group_layout, profile_name, generated_answer)
            
            self.content_layout.addWidget(group_box)
        
        self.content_layout.addStretch()
    
    def create_fill_section(self, parent_layout, profile_name, profile_config, fill_data):
        """创建fill数据区域"""
        # 从配置中获取格式字符串
        prompts = profile_config.get('prompts', [])
        format_strings = []
        
        for prompt in prompts:
            if prompt.get('type') == 'textRecognition':
                # 从value中提取格式字符串（简化处理，实际可能需要更复杂的解析）
                value = prompt.get('value', '')
                # 查找所有包含{..}的模式
                import re
                patterns = re.findall(r'[A-Za-z0-9_-]+\{[0-9]+\.\.[0-9]+\}', value)
                format_strings.extend(patterns)
        
        # 如果没有找到格式字符串，直接显示所有数据
        if not format_strings:
            self.create_simple_grid(parent_layout, profile_name, fill_data)
            return
        
        # 解析格式并分组
        all_keys = []
        for fmt in format_strings:
            all_keys.extend(parse_format(fmt))
        
        # 按前缀分组
        groups = group_by_prefix(all_keys)
        
        # 为每个分组创建一行
        for prefix, keys in groups.items():
            row_layout = QHBoxLayout()
            row_layout.addWidget(QLabel(f"{prefix}:"))
            
            for key in keys:
                # 查找对应的数据
                value = ""
                for item in fill_data:
                    if item.get('key') == key:
                        value = item.get('value', '')
                        break
                
                # 创建文本框
                text_field = QLineEdit(value)
                text_field.setMaximumWidth(80)
                text_field.setPlaceholderText(key.split('-')[-1] if '-' in key else key)
                
                # 存储文本框引用
                field_key = f"{profile_name}:fill:{key}"
                self.text_fields[field_key] = text_field
                
                row_layout.addWidget(text_field)
            
            row_layout.addStretch()
            parent_layout.addLayout(row_layout)
    
    def create_simple_grid(self, parent_layout, profile_name, fill_data):
        """创建简单网格布局（当没有格式字符串时）"""
        grid = QGridLayout()
        
        for i, item in enumerate(fill_data):
            key = item.get('key', '')
            value = item.get('value', '')
            
            row = i // 5
            col = i % 5
            
            label = QLabel(f"{key}:")
            text_field = QLineEdit(value)
            text_field.setMaximumWidth(100)
            
            field_key = f"{profile_name}:fill:{key}"
            self.text_fields[field_key] = text_field
            
            grid.addWidget(label, row * 2, col)
            grid.addWidget(text_field, row * 2 + 1, col)
        
        parent_layout.addLayout(grid)
    
    def create_answer_section(self, parent_layout, profile_name, answer):
        """创建答案区域"""
        parent_layout.addWidget(QLabel("生成的答案:"))
        
        answer_field = QLineEdit(answer)
        field_key = f"{profile_name}:answer"
        self.text_fields[field_key] = answer_field
        
        parent_layout.addWidget(answer_field)
    
    def collect_data(self):
        """收集UI中的数据"""
        new_data = copy.deepcopy(self.current_data)
        
        for field_key, text_field in self.text_fields.items():
            parts = field_key.split(':')
            profile_name = parts[0]
            field_type = parts[1]
            
            if field_type == 'fill':
                key = parts[2]
                value = text_field.text()
                
                # 更新fill数据
                fill_data = new_data.get(profile_name, {}).get('fill', [])
                for item in fill_data:
                    if item.get('key') == key:
                        item['value'] = value
                        break
            
            elif field_type == 'answer':
                value = text_field.text()
                if profile_name in new_data:
                    new_data[profile_name]['generatedAnswer'] = value
        
        return new_data
    
    def on_save(self):
        """保存修改"""
        try:
            # 收集数据
            new_data = self.collect_data()
            
            # 保存到文件
            data_path = os.path.join(self.base_dir, self.data_file)
            save_json(data_path, new_data)
            
            # 更新当前数据
            self.current_data = new_data
            self.original_data = copy.deepcopy(new_data)
            
            QMessageBox.information(self, "成功", "数据已保存")
            self.close()
            
        except Exception as e:
            QMessageBox.critical(self, "错误", f"保存失败:\n{str(e)}")
    
    def on_cancel(self):
        """取消修改"""
        # 检查是否有修改
        current = self.collect_data()
        if current != self.original_data:
            reply = QMessageBox.question(
                self, '确认',
                '有未保存的修改，确定要放弃吗？',
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No
            )
            
            if reply == QMessageBox.No:
                return
        
        self.close()
