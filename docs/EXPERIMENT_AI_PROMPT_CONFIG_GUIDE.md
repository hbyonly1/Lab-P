# 实验配置 AI 节点与 Prompt 编写指南

本文用于规范 `backend/configs/*.json` 中和 AI 识别、生成回答、公式计算有关的配置写法。目标是让实验配置可维护、提示不重复、责任边界清楚。

## 1. 总原则

- 前端不写实验专用 Prompt。前端只读取实验 JSON、展示页面、触发后端接口。
- System Prompt 只放在 Admin Prompt 模板页或后端默认值里，用来表达全局行为，例如不推断、不补全、按单位换算、只返回 JSON。
- 实验 JSON 只写当前实验特有的结构和少量补充规则。
- 能由表头、行名、列名表达的信息，优先写进 `ui.dataTables`，不要再写进 prompt 文案。
- 能由某个节点自身表达的信息，写在该节点的 `recognitionHint`，不要再写进实验级 `extraPrompt`。
- 公式计算和 AI 识别要分清：需要从学生图片或作图记录读取的结果用 `ai_recognize`；平台自动计算的结果用 `computed + formulas`。

## 2. AI 识别 Prompt 的拼接顺序

后端入口是 `backend/core/ai_prompts.py` 的 `build_recognition_prompt()`。真实拼接顺序是：

1. System Prompt：数据库模板里的 `recognition_system_prompt`，没有则用后端默认值。
2. 实验名称。
3. 字段映射：由 `ui.dataTables` / `ui.dataTable` 自动生成表格轴映射，并补充必要的节点级提示。
4. 返回 JSON schema：所有 `type = "ai_recognize"` 的 nodeId 都会出现在 schema 中。
5. 实验级 `ai.recognition.extraPrompt`：只放当前实验的少量特殊规则。

字段映射内部对每个识别节点的提示优先级是：

```text
inputs.fields[].recognitionHint
  > ai.recognition.nodeHints[nodeId]（旧式兼容）
  > 表格映射已经覆盖则不额外输出
  > label/type 自动生成的兜底提示
```

因此，`recognitionHint` 是节点级 AI 提示，不是前端显示文案，也不是全局附加指令。

## 3. 节点类型怎么选

### `ai_recognize`

用于需要从学生上传图片中识别出来的值。

适合：

- 原始数据表中的手写读数。
- 学生在原始数据纸或作图记录里已经写出的结果。
- 学校系统需要填写，但不能由平台可靠自动计算的结果。

不适合：

- 固定选择题答案。
- 可由已有节点稳定计算出的值。
- 实验问题的文字回答。
- 单独上传到学校富文本里的图片答案。

### `computed`

用于平台后端公式计算出的值。必须在顶层 `formulas` 中显式写公式。

规则：

- 只有顶层 `formulas` 会被 `/api/v1/experiments/{id}/compute` 执行。
- 公式必须显式读取节点或常量，例如 `v('A')`、`v('A','B')`、`v(200,400)`。
- 不要依赖 UI 表格结构隐式推断公式输入。
- 如果旧公式需要保留但暂时不用，放到 `archivedFormulas`，不要留在 `formulas`。

### `fixed`

用于固定填空。一键填空读取 `value`。

### `generated`

用于实验问题、分析题等 AI 生成文本。

### `image_upload`

用于学校系统中需要单独插图的答案节点。它不是普通识别文本，也不进入生成式回答文本框。

## 4. `ui.dataTables` 优先承载表格语义

表格数据的单位、行列含义、固定刻度，优先写在 `ui.dataTables[].rows[].cells[]` 里。

推荐：

```json
{
  "text": "I（10⁻¹¹A）"
}
```

```json
{
  "text": "截止电压U₀（V）"
}
```

后端会从表格自动生成类似：

```text
row_axis_label=UAK（V）
row_labels=[I（10⁻¹¹A）,I（10⁻¹¹A）]
node_matrix=[[G10-0,G10-1,...],[G12-0,G12-1,...]]
```

如果同一张表里出现“表头行 + 数据行 + 第二段表头行 + 第二段数据行”，第二段表头行应优先标成 `isHeader: true`，这样前端视觉上就是表头，后端也会把它作为新的局部坐标轴。若历史配置里它仍是无 `nodeId` 的普通多文本行，后端也会兼容识别为局部坐标轴。AI Prompt 会拆成多段表格映射：

