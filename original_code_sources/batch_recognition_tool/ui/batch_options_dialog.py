from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, 
    QLineEdit, QPushButton, QTableWidget, QTableWidgetItem,
    QWidget, QGroupBox, QMessageBox, QHeaderView, QCheckBox,
    QAbstractItemView
)
from PyQt5.QtCore import Qt
from utils.file_utils import load_json
from .dark_theme import DARK_THEME
import os

class BatchOptionsDialog(QDialog):
    def __init__(self, base_dir, student_list, parent=None):
        super().__init__(parent)
        self.setStyleSheet(DARK_THEME)
        self.base_dir = base_dir
        self.student_list = list(student_list) if student_list else []
        self.filename_suffix = "_2" # Default suffix request
        self.profiles = {} # {key: profile_data}
        self.sorted_profile_keys = []
        
        self.setWindowTitle("批量识别选项")
        self.setMinimumWidth(1150) # Wider for matrix
        self.setMinimumHeight(800)
        
        # Load profiles first to setup UI
        self.load_profiles()
        self.init_ui()

    def load_profiles(self):
        try:
            data_json_path = os.path.join(self.base_dir, 'data.json')
            if os.path.exists(data_json_path):
                config_data = load_json(data_json_path)
                self.profiles = config_data.get('profiles', {})
                # Use list() to preserve insertion order from JSON (Python 3.7+)
                self.sorted_profile_keys = list(self.profiles.keys())
            else:
                self.profiles = {}
        except Exception:
            self.profiles = {}

    def init_ui(self):
        layout = QVBoxLayout()
        self.setLayout(layout)
        
        # 1. Filename Suffix Section
        file_group = QGroupBox("输出文件名设置")
        file_layout = QVBoxLayout()
        
        hbox = QHBoxLayout()
        hbox.addWidget(QLabel("文件名后缀:"))
        self.suffix_input = QLineEdit()
        self.suffix_input.setText(self.filename_suffix)
        self.suffix_input.setPlaceholderText("例如: _2")
        self.suffix_input.textChanged.connect(self.update_preview)
        hbox.addWidget(self.suffix_input)
        file_layout.addLayout(hbox)
        
        self.preview_label = QLabel("预览: 学号_apiRecognizedData_2.json")
        self.preview_label.setStyleSheet("color: gray; font-style: italic;")
        file_layout.addWidget(self.preview_label)
        
        file_group.setLayout(file_layout)
        layout.addWidget(file_group)
        
        # 2. Per-Student Experiment Selection (Matrix)
        exp_group = QGroupBox("学号实验配置")
        exp_layout = QVBoxLayout()
        
        # Toolbar
        tool_hbox = QHBoxLayout()
        self.btn_select_all = QPushButton("全部勾选")
        self.btn_select_all.clicked.connect(self.select_all_cells)
        self.btn_unselect_all = QPushButton("全部取消")
        self.btn_unselect_all.clicked.connect(self.unselect_all_cells)
        
        tool_hbox.addWidget(self.btn_select_all)
        tool_hbox.addWidget(self.btn_unselect_all)
        tool_hbox.addStretch()
        exp_layout.addLayout(tool_hbox)
        
        # Table
        self.table = QTableWidget()
        self.setup_table()
        exp_layout.addWidget(self.table)
        
        exp_group.setLayout(exp_layout)
        layout.addWidget(exp_group, 1)
        
        # 3. Dialog Buttons
        btn_layout = QHBoxLayout()
        self.ok_btn = QPushButton("开始识别")
        self.ok_btn.clicked.connect(self.accept)
        self.cancel_btn = QPushButton("取消")
        self.cancel_btn.clicked.connect(self.reject)
        
        btn_layout.addStretch()
        btn_layout.addWidget(self.cancel_btn)
        btn_layout.addWidget(self.ok_btn)
        layout.addLayout(btn_layout)

    def setup_table(self):
        if not self.sorted_profile_keys:
            self.table.setColumnCount(1)
            self.table.setHorizontalHeaderLabels(["错误: 未加载到实验配置"])
            return

        cols = ["学号"] + [f"{i+6}. {self.profiles[k].get('expName', k)}\n(点击全选)" for i, k in enumerate(self.sorted_profile_keys)]
        self.table.setColumnCount(len(cols))
        self.table.setHorizontalHeaderLabels(cols)
        
        self.table.setRowCount(len(self.student_list))
        
        for r, student_id in enumerate(self.student_list):
            # Student ID Item
            item_id = QTableWidgetItem(str(student_id))
            item_id.setFlags(item_id.flags() & ~Qt.ItemIsEditable) # Read-only
            self.table.setItem(r, 0, item_id)
            
            # Experiment Checkboxes
            for c, key in enumerate(self.sorted_profile_keys):
                # We use a centered widget with checkbox
                # To make it easier to act on "Select All", we can also store state?
                # Using QTableWidgetItem checkstate is easier for bulk operations than cell widgets
                item_chk = QTableWidgetItem()
                item_chk.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled | Qt.ItemIsSelectable)
                item_chk.setCheckState(Qt.Unchecked) # Default unchecked (user request)
                item_chk.setTextAlignment(Qt.AlignCenter)
                # Store the profile key in user data for retrieval
                item_chk.setData(Qt.UserRole, key)
                
                self.table.setItem(r, c + 1, item_chk)

        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeToContents)
        self.table.verticalHeader().setVisible(False)
        
        # Make headers clickable for column batch selection
        self.table.horizontalHeader().setSectionsClickable(True)
        self.table.horizontalHeader().sectionClicked.connect(self.on_header_clicked)

    def on_header_clicked(self, index):
        """Handle header click to toggle column selection"""
        if index == 0:
            return # Skip Student ID column
            
        # Determine target state based on the first row (or verify if we track state)
        # Simple toggle: If first is unchecked, check all. If checked, uncheck all.
        target_state = Qt.Checked
        if self.table.rowCount() > 0:
            first_item = self.table.item(0, index)
            if first_item and first_item.checkState() == Qt.Checked:
                target_state = Qt.Unchecked
        
        # Apply to all rows in this column
        for r in range(self.table.rowCount()):
            item = self.table.item(r, index)
            if item:
                item.setCheckState(target_state)

    def update_preview(self):
        suffix = self.suffix_input.text().strip()
        self.preview_label.setText(f"预览: 学号_apiRecognizedData{suffix}.json")

    def select_all_cells(self):
        self.set_all_check_state(Qt.Checked)

    def unselect_all_cells(self):
        self.set_all_check_state(Qt.Unchecked)
        
    def set_all_check_state(self, state):
        for r in range(self.table.rowCount()):
            for c in range(1, self.table.columnCount()):
                item = self.table.item(r, c)
                if item:
                    item.setCheckState(state)

    def get_options(self):
        suffix = self.suffix_input.text().strip()
        
        # Build per-student profile map
        student_profiles = {}
        
        for r in range(self.table.rowCount()):
            student_id = self.table.item(r, 0).text()
            selected = []
            
            for c in range(1, self.table.columnCount()):
                item = self.table.item(r, c)
                if item and item.checkState() == Qt.Checked:
                    profile_key = self.sorted_profile_keys[c-1]
                    selected.append(profile_key)
            
            # Only add if at least one is selected? Or add empty list?
            # User might want to skip a student entirely by unchecking all.
            # But student remains in queue. If empty list, processor currently errors "No valid profiles".
            # That's fine, it will just fail/skip that student.
            student_profiles[student_id] = selected
            
        return student_profiles, suffix

    def accept(self):
        # Validate at least one student has at least one profile?
        # Not strictly necessary, but good UX.
        # Let's just proceed.
        super().accept()
