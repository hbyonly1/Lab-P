# 学校 WYSIWYG 字段写入计划

## 1. 目标

解决学校系统实验报告 modal 中富文本节点无法按普通表单节点写入的问题。

当前已确认的失败不是提交按钮失败，而是字段写入阶段失败：

```text
Locator.fill: Timeout 30000ms exceeded
waiting for locator("#ReportModal #skt0Area").first
resolved to <textarea id="skt0Area" class="editorClass hide" ...>
element is not visible
```

原因是学校系统把实验问题、签字原始数据上传等区域做成 WYSIWYG 编辑器：

```text
隐藏 textarea 保存节点 id
  +
可见 div.wysiwyg-editor 承担真实编辑
  +
toolbar / popup 处理图片插入
```

因此后端不能再看到 `textarea` 就直接 `fill()`。

## 2. 已观察到的真实节点形态

### 2.1 图片上传工具栏

图片上传入口不是普通平台上传组件，而是学校富文本工具栏按钮：

```html
<div class="wysiwyg-toolbar wysiwyg-toolbar-top">
  <a class="wysiwyg-toolbar-icon" href="#" title="插入图片"></a>
  <a class="wysiwyg-toolbar-icon" href="#" title="字体"></a>
  <a class="wysiwyg-toolbar-icon" href="#" title="字体大小"></a>
  <a class="wysiwyg-toolbar-icon" href="#" title="加粗 (Ctrl+B)" hotkey="b"></a>
  <a class="wysiwyg-toolbar-icon" href="#" title="倾斜 (Ctrl+I)" hotkey="i"></a>
  <a class="wysiwyg-toolbar-icon" href="#" title="下划线 (Ctrl+U)" hotkey="u"></a>
  <a class="wysiwyg-toolbar-icon" href="#" title="插入公式"></a>
</div>
```

可稳定利用的信息：

- 图片按钮是同一 toolbar 内的 `a.wysiwyg-toolbar-icon[title="插入图片"]`。
- 按钮旁边还有字体、加粗、倾斜、下划线、上下标、清空格式、插入公式等按钮，不能按第一个按钮以外的模糊文本乱点。
- 必须限定在当前字段所属的 `.wysiwyg-container` 内点击，避免点到页面其他富文本区域的图片按钮。

### 2.2 图片上传弹窗

点击图片按钮后，学校系统弹出 WYSIWYG 自己的上传框：

```html
<div class="wysiwyg-popup" style="left: 1px; top: 2132px;">
  <div class="wysiwyg-toolbar-form">
    <div class="wysiwyg-browse">
      "点击上传"
      <input
        type="file"
        draggable="true"
        style="position: absolute; left: 0px; top: 0px; width: 100%; height: 100%; opacity: 0; cursor: pointer;"
      >
    </div>
  </div>
</div>
```

结论：

- 真实可操作节点是 popup 内透明覆盖的 `input[type=file]`。
- Playwright 应直接对这个 file input 使用 `set_input_files(local_file_path)`。
- 不需要也不应该尝试操作系统文件选择窗口。
- popup 可能挂在页面全局，不一定是目标 editor 的子节点；但它是点击当前 editor 图片按钮之后出现的最新 `.wysiwyg-popup`。

### 2.3 图片写入后的 DOM

上传成功后，图片进入可见 editor：

```html
<div contenteditable="true" class="wysiwyg-editor">
  <img
    src="data:image/png;base64,..."
    alt
    title="307.NASA_Earth@2x~ipad.png"
    width="600"
    height="600"
  >
</div>
```

同一字段周围还能看到：

```html
<textarea
  class="editorClass Drawing YSSJDrawingAreaArea hide"
  id="YSSJDrawingAreaArea"
  name="editor"
  placeholder="请输入文本……"
></textarea>

<div style="display:none;" id="YSSJDrawingAreaDIV"></div>
```

结论：

- `wysiwyg_image` 的成功判定至少要确认当前字段的 `.wysiwyg-editor img` 出现。
- 上传后图片 `src` 可能是 `data:image/png;base64,...`，不是平台原始 URL。
- 不能简单把平台图片 URL 填进 textarea。
- 当前优先按真实用户路径上传：点击图片按钮 -> 等 popup -> `set_input_files()` -> 回读 editor 里的 `img`。

### 2.4 文本写入后的 DOM

