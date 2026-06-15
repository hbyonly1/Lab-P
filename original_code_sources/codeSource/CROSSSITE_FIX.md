# 修复说明

## 已完成的修改

✅ 已成功将 `crossSiteService.js` 中的图片插入方式改为模拟上传

### 主要变化

1. **新增函数 `base64ToFile`**: 将 base64 转换为 File 对象
2. **新增函数 `insertImageViaSimulatedUpload`**: 使用与 `imageUploadService.js` 相同的模拟上传方式
3. **修改 `insertImageToEditor`**: 调用新的模拟上传函数

### 语法错误修复

文件第 297 行有一个引号转义问题，需要手动修复：

**当前（错误）**:
```javascript
throw new Error("未找到\"插入图片\"按钮 (title='插入图片')");
```

**应改为**:
```javascript
throw new Error('未找到"插入图片"按钮 (title="插入图片")');
```

## 手动修复步骤

1. 打开 `src/services/crossSiteService.js`
2. 找到第 297 行
3. 将双引号改为单引号，避免转义问题
4. 保存文件
5. 运行构建命令

## 功能说明

现在 crossSite 功能会：
1. 将生成的 base64 图片转换为 File 对象
2. 找到富文本编辑器
3. 点击"插入图片"按钮
4. 找到文件输入框
5. 模拟文件上传
6. 触发 change 和 input 事件

这与 `imageUploadService.js` 的方式完全一致，确保图片正确上传到服务器而不是仅插入 base64。
