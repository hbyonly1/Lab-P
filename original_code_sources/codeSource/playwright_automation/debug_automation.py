"""
调试版本的 Playwright 自动化脚本
增加详细的调试信息，帮助诊断脚本注入问题
"""
import asyncio
import os
import json
from datetime import datetime
from playwright.async_api import async_playwright


async def run_debug_automation(student_id: str, config_path: str = "config.json"):
    """运行调试版本的自动化"""
    
    # 加载配置
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    async with async_playwright() as p:
        print(f"\n{'='*60}")
        print(f"调试模式 - 学号: {student_id}")
        print(f"{'='*60}\n")
        
        # 创建用户数据目录
        user_data_dir = f"./browser_profiles/{student_id}"
        os.makedirs(user_data_dir, exist_ok=True)
        
        # 启动浏览器
        print("[1/8] 启动浏览器...")
        browser = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=False,
            slow_mo=500,
            viewport={"width": 1280, "height": 720},
            devtools=True  # 打开开发者工具
        )
        
        page = await browser.new_page()
        
        # 读取用户脚本
        print(f"[2/8] 读取用户脚本: {config['userscript_path']}")
        with open(config['userscript_path'], 'r', encoding='utf-8') as f:
            userscript_content = f.read()
        
        print(f"    脚本大小: {len(userscript_content)} 字符")
        
        # 设置学号
        print(f"[3/8] 设置学号到 localStorage: {student_id}")
        await page.add_init_script(f"""
            localStorage.setItem('__tm_auto_login_id', '{student_id}');
            console.log('[Playwright] 学号已设置:', localStorage.getItem('__tm_auto_login_id'));
        """)
        
        # 注入用户脚本
        print("[4/8] 注入用户脚本...")
        await page.add_init_script(f"""
            console.log('[Playwright] 开始注入用户脚本...');
            
            // 立即执行脚本
            (function() {{
                try {{
                    {userscript_content}
                    console.log('[Playwright] 用户脚本执行完成');
                }} catch (e) {{
                    console.error('[Playwright] 用户脚本执行失败:', e);
                }}
            }})();
        """)
        
        # 监听控制台
        def handle_console(msg):
            print(f"    [浏览器] {msg.type}: {msg.text}")
        
        page.on("console", handle_console)
        
        # 导航到目标网站
        print(f"[5/8] 访问: {config['target_url']}")
        await page.goto(config['target_url'])
        
        # 等待页面加载
        print("[6/8] 等待页面加载...")
        await page.wait_for_load_state("networkidle")
        
        # 检查脚本是否注入
        print("[7/8] 检查脚本注入状态...")
        
        # 检查 localStorage
        storage_check = await page.evaluate("""
            () => {
                return {
                    studentId: localStorage.getItem('__tm_auto_login_id'),
                    hasPanel: !!document.getElementById('__tm_panel'),
                    hasButton: !!document.getElementById('__tm_btn_run_automation')
                };
            }
        """)
        
        print(f"    localStorage 学号: {storage_check['studentId']}")
        print(f"    插件面板存在: {storage_check['hasPanel']}")
        print(f"    自动化按钮存在: {storage_check['hasButton']}")
        
        if not storage_check['hasPanel']:
            print("\n    ⚠️ 警告: 插件面板未找到！")
            print("    可能原因:")
            print("    1. 脚本未正确执行")
            print("    2. URL 不匹配 @match 规则")
            print("    3. 脚本执行时机不对")
            
            # 尝试手动执行脚本
            print("\n    尝试手动执行脚本...")
            try:
                await page.evaluate(userscript_content)
                print("    ✓ 手动执行成功")
                
                # 再次检查
                await page.wait_for_timeout(1000)
                has_panel = await page.evaluate("!!document.getElementById('__tm_panel')")
                print(f"    插件面板现在存在: {has_panel}")
            except Exception as e:
                print(f"    ✗ 手动执行失败: {e}")
        
        # 等待用户检查
        print("\n[8/8] 调试完成")
        print("\n请在浏览器中检查:")
        print("  1. 控制台是否有错误")
        print("  2. 插件面板是否显示")
        print("  3. localStorage 中的学号是否正确")
        print("\n按 Ctrl+C 关闭浏览器...")
        
        try:
            await page.wait_for_timeout(300000)  # 等待5分钟
        except KeyboardInterrupt:
            print("\n用户中断")
        
        await browser.close()


if __name__ == "__main__":
    import sys
    
    student_id = sys.argv[1] if len(sys.argv) > 1 else "2410150207"
    asyncio.run(run_debug_automation(student_id))
