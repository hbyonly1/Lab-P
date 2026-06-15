"""
通知工具
"""
import winsound
from PyQt5.QtWidgets import QSystemTrayIcon, QApplication
from PyQt5.QtGui import QIcon
from PyQt5.QtCore import Qt


class NotificationManager:
    """通知管理器"""
    
    @staticmethod
    def show_completion_notification(total: int, success: int, failed: int):
        """显示完成通知"""
        try:
            # 系统托盘通知
            app = QApplication.instance()
            if app:
                tray_icon = QSystemTrayIcon()
                # 使用默认图标
                tray_icon.setIcon(app.style().standardIcon(app.style().SP_MessageBoxInformation))
                
                title = "批量识别完成"
                message = f"总计: {total} | 成功: {success} | 失败: {failed}"
                
                tray_icon.show()
                tray_icon.showMessage(
                    title,
                    message,
                    QSystemTrayIcon.Information,
                    3000  # 显示3秒
                )
        except Exception as e:
            print(f"显示通知失败: {e}")
    
    @staticmethod
    def play_sound():
        """播放完成提示音"""
        try:
            # Windows系统音
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        except Exception as e:
            print(f"播放声音失败: {e}")
    
    @staticmethod
    def notify_completion(total: int, success: int, failed: int, 
                         enable_notification: bool = True,
                         enable_sound: bool = True):
        """完成通知（组合）"""
        if enable_notification:
            NotificationManager.show_completion_notification(total, success, failed)
        
        if enable_sound:
            NotificationManager.play_sound()