文本区域同样是 WYSIWYG 结构：

```html
<div class="wysiwyg-container fake-bootstrap wysiwyg-active">
  <div class="wysiwyg-toolbar wysiwyg-toolbar-top">...</div>
  <div class="wysiwyg-wrapper">
    <div class="wysiwyg-placeholder" style="display: none;">请输入文本……</div>
    <textarea
      class="editorClass hide"
      id="skt0Area"
      name="editor"
      placeholder="请输入文本……"
    ></textarea>
    <div contenteditable="true" class="wysiwyg-editor">你好</div>
  </div>
</div>
```

结论：

- `#skt0Area` 是隐藏 textarea，不能 `fill()`。
- 真实输入显示在同一 `.wysiwyg-wrapper` 下的 `.wysiwyg-editor`。
- 文本写入要按 editor 路线处理，并在写入后触发事件，让学校脚本有机会同步隐藏 textarea 或内部状态。

## 3. targetType 规则

`automation.mappings[].targetType` 只定义三种：

```text
text           普通 input / textarea / select / 可直接赋值文本节点
wysiwyg_text   学校 WYSIWYG 文本节点
wysiwyg_image  学校 WYSIWYG 图片节点
```

规则：

- 绝大多数节点不写 `targetType`，默认视为 `text`。
- 只有确认是 WYSIWYG 特殊控件的节点才显式配置。
- 不新增 `school_upload` 或其它第四种类型；当前图片也属于 WYSIWYG 图片节点。
- `targetType` 是学校 DOM 写入策略，不是平台节点类型。平台侧 `generated`、`image_upload` 等业务类型保持原语义。

示例：

```json
{
  "sourceId": "DBGZ10-0",
  "targetLocator": "#DBGZ10-0"
}
```

```json
{
  "sourceId": "skt0Area",
  "targetLocator": "#skt0Area",
  "targetType": "wysiwyg_text"
}
```

```json
{
  "sourceId": "YSSJDrawingAreaArea",
  "targetLocator": "#YSSJDrawingAreaArea",
  "targetType": "wysiwyg_image"
}
```

## 4. 映射原则和校验

当前配置能否和学校节点对上，不应依赖页面视觉位置、标题文案或“看起来像哪个区域”。主映射依据应是学校 DOM 节点 id。

推荐约定：

```text
平台字段 id / sourceId  尽量等于学校节点 id
targetLocator           使用 #学校节点id
targetType              只表达写入策略，不表达业务类型
```

例如：

```json
{
  "sourceId": "skt0Area",
  "targetLocator": "#skt0Area",
  "targetType": "wysiwyg_text"
}
```

```json
{
  "sourceId": "YSSJDrawingAreaArea",
  "targetLocator": "#YSSJDrawingAreaArea",
  "targetType": "wysiwyg_image"
}
```

### 4.1 当前配置风险

平台配置里的这些字段只说明平台表单和图片槽如何展示，不等价于学校提交 mapping：

```json
{
  "id": "YSSJDrawingAreaArea",
  "type": "image_upload",
  "imageSlotId": "IMG_RAW_DATA"
}
```

```json
{
  "targetNodeId": "YSSJDrawingAreaArea"
}
```

提交阶段目前主要读取：

```text
automation.mappings[]
```

因此，平台存在 `inputs.fields[].id` 或 `inputs.images[].targetNodeId`，不代表提交时一定会写入学校系统。提交可写入字段必须满足：

```text
平台 corrected_json.values 中有 sourceId 对应值
  +
automation.mappings[] 中有该 sourceId
  +
targetLocator 在当前学校 modal 中可定位
  +
targetType 对应的写入器可处理该节点形态
```

### 4.2 电表签字原始数据图片节点当前问题

当前电表实验图片节点的问题分两层，不能混在一起判断。

第一层是配置层：当前 `exp_meter_modification` 的 `automation.mappings` 里只有普通文本字段和 `skt0Area(wysiwyg_text)`，没有 `YSSJDrawingAreaArea(wysiwyg_image)`。因此自动化提交时不会调用图片 writer，学校节点里当然不会出现图片。

