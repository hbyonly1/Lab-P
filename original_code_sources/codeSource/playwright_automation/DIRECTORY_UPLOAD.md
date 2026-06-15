# 目录上传配置指南

## 问题

脚本需要访问整个目录结构：
```
your_data/
├── data.json
└── personalData/
    └── 2410150207/
        ├── 1.jpg
        ├── 2.jpg
        └── ...
```

## 解决方案

使用本地文件服务器提供文件访问。

## 配置步骤

### 1. 准备数据目录

确保目录结构正确：
```
D:/your_data/
├── data.json
└── personalData/
    └── {学号}/
        └── *.jpg
```

### 2. 更新 config.json

```json
{
  "data_directory": "D:/your_data",
  "file_server_port": 8888,
  "api_key": "your-api-key"
}
```

### 3. 运行自动化

```bash
python parallel_automation.py
```

## 工作原理

1. **启动文件服务器**: 在端口 8888 提供文件访问
2. **注入配置**: 
   - `window.__tm_file_server_url` = `http://localhost:8888`
   - `localStorage.__tm_data_json` = 配置内容
3. **脚本访问文件**: 
   ```javascript
   const imageUrl = `${window.__tm_file_server_url}/personalData/${studentId}/1.jpg`;
   ```

## 验证

运行后查看输出：
```
✓ 文件服务器已启动: http://localhost:8888
  服务目录: D:/your_data
[2410150207] 已读取配置文件: D:/your_data/data.json
[2410150207] [Playwright] 文件服务器 URL: http://localhost:8888
```

## 测试文件访问

在浏览器中访问：
- `http://localhost:8888/data.json`
- `http://localhost:8888/personalData/2410150207/1.jpg`

## 注意事项

1. **端口占用**: 如果 8888 端口被占用，修改 `file_server_port`
2. **路径格式**: Windows 使用 `D:/path` 或 `D:\\path`
3. **文件权限**: 确保目录可读
4. **防火墙**: 允许本地端口访问
