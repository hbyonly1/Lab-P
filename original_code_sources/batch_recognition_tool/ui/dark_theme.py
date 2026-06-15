"""
深色主题样式表
"""

DARK_THEME = """
/* 全局样式 */
QWidget {
    background-color: #1e1e1e;
    color: #e0e0e0;
    font-family: "Microsoft YaHei UI", "Segoe UI", Arial, sans-serif;
    font-size: 9pt;
}

/* 主窗口 */
QMainWindow {
    background-color: #1e1e1e;
}

/* 分组框 */
QGroupBox {
    background-color: #252525;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    margin-top: 12px;
    padding-top: 12px;
    font-weight: bold;
    color: #ffffff;
}

QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    padding: 4px 8px;
    background-color: #252525;
    border-radius: 4px;
}

/* 输入框 */
QLineEdit {
    background-color: #2d2d2d;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    padding: 6px 10px;
    color: #e0e0e0;
    selection-background-color: #0d7377;
}

QLineEdit:focus {
    border: 1px solid #0d7377;
}

QLineEdit:disabled {
    background-color: #252525;
    color: #808080;
}

/* 按钮 */
QPushButton {
    background-color: #2d2d2d;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    padding: 8px 16px;
    color: #e0e0e0;
    font-weight: 500;
}

QPushButton:hover {
    background-color: #3a3a3a;
    border: 1px solid #4a4a4a;
}

QPushButton:pressed {
    background-color: #252525;
}

QPushButton:disabled {
    background-color: #252525;
    color: #606060;
    border: 1px solid #2d2d2d;
}

/* 主要按钮（开始按钮） */
QPushButton#start_btn {
    background-color: #0d7377;
    border: 1px solid #0d7377;
    color: #ffffff;
    font-weight: bold;
}

QPushButton#start_btn:hover {
    background-color: #14a085;
}

QPushButton#start_btn:pressed {
    background-color: #0a5a5d;
}

/* 危险按钮（停止按钮） */
QPushButton#stop_btn {
    background-color: #8b2635;
    border: 1px solid #8b2635;
    color: #ffffff;
}

QPushButton#stop_btn:hover {
    background-color: #a53545;
}

/* 警告按钮（暂停按钮） */
QPushButton#pause_btn {
    background-color: #b8860b;
    border: 1px solid #b8860b;
    color: #ffffff;
}

QPushButton#pause_btn:hover {
    background-color: #daa520;
}

/* 数字输入框 */
QSpinBox {
    background-color: #2d2d2d;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    padding: 4px 8px;
    color: #e0e0e0;
}

QSpinBox:focus {
    border: 1px solid #0d7377;
}

QSpinBox::up-button, QSpinBox::down-button {
    background-color: #3a3a3a;
    border: none;
    border-radius: 3px;
    width: 16px;
}

QSpinBox::up-button:hover, QSpinBox::down-button:hover {
    background-color: #4a4a4a;
}

/* 列表框 */
QListWidget {
    background-color: #2d2d2d;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    padding: 4px;
    color: #e0e0e0;
}

QListWidget::item {
    padding: 6px 10px;
    border-radius: 4px;
    margin: 2px 0;
}

QListWidget::item:hover {
    background-color: #3a3a3a;
}

QListWidget::item:selected {
    background-color: #0d7377;
    color: #ffffff;
}

/* 文本编辑框 */
QTextEdit {
    background-color: #1a1a1a;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    padding: 8px;
    color: #e0e0e0;
    font-family: "Consolas", "Courier New", monospace;
}

/* 单选按钮 */
QRadioButton {
    color: #e0e0e0;
    spacing: 8px;
}

QRadioButton::indicator {
    width: 16px;
    height: 16px;
    border-radius: 8px;
    border: 2px solid #3a3a3a;
    background-color: #2d2d2d;
}

QRadioButton::indicator:checked {
    background-color: #0d7377;
    border: 2px solid #0d7377;
}

QRadioButton::indicator:hover {
    border: 2px solid #4a4a4a;
}

/* 进度条 */
QProgressBar {
    background-color: #2d2d2d;
    border: 1px solid #3a3a3a;
    border-radius: 6px;
    text-align: center;
    color: #e0e0e0;
    height: 20px;
}

QProgressBar::chunk {
    background-color: #0d7377;
    border-radius: 5px;
}

/* 标签 */
QLabel {
    color: #e0e0e0;
    background-color: transparent;
}

/* 滚动条 */
QScrollBar:vertical {
    background-color: #2d2d2d;
    width: 12px;
    border-radius: 6px;
}

QScrollBar::handle:vertical {
    background-color: #4a4a4a;
    border-radius: 6px;
    min-height: 20px;
}

QScrollBar::handle:vertical:hover {
    background-color: #5a5a5a;
}

QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
    height: 0px;
}

QScrollBar:horizontal {
    background-color: #2d2d2d;
    height: 12px;
    border-radius: 6px;
}

QScrollBar::handle:horizontal {
    background-color: #4a4a4a;
    border-radius: 6px;
    min-width: 20px;
}

QScrollBar::handle:horizontal:hover {
    background-color: #5a5a5a;
}

QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
    width: 0px;
}

/* 消息框 */
QMessageBox {
    background-color: #1e1e1e;
}

QMessageBox QLabel {
    color: #e0e0e0;
}

QMessageBox QPushButton {
    min-width: 80px;
}

/* 文件对话框 */
QFileDialog {
    background-color: #1e1e1e;
    color: #e0e0e0;
}

/* 表格控件 */
QTableWidget {
    background-color: #2d2d2d;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    gridline-color: #3a3a3a;
    color: #e0e0e0;
    selection-background-color: #0d7377;
}

QTableWidget::item {
    padding: 4px;
}

QTableWidget::item:selected {
    background-color: #0d7377;
    color: #ffffff;
}

QTableWidget::item:hover {
    background-color: #3a3a3a;
}

QHeaderView::section {
    background-color: #252525;
    color: #e0e0e0;
    padding: 6px;
    border: 1px solid #3a3a3a;
}

QTableCornerButton::section {
    background-color: #252525;
    border: 1px solid #3a3a3a;
}
"""
