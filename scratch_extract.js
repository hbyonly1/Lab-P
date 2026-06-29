const fs = require("fs");
const path = require("path");

const html = fs.readFileSync("./assets/complete_saves_student/电表的改装.html", "utf-8");

const startIdx = html.indexOf("实验目的：");
const endIdx = html.indexOf("实验内容：电表的改装");

if (startIdx === -1 || endIdx === -1) {
  console.error("Could not find bounds");
  process.exit(1);
}

const contentHTML = html.substring(startIdx, endIdx);

let currentTitle = "实验目的";
let sections = [];
let currentSegments = [];

let imgCounter = 0;
function saveImage(base64Str) {
  imgCounter++;
  const match = base64Str.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const data = Buffer.from(match[2], "base64");
  const filename = `meter_mod_img_${imgCounter}.${ext}`;
  const outPath = path.join(__dirname, "frontend/public/assets/configs_images", filename);
  fs.writeFileSync(outPath, data);
  return `/assets/configs_images/${filename}`;
}

const tagRegex = /(<img[^>]+>|<input[^>]+>|实验目的：|实验仪器：|实验原理|实验步骤|<br>|<\/div>)/gi;
let lastIndex = 0;
let match;

function flushText(text) {
  const clean = text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  if (clean) currentSegments.push(clean);
}

while ((match = tagRegex.exec(contentHTML)) !== null) {
  const textBefore = contentHTML.substring(lastIndex, match.index);
  flushText(textBefore);

  const tag = match[0];
  if (tag === "实验目的：" || tag === "实验仪器：" || tag === "实验原理" || tag === "实验步骤") {
    if (currentSegments.length > 0) {
      sections.push({ title: currentTitle, segments: currentSegments });
    }
    currentTitle = tag.replace("：", "");
    currentSegments = [];
  } else if (tag.toLowerCase().startsWith("<img")) {
    const srcMatch = tag.match(/src="([^"]+)"/i);
    const widthMatch = tag.match(/width="([^"]+)"/i);
    const heightMatch = tag.match(/height="([^"]+)"/i);
    
    if (srcMatch) {
      let srcPath = srcMatch[1];
      if (srcPath.startsWith("data:image")) {
        srcPath = saveImage(srcPath);
      }
      
      if (srcPath) {
        const width = widthMatch ? parseFloat(widthMatch[1]) : 0;
        const height = heightMatch ? parseFloat(heightMatch[1]) : 0;
        const isInline = (width > 0 && width < 200) || (height > 0 && height < 60);
        
        const imgSeg = { type: "image", src: srcPath, inline: isInline };
        if (width > 0) imgSeg.width = width + "px";
        if (height > 0) imgSeg.height = height + "px";
        
        currentSegments.push(imgSeg);
      }
    }
  } else if (tag.toLowerCase().startsWith("<input")) {
    const idMatch = tag.match(/id="([^"]+)"/i);
    if (idMatch) {
      currentSegments.push({ nodeId: idMatch[1], width: "100px" });
    }
  }
  
  lastIndex = tagRegex.lastIndex;
}
flushText(contentHTML.substring(lastIndex));
if (currentSegments.length > 0) {
  sections.push({ title: currentTitle, segments: currentSegments });
}

console.log(JSON.stringify(sections, null, 2));
