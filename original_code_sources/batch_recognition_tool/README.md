# 批量预识别工具

基于 PyQt5 的批量数据预识别工具，用于自动化处理实验数据识别和答案生成。

## 功能特性

- 📁 支持选择识别目录（带记忆功能）
- 🔑 API Key 管理（持久化存储）
- 👥 动态学号队列（运行中可添加）
- ⚡ 可调节并发处理（默认1，可动态调整）
- 🔄 API 自动重试机制（可配置次数）
- 📊 双级别日志（简要/详细）
- 📤 结果导出（CSV简要版 + JSON详细版）
- 🔔 完成通知（系统通知 + 声音提示）
- ⚠️ 图片预检查（避免无效API调用）

## 安装依赖

```bash
pip install -r requirements.txt
```

## 运行程序

```bash
python main.py
```

## 打包为exe

```bash
# 单文件打包（推荐）
pyinstaller --name "批量预识别工具" --windowed --onefile main.py

# 或使用配置文件
pyinstaller build.spec
```

打包后的exe文件在 `dist/` 目录下。

## 目录结构

```
batch_recognition_tool/
├── main.py                 # 程序入口
├── requirements.txt        # 依赖列表
├── build.spec             # PyInstaller配置
├── README.md              # 说明文档
├── config.json            # 运行时配置（自动生成）
├── core/                  # 核心逻辑
│   ├── __init__.py
│   ├── api_client.py      # API调用客户端
│   ├── processor.py       # 批量处理器
│   ├── queue_manager.py   # 队列管理
│   ├── logger.py          # 日志系统
│   ├── config_manager.py  # 配置管理
│   └── models.py          # 数据模型
├── ui/                    # 用户界面
│   ├── __init__.py
│   └── main_window.py     # 主窗口
└── utils/                 # 工具函数
    ├── __init__.py
    ├── file_utils.py      # 文件工具
    └── notification.py    # 通知工具
```

## 使用说明

1. 选择识别目录（包含 data.json 和 personalData 文件夹）
2. 输入豆包 API Key
3. 设置并发数和重试次数
4. 添加学号（可多个，每行一个）
5. 点击"开始批量识别"
6. 处理完成后导出结果报告

## 配置文件格式

程序会自动读取目录下的 `data.json`，格式示例：

```json
{
  "profiles": {
    "配置1": {
      "expName": "实验名称",
      "prompts": [
        {
          "type": "textRecognition",
          "value": "识别提示词",
          "recognitionSource": "1.jpg",
          "model": "doubao-seed-1-6-vision-250815"
        },
        {
          "type": "generateAnswer",
          "value": "生成提示词",
          "model": "doubao-seed-1-6-flash-250828"
        }
      ]
    }
  }
}
```

## 输出结果

处理完成后，会在每个学号的文件夹下生成：
- `{学号}_apiRecognizedData.json`

## 许可证

MIT License
