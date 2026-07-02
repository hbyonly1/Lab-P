# 实验内容数据抽取标准作业程序 (SOP)

平台后续需要接入成百上千个实验，不能依赖于手工编写每一个配置。为了保证高效的转化效率，我们沉淀了这套“从旧版 HTML 自动抽取实验内容并转换为 JSON 结构”的标准流程。

## 1. 原理概述
老版实验系统中（如 `电表的改装.html`），每个实验页面由复杂的表格、纯文本以及大量行内/块级图片（例如带数学符号的小图和带电路图的大图）拼接而成。
我们通过 Node.js 脚本读取 HTML 节点，将其结构化并自动清洗，生成一套可以在本平台的渲染引擎中动态执行的配置文件（JSON）。

## 2. 工具脚本准备
确保项目根目录下存在类似于 `scratch_extract.js` 的脚本工具，其核心逻辑应包含：
1. **DOM 抓取与边界界定**：通过 `indexOf` 或者 Cheerio 定位“实验目的”、“实验原理”、“实验步骤”、“数据处理”等核心文本区块。
2. **段落切分**：将抓取到的整块内容按换行符 (`\n` 或 `<br/>`) 和段落标签 (`<p>`) 劈开成对应的 `segments` 数组。
3. **富文本与图片正则提取**：遍历每个 HTML 片段，使用正则表达式提取包含在文本中的 `<img/>` 标签。

## 3. 尺寸嗅探与智能分类 (核心)
导致排版错乱的最大元凶是“丢失图片尺寸导致行内公式变成巨大方块”。因此，在解析 HTML 里的 `<img>` 时，脚本**必须**执行以下动作：

```javascript
// 伪代码示例：
const imgMatches = [...html.matchAll(/<img([^>]+)>/gi)];
imgMatches.forEach(m => {
  // 1. 抓取原始行内写死的尺寸
  const w = m[1].match(/width="([^"]+)"/i)?.[1];
  const h = m[1].match(/height="([^"]+)"/i)?.[1];
  const src = m[1].match(/src="([^"]+)"/i)?.[1];
  
  // 2. 将字符串数字转为浮点型以作判断
  const numericHeight = h ? parseFloat(h) : 1000;
  
  // 3. 判断阈值，打上 inline 标签
  // 如果高度极小（例如小于 60px），大概率是行内的公式或特殊符号（如 R_x）
  const isInline = numericHeight < 60; 
  
  segments.push({
    type: "image",
    src: src,
    inline: isInline,
    width: w,
    height: h
  });
});
```

## 4. 人工校验与配置挂载
脚本执行输出 JSON 后，需进行最终的人工校验：
1. **清理多余空白与换行**：修正由于 HTML 解析残留的过多空白段落。
2. **嵌入占位符 (Inputs)**：找出原有文本中的空缺横线（如 `____`），用含有 `nodeId` 的输入框配置对象替换，例如 `{"nodeId": "SYMD_Fill_0", "width": "100px"}`。
3. **注入到后端配置**：将生成的 `segments` 填入 `backend/configs/exp_xxxx.json`，由后端同步到 `experiments.config_json` 并通过 API 提供给前端。

## 5. 渲染引擎对接
前端的 `SectionShell` 和 `ExperimentDetailView` 组件在遍历这套 JSON 的 `segments` 时：
- 遇到纯字符串：以原生文本加 `white-space: pre-wrap` 渲染。
- 遇到图片：读取 `inline` 属性，选择按普通块级大图居中展示，或者应用 `vertical-align: middle` 和原生宽高嵌入在文本段落中。
