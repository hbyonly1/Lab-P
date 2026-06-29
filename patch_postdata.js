const fs = require("fs");
const path = require("path");

const html = fs.readFileSync("./assets/complete_saves_student/电表的改装.html", "utf-8");
const configPath = "frontend/src/assets/configs/exp_meter_modification.json";
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// Find the block for "拟合Rs与"
const startIdx = html.indexOf("拟合Rs与");
// We can just grab a chunk of HTML from here until say "思考题"
const chunk = html.substring(startIdx - 50, startIdx + 3000); // 3000 chars should be enough

let segments = [];
let imgCounter = 100; // start higher to avoid collisions with previous script

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

// Tokenize the HTML chunk
const tagRegex = /(<img[^>]+>|<input[^>]+>|<br>|<\/div>|<\/p>|<p[^>]*>)/gi;
let lastIndex = 0;
let match;

function flushText(text) {
  const clean = text.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  // Don't add empty strings unless they have meaning. Let's just push non-empty.
  if (clean) segments.push(clean);
}

// Ensure we only process until the end of this conceptual block (e.g., stopping when we hit the next major section like "三、" or end of div)
// Actually we can just process the whole chunk and slice it conceptually. The chunk ends around 3000 chars which is safe.
// Wait, to be safe, let's stop processing if we hit "（3）拟合的相关系数" + the input field after it.

let stop = false;

while ((match = tagRegex.exec(chunk)) !== null && !stop) {
  const textBefore = chunk.substring(lastIndex, match.index);
  flushText(textBefore);

  const tag = match[0];
  if (tag.toLowerCase().startsWith("<img")) {
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
        
        segments.push(imgSeg);
      }
    }
  } else if (tag.toLowerCase().startsWith("<input")) {
    const idMatch = tag.match(/id="([^"]+)"/i);
    if (idMatch) {
      segments.push({ nodeId: idMatch[1], width: "100px" });
      if (idMatch[1] === "DBGZ4") {
        // DBGZ4 is the last input in this section
        stop = true;
      }
    }
  }
  
  lastIndex = tagRegex.lastIndex;
}

// Replace the postDataSections in config
config.ui.postDataSections = [
  {
    title: "（二）拟合Rs与 1/Ix 的函数关系",
    segments: segments
  }
];

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log("Post data sections patched successfully.");
