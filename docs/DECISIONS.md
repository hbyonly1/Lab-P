# Decisions

## 2026-06-22

### 前端 UI 规范层

- 采用 `theme.css` + `ui.css` + `components/ui` 的轻量设计系统做法，而不是按每个页面继续拆出大量 CSS 文件。
- `theme.css` 负责颜色、圆角、阴影、边框和间距 token；`ui.css` 负责黄金强调按钮、通用卡片、表格容器、四项指标卡、状态标签等可复用样式。
- 新页面优先复用 `GoldButton`、`PageHeading`、`StatCard`、`StatusBadge`、`TablePanel`、`UiPanel`，页面 CSS 只保留页面专属布局和复杂交互。
- 新增 admin 内部页面 `/workspace/admin/design-system` 展示当前可复用组件规范，作为后续页面实现的对照入口。

### 控件圆角和输入规范

- 按钮和常规输入控件统一使用 8px 圆角矩形，不再使用胶囊或圆形按钮作为后台默认控件形态。
- 输入控件统一沉淀在 `ui.css`：38px 基础高度、浅灰边框、蓝色 hover/focus、统一 placeholder 和文本域计数字体。
- 非按钮的状态点、头像、进度圆环、统计卡图标背景可继续使用圆形。
