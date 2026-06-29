
function InitCanvas(FaricjsJson, imgUrl, canvasId, IsSupportWrite, ImgId) {
    this.canvas = null; // fabric canvas对象
    this.strokeColor = (getCookie("colorFa") != "" ? getCookie("colorFa") : "#f81616"); // 线框色
    this.showStrokeColorPicker = false; // 是否显示 线框色选择器
    this.fillColor = "rgba(241, 8, 8, 0)"; // 填充色
    this.showFillColorPicker = false; // 是否显示 填充色选择器
    this.showBgColorPicker = false; // 是否显示 背景色选择器
    this.lineSize = (getCookie("widthFa") != "" ? parseInt(getCookie("widthFa")) : 2); // 线条大小 （线条 and 线框）
    this.fontSize = 16; // 字体大小
    this.selectTool = ""; // 当前用户选择的绘图工具 画笔：brush 直线：line 矩形：rect 圆形 circle 文本 text
    this.mouseFrom = {}; // 鼠标绘制起点
    this.mouseTo = {}; // 鼠标绘制重点
    this.drawingObject = null; // 保存鼠标未松开时用户绘制的临时图像
    this.textObject = null; // 保存用户创建的文本对象
    this.isDrawing = false; // 当前是否正在绘制图形（画笔，文本模式除外）
    this.stateArr = []; // 保存画布的操作记录
    this.stateIdx = 0; // 当前操作步数
    this.isRedoing = false; // 当前是否在执行撤销或重做操作
    this.objectCanvas = "";
    this.FaricjsJson = FaricjsJson; // 当前操作步数
    this.imgUrl = imgUrl; // 当前是否在执行撤销或重做操作
    this.canvasId = canvasId;
    this.IsSupportWrite = IsSupportWrite;
    this.IsExistTrace = false;//是否存在痕迹
    this.ActiveObject = '';
    this.IsEdit = false;
    this.ImgId = ImgId;
}

