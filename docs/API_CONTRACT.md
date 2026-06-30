# API Contract & Data Models

本文档定义了实验报告系统前后端交互的 API 契约与核心数据模型。

## 1. 核心模型设计

### 1.1 系统公告 (Announcements)
提供系统级的更新、通知和活动广播。

**表：`announcements`**
- `id`: UUID (主键)
- `title`: String (公告标题)
- `content`: Text (公告正文)
- `type`: Enum `['update', 'notice', 'promotion']` (公告类型，决定前端图标与颜色)
- `is_active`: Boolean (默认 true，用于管理员软删除或撤回)
- `created_at`: Datetime (发布时间)

**表：`user_announcement_reads`**
（用于精确跟踪每个用户的已读状态 - 方案 A）
- `id`: UUID
- `user_id`: UUID (外键)
- `announcement_id`: UUID (外键)
- `read_at`: Datetime (阅读时间)

## 2. API 接口定义

### 2.1 获取公告列表
- **Endpoint**: `GET /api/v1/announcements`
- **Auth Required**: Yes (Student / Admin / Reviewer)
- **Response**:
```json
{
  "code": 200,
  "data": [
    {
      "id": "ann-1",
      "title": "系统维护通知",
      "content": "为了提供更好的服务...",
      "type": "update",
      "is_read": false,
      "created_at": "2026-06-30T08:00:00Z"
    }
  ]
}
```
*注：`is_read` 字段由后端联表 `user_announcement_reads` 动态计算得出。*

### 2.2 标记单条公告已读
- **Endpoint**: `POST /api/v1/announcements/{id}/read`
- **Auth Required**: Yes
- **Response**:
```json
{
  "code": 200,
  "message": "success"
}
```

### 2.3 标记全部公告已读
- **Endpoint**: `POST /api/v1/announcements/read-all`
- **Auth Required**: Yes
- **Response**:
```json
{
  "code": 200,
  "message": "success"
}
```
