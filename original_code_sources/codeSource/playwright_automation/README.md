# Playwright 自动化使用指南

## 功能说明

使用 Playwright 自动化执行用户脚本插件的流程：
1. 自动注入用户脚本
2. 填写学号并登录
3. 自动点击"执行此配置的所有自动化流程"按钮

## 安装步骤

### 1. 安装 Python 依赖

```bash
cd playwright_automation
pip install -r requirements.txt
```

### 2. 安装 Playwright 浏览器

```bash
playwright install chromium
```

## 使用方法

### 单个学号自动化

编辑 `automation.py`，修改配置：

```python
# 配置参数
STUDENT_ID = "2021001"  # 你的学号
USERSCRIPT_PATH = "../build/bundle.user.js"  # 用户脚本路径
TARGET_URL = "http://your-target-website.com"  # 目标网站URL
```

运行：

```bash
python automation.py
```

### 批量学号自动化

编辑 `automation.py`，使用批量模式：

```python
# 配置参数
STUDENT_IDS = ["2021001", "2021002", "2021003"]  # 学号列表
USERSCRIPT_PATH = "../build/bundle.user.js"
TARGET_URL = "http://your-target-website.com"

# 在 if __name__ == "__main__": 中使用
asyncio.run(batch_run(STUDENT_IDS, USERSCRIPT_PATH, TARGET_URL))
```

## 工作流程

1. **启动浏览器**: 以非无头模式启动，可以看到操作过程
2. **注入脚本**: 在页面加载前注入用户脚本
3. **设置学号**: 将学号写入 localStorage
4. **导航页面**: 访问目标网站
5. **自动登录**: 脚本会自动填写学号并登录
6. **等待加载**: 等待页面和插件初始化
7. **执行自动化**: 点击自动化流程按钮
8. **等待完成**: 等待流程执行完成
9. **保存截图**: 自动保存结果截图

## 自定义配置

### 调整等待时间

```python
# 等待插件初始化
await page.wait_for_timeout(2000)  # 2秒

# 等待自动化完成
await page.wait_for_timeout(60000)  # 60秒
```

### 修改目标URL

```python
TARGET_URL = "http://实际的网站地址.com"
```

### 添加自定义操作

在 `run_automation` 函数中添加：

```python
# 在点击自动化按钮前
await page.click("#某个按钮")
await page.fill("#某个输入框", "值")
```

## 高级用法

### 监听控制台日志

```python
page.on("console", lambda msg: print(f"[浏览器] {msg.text}"))
```

### 等待特定元素

```python
# 等待某个元素出现
await page.wait_for_selector(".success-message", timeout=30000)
```

### 处理弹窗

```python
# 自动接受弹窗
page.on("dialog", lambda dialog: dialog.accept())
```

## 故障排除

### 问题1: 找不到按钮

**原因**: 插件未正确加载或选择器错误

**解决**: 
- 检查用户脚本路径是否正确
- 增加等待时间
- 使用浏览器开发者工具检查元素ID

### 问题2: 登录失败

**原因**: 学号格式错误或网站变化

**解决**:
- 检查学号是否正确
- 手动测试登录流程
- 检查网站是否更新

### 问题3: 自动化未执行

**原因**: 配置文件未加载或按钮未找到

**解决**:
- 确保 data.json 配置正确
- 检查 automation 配置是否存在
- 查看控制台错误信息

## 示例：完整配置

```python
import asyncio
from automation import run_automation

# 单个学号
asyncio.run(run_automation(
    student_id="2021001",
    userscript_path="../build/bundle.user.js",
    target_url="http://example.com"
))
```

## 注意事项

1. **首次运行**: 确保先运行 `node build.js` 构建用户脚本
2. **网络环境**: 确保能访问目标网站
3. **浏览器版本**: 使用最新版 Chromium
4. **截图保存**: 结果会自动保存在 `screenshots/` 目录
5. **错误处理**: 脚本会捕获异常并继续处理下一个学号

## 文件结构

```
playwright_automation/
├── automation.py          # 主自动化脚本
├── requirements.txt       # Python依赖
├── README.md             # 本文档
└── screenshots/          # 截图保存目录（自动创建）
```

## 进阶：自定义脚本

创建自己的自动化脚本：

```python
from playwright.async_api import async_playwright

async def custom_automation():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        # 你的自定义逻辑
        # ...
        
        await browser.close()

asyncio.run(custom_automation())
```