第二层是操作层：补齐 `YSSJDrawingAreaArea(wysiwyg_image)` mapping 后，如果 writer 已经点击图片按钮、设置 file input，但当前字段的 `.wysiwyg-editor` 里仍然没有 `<img>`，那才是图片上传操作失败。这个失败必须在字段写入阶段暴露为 `WYSIWYG_IMAGE_UPLOAD_FAILED`，不能等到提交反馈阶段才变成 `SUBMIT_FEEDBACK_TIMEOUT`。

这里要先区分两个问题：

```text
没有出现在 fieldWriteReport
  = 图片节点没有进入提交写入链路，writer 没有执行

出现在 fieldWriteReport 但失败
  = writer 已执行，但学校节点最终没插入 img
  = 失败发生在定位 container、点击图片按钮、set_input_files、上传等待或回读 img 阶段
```

电表实验的“签字原始数据上传”要补齐以下链路，不能只看页面上是否有上传控件：

```text
平台图片槽 imageSlot
  -> inputs.fields[] 中有对应 image_upload 节点
  -> 该节点 id / targetNodeId 对齐学校隐藏 textarea id
  -> corrected_json.values[nodeId] 或等价提交值中有图片 URL
  -> automation.mappings[] 中存在同 sourceId
  -> mapping.targetLocator 指向学校隐藏 textarea
  -> mapping.targetType = wysiwyg_image
```

推荐配置形态：

```json
{
  "id": "YSSJDrawingAreaArea",
  "type": "image_upload",
  "imageSlotId": "IMG_RAW_DATA"
}
```

```json
{
  "id": "IMG_RAW_DATA",
  "targetNodeId": "YSSJDrawingAreaArea"
}
```

```json
{
  "sourceId": "YSSJDrawingAreaArea",
  "targetLocator": "#YSSJDrawingAreaArea",
  "targetType": "wysiwyg_image"
}
```

验收标准：

- 如果平台已有图片但缺少 `automation.mappings[]`，`fieldWriteReport.missingFields` 必须列出该节点。
- 如果 mapping 存在但学校 DOM 没有该 selector，`missingFields` 必须列出 selector。
- 如果 mapping 存在且 selector 命中隐藏 WYSIWYG textarea，但没写 `targetType=wysiwyg_image`，必须进入 `unsupportedFields` 或 `failedFields`，提示 targetType 配置错误。
- 如果 writer 执行了图片上传，`fieldWriteReport` 必须至少出现该节点，不能静默跳过。
- 如果 writer 执行后当前字段 `.wysiwyg-editor` 仍然没有 `<img>`，必须记录为 `WYSIWYG_IMAGE_UPLOAD_FAILED`，并输出 file input、上传弹窗、上传进度和 editor HTML 摘要。

### 4.3 不建议自动猜测的内容

不建议靠这些方式自动决定映射：

- 仅靠标题文案，例如“签字原始数据上传”。
- 仅靠 WYSIWYG toolbar 位置。
- 仅靠字段在页面上的顺序。
- 仅靠 class 中出现 `Drawing`、`Area`、`editorClass` 就自动当图片。

原因：

- 多个 WYSIWYG 节点共用相同 class 和 toolbar 结构。
- 文本和图片节点都可能是隐藏 textarea + `.wysiwyg-editor`。
- 同一实验可能有多个图片节点，例如 `YSSJDrawingAreaArea`、`Y2Area`、`Y5Area`、`Y7Area`。
- 学校页面标题和平台标题不一定完全一致。

可以做自动探测，但只能用于诊断和建议，不能替代显式 mapping。

### 4.4 提交前 mapping audit

实现 WYSIWYG 写入前，先增加一个提交前 mapping audit。打开真实学校 modal 后，按实验配置输出三列关系：

```text
platform field / image slot
  -> automation mapping
  -> school DOM node
```

audit 至少检查：

```text
sourceId                         平台字段 id
targetLocator                    学校 selector
targetType                       text / wysiwyg_text / wysiwyg_image，缺省 text
platformHasValue                 平台侧是否有值
mappingExists                    automation.mappings 是否覆盖
schoolNodeExists                 学校 modal 中 selector 是否存在
schoolNodeTag                    input / textarea / select / div
schoolNodeClass                  className
schoolNodeVisible                是否可见
hasWysiwygWrapper                是否能找到同字段 wrapper
hasWysiwygEditor                 是否能找到同字段 editor
hasImageToolbarButton            是否能找到同 container 的 title="插入图片" 按钮
recommendedTargetType            诊断建议，不自动覆盖配置
```

示例诊断：

