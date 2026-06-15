# 文件服务器访问说明

## 目录结构

```
C:/Users/hbyan/Documents/code/物理实验/
├── data.json                          # 主配置文件
└── personalData/
    └── {学号}/                        # 例如: 2410150207
        ├── 1.jpg                      # 实验图片
        ├── 2.jpg
        ├── ...
        └── {学号}_apiRecognizedData.json  # API识别结果
```

## 文件访问 URL

启动文件服务器后（端口 8888），可通过以下 URL 访问：

### 主配置文件
```
http://localhost:8888/data.json
```

### 学号图片
```
http://localhost:8888/personalData/2410150207/1.jpg
http://localhost:8888/personalData/2410150207/2.jpg
```

### API 识别结果
```
http://localhost:8888/personalData/2410150207/2410150207_apiRecognizedData.json
```

## 脚本中的使用

脚本会自动注入 `window.__tm_file_server_url`：

```javascript
// 访问图片
const imageUrl = `${window.__tm_file_server_url}/personalData/${studentId}/1.jpg`;

// 访问识别结果
const resultUrl = `${window.__tm_file_server_url}/personalData/${studentId}/${studentId}_apiRecognizedData.json`;

// 使用 fetch 读取
const response = await fetch(imageUrl);
const blob = await response.blob();
```

## 验证文件服务器

运行脚本后，在浏览器中访问：
- http://localhost:8888/data.json
- http://localhost:8888/personalData/

应该能看到文件列表和内容。

## 注意事项

1. **中文路径**: 支持中文路径（如"物理实验"）
2. **文件编码**: JSON 文件应使用 UTF-8 编码
3. **文件权限**: 确保目录可读
4. **端口占用**: 如果 8888 被占用，修改 `file_server_port`
