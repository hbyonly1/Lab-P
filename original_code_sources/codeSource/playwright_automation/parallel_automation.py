"""
带文件服务器的 Playwright 自动化脚本
支持整个目录上传（包括图片文件）
"""
import asyncio
import os
import json
import http.server
import socketserver
import threading
from datetime import datetime
from playwright.async_api import async_playwright, Browser, BrowserContext, Page


class FileServerHandler(http.server.SimpleHTTPRequestHandler):
    """自定义文件服务器处理器（支持 CORS）"""
    
    def end_headers(self):
        """添加 CORS 头"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()
    
    def do_OPTIONS(self):
        """处理 OPTIONS 请求（CORS 预检）"""
        self.send_response(200)
        self.end_headers()
    
    def do_GET(self):
        """处理 GET 请求"""
        # 文件映射逻辑 (如果开启 use_secondary_data，尝试使用 _2 数据)
        if getattr(self, 'use_secondary_data', False) and self.path.endswith("_apiRecognizedData.json"):
             new_path = self.path.replace("_apiRecognizedData.json", "_apiRecognizedData_2.json")
             # 检查本地文件是否存在 (去掉开头的 /)
             local_path = new_path.lstrip('/')
             if os.path.exists(local_path):
                 print(f"[FileServer] 映射覆盖: {self.path} -> {new_path}")
                 self.path = new_path

        if self.path.startswith('/__tm_list_files'):
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            # 简单的 Query 解析
            student_id = None
            if '?' in self.path:
                try:
                    query = self.path.split('?')[1]
                    params = dict(p.split('=') for p in query.split('&') if '=' in p)
                    student_id = params.get('student_id')
                except:
                    pass

            target_dir = '.'
            if student_id:
                # 尝试进入 personalData/<student_id>
                potential_dir = os.path.join('personalData', student_id)
                if os.path.exists(potential_dir):
                    target_dir = potential_dir
            
            # 获取目录下的所有文件
            files = []
            try:
                # 仅列出文件
                files = [f for f in os.listdir(target_dir) if os.path.isfile(os.path.join(target_dir, f))]
            except Exception as e:
                print(f"[FileServer] Error listing files in {target_dir}: {e}")
            
            self.wfile.write(json.dumps(files).encode('utf-8'))
        else:
            super().do_GET()

    def log_message(self, format, *args):
        """记录访问日志"""
        print(f"[FileServer] {self.address_string()} - {format % args}")


class ParallelAutomationRunner:
    """并行自动化运行器（带文件服务器）"""
    
    def __init__(self, config_path: str = "config.json"):
        """初始化"""
        self.config = self.load_config(config_path)
        self.results = []
        self.semaphore = None
        self.file_server = None
    
    def load_config(self, config_path: str) -> dict:
        """加载配置文件"""
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def start_file_server(self, start_port=None):
        """启动本地文件服务器（支持动态端口）"""
        data_directory = self.config.get("data_directory")
        base_port = start_port or self.config.get("file_server_port", 8888)
        
        if not data_directory or not os.path.exists(data_directory):
            print(f"警告: 数据目录不存在: {data_directory}")
            return None, None
        
        # 保存原目录
        original_dir = os.getcwd()
        os.chdir(data_directory)
        
        handler = FileServerHandler
        # 注入配置开关
        handler.use_secondary_data = self.config.get("use_secondary_data", False)
        if handler.use_secondary_data:
            print("注意: 已启用二级数据文件映射 (*_apiRecognizedData_2.json)")
            
        httpd = None
        actual_port = base_port
        
        # 尝试寻找可用端口 (尝试 20 次)
        for i in range(20):
            try:
                port = base_port + i
                httpd = socketserver.TCPServer(("", port), handler)
                actual_port = port
                break
            except OSError:
                continue
        
        if not httpd:
            print(f"警告: 无法启动文件服务器，端口 {base_port}-{base_port+19} 均被占用")
            os.chdir(original_dir)
            return None, None
        
        # 在后台线程运行
        thread = threading.Thread(target=httpd.serve_forever)
        thread.daemon = True
        thread.start()
        
        print(f"✓ 文件服务器已启动: http://localhost:{actual_port}")
        print(f"  服务目录: {data_directory}")
        
        return httpd, actual_port
    
    async def setup_page(self, page: Page, student_id: str, file_server_port: int, is_test_mode: bool = False):
        """设置页面（注入脚本、配置和学号）"""
        # 读取用户脚本
        userscript_path = self.config["userscript_path"]
        
        with open(userscript_path, 'r', encoding='utf-8') as f:
            userscript_content = f.read()
        
        # 读取 data.json 配置
        data_directory = self.config.get("data_directory")
        data_json_path = os.path.join(data_directory, "data.json")
        
        if os.path.exists(data_json_path):
            with open(data_json_path, 'r', encoding='utf-8') as f:
                data_json = json.load(f)
            print(f"[{student_id}] 已读取配置文件: {data_json_path}")
        else:
            data_json = None
            print(f"[{student_id}] 警告: 未找到配置文件 {data_json_path}")
        
        # 获取 API Key
        api_key = self.config.get("api_key", "")
        
        # 使用实际分配的端口
        file_server_url = f"http://localhost:{file_server_port}"
        
        # 注入配置到 localStorage（在脚本执行前）
        init_script = f"""
            // 设置学号
            localStorage.setItem('__tm_auto_login_id', '{student_id}');
            console.log('[Playwright] 学号已设置:', '{student_id}');
            
            // 设置文件服务器 URL
            window.__tm_file_server_url = '{file_server_url}';
            window.__tm_student_id = '{student_id}';
            console.log('[Playwright] 文件服务器 URL:', '{file_server_url}');
        """

        if is_test_mode:
            init_script += """
                // 设置测试模式标志
                localStorage.setItem('__tm_test_mode', 'true');
                console.log('[Playwright] 测试模式已激活 (__tm_test_mode=true)');
            """
        
        # 如果有配置文件，注入配置
        if data_json:
            data_json_str = json.dumps(data_json)
            init_script += f"""
            // 设置配置文件（使用脚本期望的键名）
            localStorage.setItem('__tm_cfg_toolkit_config_v1', {json.dumps(data_json_str)});
            console.log('[Playwright] 配置文件已注入到 __tm_cfg_toolkit_config_v1');
            """
        
        # 如果有 API Key，注入 API Key
        if api_key and api_key != "YOUR_DOUBAO_API_KEY_HERE":
            init_script += f"""
            // 设置 API Key（使用脚本期望的键名）
            localStorage.setItem('__tm_doubao_api_key', '{api_key}');
            console.log('[Playwright] API Key 已设置到 __tm_doubao_api_key');
            """

        # 设置默认页面缩放为 75%
        init_script += """
            // 设置浏览器缩放 75%
            document.addEventListener('DOMContentLoaded', () => {
                document.body.style.zoom = '75%';
                console.log('[Playwright] 页面缩放已设置为 75%');
            });
        """
        
        await page.add_init_script(init_script)
        
        # 注入用户脚本
        await page.add_init_script(f"""
            // 等待 DOM 加载后执行用户脚本
            if (document.readyState === 'loading') {{
                document.addEventListener('DOMContentLoaded', function() {{
                    {userscript_content}
                }});
            }} else {{
                {userscript_content}
            }}
        """)
        
        # 监听控制台日志
        page.on("console", lambda msg: print(f"[{student_id}] {msg.text}"))
        
        # 自动处理弹窗
        page.on("dialog", lambda dialog: asyncio.create_task(dialog.accept()))
        
        # 监听新窗口（用于跨站功能）
        async def handle_popup(popup):
            """处理新打开的窗口（跨站）"""
            try:
                print(f"[{student_id}] 检测到新窗口打开")
                
                # 等待新窗口加载
                await popup.wait_for_load_state("domcontentloaded")
                print(f"[{student_id}] 新窗口已加载: {popup.url}")
                
                # 向新窗口注入跨站执行脚本
                # 这个脚本会监听来自父窗口的消息并执行操作
                await popup.evaluate("""
                    console.log('[Playwright] 新窗口脚本注入');
                    
                    // 监听来自父窗口的执行指令
                    window.addEventListener('message', async (event) => {
                        if (event.data && event.data.type === 'TM_CROSS_SITE_EXECUTE') {
                            console.log('[CrossSite Popup] 收到执行指令:', event.data);
                            
                            const { equationType, xAxisString, yAxisString, delays } = event.data;
                            
                            function waitForElement(selector, callback, maxAttempts = 50) {
                                let attempts = 0;
                                const check = setInterval(() => {
                                    attempts++;
                                    const el = document.querySelector(selector);
                                    if (el) {
                                        clearInterval(check);
                                        callback(el);
                                    } else if (attempts >= maxAttempts) {
                                        clearInterval(check);
                                        window.opener.postMessage({ 
                                            type: "TM_CROSS_SITE_DONE", 
                                            success: false, 
                                            error: "元素未找到: " + selector 
                                        }, "*");
                                    }
                                }, 100);
                            }
                            
                            try {
                                // 1. 选择方程类型
                                waitForElement("select#Select1", (select) => {
                                    select.value = equationType;
                                    select.dispatchEvent(new Event("change", { bubbles: true }));
                                    console.log('[CrossSite Popup] 已设置方程类型:', equationType);
                                    
                                    // 2. 填写X轴数据
                                    waitForElement("#TextArea1", (xInput) => {
                                        xInput.value = xAxisString;
                                        xInput.dispatchEvent(new Event("input", { bubbles: true }));
                                        xInput.dispatchEvent(new Event("change", { bubbles: true }));
                                        console.log('[CrossSite Popup] 已填写X轴数据');
                                        
                                        // 3. 填写Y轴数据
                                        setTimeout(() => {
                                            waitForElement("#TextArea2", (yInput) => {
                                                yInput.value = yAxisString;
                                                yInput.dispatchEvent(new Event("input", { bubbles: true }));
                                                yInput.dispatchEvent(new Event("change", { bubbles: true }));
                                                console.log('[CrossSite Popup] 已填写Y轴数据');
                                                
                                                // 4. 点击拟合按钮
                                                setTimeout(() => {
                                                    waitForElement("#Button1", (fitButton) => {
                                                        fitButton.click();
                                                        console.log('[CrossSite Popup] 已点击拟合按钮');
                                                        
                                                        // 5. 等待图片加载
                                                        setTimeout(() => {
                                                            waitForElement("#img1", (img) => {
                                                                try {
                                                                    const sendImage = (dataUrl) => {
                                                                        // 提取 R2 和 b 值
                                                                        let r2Val = null;
                                                                        let bVal = null;
                                                                        try {
                                                                            const ps = document.querySelectorAll("p");
                                                                            for (const p of ps) {
                                                                                const text = p.textContent || "";
                                                                                if (text.includes("相关系数")) {
                                                                                    // 匹配：相关系数 R2：0.99... 或 相关系数 R^2: 0.99...
                                                                                    const match = text.match(/相关系数.*[：:]\s*([\d\.]+)/);
                                                                                    if (match) r2Val = match[1];
                                                                                }
                                                                                if (text.includes("b =")) {
                                                                                    // 匹配：b = 0.57...
                                                                                    const match = text.match(/b\s*=\s*([\d\.]+)/);
                                                                                    if (match) bVal = match[1];
                                                                                }
                                                                            }
                                                                            console.log(`[CrossSite Popup] 提取到变量: R2=${r2Val}, b=${bVal}`);
                                                                        } catch (e) {
                                                                            console.warn('[CrossSite Popup] 提取变量失败:', e);
                                                                        }

                                                                        window.opener.postMessage({ 
                                                                            type: "TM_CROSS_SITE_DONE", 
                                                                            success: true, 
                                                                            data: dataUrl,
                                                                            r2: r2Val,
                                                                            b: bVal
                                                                        }, "*");
                                                                        console.log('[CrossSite Popup] 已发送图片数据和变量');
                                                                    };
                                                                    
                                                                    if (img.tagName === "CANVAS") {
                                                                        sendImage(img.toDataURL("image/png"));
                                                                    } else {
                                                                        const processImg = () => {
                                                                            if (img.naturalWidth > 0) {
                                                                                const canvas = document.createElement("canvas");
                                                                                canvas.width = img.naturalWidth;
                                                                                canvas.height = img.naturalHeight;
                                                                                const ctx = canvas.getContext("2d");
                                                                                ctx.drawImage(img, 0, 0);
                                                                                sendImage(canvas.toDataURL("image/png"));
                                                                            } else {
                                                                                window.opener.postMessage({ 
                                                                                    type: "TM_CROSS_SITE_DONE", 
                                                                                    success: false, 
                                                                                    error: "图片宽度为0" 
                                                                                }, "*");
                                                                            }
                                                                        };
                                                                        
                                                                        if (img.complete) {
                                                                            processImg();
                                                                        } else {
                                                                            img.onload = processImg;
                                                                            img.onerror = () => {
                                                                                window.opener.postMessage({ 
                                                                                    type: "TM_CROSS_SITE_DONE", 
                                                                                    success: false, 
                                                                                    error: "图片加载失败" 
                                                                                }, "*");
                                                                            };
                                                                        }
                                                                    }
                                                                } catch (e) {
                                                                    window.opener.postMessage({ 
                                                                        type: "TM_CROSS_SITE_DONE", 
                                                                        success: false, 
                                                                        error: "获取图片数据出错: " + e.message 
                                                                    }, "*");
                                                                }
                                                            }, delays.imageLoad || 3000);
                                                        }, delays.afterClick || 2000);
                                                    }, 1000);
                                                }, delays.afterFill || 500);
                                            });
                                        }, 500);
                                    });
                                });
                            } catch (e) {
                                console.error('[CrossSite Popup] 执行出错:', e);
                                window.opener.postMessage({ 
                                    type: "TM_CROSS_SITE_DONE", 
                                    success: false, 
                                    error: e.message 
                                }, "*");
                            }
                        }
                    });
                    
                    console.log('[CrossSite Popup] 消息监听器已设置');
                """)
                
                print(f"[{student_id}] 新窗口跨站脚本已注入")
                
            except Exception as e:
                print(f"[{student_id}] 处理新窗口失败: {e}")
        
        page.on("popup", lambda popup: asyncio.create_task(handle_popup(popup)))
    
    async def run_single_browser(self, playwright, student_id: str, browser_index: int, provided_file_server_port: int = None, auto_run: bool = True, is_test_mode: bool = False):
        """在独立浏览器实例中运行单个学号"""
        result = {
            "student_id": student_id,
            "browser_index": browser_index,
            "status": "pending",
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "screenshot": None,
            "error": None
        }
        
        browser = None
        httpd = None
        
        # 如果是单实例运行，并且没有提供端口，则在此处启动独立的文件服务器
        if provided_file_server_port is None:
             httpd, port = self.start_file_server()
             if not httpd:
                 print(f"[{student_id}] 启动文件服务器失败，无法继续")
                 return result
             file_server_port = port
        else:
             file_server_port = provided_file_server_port
        
        try:
            print(f"\n[{student_id}] 启动浏览器 #{browser_index} (Port: {file_server_port})...")
            
            # 为每个浏览器创建独立的用户数据目录
            user_data_dir = f"./browser_profiles/{student_id}"
            os.makedirs(user_data_dir, exist_ok=True)
            
            # 启动独立的浏览器实例
            browser = await playwright.chromium.launch_persistent_context(
                user_data_dir,
                headless=self.config["headless"],
                slow_mo=self.config["slow_mo"],
                viewport={"width": 1280, "height": 720},
                args=[
                    f'--window-position={100 + browser_index * 50},{100 + browser_index * 50}'
                ]
            )
            
            # 创建新页面
            page = await browser.new_page()
            
            print(f"[{student_id}] 设置页面...")
            await self.setup_page(page, student_id, file_server_port, is_test_mode=is_test_mode)
            
            # 导航到目标网站
            print(f"[{student_id}] 访问: {self.config['target_url']}")
            await page.goto(self.config["target_url"])
            
            # 等待登录
            print(f"[{student_id}] 等待登录...")
            try:
                await page.wait_for_selector(
                    "#LoginUserName",
                    timeout=self.config["timeout"]["page_load"]
                )
                print(f"[{student_id}] 登录成功！")
            except Exception as e:
                print(f"[{student_id}] 登录超时: {e}")
            
            # 等待插件
            print(f"[{student_id}] 等待插件初始化...")
            await page.wait_for_selector(
                "#__tm_btn_run_automation",
                timeout=self.config["timeout"]["plugin_init"]
            )
            print(f"[{student_id}] 插件已加载！")
            
            # 执行自动化
            if auto_run:
                print(f"[{student_id}] 点击自动化流程按钮...")
                await page.click("#__tm_btn_run_automation")
                print(f"[{student_id}] 自动化流程已启动！")
            else:
                print(f"[{student_id}] 测试模式：自动运行已禁用。请手动操作。")
            
            # 保持浏览器开启，直到用户手动关闭
            # 使用一个永远不会被设置的 Event，实现无限等待
            print(f"[{student_id}] 浏览器将保持开启，直到手动关闭。")
            print(f"[{student_id}] 提示：关闭浏览器窗口或按 Ctrl+C 终止脚本。")
            
            # 创建一个永远不会被触发的事件，实现无限等待
            never_complete = asyncio.Event()
            try:
                await never_complete.wait()  # 这将永远等待
            except KeyboardInterrupt:
                print(f"[{student_id}] 用户中断")
            
            if auto_run:
                print(f"[{student_id}] 自动化流程完成！")
            
            # 截图
            if self.config["screenshot"]["enabled"] and auto_run:
                screenshot_dir = self.config["screenshot"]["directory"]
                os.makedirs(screenshot_dir, exist_ok=True)
                
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                screenshot_path = f"{screenshot_dir}/{student_id}_{timestamp}.png"
                
                await page.screenshot(path=screenshot_path, full_page=True)
                print(f"[{student_id}] 截图已保存: {screenshot_path}")
                result["screenshot"] = screenshot_path
            
            result["status"] = "success"
            
        except Exception as e:
            result["status"] = "failed"
            result["error"] = str(e)
            print(f"[{student_id}] ✗ 处理失败: {e}")
        
        finally:
            # 不自动关闭浏览器，以便用户查看
            if browser:
                # await browser.close()
                print(f"[{student_id}] 注意：浏览器保持开启状态")
            
            # 如果是在此函数内启动的服务器，需要关闭
            if httpd:
                httpd.shutdown()
                print(f"[{student_id}] 独立文件服务器已关闭")
        
        result["end_time"] = datetime.now().isoformat()
        self.results.append(result)
        
        return result
    
    async def run_parallel(self):
        """并行运行所有学号"""
        student_ids = self.config.get("student_ids", [])
        max_parallel = self.config.get("max_parallel_browsers", 3)
        
        if not student_ids:
            print("错误: 配置文件中没有学号列表")
            return
        
        # 启动文件服务器 (共享模式)
        self.file_server, port = self.start_file_server()
        if not self.file_server:
            return

        print(f"\n{'='*60}")
        print(f"开始并行处理 {len(student_ids)} 个学号 (共享服务器端口: {port})")
        print(f"最大并行数: {max_parallel}")
        print(f"{'='*60}\n")
        
        # 创建信号量限制并发数
        self.semaphore = asyncio.Semaphore(max_parallel)
        
        async with async_playwright() as playwright:
            # 创建所有任务
            tasks = []
            for index, student_id in enumerate(student_ids):
                task = self.run_with_semaphore(
                    playwright, student_id, index, port
                )
                tasks.append(task)
            
            # 并行执行所有任务
            await asyncio.gather(*tasks)
        
        # 停止文件服务器
        if self.file_server:
            self.file_server.shutdown()
            print("\n✓ 文件服务器已停止")
        
        # 生成报告
        self.generate_report()
    
    async def run_with_semaphore(self, playwright, student_id: str, index: int, port: int):
        """使用信号量控制并发"""
        async with self.semaphore:
            return await self.run_single_browser(playwright, student_id, index, port)
    
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
        
        # 显示失败详情
        failed = [r for r in self.results if r['status'] == 'failed']
        if failed:
            print(f"\n失败详情:")
            for r in failed:
                print(f"  - {r['student_id']}: {r['error']}")
        
        print(f"\n报告已保存: {report_path}")
        print(f"{'='*60}\n")


async def main():
    """主函数"""
    import sys
    runner = ParallelAutomationRunner("config.json")
    
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        
        if arg == "test":
            # 测试模式
            # 用法: python parallel_automation.py test [student_id] [doNothing]
            student_id = "test_user"
            if len(sys.argv) > 2:
                student_id = sys.argv[2]
            
            do_nothing = False
            if len(sys.argv) > 3 and sys.argv[3] == "doNothing":
                do_nothing = True
                
            print(f"==> 启动增强测试模式 (Student ID: {student_id})")
            
            if do_nothing:
                print("模式: doNothing (仅登录，不执行自动化)")
            else:
                print("说明:")
                print("1. 浏览器将保持开启")
                print("2. 自动运行脚本 (__tm_test_mode=True)")
                print("3. 遇到提交操作时会暂停并询问")
            
            async with async_playwright() as playwright:
                # do_nothing=True -> auto_run=False
                await runner.run_single_browser(
                    playwright, 
                    student_id, 
                    0, 
                    provided_file_server_port=None, 
                    auto_run=not do_nothing, 
                    is_test_mode=True
                )
        else:
            # 命令行模式：运行单个学号
            student_id = arg
            print(f"==> 独立运行模式: 学号 {student_id}")
            async with async_playwright() as playwright:
                await runner.run_single_browser(playwright, student_id, 0, provided_file_server_port=None)
    else:
        # 默认模式：并行运行配置文件中的所有学号
        await runner.run_parallel()


if __name__ == "__main__":
    asyncio.run(main())
