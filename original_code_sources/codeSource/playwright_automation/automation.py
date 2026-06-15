"""
Playwright 自动化脚本 - 使用用户脚本插件

功能：
1. 加载用户脚本
2. 填写学号并登录
3. 自动执行配置的自动化流程
"""
import asyncio
import os
from playwright.async_api import async_playwright


async def run_automation(student_id: str, userscript_path: str, target_url: str = None):
    """
    运行自动化流程
    
    Args:
        student_id: 学号
        userscript_path: 用户脚本文件路径（build/bundle.user.js）
        target_url: 目标网站URL（可选，如果不提供则使用默认）
    """
    async with async_playwright() as p:
        # 启动浏览器（使用持久化上下文以保留localStorage）
        browser = await p.chromium.launch(
            headless=False,  # 显示浏览器窗口
            slow_mo=500,     # 减慢操作速度，便于观察
        )
        
        # 创建新页面
        page = await browser.new_page()
        
        print(f"[Playwright] 开始自动化流程，学号: {student_id}")
        
        # 1. 读取用户脚本内容
        print(f"[Playwright] 读取用户脚本: {userscript_path}")
        with open(userscript_path, 'r', encoding='utf-8') as f:
            userscript_content = f.read()
        
        # 2. 注入用户脚本到页面
        print("[Playwright] 注入用户脚本...")
        await page.add_init_script(userscript_content)
        
        # 3. 设置学号到localStorage（在导航前）
        print(f"[Playwright] 设置学号: {student_id}")
        await page.add_init_script(f"""
            localStorage.setItem('__tm_auto_login_id', '{student_id}');
        """)
        
        # 4. 导航到目标网站
        if not target_url:
            # 默认URL（根据实际情况修改）
            target_url = "http://your-target-website.com"
        
        print(f"[Playwright] 导航到: {target_url}")
        await page.goto(target_url)
        
        # 5. 等待页面加载和插件初始化
        print("[Playwright] 等待插件初始化...")
        await page.wait_for_timeout(2000)
        
        # 6. 等待登录完成（检查是否已经跳转到主页面）
        print("[Playwright] 等待登录完成...")
        try:
            # 等待登录后的特征元素出现（根据实际情况调整选择器）
            await page.wait_for_selector("#LoginUserName", timeout=30000)
            print("[Playwright] 登录成功！")
        except Exception as e:
            print(f"[Playwright] 等待登录超时或失败: {e}")
            print("[Playwright] 继续执行...")
        
        # 7. 等待插件面板出现
        print("[Playwright] 等待插件面板...")
        await page.wait_for_selector("#__tm_btn_run_automation", timeout=10000)
        
        # 8. 点击"执行此配置的所有自动化流程"按钮
        print("[Playwright] 点击自动化流程按钮...")
        await page.click("#__tm_btn_run_automation")
        
        print("[Playwright] 自动化流程已启动！")
        print("[Playwright] 等待流程完成...")
        
        # 9. 等待自动化流程完成（根据实际情况调整等待时间）
        # 可以监听日志或特定元素来判断完成
        await page.wait_for_timeout(60000)  # 等待60秒
        
        print("[Playwright] 自动化流程完成！")
        
        # 10. 可选：截图保存结果
        screenshot_path = f"screenshots/{student_id}_result.png"
        os.makedirs("screenshots", exist_ok=True)
        await page.screenshot(path=screenshot_path)
        print(f"[Playwright] 截图已保存: {screenshot_path}")
        
        # 保持浏览器打开以便查看结果
        print("[Playwright] 按 Ctrl+C 关闭浏览器...")
        try:
            await page.wait_for_timeout(300000)  # 等待5分钟
        except KeyboardInterrupt:
            print("[Playwright] 用户中断")
        
        await browser.close()


async def batch_run(student_ids: list, userscript_path: str, target_url: str = None):
    """
    批量运行多个学号
    
    Args:
        student_ids: 学号列表
        userscript_path: 用户脚本文件路径
        target_url: 目标网站URL
    """
    for student_id in student_ids:
        print(f"\n{'='*60}")
        print(f"处理学号: {student_id}")
        print(f"{'='*60}\n")
        
        try:
            await run_automation(student_id, userscript_path, target_url)
        except Exception as e:
            print(f"[错误] 学号 {student_id} 处理失败: {e}")
            continue
        
        print(f"\n学号 {student_id} 处理完成\n")


if __name__ == "__main__":
    # 配置参数
    STUDENT_ID = "2021001"  # 单个学号
    # STUDENT_IDS = ["2021001", "2021002", "2021003"]  # 批量学号
    
    USERSCRIPT_PATH = "../build/bundle.user.js"  # 用户脚本路径
    TARGET_URL = "http://your-target-website.com"  # 目标网站URL
    
    # 运行单个学号
    asyncio.run(run_automation(STUDENT_ID, USERSCRIPT_PATH, TARGET_URL))
    
    # 或批量运行
    # asyncio.run(batch_run(STUDENT_IDS, USERSCRIPT_PATH, TARGET_URL))