```json
{
  "sourceId": "skt0Area",
  "targetLocator": "#skt0Area",
  "targetType": "text",
  "platformHasValue": true,
  "mappingExists": true,
  "schoolNodeExists": true,
  "schoolNodeTag": "textarea",
  "schoolNodeClass": "editorClass hide",
  "schoolNodeVisible": false,
  "hasWysiwygEditor": true,
  "recommendedTargetType": "wysiwyg_text",
  "risk": "hidden_textarea_with_wysiwyg_editor"
}
```

```json
{
  "sourceId": "YSSJDrawingAreaArea",
  "targetLocator": null,
  "targetType": null,
  "platformHasValue": true,
  "mappingExists": false,
  "schoolNodeExists": null,
  "recommendedTargetType": "wysiwyg_image",
  "risk": "platform_image_value_without_automation_mapping"
}
```

阻断规则：

- 平台有值但 `mappingExists=false`：提交前阻断，除非该字段显式配置为不提交。
- `targetType=text` 但学校节点是隐藏 WYSIWYG textarea：提交前阻断，并建议补 `targetType`。
- `targetType=wysiwyg_image` 但找不到同 container 的图片按钮：提交前阻断。
- `targetType=wysiwyg_text` 但找不到同 wrapper 的 editor：提交前阻断。

### 4.4 配置修复顺序

修复配置时按这个顺序：

1. 先保证 `automation.mappings[]` 覆盖所有需要提交的 `corrected_json.values` 字段。
2. 普通字段只写 `sourceId` 和 `targetLocator`，不写 `targetType`。
3. 实验问题等富文本字段补 `targetType=wysiwyg_text`。
4. 图片上传字段补 `targetType=wysiwyg_image`。
5. 每次补完配置后运行 mapping audit，确认不存在“平台有值但提交 mapping 缺失”的字段。

## 5. 后端写入器设计

提交回填阶段不应继续在 `_write_one_field()` 里堆条件。建议拆成分派入口：

```text
write_field(mapping, value)
  |
  +--> targetType missing / text -> write_text_field()
  |
  +--> wysiwyg_text -> write_wysiwyg_text()
  |
  +--> wysiwyg_image -> write_wysiwyg_image()
```

### 5.1 普通 text 写入

适用范围：

- 可见 input
- 可见 textarea
- select
- contenteditable 但不属于学校 WYSIWYG 容器的简单节点

规则：

- 保留现有普通写入逻辑。
- 如果 locator 命中隐藏 textarea，不应继续硬填；应返回明确诊断，提示该 mapping 可能需要 `targetType=wysiwyg_text` 或 `targetType=wysiwyg_image`。

### 5.2 WYSIWYG 文本写入

写入步骤：

1. 用 `targetLocator` 找到隐藏 textarea，例如 `#skt0Area`。
2. 从 textarea 向上找到最近的 `.wysiwyg-wrapper`。
3. 再向上确认所属 `.wysiwyg-container`，用于隔离当前字段。
4. 在 wrapper 内找到 `.wysiwyg-editor[contenteditable="true"]`。
5. 将平台文本转成安全 HTML：
   - HTML escape 普通文本。
   - 换行转 `<br>`。
   - 空文本不写入，归入 `skippedEmptyFields`。
6. 优先尝试学校编辑器 API：
   - 如果 `window.jQuery` 存在，检查 `$(textarea).data("wysiwygjs")`。
   - 如果实例存在且提供 `setHTML`，优先调用 `setHTML(html)`。
7. 如果没有可用 API，再设置 editor `innerHTML`。
8. 同步 textarea：
   - 设置 textarea `value`。
   - 必要时设置 textarea text content，避免学校脚本读取 DOM 内容而不是 value。
9. 对 editor 和 textarea 都 dispatch：
   - `input`
   - `change`
   - `blur`
10. 回读校验：
   - 读取 editor `innerText` / `innerHTML`。
   - 读取 textarea `value`。
   - 规范化空白和换行后，至少 editor 可见文本包含平台文本。

失败诊断至少包含：

```json
{
  "nodeId": "skt0Area",
  "targetType": "wysiwyg_text",
  "targetLocator": "#skt0Area",
  "stage": "editor_not_found",
  "tag": "textarea",
  "className": "editorClass hide",
  "isVisible": false,
  "valueLength": 2
}
```

