# 页面组件与 UI 设计规范

本文档为“实验报告智能处理平台”的 UI 设计规范，旨在保证后续接入数十个甚至上百个新实验时，界面体验保持高度一致。

## 1. 按钮与交互规范 (Button Guidelines)
- **主功能按钮**：如“自动填报”、“一键填入生成式回答”等携带图标长文案的 `GoldButton`，**严禁使用** `size="small"` 属性。
  - **原因**：Small size 会极大压缩左右内边距，导致长文本挤压至按钮边缘，破坏呼吸感和设计规范。
  - **正确用法**：`<GoldButton icon={<CrownOutlined />}>长文案操作</GoldButton>`。

## 2. 输入框状态规范 (Input State Guidelines)
前端使用 `is-computed` 等状态类名，结合 `readonly` 属性来区分学生手填、AI 异步预测和系统自动计算字段。
- **is-computed（待计算）**：
  - **表现**：使用专属的主题蓝边框 (`border-color: #1677ff`) 和蓝色文字 (`color: #1677ff`)，与 Plus/Pro 的智能推导色调对齐。
  - **背景与交互**：背景必须保持纯白 (`background: #fff`)，不再使用浅绿背景；并且**必须放开只读限制** (`readOnly={false}`)，允许学生在系统尚未返回或需要人工干预时手动填入数据。

## 3. 图片混合排版规范 (Mixed Typography Guidelines)
从旧版实验报告中提取的 HTML 通常包含大尺寸流程图和行内公式图。
- **行内公式图 (Inline Formula)**：
  - **识别特征**：由提取脚本打上 `"inline": true` 标签。
  - **样式规范**：在渲染时，必须应用 `vertical-align: middle` 以及 `margin: 0 4px`，并且使用其原生的（或按比例缩放后的）宽高，保证其完美融入段落之中。
- **块级大图 (Block Images)**：
  - **样式规范**：独立占行，推荐放置于居中的容器内。取消原有的严格高度限制（如 `120px`），允许最大高度 `400px`，确保等效电路图等关键大图清晰可辨。

## 4. 标题与区块间距规范 (Layout & Spacing Guidelines)
- **附加数据区块 (Post Data Sections)**：
  - **容器间距**：不同板块之间应该通过自然的 `marginTop: '24px'` 分开，必要时辅以浅色的顶部边框 (`borderTop: '1px solid #e1e7f0'`) 作为柔和的分割线。**不要滥用厚重的背景 Card** 导致嵌套过深或出现怪异的大块白边。
  - **标题排版与专属操作**：标题渲染为 `<h3 style={{ margin: 0, fontSize: '15px', color: '#141413' }}>`。**核心规则**：如果该板块涉及后续数据公式推导，必须在标题外层套用 Flexbox 左右对齐容器，并在小标题的最右侧，放置一个统一样式为 `recognize-primary-button` 的蓝色 `(Plus/Pro)` 计算数据按钮。

## 5. 图片画廊规范 (Image Gallery Guidelines)
- **多图支持**：上传组件必须支持无限制的追加上传，禁止硬编码数量限制（如 `maxCount`）。
- **缩略图画廊**：上传后，图片应以下方水平滚动的缩略图列表（Thumbnail Strip）形式展现，而非替换掉上传入口。
- **快速操作**：每张缩略图需自带删除操作（触发 `onRemoveImage`），点击缩略图即可在上方主舞台查看大图并重置缩放坐标。