InitCanvas.prototype = {
    data: function () {
        return this;
    },
    // 监听线框色选择器 颜色选择
    updateStrokeColor(val) {
        var _data = this.data();
        // 保存用户选择的线框色
        _data.strokeColor = val.hex;
        // 修改当前选择的颜色指示
        //this.$refs.strokeColor.style.backgroundColor = this.strokeColor;
    },
    // 监听填充色选择器 颜色选择
    updateFillColor(val) {
        var _data = this.data();
        // 保存用户选择的线框色
        _data.fillColor = val.hex8;
    },
    // 监听背景色选择器 颜色选择
    updateBgColor(val) {
        var _data = this.data();
        // 保存用户选择的背景色
        _data.bgColor = val.hex;
        //this.$refs.bgColor.style.backgroundColor = this.bgColor;
    },
    // 初始化画布
    initCanvas(FaricjsJson, imgUrl, canvasId) {
        var _this = this;
        var _data = this.data();
        pzState();//初始化批注选中样式
        // 初始化线框色 与 指示器
        _data.strokeColor = (getCookie("colorFa") != "" ? getCookie("colorFa") : "#f81616");
        // 初始化填充色 与 指示器
        _data.fillColor = "rgba(241, 8, 8, 0)";
        // 初始化背景色 与 指示器
        // 初始化 fabric canvas对象
        if (!_data.canvas) {
            _data.canvas = new fabric.Canvas(canvasId);
            // 设置画布背景色 (背景色需要这样设置，否则拓展的橡皮功能会报错)
            _data.canvas.setBackgroundColor(_data.bgColor, undefined, {
                erasable: false,
            });
            // 设置背景色不受缩放与平移的影响
            _data.canvas.set("backgroundVpt", false);
            // 禁止用户进行组选择
            _data.canvas.selection = false;
            // 设置当前鼠标停留在
            _data.canvas.hoverCursor = "default";
            _data.canvas.calcOffset()

            let children = _data.canvas.getObjects();
            if (children.length > 0) {
                _data.canvas.remove(...children);
            }

            if (imgUrl != "" && (FaricjsJson == null || FaricjsJson == "")) {
                _this.initCanvasBackground(imgUrl, _data.canvas);
            }
            if (FaricjsJson != null && FaricjsJson != "") {
                _data.canvas.loadFromJSON(JSON.parse(FaricjsJson.replace(/'/g, '"').replace(/\/r\/n/g, "")));//初始化画布数据，将json转为对象进行渲染
                _data.canvas.renderAll();//渲染全部
            } else {
                _data.canvas.renderAll();//渲染全部
            }
            // 记录画布原始状态
            _data.stateIdx = 0;
            _data.stateArr.push(JSON.stringify(_data.canvas));
            _this.initObjEdit(false);//初始化默认为无法选择状态
        }
    },
    //初始化画布背景
    initCanvasBackground(objURL, canvas) {
        var _data = this.data();
        // 读取图片地址，设置画布背景,objURL是用户上传的图片资源
        fabric.Image.fromURL(objURL, (img) => {
            var tscaleX =
                (canvas.height < canvas.width ? canvas.height : canvas.width) /
                (img.height < img.width ? img.height : img.width);
            var tscaleY =
                (canvas.height < canvas.width ? canvas.height : canvas.width) /
                (img.height < img.width ? img.height : img.width);
            if (tscaleX * img.width > canvas.width) {
                var rscalex = canvas.width / img.width;
                var imgscale = img.height / img.width;
                var rscaley = (rscalex * img.width * imgscale) / img.height;
                //再次缩放
                tscaleX = rscalex;
                tscaleY = rscaley;
            }
            img.set({
                // 通过scale来设置图片大小，这里设置和画布一样大
                scaleX: tscaleX,
                scaleY: tscaleY,
            });
            canvas.add(
                img.set({
                    // 通过scale来设置图片大小，这里设置和画布一样大
                    scaleX: tscaleX,
                    scaleY: tscaleY,
                    // type: "img",//去除，导出图片会报错
                })
            );
            // 设置背景白色
            canvas.setBackgroundColor("white");

            // 设置背景,直接设置
            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
            canvas.renderAll();
            let children = _data.canvas.getObjects();
            if (children.length > 0) {
                _data.canvas.remove(...children);
            }
        });
    },
    // 初始化画布事件
    initCanvasEvent() {
        // 操作类型集合
        let toolTypes = ["line", "rect", "circle", "text", "move"];
        var _data = this.data();
        var _this = this;
        // 监听鼠标按下事件
        _data.canvas.on("mouse:down", (options) => {
            _this.IsExistTrace = true;
            if (_data.selectTool != "text" && _data.textObject) {
                // 如果当前存在文本对象，并且不是进行添加文字操作 则 退出编辑模式，并删除临时的文本对象
                // 将当前文本对象退出编辑模式
                _data.textObject.exitEditing();
                _data.textObject.set("backgroundColor", "rgba(0,0,0,0)");
                if (_data.textObject.text == "") {
                    _data.canvas.remove(_data.textObject);
                }
                _data.canvas.renderAll();
                _data.textObject = null;
            }
            // 判断当前是否选择了集合中的操作
            if (toolTypes.indexOf(_data.selectTool) != -1) {
                // 记录当前鼠标的起点坐标 (减去画布在 x y轴的偏移，因为画布左上角坐标不一定在浏览器的窗口左上角)
                _data.mouseFrom.x = options.absolutePointer.x;
                _data.mouseFrom.y = options.absolutePointer.y;
                // 判断当前选择的工具是否为文本
                if (_data.selectTool == "text") {
                    // 文本工具初始化
                    _this.initText();
                } else {
                    // 设置当前正在进行绘图 或 移动操作
                    _data.isDrawing = true;
                }
            }
        });
        // 监听鼠标移动事件
        _data.canvas.on("mouse:move", (options) => {
            // 如果当前正在进行绘图或移动相关操作
            if (_data.isDrawing) {
                // 记录当前鼠标移动终点坐标 (减去画布在 x y轴的偏移，因为画布左上角坐标不一定在浏览器的窗口左上角)
                _data.mouseTo.x = options.absolutePointer.x;
                _data.mouseTo.y = options.absolutePointer.y;
                switch (_data.selectTool) {
                    case "line":
                        // 当前绘制直线，初始化直线绘制
                        _this.initLine();
                        break;
                    case "rect":
                        // 初始化 矩形绘制
                        _this.initRect();
                        break;
                }
            }
        });
        // 监听鼠标松开事件
        _data.canvas.on("mouse:up", (options) => {
            // 如果当前正在进行绘图或移动相关操作
            if (_data.isDrawing) {
                // 清空鼠标移动时保存的临时绘图对象
                _data.drawingObject = null;
                // 重置正在绘制图形标志
                _data.isDrawing = false;
                // 清空鼠标保存记录
                _this.resetMove();
                // 如果当前进行的是移动操作，鼠标松开重置当前视口缩放系数
                //if (_data.selectTool == "move") {
                //    _data.canvas.setViewportTransform(_data.canvas.viewportTransform);
                //}
            }
        });
        // 监听画布渲染完成
        _data.canvas.on("after:render", (options) => {
            if (!_data.isRedoing) {
                _data.stateArr.push(JSON.stringify(_data.canvas));
                _data.stateIdx++;
            } else {
                // 当前正在执行撤销或重做操作，不记录重新绘制的画布
                _data.isRedoing = false;
            }
        });
        // 监听对象移动，防止对象拖出画布
        _data.canvas.on('object:moving', function (e) {
            var obj = e.target;
            // if object is too big ignore
            if (obj.currentHeight > obj.canvas.height || obj.currentWidth > obj.canvas.width) {
                return;
            }
            obj.setCoords();
            // top-left  corner
            if (obj.getBoundingRect().top < 0 || obj.getBoundingRect().left < 0) {
                obj.top = Math.max(obj.top, obj.top - obj.getBoundingRect().top);
                obj.left = Math.max(obj.left, obj.left - obj.getBoundingRect().left);
            }
            // bot-right corner
            if (obj.getBoundingRect().top + obj.getBoundingRect().height > obj.canvas.height || obj.getBoundingRect().left + obj.getBoundingRect().width > obj.canvas.width) {
                obj.top = Math.min(obj.top, obj.canvas.height - obj.getBoundingRect().height + obj.top - obj.getBoundingRect().top);
                obj.left = Math.min(obj.left, obj.canvas.width - obj.getBoundingRect().width + obj.left - obj.getBoundingRect().left);
            }
        });
    },
    // 初始化画笔工具
    initBruch(isDrawingMode) {
        var _this = this;
        var _data = _this.data();
        // 设置绘画模式画笔类型为 铅笔类型
        _data.canvas.freeDrawingBrush = new fabric.PencilBrush(_data.canvas);
        // 设置画布模式为绘画模式
        _data.canvas.isDrawingMode = isDrawingMode;
        // 设置绘画模式 画笔颜色与画笔线条大小
        _data.canvas.freeDrawingBrush.color = _data.strokeColor;
        _data.canvas.freeDrawingBrush.width = parseInt(_data.lineSize, 10);
    },
    // 初始化 绘制直线
    initLine() {
        var _data = this.data();
        var _this = this;
        // 根据保存的鼠标起始点坐标 创建直线对象
        let canvasObject = new fabric.Line(
            [
                _this.getTransformedPosX(_data.mouseFrom.x),
                _this.getTransformedPosY(_data.mouseFrom.y),
                _this.getTransformedPosX(_data.mouseTo.x),
                _this.getTransformedPosY(_data.mouseTo.y),
            ],
            {
                fill: _data.fillColor,
                stroke: _data.strokeColor,
                strokeWidth: _data.lineSize
            }
        );
        // 绘制 图形对象
        _this.startDrawingObject(canvasObject);
    },
    // 初始化 绘制矩形
    initRect() {
        var _data = this.data();
        var _this = this;
        let left = 0;
        let top = 0;
        let width = 0;
        let height = 0;
        //左上到右下
        if (_data.mouseTo.x > _data.mouseFrom.x && _data.mouseTo.y > _data.mouseFrom.y) {
            // 计算矩形长宽
            left = _this.getTransformedPosX(_data.mouseFrom.x);
            top = _this.getTransformedPosY(_data.mouseFrom.y);
            width = _data.mouseTo.x - _data.mouseFrom.x;
            height = _data.mouseTo.y - _data.mouseFrom.y;
        }
        //从 右下 往 左上 框选
        else if (_data.mouseTo.x < _data.mouseFrom.x && _data.mouseTo.y < _data.mouseFrom.y) {
            // 计算矩形长宽
            left = _this.getTransformedPosX(_data.mouseTo.x);
            top = _this.getTransformedPosY(_data.mouseTo.y);
            width = _data.mouseFrom.x - _data.mouseTo.x;
            height = _data.mouseFrom.y - _data.mouseTo.y;
        }
        //从 左下 往 右上 框选
        else if (_data.mouseFrom.x < _data.mouseTo.x && _data.mouseTo.y < _data.mouseFrom.y) {
            // 计算矩形长宽
            left = _this.getTransformedPosX(_data.mouseFrom.x);
            top = _this.getTransformedPosY(_data.mouseTo.y);
            width = Math.abs(_data.mouseFrom.x - _data.mouseTo.x);
            height = Math.abs(_data.mouseTo.y - _data.mouseFrom.y);
        }
        //从 右上 往 左下 框选
        else {
            // 计算矩形长宽
            left = _this.getTransformedPosX(_data.mouseTo.x);
            top = _this.getTransformedPosY(_data.mouseFrom.y);
            width = _data.mouseFrom.x - _data.mouseTo.x;
            height = Math.abs(_data.mouseFrom.y - _data.mouseTo.y);
        }

        // 创建矩形 对象
        let canvasObject = new fabric.Rect({
            left: left,
            top: top,
            width: width,
            height: height,
            stroke: _data.strokeColor,
            fill: _data.fillColor,
            strokeWidth: _data.lineSize
        });
        // 绘制矩形
        _this.startDrawingObject(canvasObject);
    },
    // 初始化绘制圆形
    initCircle() {
        var _data = this.data();
        var _this = this;
        let left = _this.getTransformedPosX(_data.mouseFrom.x);
        let top = _this.getTransformedPosY(_data.mouseFrom.y);
        // 计算圆形半径
        let radius =
            Math.sqrt(
                (_this.getTransformedPosX(_data.mouseTo.x) - left) *
                (_this.getTransformedPosY(_data.mouseTo.x) - left) +
                (_this.getTransformedPosX(_data.mouseTo.y) - top) *
                (_this.getTransformedPosY(_data.mouseTo.y) - top)
            ) / 2;
        // 创建 原型对象
        let canvasObject = new fabric.Circle({
            left: left,
            top: top,
            stroke: _data.strokeColor,
            fill: _data.fillColor,
            radius: radius,
            strokeWidth: _data.lineSize,
        });
        // 绘制圆形对象
        _this.startDrawingObject(canvasObject);
        canvasObject.on("selected", function () {
        });
    },
    // 初始化文本工具
    initText() {
        var _data = this.data();
        var _this = this;
        // 设置画布模式为绘画模式
        _data.canvas.isDrawingMode = false;
        
        //因为切换监听事件在鼠标事件之后，添加延迟执行
        setTimeout(function (_data) {
            var _data = _this.data();
            console.log(_data.selectTool == "edit");
            if (_data.selectTool == "edit") {
                return false;
            }
            console.log(3);
            if (!_data.textObject) {
                // 当前不存在绘制中的文本对象
                
                // 创建文本对象
                _data.textObject = new fabric.IText("", {
                    left: _this.getTransformedPosX(_data.mouseFrom.x),
                    top: _this.getTransformedPosY(_data.mouseFrom.y),
                    fontSize: _data.fontSize,
                    fontFamily: "Comic Sans",
                    fill: _data.strokeColor,
                    hasControls: true,
                    editable: true,
                    width: 30,
                    backgroundColor: "#fff",
                    selectable: true,
                    strokeWidth: 3
                });
                _data.canvas.add(_data.textObject);
                // 文本打开编辑模式
                _data.textObject.enterEditing();
                // 文本编辑框获取焦点
                _data.textObject.hiddenTextarea.focus();
                //当前文本设置为活动状态
                _data.canvas.setActiveObject(_data.textObject);
            } else {
                // 将当前文本对象退出编辑模式
                _data.textObject.exitEditing();
                _data.textObject.set("backgroundColor", "rgba(0,0,0,0)");
                if (_data.textObject.text == "") {
                    _data.canvas.remove(_data.textObject);
                }
                _data.canvas.renderAll();
                _data.textObject = null;
                _data.initObjEdit(false);
                return;
            }
        }, 100);

    },
    //初始化文本对象为编辑模式
    initObjEdit(isEdit) {
        var _data = this.data();
        _data.canvas.isDrawingMode = false;
        //如果是画笔撤销一步
        if (_data.selectTool == "brush" && this.imgUrl == '' && isEdit) {
            this.tapHistoryBtn(-1);
        }
        var drawObjects = _data.canvas.getObjects();
        if (drawObjects.length > 0) {
            drawObjects.map((item) => {
                // 双击前重置画布
                // 禁用画笔模式
                _data.canvas.isDrawingMode = false;
                // 启动图形选择编辑
                _data.IsEdit = isEdit;
                //item.set("selectable", isEdit);
                item.selectable = isEdit;
                item.editable = isEdit;
                // 保存当前选中的绘图工具
                if (isEdit) {
                    _data.selectTool = "edit";
                } else {
                    _data.canvas.discardActiveObject(); // 取消画布中的所有对象的选中状态
                }

            });
        }
        _data.canvas.renderAll();
    },
    // 绘制图形
    startDrawingObject(canvasObject) {
        var _data = this.data();
        // 禁止用户选择当前正在绘制的图形
        /*console.log("绘制图形"+canvasObject);*/
        canvasObject.selectable = false;
        // 如果当前图形已绘制，清除上一次绘制的图形
        if (_data.drawingObject) {
            _data.canvas.remove(_data.drawingObject);
        }
        // 将绘制对象添加到 canvas中
        _data.canvas.add(canvasObject);
        // 保存当前绘制的图形
        _data.drawingObject = canvasObject;
    },
    // 清空鼠标移动记录 （起点 与 终点）
    resetMove() {
        var _data = this.data();
        _data.mouseFrom = {};
        _data.mouseTo = {};
    },
    // 绘图工具点击选择
    tapToolBtn(tool) {

        var _data = this.data();
        var _this = this;
        if (tool == "edit") {
            // 保存当前选中的绘图工具
            _data.selectTool = tool;
            //控制当前画布的对象选中属性
            if ($('#edit').attr('class').indexOf('typeactive') != "-1") {
                _this.initObjEdit(true);
            } else {
                _this.initObjEdit(false);
            }
            return true;
        }
        if (_data.selectTool == tool) {
            return true;
        }
        // 保存当前选中的绘图工具
        _data.selectTool = tool;

        // 选择任何工具前进行一些重置工作
        // 禁用画笔模式
        _data.canvas.isDrawingMode = false;
        // 禁止图形选择编辑
        /* console.log("禁止图形选择编辑");*/
        let drawObjects = _data.canvas.getObjects();
        if (drawObjects.length > 0) {
            drawObjects.map((item) => {
                item.set("selectable", false);
            });
        }
        if (_data.selectTool == "brush") {
            // 如果用户选择的是画笔工具，直接初始化，无需等待用户进行鼠标操作
            _this.initBruch(true);
        }

    },
    // 缩放按钮点击
    tapScaleBtn(flag) {
        var _data = this.data();
        var _this = this;
        // flag -1 缩小 1 放大
        let zoom = _data.canvas.getZoom();
        if (flag > 0) {
            // 放大
            zoom *= 1.1;
        } else {
            // 缩小
            zoom *= 0.9;
        }
        // zoom 不能大于 20 不能小于0.01
        zoom = zoom > 20 ? 20 : zoom;
        zoom = zoom < 0.01 ? 0.01 : zoom;
        _this.canvas.setZoom(zoom);
    },
    // 撤销重做按钮点击
    tapHistoryBtn(flag) {
        var _data = this.data();
        _data.isRedoing = true;
        let stateIdx = _data.stateIdx + flag;
        // 判断是否已经到了第一步操作
        if (stateIdx < 0) return;
        // 判断是否已经到了最后一步操作
        if (stateIdx >= _data.stateArr.length) return;
        if (_data.stateArr[stateIdx]) {
            _data.canvas.loadFromJSON(_data.stateArr[stateIdx]);
            if (_data.canvas.getObjects().length > 0) {
                _data.canvas.getObjects().forEach((item) => {
                    item.set("selectable", false);
                });
            }
            _data.stateIdx = stateIdx;
        }
    },
    // 监听画布重新绘制
    tapClearBtn() {
        var _data = this.data();
        var _this = this;
        // 保存当前选中的绘图工具
        _data.selectTool = "clearAll";
        // 设置画布模式为绘画模式
        _data.canvas.isDrawingMode = false;
        let children = _data.canvas.getObjects();
        if (children.length > 0) {
            _data.canvas.remove(...children);
        }
        _this.IsExistTrace = true;
    },
    // 监听画布重新绘制
    tapLoadBtn() {
        var _data = this.data();
        var objectCanvasNew = _data.objectCanvas;
        _data.canvas.loadFromJSON(objectCanvasNew);
    },
    // 保存按钮点击
    tapSaveBtn() {
        var _data = this.data();
        _data.objectCanvas = _data.canvas.toJSON();
        _data.canvas.clone((cvs) => {
            //遍历所有对对象，获取最小坐标，最大坐标
            let top = 0;
            let left = 0;
            let width = _data.canvas.width;
            let height = _data.canvas.height;

            var objects = cvs.getObjects();
            if (objects.length > 0) {
                cvs.sendToBack(
                    new fabric.Rect({
                        left,
                        top,
                        width,
                        height,
                        stroke: "rgba(0,0,0,0)",
                        fill: _data.bgColor,
                        strokeWidth: 0,
                    })
                );
            }
            const dataURL = cvs.toDataURL({
                format: "png",
                multiplier: cvs.getZoom(),
                left,
                top,
                width,
                height,
            });
            const link = document.createElement("a");
            link.download = "canvas.png";
            link.href = dataURL;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    },
    // 计算画布移动之后的x坐标点(无缩放直接返回)
    getTransformedPosX(x) {
        var _data = this.data();
        let zoom = Number(_data.canvas.getZoom())
        return (x - _data.canvas.viewportTransform[4]) / zoom;
    },
    // 计算画布移动之后的y坐标点（无缩放直接返回）
    getTransformedPosY(y) {
        var _data = this.data();
        let zoom = Number(_data.canvas.getZoom())
        return (y - _data.canvas.viewportTransform[5]) / zoom;
    }
};

InitCanvas.prototype.mounted = function () {
    var _this = this;
    var FaricjsJson = _this.FaricjsJson;
    var imgUrl = _this.imgUrl;
    var canvasId = _this.canvasId;
    // 初始化 画布
    _this.initCanvas(FaricjsJson, imgUrl, canvasId);
    if (this.IsSupportWrite == 1) {
        // 默认开启画笔模式
        _this.tapToolBtn("brush");
        // 初始化 画布 事件
        _this.initCanvasEvent();
    }
};

InitCanvas.prototype.parentThis = function () {
    return this.canvas;
}

//工具的相关绑定
function toolBind(canvasObj) {
    //画布工具单击事件
    $(".type li").unbind().click(function () {
        
        if ($(this).attr('class').indexOf('tool') != -1) {
            $('#edit').removeClass("typeactive");//替换工具时，清除当前编辑状态
            for (var i = 0; i < canvasObj.length; i++) {
                canvasObj[i].initObjEdit(false);
            }
            $(".type .tool").removeClass("typeactive");//清除当前工具选中状态
            $(this).toggleClass("typeactive");
            pzState();//初始化批注选中样式
        }

        if ($(this).attr('class').indexOf('edit') != -1) {
            $(".type .tool").removeClass("typeactive");//清除当前工具选中状态
            $(this).toggleClass("typeactive");
        }
        var li = $(this).data('li');
        if (li == "clear") {
            bootbox.confirm({
                buttons: {
                    confirm: {
                        label: '确认',
                        className: 'btn btn-LightGreen'
                    },
                    cancel: {
                        label: '取消',
                        className: 'btn btn-LightGreen'
                    }
                },
                message: "<span style='margin-left:15px;'>是否确认清除？</span>",
                callback: function (result) {
                    if (result) {
                        for (var i = 0; i < canvasObj.length; i++) {
                            canvasObj[i].tapClearBtn();
                        }
                    }
                },
                title: "提示"
            });
        } else if (li != '' && li != undefined) {
            for (var i = 0; i < canvasObj.length; i++) {
                canvasObj[i].tapToolBtn(li);
            }
        } else {
            console.log('工具构建失败！');
        }
        pzState();//初始化批注选中样式
    });

    //字体大小切换
    $("#sizechoose").change(function () {
        for (var i = 0; i < canvasObj.length; i++) {
            canvasObj[i].fontSize = $(this).val();
            var item = canvasObj[i].canvas.getActiveObject();
            if (canvasObj[i].canvas.getActiveObject() != null) {

                //更新当前活动状态的文本框
                item.fontSize = $(this).val();
                canvasObj[i].canvas.renderAll();
            }

        }
    });

    var colorchoose = document.querySelector("input[type=color]");
    var widthchoose = document.querySelector(".linewidth input[type=number]");
    colorchoose.value = getCookie("colorFa") != "" ? getCookie("colorFa") : "#f81616";
    widthchoose.value = getCookie("widthFa") != "" ? getCookie("widthFa") : 2;
    //颜色选择
    colorchoose.onchange = function () {
        //$(".type .tool").removeClass("typeactive");
        for (var i = 0; i < canvasObj.length; i++) {
            canvasObj[i].strokeColor = this.value;
            if (canvasObj[i].selectTool == "brush") {
                canvasObj[i].initBruch(true);
            }
            var item = canvasObj[i].canvas.getActiveObject();
            if (canvasObj[i].canvas.getActiveObject() != null) {

                //更新当前活动状态的文本框
                item.fill = $(this).val();
                canvasObj[i].canvas.renderAll();
            }

        }
        setCookie("colorFa", this.value,10000);
    };

    // 粗细改变
    widthchoose.onchange = function () {
        /*$(".type .tool").removeClass("typeactive");*/
        for (var i = 0; i < canvasObj.length; i++) {
            canvasObj[i].lineSize = parseInt(this.value);
            canvasObj[i].canvas.freeDrawingBrush.width = parseInt(this.value);
        }
        setCookie("widthFa", this.value, 10000);
    };

    //删除活动对象
    document.onkeydown = function (e) {
        // 是否点击delete
        if (e.keyCode === 8) {
            // 移除当前所有正在活动的对象
            for (var i = 0; i < canvasObj.length; i++) {
                if (canvasObj[i].canvas.getActiveObject() != undefined && canvasObj[i].canvas.getActiveObject().type == "i-text" && canvasObj[i].canvas.getActiveObject().isEditing) {
                    return;
                }
                canvasObj[i].canvas.remove(canvasObj[i].canvas.getActiveObject())
            }
        }
    };

    //鼠标双击事件记录
    $('.canvas-container').unbind().dblclick(function () {
        console.log('双击');
        $(".type .tool").removeClass("typeactive");//清除当前工具选中状态
        pzState();//初始化批注选中样式
        var index = $(this).index();
        //控制当前画布的对象选中属性
        if ($('#edit').attr('class').indexOf('typeactive') == "-1") {
            canvasObj[index].initObjEdit(true);
            $('#edit').toggleClass("typeactive");
        }
    });

    $('#pz').unbind().click(function () {
        $('#xmltopcanvasdiv').toggle();
        $(".type .tool").removeClass("typeactive");//清除当前工具选中状态
        $('#edit').removeClass("typeactive");
        pzState();//初始化批注选中样式
        if ($('#xmltopcanvasdiv').css("display") == "none") {
            $('#brush').removeClass('typeactive');
        } else {
            $('#brush').addClass('typeactive');
        }
    });
}

//批注的选中控制
function pzState() {
    //控制批注的选中状态
    if ($('#xmltopcanvasdiv').css("display") == "none") {
        $('#pz').removeClass('typeactive');
    } else {
        $('#pz').addClass('typeactive');
    }
}

function setCookie(cname, cvalue, exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    var expires = "expires=" + d.toGMTString();
    document.cookie = cname + "=" + cvalue + "; " + expires;
}

function getCookie(cname) {
    var name = cname + "=";
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i].trim();
        if (c.indexOf(name) == 0) { return c.substring(name.length, c.length); }
    }
    return "";
}



