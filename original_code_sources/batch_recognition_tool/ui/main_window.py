"""
主窗口UI
"""
import os
from datetime import datetime
from PyQt5.QtWidgets import (
    QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QLineEdit, QTextEdit, QSpinBox,
    QFileDialog, QMessageBox, QRadioButton, QButtonGroup,
    QListWidget, QListWidgetItem, QProgressBar, QGroupBox,
    QDialog, QInputDialog
)
import subprocess
from PyQt5.QtCore import Qt, pyqtSignal, QThread
from PyQt5.QtGui import QFont, QColor

from core import logger, ConfigManager, APIClient, StudentQueue, ProcessingResult
from core.processor import BatchProcessor
from utils import validate_directory, get_student_folders, NotificationManager, HistoryManager
from utils.export_utils import export_results_to_csv, export_results_to_json
from .dark_theme import DARK_THEME


class MainWindow(QMainWindow):
    """主窗口"""
    
    # 信号
    log_signal = pyqtSignal(str, str, str)  # message, log_type, status
    progress_signal = pyqtSignal(dict)  # status dict
    student_status_signal = pyqtSignal(str, str)  # student_id, status
    
    def __init__(self):
        super().__init__()
        
        # 窗口状态标志
        self._is_closing = False
        
        # 配置管理器
        self.config_manager = ConfigManager()
        
        # 历史管理器
        self.history_manager = HistoryManager()
        
        # 核心组件
        self.student_queue = StudentQueue()
        self.processor = None
        self.api_client = None
        
        # 处理结果
        self.processing_results = []
        
        # 应用深色主题
        self.setStyleSheet(DARK_THEME)
        
        # 初始化UI
        self.init_ui()
        
        # Web服务器
        from utils.server import VerificationServer
        # Use a default base dir or current, will be updated when user selects dir?
        # Ideally server should serve from the selected directory.
        # But server init requires valid dir? 
        # Let's start server with current dir or app dir, and update base_dir when needed?
        # Server.py allows updating base_dir? No, it's passed in init.
        # Let's pass CWD first, and we can access the server instance to update it if needed or server handles absolute paths.
        # Actually server handles personalData path. We need to make sure server serves correct files.
        # In this app, data is in `dir_input` path.
        # Let's update `VerificationServer` to allow dynamic base_dir or pass it in helper.
        # For now, let's start with CWD, and assume user selects `dir_input`.
        # Wait, if `dir_input` changes, server needs to know.
        # Simple fix: Pass `self.dir_input.text()` when handling requests? 
        # But server runs in thread.
        # Better: Pass a lambda or reference to get current base dir?
        # Or just restart server? Restarting is cleaner but slower.
        # Let's let server serve from a FIXED root (project root?) and we use absolute paths?
        # No, `personalData` is relative to where script runs usually, OR relative to `dir_input`.
        # User selects "Batch Recognition Directory". That dir contains `personalData`.
        # So server root should be `dir_input`.
        # We will start server later when directory is selected? Or start now and update?
        # Let's start it now with None, and set it later.
        self.web_server = VerificationServer(base_dir=os.getcwd())
        self.web_server.start()
        
        # 连接信号
        self.log_signal.connect(self._on_log_received)
        self.progress_signal.connect(self._on_progress_update)
        self.student_status_signal.connect(self._on_student_status_update)
        
        # 设置日志回调
        logger.add_callback(self._log_callback)
        
        # 加载配置
        self.load_config()
    
    def init_ui(self):
        """初始化UI"""
        self.setWindowTitle("批量预识别工具 v1.0")
        self.setGeometry(100, 100, 1000, 600)
        
        # 主窗口部件
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        
        # 主布局（水平分割）
        main_layout = QHBoxLayout()
        central_widget.setLayout(main_layout)
        
        # 左侧配置区域
        left_panel = self.create_left_panel()
        main_layout.addWidget(left_panel, 1)
        
        # 右侧日志区域
        right_panel = self.create_right_panel()
        main_layout.addWidget(right_panel, 2)
    
    def create_left_panel(self) -> QWidget:
        """创建左侧配置面板"""
        panel = QWidget()
        layout = QVBoxLayout()
        panel.setLayout(layout)
        
        # 识别目录
        dir_group = QGroupBox(" 识别目录")
        dir_layout = QVBoxLayout()
        
        self.dir_input = QLineEdit()
        self.dir_input.setReadOnly(True)
        self.dir_input.setPlaceholderText("请选择识别目录...")
        dir_layout.addWidget(self.dir_input)
        
        self.dir_btn = QPushButton("选择目录")
        self.dir_btn.clicked.connect(self.on_select_directory)
        dir_layout.addWidget(self.dir_btn)
        
        dir_group.setLayout(dir_layout)
        layout.addWidget(dir_group)
        
        # API Key
        api_group = QGroupBox(" API Key")
        api_layout = QVBoxLayout()
        
        self.api_input = QLineEdit()
        self.api_input.setPlaceholderText("请输入豆包 API Key...")
        self.api_input.setEchoMode(QLineEdit.Password)
        self.api_input.textChanged.connect(self.on_api_key_changed)
        api_layout.addWidget(self.api_input)
        
        self.test_api_btn = QPushButton("测试连接")
        self.test_api_btn.clicked.connect(self.on_test_api)
        api_layout.addWidget(self.test_api_btn)
        
        api_group.setLayout(api_layout)
        layout.addWidget(api_group)
        
        # 并发设置
        concurrent_layout = QHBoxLayout()
        concurrent_layout.addWidget(QLabel(" 并发数:"))
        self.concurrent_spin = QSpinBox()
        self.concurrent_spin.setMinimum(1)
        self.concurrent_spin.setMaximum(10)
        self.concurrent_spin.setValue(1)
        self.concurrent_spin.valueChanged.connect(self.on_concurrent_changed)
        concurrent_layout.addWidget(self.concurrent_spin)
        concurrent_layout.addStretch()
        layout.addLayout(concurrent_layout)
        
        # 重试设置
        retry_layout = QHBoxLayout()
        retry_layout.addWidget(QLabel("[处理中] 重试次数:"))
        self.retry_spin = QSpinBox()
        self.retry_spin.setMinimum(0)
        self.retry_spin.setMaximum(5)
        self.retry_spin.setValue(2)
        self.retry_spin.valueChanged.connect(self.on_retry_changed)
        retry_layout.addWidget(self.retry_spin)
        retry_layout.addStretch()
        layout.addLayout(retry_layout)
        
        # 学号队列
        queue_group = QGroupBox(" 学号队列")
        queue_layout = QVBoxLayout()
        
        self.student_list = QListWidget()
        self.student_list.setMaximumHeight(150)
        queue_layout.addWidget(self.student_list)
        
        student_input_layout = QHBoxLayout()
        self.student_input = QLineEdit()
        self.student_input.setPlaceholderText("输入学号...")
        self.student_input.returnPressed.connect(self.on_add_student)
        student_input_layout.addWidget(self.student_input)
        
        self.add_student_btn = QPushButton("添加")
        self.add_student_btn.clicked.connect(self.on_add_student)
        student_input_layout.addWidget(self.add_student_btn)
        queue_layout.addLayout(student_input_layout)
        
        self.import_btn = QPushButton("从文件导入")
        self.import_btn.clicked.connect(self.on_import_students)
        queue_layout.addWidget(self.import_btn)
        
        queue_group.setLayout(queue_layout)
        layout.addWidget(queue_group)
        
        # 控制按钮
        self.start_btn = QPushButton("开始批量识别")
        self.start_btn.setObjectName("start_btn")
        self.start_btn.clicked.connect(self.on_start)
        layout.addWidget(self.start_btn)
        
        control_layout = QHBoxLayout()
        self.pause_btn = QPushButton("暂停")
        self.pause_btn.setObjectName("pause_btn")
        self.pause_btn.clicked.connect(self.on_pause)
        self.pause_btn.setEnabled(False)
        control_layout.addWidget(self.pause_btn)
        
        self.stop_btn = QPushButton("停止")
        self.stop_btn.setObjectName("stop_btn")
        self.stop_btn.clicked.connect(self.on_stop)
        self.stop_btn.setEnabled(False)
        control_layout.addWidget(self.stop_btn)

        
        # Test (Do Nothing) Button
        self.test_nothing_btn = QPushButton("Test (Do Nothing)")
        self.test_nothing_btn.clicked.connect(self.on_test_nothing)
        control_layout.addWidget(self.test_nothing_btn)
        
        layout.addLayout(control_layout)
        
        # 数据核对按钮
        self.verify_btn = QPushButton("数据核对")
        self.verify_btn.clicked.connect(self.on_verification)
        layout.addWidget(self.verify_btn)
        
        layout.addStretch()
        return panel
    
    def create_right_panel(self) -> QWidget:
        """创建右侧日志面板"""
        panel = QWidget()
        layout = QVBoxLayout()
        panel.setLayout(layout)
        
        # 日志级别选择
        log_level_layout = QHBoxLayout()
        self.log_simple_radio = QRadioButton("简要")
        self.log_detailed_radio = QRadioButton("详细")
        self.log_simple_radio.setChecked(True)
        self.log_simple_radio.toggled.connect(self.on_log_level_changed)
        
        log_level_layout.addWidget(self.log_simple_radio)
        log_level_layout.addWidget(self.log_detailed_radio)
        log_level_layout.addStretch()
        layout.addLayout(log_level_layout)
        
        # 日志文本框
        self.log_text = QTextEdit()
        self.log_text.setReadOnly(True)
        self.log_text.setFont(QFont("Consolas", 9))
        layout.addWidget(self.log_text)
        
        # 日志按钮
        log_btn_layout = QHBoxLayout()
        self.clear_log_btn = QPushButton("清空日志")
        self.clear_log_btn.clicked.connect(self.on_clear_log)
        log_btn_layout.addWidget(self.clear_log_btn)
        
        self.export_log_btn = QPushButton("导出日志")
        self.export_log_btn.clicked.connect(self.on_export_log)
        log_btn_layout.addWidget(self.export_log_btn)
        
        self.export_result_btn = QPushButton("导出结果报告")
        self.export_result_btn.clicked.connect(self.on_export_results)
        log_btn_layout.addWidget(self.export_result_btn)
        layout.addLayout(log_btn_layout)
        
        # 统计信息
        stats_group = QGroupBox("统计信息")
        stats_layout = QVBoxLayout()
        
        self.stats_label = QLabel("总数: 0 | 完成: 0 | 进行中: 0 | 失败: 0 | 等待: 0")
        stats_layout.addWidget(self.stats_label)
        
        self.progress_bar = QProgressBar()
        self.progress_bar.setValue(0)
        stats_layout.addWidget(self.progress_bar)
        
        stats_group.setLayout(stats_layout)
        layout.addWidget(stats_group)
        
        return panel
    
    def load_config(self):
        """加载配置"""
        # 加载目录
        last_dir = self.config_manager.get('last_directory', '')
        if last_dir and os.path.exists(last_dir):
            self.dir_input.setText(last_dir)
        
        # 加载API Key
        api_key = self.config_manager.get('api_key', '')
        if api_key:
            self.api_input.setText(api_key)
        
        # 加载并发数
        concurrent = self.config_manager.get('concurrent_workers', 1)
        self.concurrent_spin.setValue(concurrent)
        
        # 加载重试次数
        retries = self.config_manager.get('max_retries', 2)
        self.retry_spin.setValue(retries)
        
        # 加载日志级别
        log_level = self.config_manager.get('log_level', 0)
        if log_level == 0:
            self.log_simple_radio.setChecked(True)
        else:
            self.log_detailed_radio.setChecked(True)
        logger.set_level(log_level)
        
        # 加载窗口几何
        geometry = self.config_manager.get('window_geometry', {})
        if geometry:
            self.setGeometry(
                geometry.get('x', 100),
                geometry.get('y', 100),
                geometry.get('width', 1000),
                geometry.get('height', 600)
            )
    
    def save_window_geometry(self):
        """保存窗口几何"""
        geometry = self.geometry()
        self.config_manager.set('window_geometry', {
            'x': geometry.x(),
            'y': geometry.y(),
            'width': geometry.width(),
            'height': geometry.height()
        })
    
    def closeEvent(self, event):
        """关闭事件"""
        self.save_window_geometry()
        
        # 停止处理
        if self.processor and self.processor.running:
            reply = QMessageBox.question(
                self, '确认',
                '处理正在进行中，确定要退出吗？',
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No
            )
            
            if reply == QMessageBox.Yes:
                self._is_closing = True
                # 移除日志回调，防止窗口关闭后继续调用
                logger.remove_callback(self._log_callback)
                self.processor.stop()
                event.accept()
            else:
                event.ignore()
        else:
            self._is_closing = True
            # 移除日志回调
            logger.remove_callback(self._log_callback)
            event.accept()
    
    # 事件处理器
    def on_select_directory(self):
        """选择目录"""
        directory = QFileDialog.getExistingDirectory(
            self, "选择识别目录",
            self.dir_input.text() or os.path.expanduser("~")
        )
        
        if directory:
            # 验证目录
            valid, message = validate_directory(directory)
            if valid:
                self.dir_input.setText(directory)
                self.config_manager.set('last_directory', directory)
                self.config_manager.add_recent_directory(directory)
                logger.log_simple(f"[成功] 已选择目录: {directory}", status='success')
                
                # 显示可用学号
                folders = get_student_folders(directory)
                if folders:
                    logger.log_simple(f"发现 {len(folders)} 个学号文件夹", status='info')
            else:
                QMessageBox.warning(self, "目录验证失败", message)
    
    def on_api_key_changed(self):
        """API Key改变"""
        api_key = self.api_input.text().strip()
        if api_key:
            self.config_manager.set('api_key', api_key)
    
    def on_test_api(self):
        """测试API连接"""
        api_key = self.api_input.text().strip()
        if not api_key:
            QMessageBox.warning(self, "提示", "请先输入API Key")
            return
        
        try:
            client = APIClient(api_key, max_retries=0)
            # 简单测试
            response = client._call_api("测试", None, "doubao-seed-1-6-vision-250815")
            QMessageBox.information(self, "成功", "API连接测试成功！")
            logger.log_simple("[成功] API连接测试成功", status='success')
        except Exception as e:
            QMessageBox.warning(self, "失败", f"API连接测试失败:\n{str(e)}")
            logger.log_simple(f"[失败] API连接测试失败: {str(e)}", status='error')
    
    def on_concurrent_changed(self, value):
        """并发数改变"""
        self.config_manager.set('concurrent_workers', value)
    
    def on_retry_changed(self, value):
        """重试次数改变"""
        self.config_manager.set('max_retries', value)
    
    def on_log_level_changed(self):
        """日志级别改变"""
        if self.log_simple_radio.isChecked():
            logger.set_level(logger.SIMPLE)
            self.config_manager.set('log_level', 0)
        else:
            logger.set_level(logger.DETAILED)
            self.config_manager.set('log_level', 1)
    
    def on_add_student(self):
        """添加学号 (支持批量输入，空格分隔)"""
        text = self.student_input.text().strip()
        if not text:
            return
            
        # 按空格分割支持批量输入
        raw_ids = text.split()
        added_count = 0
        duplicate_count = 0
        new_student_ids = []
        
        for student_id in raw_ids:
            if not student_id:
                continue
                
            # 如果输入的是路径，提取最后的文件夹名作为学号
            if os.path.sep in student_id or '/' in student_id:
                student_id = os.path.basename(os.path.normpath(student_id))
            
            if self.student_queue.add_student(student_id):
                added_count += 1
                new_student_ids.append(student_id)
            else:
                duplicate_count += 1
        
        if added_count > 0:
            self.update_student_list()
            self.student_input.clear()
            
            msg = f"成功添加 {added_count} 个学号"
            if duplicate_count > 0:
                msg += f"，忽略 {duplicate_count} 个重复/无效项"
            logger.log_simple(msg, status='info')

            # 如果正在运行或暂停，且使用了自定义配置，则弹出配置窗口
            if hasattr(self, 'processor') and self.processor and new_student_ids:
                from .batch_options_dialog import BatchOptionsDialog
                
                # Use current base_dir
                base_dir = self.dir_input.text()
                
                # Show dialog only for NEW students
                dialog = BatchOptionsDialog(base_dir, new_student_ids, self)
                if dialog.exec() == QDialog.Accepted:
                    new_configs, _ = dialog.get_options()
                    if new_configs:
                        # Update processor config
                        if not hasattr(self.processor, 'student_configs'):
                            self.processor.student_configs = {}
                        
                        self.processor.student_configs.update(new_configs)
                        logger.log_simple(f"[配置] 已更新 {len(new_student_ids)} 个新学号的实验配置", status='info')
                else:
                    logger.log_simple(f"[配置] 用户取消配置，新学号将使用默认设置 (全部实验)", status='warning')

        elif duplicate_count > 0:
            QMessageBox.warning(self, "提示", "输入的学号均已存在或无效")
    
    def on_import_students(self):
        """从文件导入学号"""
        file_path, _ = QFileDialog.getOpenFileName(
            self, "选择学号文件",
            "",
            "文本文件 (*.txt);;所有文件 (*.*)"
        )
        
        if file_path:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    student_ids = [line.strip() for line in f if line.strip()]
                
                count = self.student_queue.add_students(student_ids)
                self.update_student_list()
                logger.log_simple(f"[成功] 已导入 {count} 个学号", status='success')
                
            except Exception as e:
                QMessageBox.warning(self, "导入失败", str(e))
    
    def on_start(self):
        """开始处理"""
        # 验证
        if not self.dir_input.text():
            QMessageBox.warning(self, "提示", "请先选择识别目录")
            return
        
        base_dir = self.dir_input.text()
        
        # 1. Show Options Dialog
        from .batch_options_dialog import BatchOptionsDialog
        # Pass current queue of student IDs
        student_list = self.student_queue.queue
        dialog = BatchOptionsDialog(base_dir, student_list, self)
        
        if dialog.exec() != QDialog.Accepted:
            return # User cancelled
            
        # config is now a dict {student_id: [profiles]}
        student_configs, filename_suffix = dialog.get_options()
        if not student_configs:
            return
            
        api_key = self.api_input.text().strip()
        if not api_key:
            QMessageBox.warning(self, "提示", "请先输入API Key")
            return
        
        if self.student_queue.get_status()['total'] == 0:
            QMessageBox.warning(self, "提示", "请先添加学号")
            return
        
        # 创建API客户端
        max_retries = self.retry_spin.value()
        self.api_client = APIClient(api_key, max_retries)
        
        # 创建处理器
        max_workers = self.concurrent_spin.value()
        self.processor = BatchProcessor(max_workers)
        
        # 设置回调
        self.processor.on_student_start = self._on_student_start
        self.processor.on_student_done = self._on_student_done
        self.processor.on_complete = self._on_all_complete
        
        # 启动处理
        self.processor.start(
            self.student_queue, base_dir, self.api_client,
            student_configs=student_configs,
            filename_suffix=filename_suffix
        )
        
        # 更新UI
        self.start_btn.setEnabled(False)
        self.pause_btn.setEnabled(True)
        self.stop_btn.setEnabled(True)
        
        logger.log_simple("[开始] 开始批量处理", status='info')
    
    def on_pause(self):
        """暂停/恢复"""
        if not self.processor:
            return
        
        if self.processor.paused:
            self.processor.resume()
            self.pause_btn.setText("暂停")
        else:
            self.processor.pause()
            self.pause_btn.setText("恢复")
    
    def on_stop(self):
        """停止处理"""
        if not self.processor:
            return
        
        reply = QMessageBox.question(
            self, '确认',
            '确定要停止处理吗？',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            self.processor.stop()
            self.start_btn.setEnabled(True)
            self.pause_btn.setEnabled(False)
            self.stop_btn.setEnabled(False)
    
    def on_clear_log(self):
        """清空日志"""
        self.log_text.clear()
    
    def on_export_log(self):
        """导出日志"""
        file_path, _ = QFileDialog.getSaveFileName(
            self, "导出日志",
            f"日志_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt",
            "文本文件 (*.txt)"
        )
        
        if file_path:
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(self.log_text.toPlainText())
                logger.log_simple(f"[成功] 日志已导出: {file_path}", status='success')
            except Exception as e:
                QMessageBox.warning(self, "导出失败", str(e))
    
    def on_export_results(self):
        """导出结果"""
        if not self.processing_results:
            QMessageBox.warning(self, "提示", "暂无处理结果")
            return
        
        # 选择格式
        reply = QMessageBox.question(
            self, "选择导出格式",
            "导出为CSV（简要）还是JSON（详细）？\n\nYes = CSV\nNo = JSON",
            QMessageBox.Yes | QMessageBox.No | QMessageBox.Cancel
        )
        
        if reply == QMessageBox.Cancel:
            return
        
        if reply == QMessageBox.Yes:
            # CSV
            file_path, _ = QFileDialog.getSaveFileName(
                self, "导出结果",
                f"处理结果_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                "CSV文件 (*.csv)"
            )
            if file_path:
                export_results_to_csv(self.processing_results, file_path)
        else:
            # JSON
            file_path, _ = QFileDialog.getSaveFileName(
                self, "导出结果",
                f"处理结果_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
                "JSON文件 (*.json)"
            )
            if file_path:
                export_results_to_json(self.processing_results, file_path)
    
    def on_test_nothing(self):
        """Test mode with doNothing flag"""
        student_id, ok = QInputDialog.getText(self, "Test Mode", "请输入需测试的学号:")
        if ok and student_id:
            student_id = student_id.strip()
            if not student_id:
                return
            
            # Match paths from utils/server.py
            python_path = r"C:\Users\hbyan\AppData\Local\Programs\Python\Python39\python.exe"
            script_dir = r"D:\Users\hbyan\Downloads\edit\playwright_automation"
            script_name = "parallel_automation.py"

            # Run in new independent CMD window using "cmd /k" to keep window open after run
            # This avoids encoding issues with captured pipes and lets user see output
            cmd = ["cmd.exe", "/k", python_path, script_name, "test", student_id, "doNothing"]
            
            try:
                logger.log_simple(f"[Test] Launching in new window: {' '.join(cmd)}", status='info')
                
                subprocess.Popen(
                    cmd, 
                    cwd=script_dir,
                    creationflags=subprocess.CREATE_NEW_CONSOLE
                )
                
                logger.log_simple(f"[Test] Test launched in separate window", status='success')
                    
            except Exception as e:
                logger.log_simple(f"[Test] Exception: {str(e)}", status='error')
                QMessageBox.critical(self, "Error", f"Failed to launch command:\n{str(e)}")
                    

    
    def on_verification(self):
        """打开数据核对页面 (Web)"""
        import webbrowser
        
        base_dir = self.dir_input.text()
        if not base_dir:
            QMessageBox.warning(self, "提示", "请先选择识别目录")
            return
            
        # Update server base dir to selected directory
        if hasattr(self, 'web_server') and self.web_server:
            # We need to access the handler or server instance to update base_dir
            # In server.py, httpd.base_dir is used.
            if self.web_server.httpd:
                self.web_server.httpd.base_dir = base_dir
                self.web_server.base_dir = base_dir # Update wrapper too just in case
        
        url = self.web_server.get_url()
        if url:
            webbrowser.open(url)
        else:
            QMessageBox.critical(self, "错误", "Web服务器未启动")
    
    def update_student_list(self):
        """更新学号列表"""
        self.student_list.clear()
        
        status = self.student_queue.get_status()
        
        # 添加待处理
        for sid in self.student_queue.queue:
            item = QListWidgetItem(f"{sid} [待处理] ")
            self.student_list.addItem(item)
        
        # 添加处理中
        for sid in self.student_queue.processing:
            item = QListWidgetItem(f"{sid} [处理中]")
            item.setForeground(QColor('blue'))
            self.student_list.addItem(item)
        
        # 添加已完成
        for sid in self.student_queue.completed:
            item = QListWidgetItem(f"{sid} [成功]")
            item.setForeground(QColor('green'))
            self.student_list.addItem(item)
        
        # 添加失败
        for sid in self.student_queue.failed:
            item = QListWidgetItem(f"{sid} [失败]")
            item.setForeground(QColor('red'))
            self.student_list.addItem(item)
        
        # 更新统计
        self._update_stats(status)
    
    def _update_stats(self, status: dict):
        """更新统计信息"""
        total = status['total']
        completed = status['completed']
        failed = status['failed']
        processing = status['processing']
        pending = status['pending']
        
        self.stats_label.setText(
            f"总数: {total} | 完成: {completed} | 进行中: {processing} | "
            f"失败: {failed} | 等待: {pending}"
        )
        
        # 更新进度条
        if total > 0:
            progress = int((completed + failed) / total * 100)
            self.progress_bar.setValue(progress)
        else:
            self.progress_bar.setValue(0)
    
    # 回调函数
    def _log_callback(self, message: str, log_type: str, status: str):
        """日志回调"""
        # 检查窗口是否正在关闭
        if self._is_closing:
            return
        try:
            self.log_signal.emit(message, log_type, status)
        except RuntimeError:
            # 窗口已被删除，忽略错误
            pass
    
    def _on_log_received(self, message: str, log_type: str, status: str):
        """接收日志（UI线程）"""
        # 检查窗口是否正在关闭
        if self._is_closing:
            return
        
        try:
            # 根据状态设置颜色
            color_map = {
                'success': 'green',
                'error': 'red',
                'warning': 'orange',
                'info': 'white'
            }
            color = color_map.get(status, 'white')
            
            # 添加到日志
            self.log_text.append(f'<span style="color:{color}">{message}</span>')
            
            # 自动滚动到底部
            self.log_text.verticalScrollBar().setValue(
                self.log_text.verticalScrollBar().maximum()
            )
        except RuntimeError:
            # 窗口已被删除，忽略错误
            pass
    
    def _on_student_start(self, student_id: str):
        """学号开始处理"""
        if self._is_closing:
            return
        try:
            self.student_status_signal.emit(student_id, 'processing')
        except RuntimeError:
            pass
    
    def _on_student_done(self, student_id: str, result: ProcessingResult):
        """学号处理完成"""
        if self._is_closing:
            return
        try:
            status = 'success' if result.status == 'success' else 'failed'
            self.student_status_signal.emit(student_id, status)
            
            # 立即记录到历史（成功的学号）
            if result.status == 'success':
                base_dir = self.dir_input.text()
                data_file = f"personalData/{student_id}/{student_id}_apiRecognizedData.json"
                self.history_manager.add_record(student_id, data_file, 'success')
                logger.log_detailed(f"已将学号 {student_id} 添加到核对历史", status='info')
        except RuntimeError:
            pass
    
    def _on_student_status_update(self, student_id: str, status: str):
        """更新学号状态（UI线程）"""
        if self._is_closing:
            return
        try:
            self.update_student_list()
        except RuntimeError:
            pass
    
    def _on_progress_update(self, status: dict):
        """更新进度（UI线程）"""
        if self._is_closing:
            return
        try:
            self._update_stats(status)
        except RuntimeError:
            pass
    
    def _on_all_complete(self, results: list):
        """全部处理完成"""
        if self._is_closing:
            return
        
        try:
            self.processing_results = results
            
            # 更新UI
            self.start_btn.setEnabled(True)
            self.pause_btn.setEnabled(False)
            self.stop_btn.setEnabled(False)
            
            # 统计
            total = len(results)
            success = sum(1 for r in results if r.status == 'success')
            failed = total - success
            
            # 显示通知
            enable_notification = self.config_manager.get('enable_notification', True)
            enable_sound = self.config_manager.get('enable_sound', True)
            NotificationManager.notify_completion(
                total, success, failed,
                enable_notification, enable_sound
            )
            
            # 记录完成信息（不再弹出阻塞对话框）
            logger.log_simple(
                f"[完成] 全部处理完成！总计: {total}, 成功: {success}, 失败: {failed}",
                status='success'
            )
        except RuntimeError:
            # 窗口已被删除，忽略错误
            pass