```text
cols=[-1.5,-1,-0.5,0,1,2,3,4,5]
node_matrix=[[G10-0,...,G10-8]]

cols=[6,8,10,13,16,19,22,26,30]
node_matrix=[[G12-0,...,G12-8]]
```

这样前端仍按原始实验表格展示，AI 也能看到第二排节点对应的真实列坐标。

不要再为表格里的每个节点写这种重复提示：

```json
{
  "id": "G10-0",
  "recognitionHint": "表1电流，单位 10^-11 A，只返回系数"
}
```

表格映射已经能表达时，逐节点提示会让 Prompt 变长、变乱，也更容易互相矛盾。

## 5. `recognitionHint` 怎么写

`recognitionHint` 只用于单个节点的特殊说明。

适合写：

- 这个节点不在表格里，AI 需要知道单位或返回格式。
- 这个节点和周围节点长得像，但含义不同。
- 这个节点是从图片中的独立结果区读取，而不是从表格坐标读取。

不适合写：

- 整个实验的通用规则。
- 表格中已经通过行名/列名表达的单位。
- “不要推断、不要补全、只返回 JSON”这类全局规则。
- 长篇实验原理或作图过程。

推荐短句：

```json
{
  "id": "G7",
  "type": "ai_recognize",
  "label": "普朗克常数计算值 h1",
  "recognitionHint": "单位按 10^-34 J·S，只返回数值，不带单位。"
}
```

```json
{
  "id": "G8",
  "type": "ai_recognize",
  "label": "普朗克常数相对误差",
  "recognitionHint": "单位按 %，只返回数值，不带 %。"
}
```

避免长句：

```text
从原始数据纸或作图记录中读取 U0-v 直线斜率 k 后得到的普朗克常数...
```

这类说明对模型帮助有限，还会和 PPT、公式、数据处理方式混在一起。节点提示只写 AI 真正需要的定位或格式信息。

## 6. `ai.recognition.extraPrompt` 怎么写

`extraPrompt` 是实验级识别补充说明，只用于少量跨多个节点的特殊规则。

适合写：

- 某个实验普遍容易出错的单位换算。
- 某类值需要保留符号、保留小数形式或特殊格式。
- 表格结构无法表达的通用例外。

不适合写：

- 已经在 `ui.dataTables` 表头/行名里表达的单位。
- 已经在 `recognitionHint` 里写过的节点单位。
- 每个 nodeId 的逐个说明。
- 大段实验步骤、实验原理、公式推导。

推荐短句：

```json
{
  "ai": {
    "recognition": {
      "imageRef": "IMG_RAW_DATA",
      "extraPrompt": "若手写为 A 单位科学计数法，按表头单位换算为系数；U0 保留手写正负号。"
    }
  }
}
```

这句只补两个表格映射不一定稳住的高频问题：

- 学生可能写 `7.68×10^-9 A`，但学校表格要按表头单位填写系数。
- 截止电压 `U0` 的正负号不能被模型按物理习惯改写。

如果一个实验需要从多张不同图片识别不同节点，使用 `ai.recognition.groups`。每组只声明图片槽和节点列表，避免把响应曲线、原始数据表等不同图片混进同一个 Prompt。

```json
{
  "ai": {
    "recognition": {
      "imageRef": "IMG_RAW_DATA",
      "groups": [
        {
          "id": "raw_table",
          "imageRef": "IMG_RAW_DATA",
          "nodeIds": ["A1", "A2"],
          "extraPrompt": "只识别原始数据表。"
        },
        {
          "id": "response_curve",
          "imageRef": "IMG_RESPONSE_CURVE",
          "nodeIds": ["B1"]
        }
      ]
    }
  }
}
```

`imageRef` 保留给旧逻辑和默认识别槽；配置了 `groups` 后，审核预处理和详情页一键识别会按组分别调用 AI 并合并结果。组内 `extraPrompt` 只写该组图片特有的简短规则，不要复用其他组的表格说明。

不要写：

```text
G7 单位按 10^-34 J·S；G8 单位按 %。
```

