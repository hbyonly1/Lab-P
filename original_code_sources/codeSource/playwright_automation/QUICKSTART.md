# 并行自动化 - 快速开始

## 配置学号

编辑 `config.json`:

```json
{
  "student_ids": ["2021001", "2021002", "2021003"],
  "max_parallel_browsers": 3
}
```

## 运行

```bash
python parallel_automation.py
```

## 特性

✓ 多个浏览器窗口同时运行
✓ 每个浏览器完全独立（独立cookie、session）
✓ 可控制最大并发数
✓ 自动生成报告

## 文件说明

- `parallel_automation.py` - 并行处理脚本（推荐）
- `advanced_automation.py` - 顺序处理脚本
- `PARALLEL_GUIDE.md` - 详细使用指南
