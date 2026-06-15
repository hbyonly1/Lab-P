"""
核对历史对话框
"""
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QPushButton,
    QTableWidget, QTableWidgetItem, QHeaderView, QMessageBox
)
from PyQt5.QtCore import Qt
from utils.history_manager import HistoryManager
from .dark_theme import DARK_THEME


class VerificationDialog(QDialog):
    """核对历史对话框"""
    
    def __init__(self, base_dir: str, parent=None):
        super().__init__(parent)
        self.base_dir = base_dir
        self.history_manager = HistoryManager()
        self.init_ui()
        self.load_history()
    
    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle("数据核对历史")
        self.setMinimumSize(800, 500)
        self.setStyleSheet(DARK_THEME)
        
        layout = QVBoxLayout()
        self.setLayout(layout)
        
        # 创建表格
        self.table = QTableWidget()
        self.table.setColumnCount(4)
        self.table.setHorizontalHeaderLabels(['学号', '最后处理时间', '状态', '操作'])
        
        # 设置表格属性
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.horizontalHeader().setStretchLastSection(False)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.ResizeToContents)
        
        # 设置表格样式（确保文字可见）
        self.table.setStyleSheet("""
            QTableWidget {
                background-color: #2b2b2b;
                color: #ffffff;
                gridline-color: #3d3d3d;
            }
            QTableWidget::item {
                color: #ffffff;
                padding: 5px;
            }
            QTableWidget::item:selected {
                background-color: #3d5afe;
            }
            QHeaderView::section {
                background-color: #1e1e1e;
                color: #ffffff;
                padding: 5px;
                border: 1px solid #3d3d3d;
            }
        """)
        
        layout.addWidget(self.table)
        
        # 底部按钮
        button_layout = QHBoxLayout()
        button_layout.addStretch()
        
        self.refresh_btn = QPushButton("刷新")
        self.refresh_btn.clicked.connect(self.load_history)
        button_layout.addWidget(self.refresh_btn)
        
        self.close_btn = QPushButton("关闭")
        self.close_btn.clicked.connect(self.close)
        button_layout.addWidget(self.close_btn)
        
        layout.addLayout(button_layout)
    
    def load_history(self):
        """加载历史记录"""
        records = self.history_manager.get_all_records()
        
        self.table.setRowCount(len(records))
        
        for row, record in enumerate(records):
            # 学号
            self.table.setItem(row, 0, QTableWidgetItem(record['student_id']))
            
            # 时间
            self.table.setItem(row, 1, QTableWidgetItem(record['last_processed']))
            
            # 状态
            status_text = '成功' if record['status'] == 'success' else '失败'
            self.table.setItem(row, 2, QTableWidgetItem(status_text))
            
            # 操作按钮
            verify_btn = QPushButton("核对")
            verify_btn.clicked.connect(lambda checked, r=record: self.on_verify(r))
            self.table.setCellWidget(row, 3, verify_btn)
    
    def on_verify(self, record: dict):
        """打开数据编辑器"""
        from .data_editor_dialog import DataEditorDialog
        
        try:
            dialog = DataEditorDialog(
                student_id=record['student_id'],
                data_file=record['data_file'],
                base_dir=self.base_dir,
                parent=self
            )
            dialog.show()  # QMainWindow使用show()而不是exec_()
            
        except Exception as e:
            QMessageBox.critical(self, "错误", f"打开数据编辑器失败:\n{str(e)}")