### 5.3 WYSIWYG 图片写入

写入步骤：

1. 用 `targetLocator` 找到隐藏 textarea，例如 `#YSSJDrawingAreaArea`。
2. 从 textarea 向上找到当前字段的 `.wysiwyg-wrapper` 和 `.wysiwyg-container`。
3. 在当前 container 内找到图片按钮：

```css
a.wysiwyg-toolbar-icon[title="插入图片"]
```

4. 上传前清理旧图片：
   - 当前阶段默认 `clearBeforeUpload=true`。
   - 清空当前字段 editor 内已有内容。
   - 清空 textarea `value`。
   - dispatch `input/change`。
5. 点击当前 container 内的图片按钮。
6. 等待新出现或当前可见的 `.wysiwyg-popup input[type="file"]`。
7. 将平台图片值解析为 Playwright 可用本地文件：
   - `/uploads/...` -> 仓库或后端服务的真实本地路径。
   - 完整平台 URL -> 转换到本地上传文件；如果不是本地文件，先下载到临时文件。
   - 空值 -> `skippedEmptyFields`。
8. 对 file input 执行 `set_input_files(local_file_path)`。
9. 等待当前字段 `.wysiwyg-editor img` 出现。
10. 校验图片：
   - `img.src` 非空。
   - `src` 是 `data:image/...` 或学校系统生成的图片 URL。
   - 如果能拿到文件名，检查 `title` / `alt` / `src` 是否和本次上传有关。
11. 同步 textarea 和事件：
   - 如果学校脚本自动同步，直接回读确认。
   - 如果 editor 已有 img 但 textarea 为空，不急着判失败；先记录 `textareaValueEmpty=true`，因为截图显示成功上传的关键结果在 editor。

失败诊断至少包含：

```json
{
  "nodeId": "YSSJDrawingAreaArea",
  "targetType": "wysiwyg_image",
  "targetLocator": "#YSSJDrawingAreaArea",
  "stage": "file_input_missing",
  "hasToolbarImageButton": true,
  "hasPopup": false,
  "editorImageCount": 0
}
```

图片上传诊断不能只记录最终失败码，应记录完整阶段链路：

```json
{
  "nodeId": "YSSJDrawingAreaArea",
  "targetType": "wysiwyg_image",
  "stage": "upload_wait",
  "platformHasValue": true,
  "platformValuePreview": "/uploads/...",
  "localFileResolved": true,
  "localFileExists": true,
  "localFileSize": 284391,
  "schoolNodeExists": true,
  "schoolNodeVisible": false,
  "hasWysiwygContainer": true,
  "hasWysiwygEditor": true,
  "hasImageToolbarButton": true,
  "popupAppeared": true,
  "fileInputFound": true,
  "setInputFilesDone": true,
  "uploadModalVisible": true,
  "uploadProgressText": "0%",
  "editorImageCountBefore": 0,
  "editorImageCountAfter": 0,
  "firstImageSrcPreview": null
}
```

阶段枚举建议：

```text
mapping_missing
platform_value_empty
local_file_resolve_failed
school_node_missing
wysiwyg_container_missing
image_toolbar_missing
popup_missing
file_input_missing
set_input_files_failed
upload_wait_timeout
editor_image_missing
editor_image_verify_failed
```

如果 `set_input_files()` 后出现 `#kvFileinputModal`、`.file-zoom-dialog`、上传进度、错误文本或“选择 / 移除 / 取消”等控件，必须记录到该字段诊断里。图片节点失败时应在点击学校提交按钮前以 `WYSIWYG_IMAGE_UPLOAD_FAILED` 阻断，不能等到提交反馈阶段才暴露为 `SUBMIT_FEEDBACK_TIMEOUT`。

## 6. 字段写入报告

提交链路在点击学校“临时提交 / 正式提交”前必须生成字段写入报告。

报告分组：

```text
succeededFields      已写入并回读通过
skippedEmptyFields   平台侧为空，跳过
missingFields        平台侧有值，但 mapping 或 selector 缺失
failedFields         写入失败或回读不匹配
unsupportedFields    targetType 未支持或节点形态不匹配
```

阻断规则：

- `failedFields` 非空：停止，不点击学校提交按钮。
- `unsupportedFields` 非空：停止，不点击学校提交按钮。
- `missingFields` 非空：停止，不点击学校提交按钮，除非该节点被配置为可选。
- 只有全部必填字段写入通过或被明确跳过，才进入提交按钮点击阶段。

