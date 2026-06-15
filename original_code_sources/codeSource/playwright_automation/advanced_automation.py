"""
高级 Playwright 自动化脚本
支持更多自定义选项和错误处理
"""
import asyncio
import os
import json
from datetime import datetime
from playwright.async_api import async_playwright, Page


class AutomationRunner:
    """自动化运行器"""
    
    def __init__(self, config_path: str = "config.json"):
        """
        初始化
        
        Args:
            config_path: 配置文件路径
        """
        self.config = self.load_config(config_path)
        self.results = []
    
    def load_config(self, config_path: str) -> dict:
        """加载配置文件"""
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        else:
            # 默认配置
            return {
                "userscript_path": "../build/bundle.user.js",
                "target_url": "http://your-target-website.com",
                "headless": False,
                "slow_mo": 500,
                "timeout": {
                    "page_load": 30000,
                    "plugin_init": 5000,
                    "automation_complete": 120000
                },
                "screenshot": {
                    "enabled": True,
                    "directory": "screenshots"
                }
            }
    
    async def setup_page(self, page: Page, student_id: str):
        """设置页面（注入脚本和学号）"""
        # 读取用户脚本
        userscript_path = self.config["userscript_path"]
        print(f"[Setup] 读取用户脚本: {userscript_path}")
        
        with open(userscript_path, 'r', encoding='utf-8') as f:
            userscript_content = f.read()
        
        # 注入用户脚本
        await page.add_init_script(userscript_content)
        
        # 设置学号
        await page.add_init_script(f"""
            localStorage.setItem('__tm_auto_login_id', '{student_id}');
        """)
        
        # 监听控制台日志
        page.on("console", lambda msg: print(f"[浏览器] {msg.text}"))
        
        # 自动处理弹窗
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
    
    async def wait_for_login(self, page: Page):
        """等待登录完成"""
        print("[Login] 等待登录完成...")
        try:
            # 等待登录后的元素（根据实际情况调整）
            await page.wait_for_selector(
                "#LoginUserName",
                timeout=self.config["timeout"]["page_load"]
            )
            print("[Login] 登录成功！")
            return True
        except Exception as e:
            print(f"[Login] 登录超时或失败: {e}")
            return False
    
    async def wait_for_plugin(self, page: Page):
        """等待插件初始化"""
        print("[Plugin] 等待插件初始化...")
        try:
            await page.wait_for_selector(
                "#__tm_btn_run_automation",
                timeout=self.config["timeout"]["plugin_init"]
            )
            print("[Plugin] 插件已加载！")
            return True
        except Exception as e:
            print(f"[Plugin] 插件加载失败: {e}")
            return False
    
    async def run_automation_flow(self, page: Page):
        """执行自动化流程"""
        print("[Automation] 点击自动化流程按钮...")
        await page.click("#__tm_btn_run_automation")
        
        print("[Automation] 自动化流程已启动！")
        
        # 等待完成（可以根据实际情况添加更精确的判断）
        await page.wait_for_timeout(
            self.config["timeout"]["automation_complete"]
        )
        
        print("[Automation] 自动化流程完成！")
    
    async def take_screenshot(self, page: Page, student_id: str):
        """截图保存"""
        if not self.config["screenshot"]["enabled"]:
            return None
        
        screenshot_dir = self.config["screenshot"]["directory"]
        os.makedirs(screenshot_dir, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        screenshot_path = f"{screenshot_dir}/{student_id}_{timestamp}.png"
        
        await page.screenshot(path=screenshot_path, full_page=True)
        print(f"[Screenshot] 已保存: {screenshot_path}")
        
        return screenshot_path
    
    async def run_single(self, student_id: str):
        """运行单个学号的自动化"""
        result = {
            "student_id": student_id,
            "status": "pending",
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "screenshot": None,
            "error": None
        }
        
        try:
            async with async_playwright() as p:
                # 启动浏览器
                browser = await p.chromium.launch(
                    headless=self.config["headless"],
                    slow_mo=self.config["slow_mo"]
                )
                
                page = await browser.new_page()
                
                print(f"\n{'='*60}")
                print(f"开始处理学号: {student_id}")
                print(f"{'='*60}\n")
                
                # 设置页面
                await self.setup_page(page, student_id)
                
                # 导航到目标网站
                print(f"[Navigation] 访问: {self.config['target_url']}")
                await page.goto(self.config["target_url"])
                
                # 等待登录
                if not await self.wait_for_login(page):
                    raise Exception("登录失败")
                
                # 等待插件
                if not await self.wait_for_plugin(page):
                    raise Exception("插件加载失败")
                
                # 执行自动化
                await self.run_automation_flow(page)
                
                # 截图
                screenshot_path = await self.take_screenshot(page, student_id)
                result["screenshot"] = screenshot_path
                
                result["status"] = "success"
                print(f"\n✓ 学号 {student_id} 处理成功！\n")
                
                await browser.close()
                
        except Exception as e:
            result["status"] = "failed"
            result["error"] = str(e)
            print(f"\n✗ 学号 {student_id} 处理失败: {e}\n")
        
        result["end_time"] = datetime.now().isoformat()
        self.results.append(result)
        
        return result
    
    async def run_batch(self, student_ids: list):
        """批量运行"""
        print(f"\n开始批量处理 {len(student_ids)} 个学号...\n")
        
        for student_id in student_ids:
            await self.run_single(student_id)
        
        # 生成报告
        self.generate_report()
    
    def generate_report(self):
        """生成处理报告"""
        report_path = f"reports/report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        os.makedirs("reports", exist_ok=True)
        
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(self.results, f, ensure_ascii=False, indent=2)
        
        print(f"\n{'='*60}")
        print("处理报告")
        print(f"{'='*60}")
        print(f"总数: {len(self.results)}")
        print(f"成功: {sum(1 for r in self.results if r['status'] == 'success')}")
        print(f"失败: {sum(1 for r in self.results if r['status'] == 'failed')}")
        print(f"报告已保存: {report_path}")
        print(f"{'='*60}\n")


async def main():
    """主函数"""
    # 创建运行器
    runner = AutomationRunner("config.json")
    
    # 单个学号
    # await runner.run_single("2021001")
    
    # 批量学号
    student_ids = ["2021001", "2021002", "2021003"]
    await runner.run_batch(student_ids)


if __name__ == "__main__":
    asyncio.run(main())
