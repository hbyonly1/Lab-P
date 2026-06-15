# localStorage 键名映射

## 脚本期望的键名

根据源代码分析，脚本使用以下 localStorage 键名：

### 1. 配置文件
- **键名**: `__tm_cfg_toolkit_config_v1`
- **用途**: 存储 data.json 配置
- **定义位置**: `src/core/vars.js:10`

### 2. API Key
- **键名**: `__tm_doubao_api_key`
- **用途**: 存储豆包 API 密钥
- **定义位置**: `src/services/ai.js:229`

### 3. 学号
- **键名**: `__tm_auto_login_id`
- **用途**: 自动登录的学号
- **定义位置**: `src/main.js:143`

### 4. 当前配置
- **键名**: `__tm_cfg_toolkit_active_profile_v1`
- **用途**: 当前激活的配置名称
- **定义位置**: `src/core/vars.js:11`

## Playwright 注入配置

```python
# 正确的注入方式
localStorage.setItem('__tm_cfg_toolkit_config_v1', configData);
localStorage.setItem('__tm_doubao_api_key', apiKey);
localStorage.setItem('__tm_auto_login_id', studentId);
```

## 验证

在浏览器控制台检查：
```javascript
console.log('配置:', localStorage.getItem('__tm_cfg_toolkit_config_v1'));
console.log('API Key:', localStorage.getItem('__tm_doubao_api_key'));
console.log('学号:', localStorage.getItem('__tm_auto_login_id'));
```