错误码规则：

```text
FIELD_WRITE_FAILED
FIELD_WRITE_VERIFY_FAILED
WYSIWYG_TEXT_WRITE_FAILED
WYSIWYG_IMAGE_UPLOAD_FAILED
FIELD_SELECTOR_MISSING
FIELD_TARGET_TYPE_REQUIRED
FIELD_TARGET_TYPE_UNSUPPORTED
```

不应再把字段写入错误包装成：

```text
SCHOOL_SUBMIT_UNKNOWN_ERROR
```

## 7. 实施顺序

### 7.1 第一阶段：mapping audit 和诊断先落地

目标：即使还没支持全部 WYSIWYG，也必须先确认平台字段、提交 mapping 和学校 DOM 是否能对上，并让失败原因可见。

任务：

1. 增加 mapping audit，输出平台字段、`automation.mappings`、学校 DOM 三列关系。
2. `_write_one_field()` 捕获 Playwright `TimeoutError`、不可见元素、selector 缺失。
3. 记录 `sourceId`、`targetLocator`、`targetType`、tag、class、visible、value length、失败 stage。
4. job `error_code` 改为具体字段写入错误。
5. audit details 写精简摘要，例如：

```text
skt0Area(wysiwyg_text) 写入失败：目标是隐藏 textarea，未找到可写 editor
```

验收：

- 再遇到 `#skt0Area` 隐藏 textarea，不再只看到 `SCHOOL_SUBMIT_UNKNOWN_ERROR`。
- 平台有值但缺少提交 mapping 的图片节点会被明确列出，例如 `YSSJDrawingAreaArea`。
- 前端 public message 仍脱敏，只提示“部分内容未能成功写入学校系统，系统已停止提交”。

### 7.2 第二阶段：实现 `wysiwyg_text`

任务：

1. 配置 `skt0Area` 等实验问题节点 `targetType=wysiwyg_text`。
2. 实现 `write_wysiwyg_text()`。
3. 对真实页面写入“你好”这类短文本并回读。
4. 再写入多行文本，确认 `<br>` 和可见文本回读稳定。

验收：

- `#skt0Area` 不再触发 hidden textarea fill timeout。
- `.wysiwyg-editor` 可见文本正确。
- 提交前字段报告显示该节点 `succeededFields`。

### 7.3 第三阶段：实现 `wysiwyg_image`

任务：

1. 配置 `YSSJDrawingAreaArea` 等图片节点 `targetType=wysiwyg_image`。
2. 解析平台图片 URL 到本地文件路径。
3. 实现点击当前 container 的 `title="插入图片"` 按钮。
4. 对 popup file input 执行 `set_input_files()`。
5. 等待当前 editor 出现 `img`。

验收：

- 上传后当前字段 `.wysiwyg-editor img` 存在。
- `img.src` 非空，允许是 `data:image/png;base64,...`。
- 已有旧图片时，默认清空后只保留本次图片。

### 7.4 第四阶段：真实提交验证

验证顺序：

1. 只写普通 text 字段，不点提交，检查报告。
2. 写 `skt0Area`，不点提交，检查报告。
3. 写 `YSSJDrawingAreaArea`，不点提交，检查报告。
4. 所有字段写入成功后，再允许点击临时提交。
5. 临时提交成功后关闭 bootbox，回到完成报告列表，同步学校提交状态。

## 8. 明确不做的事

- 不直接对隐藏 textarea 调用 `locator.fill()`。
- 不把图片 URL 当普通文本填入 textarea。
- 不优先手拼 `<img src="平台 URL">` 跳过学校上传流程。
- 不新增第四种 `targetType`。
- 不用自动猜测替代 `automation.mappings`。
- 不在字段写入失败时继续点击学校提交按钮。
- 不把字段写入失败包装成 unknown submit error。

## 9. 与其它文档关系

- `docs/SCHOOL_SUBMIT_AND_STATUS_PLAN.md` 记录提交状态、modal 复用、前端进度面板和状态拆分规则。
- 本文档只聚焦学校 WYSIWYG 字段的 DOM 形态、写入策略和验收。
- `docs/API_CONTRACT.md` 已记录 `automation.mappings[].targetType` 的配置契约。