如果 `G7/G8` 已经有 `recognitionHint`，这里再写就是重复。

## 7. `ai.generation` 怎么写

生成式回答的配置只描述“用哪些数据帮助回答问题”，不要把识别规则混进来。

```json
{
  "ai": {
    "generation": {
      "targetRef": "skt0Area",
      "dataNodes": ["G3", "G4", "G5", "G7", "G8"],
      "extraPrompt": "回答只写结论和原因，不写题号。"
    }
  }
}
```

规则：

- `dataNodes` 只能引用 `inputs.fields[].id` 中存在的节点。
- 可以引用 `ai_recognize`、`computed`、`fixed` 等节点。
- 未配置时，后端默认取前 3 个 `ai_recognize` 节点作为兜底。
- `ai.generation.extraPrompt` 只写思考题生成的特殊要求，不写图片识别单位规则。

## 8. `formulas` 和 `archivedFormulas`

`formulas` 是可执行区。

```json
{
  "formulas": {
    "G3": "format_sig(v('G20-1') / v('G20-0'), 3)"
  }
}
```

`archivedFormulas` 是留存区。

```json
{
  "archivedFormulas": {
    "G7": "format_sig(...)"
  }
}
```

规则：

- 当前要自动计算的节点才放进 `formulas`。
- 不希望一键计算覆盖的节点，不要放进 `formulas`。
- 因教学/PPT/人工作图要求导致结果应从学生图片读取时，把节点设为 `ai_recognize`。
- 旧公式怕以后还用，可以放进 `archivedFormulas`，但必须知道它不会被后端执行。

光电效应示例：

- `G3/G4/G5` 是电流比例，可以由表2电流稳定计算，所以保留在 `formulas`。
- `G7/G8` 按 PPT 来自作图结果，学生可能用手动画图斜率，不应由平台最小二乘自动覆盖，所以改为 `ai_recognize`，旧公式放入 `archivedFormulas`。

## 9. 写配置时的检查清单

- [ ] 这个节点是图片识别、固定值、公式计算、文本生成还是图片上传？
- [ ] 表格单位是否已经写进 `ui.dataTables` 的表头或行名？
- [ ] 表格节点是否避免了逐节点 `recognitionHint`？
- [ ] 非表格识别节点是否只写了必要的短 `recognitionHint`？
- [ ] `ai.recognition.extraPrompt` 是否只保留实验级少量特殊规则？
- [ ] `extraPrompt` 是否没有重复 `recognitionHint` 的内容？
- [ ] System Prompt 是否没有被写进实验 JSON？
- [ ] 可执行公式是否只放在 `formulas`？
- [ ] 暂时不用但要保留的公式是否放在 `archivedFormulas`？
- [ ] 生成式回答的 `dataNodes` 是否只引用真实存在的节点？

## 10. 光电效应当前推荐写法

```json
{
  "inputs": {
    "fields": [
      {
        "id": "G7",
        "type": "ai_recognize",
        "label": "普朗克常数计算值 h1",
        "recognitionHint": "单位按 10^-34 J·S，只返回数值，不带单位。"
      },
      {
        "id": "G8",
        "type": "ai_recognize",
        "label": "普朗克常数相对误差",
        "recognitionHint": "单位按 %，只返回数值，不带 %。"
      }
    ]
  },
  "ai": {
    "recognition": {
      "imageRef": "IMG_RAW_DATA",
      "extraPrompt": "若手写为 A 单位科学计数法，按表头单位换算为系数；U0 保留手写正负号。"
    }
  },
  "formulas": {
    "G3": "format_sig(v('G20-1') / v('G20-0'), 3)",
    "G4": "format_sig(v('G20-2') / v('G20-1'), 3)",
    "G5": "format_sig(v('G20-2') / v('G20-0'), 3)"
  },
  "archivedFormulas": {
    "G7": "...",
    "G8": "..."
  }
}
```

这里的分工是：

- `ui.dataTables` 负责表格结构、行列、单位。
- `recognitionHint` 负责 `G7/G8` 这类非表格结果节点的单位。
- `extraPrompt` 只补科学计数法换算和 `U0` 符号。
- `formulas` 只计算仍应自动计算的电流比例。
- `archivedFormulas` 只留存旧公式，不参与计算。
