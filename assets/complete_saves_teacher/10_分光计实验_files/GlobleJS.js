//全局变量AccessToken
_userInfo = window.sessionStorage;
_systemInfo = window.sessionStorage;
_enviroment = window.sessionStorage;
_semesterInfo = window.sessionStorage;
_courseInfo = window.sessionStorage;
_reportReview = window.sessionStorage;
_pdfMuti = window.sessionStorage;
_menuType = window.sessionStorage
// 虚拟目录中站点名称 例如站点名为cccc，写成 /cccc
_websiteName = "";

//判断浏览器版本
function myBrowser() {
    var userAgent = navigator.userAgent; //取得浏览器的userAgent字符串
    var isOpera = userAgent.indexOf("Opera") > -1; //判断是否Opera浏览器
    var isIE = userAgent.indexOf("compatible") > -1 && userAgent.indexOf("MSIE") > -1 && !isOpera; //判断是否IE浏览器
    var isFF = userAgent.indexOf("Firefox") > -1; //判断是否Firefox浏览器
    var isSafari = userAgent.indexOf("Safari") > -1; //判断是否Safari浏览器
    if (isIE) {
        var IE5 = IE55 = IE6 = IE7 = IE8 = IE9 = false;
        var reIE = new RegExp("MSIE (\\d+\\.\\d+);");
        reIE.test(userAgent);
        var fIEVersion = parseFloat(RegExp["$1"]);
        IE55 = fIEVersion == 5.5;
        IE6 = fIEVersion == 6.0;
        IE7 = fIEVersion == 7.0;
        IE8 = fIEVersion == 8.0;
        IE9 = fIEVersion == 9.0;
        if (IE55) {
            return "IE55";
        }
        if (IE6) {
            return "IE6";
        }
        if (IE7) {
            return "IE7";
        }
        if (IE8) {
            return "IE8";
        }
        if (IE9) {
            return "IE9";
        }
    } //isIE end
    if (isFF) {
        return "FF";
    }
    if (isOpera) {
        return "Opera";
    }
}


////禁止后退键 作用于Firefox、Opera 
//document.onkeypress = forbidBackSpace;
////禁止后退键 作用于IE、Chrome 
//document.onkeydown = forbidBackSpace;
////处理键盘事件 禁止后退键（Backspace）密码或单行、多行文本框除外 
//function forbidBackSpace(e) {
//    var ev = e || window.event; //获取event对象 
//    var obj = ev.target || ev.srcElement; //获取事件源 
//    var t = obj.type || obj.getAttribute('type'); //获取事件源类型 
//    var c = obj.getAttribute('class'); //获取事件源类型
//    //获取作为判断条件的事件类型 
//    var vReadOnly = obj.readOnly;
//    var vDisabled = obj.disabled;
//    //处理undefined值情况 
//    vReadOnly = (vReadOnly == undefined) ? false : vReadOnly;
//    vDisabled = (vDisabled == undefined) ? true : vDisabled;
//    console.log(vReadOnly.toString() + vDisabled.toString());
//    //当敲Backspace键时，事件源类型为密码或单行、多行文本的， 
//    //并且readOnly属性为true或disabled属性为true的，则退格键失效 
//    var flag1 = ev.keyCode == 8 && (t == "password" || t == "text" || t == "textarea" || t == "number" || c == "wysiwyg-editor") && (vReadOnly == true || vDisabled == true);
//    //当敲Backspace键时，事件源类型非密码或单行、多行文本的，则退格键失效 
//    var flag2 = ev.keyCode == 8 && t != "password" && t != "text" && t != "number" && t != "textarea" && c != "wysiwyg-editor";
//    //判断
//    console.log(flag1.toString() + flag2.toString());
//    if (flag2 || flag1) return false;

//}

//防止页面后退
history.pushState(null, null, document.URL);
window.addEventListener('popstate', function () {
    history.pushState(null, null, document.URL);
});
//验证全局防XSS攻击返回值
function XSSResponse(str) {
    if (str == "Malicious character warning") {
        bootbox.alert("您提交的数据有恶意字符！");
        return false;
    }
}
//初始化
(function ($) {

    //验证重写
    $.fn.validation = function (options) {
        return this.each(function () {
            globalOptions = $.extend({}, $.fn.validation.defaults, options);
            validationForm(this)
        });
    };

    $.fn.validation.defaults = {
        validRules: [
            { name: 'required', validate: function (value) { return ($.trim(value) == ''); }, defaultMsg: '不能为空' },
            { name: 'number', validate: function (value) { return (!/^[0-9]\d*$/.test(value)); }, defaultMsg: '请输入数字。' },
            { name: 'email', validate: function (value) { return (!/^[a-zA-Z0-9]{1}([\._a-zA-Z0-9-]+)(\.[_a-zA-Z0-9-]+)*@[a-z0-9-]+(\.[a-z0-9-]+){1,3}$/.test(value)); }, defaultMsg: '请输入邮箱地址。' },
            { name: 'char', validate: function (value) { return (!/^[a-zA-Z]*$/.test(value)); }, defaultMsg: '请输入英文字符。' },
            { name: 'qq', validate: function (value) { return (!/^[^0]\d{4,9}$/.test(value)); }, defaultMsg: '请输入正确QQ' },
            { name: 'phone', validate: function (value) { return (!/^((\(\d{2,3}\))|(\d{3}\-))?1(3|4|5|6|8)\d{9}$/.test(value)); }, defaultMsg: '请输入正确手机号码' },
            { name: 'password', validate: function (value) { return (!safePassword(value)); }, defaultMsg: '密码由字母和数字组成，至少6位' }, // check-type="password"
            { name: 'rePassword', validate: function (value, param) { return (!(value == $(param).val())); }, defaultMsg: '两次输入的字符不一至' }, //  check-type="rePassword #inputPassword"   ,inputPassword需要比较的ID
            { name: 'idcard', validate: function (value) { return (!idCard(value)); }, defaultMsg: '***号码不正确' },
            { name: 'chinese', validate: function (value) { return (!/^[\u4e00-\u9fff]$/.test(value)); }, defaultMsg: '请输入汉字。' },
            { name: 'minNumber', validate: function (value) { return ($.trim(value) < 0); }, defaultMsg: '请输入大于0的值。' }
        ]
    };
    //默认页大小
    _enviroment.PageSize = 10;
    //备份jquery的ajax方法
    var _ajax = $.ajax;
    //获取PDF倍率
    SetPdfScale();
    $(".contentClass").attr("style", "height:" + _reportReview.pdfHeight);
    $(".scoreClass").attr("style", "height:" + _reportReview.tableHeight);
    //重写jquery的ajax方法
    $.ajax = function (opt) {
        //备份opt中error和success方法
        var fn = {
            error: function (XMLHttpRequest, textStatus, errorThrown) {},
            success: function (data, textStatus) {}
        }
        if (opt.error) {
            fn.error = opt.error;
        }
        if (opt.success) {
            fn.success = opt.success;
        }
        //扩展增强处理
        var _opt = $.extend(opt, {
            headers: {
                "Authorization": _userInfo.Token
            },
            error: function (XMLHttpRequest, textStatus, errorThrown) {
                XSSResponse(XMLHttpRequest);
                //错误方法增强处理
                $("#ajaxInfo").remove();
                fn.error(XMLHttpRequest, textStatus, errorThrown);
                bootbox.alert(textStatus);
            },
            success: function (data, textStatus) {
                XSSResponse(data);
                //成功回调方法增强处理
                if (data.toString().indexOf("/Scripts/APP/LoginJS.js") > 0) {
                    window.location.href = _websiteName + "/Login";
                }
                fn.success(data, textStatus);
            },
            beforeSend: function (XHR) {
                //提交前回调方法
                $('body').append("<div id='ajaxInfo' class='loadingLayout'><div class='loading'>正在请求数据,请稍等...</div></div>");
            },
            complete: function (XHR, TS) {
                //请求完成后回调函数 (请求成功或失败之后均调用)。
                $("#ajaxInfo").remove();
            }
        });
        _ajax(_opt);
    };

    window.onerror = function (msg, url, l) {
        $("#ajaxInfo").remove();
    }

})(jQuery);

//获取PDF倍率
function SetPdfScale() {
    var winWidth;
    if (window.innerWidth) {
        winWidth = window.innerWidth;
    }
    else if ((document.body) && (document.body.clientWidth)) {
        winWidth = document.body.clientWidth;
    }
    _pdfMuti.scale = winWidth / 1000;
    var winHeight;
    if (window.innerHeight) {
        winHeight = window.innerHeight;
    }
    else if ((document.body) && (document.body.clientHeight)) {
        winHeight = document.body.clientHeight;
    }
    _reportReview.pdfHeight = (winHeight * 0.6).toFixed(0);
    _reportReview.tableHeight = (winHeight * 0.2).toFixed(0);
}

//富文本编辑器添加
function BuildFuryText() {
    $('.editorClass').each(function (index, element) {
        //去除两个换行在一起的情况
        this.value = this.value.replace(/<br\s*\/?><br\s*\/?>/gi, "");
        //构建富文本编辑器
        $(element).wysiwyg({
            'class': 'fake-bootstrap',
            toolbar: 'top-selection',
            buttons: {
                insertimage: {
                    title: '插入图片',
                    image: '\uf030',
                    showselection: true
                },
                fontname: {
                    title: '字体',
                    image: '\uf031',
                    popup: function ($popup, $button) {
                        var list_fontnames = {
                            'Arial, Helvetica': 'Arial,Helvetica',
                            '宋体': '宋体',
                            '黑体': '黑体',
                            '楷体': '楷体',
                            '微软雅黑': '微软雅黑'
                        };
                        var $list = $('<div/>').addClass('wysiwyg-plugin-list')
                                               .attr('unselectable', 'on');
                        $.each(list_fontnames, function (name, font) {
                            var $link = $('<a/>').attr('href', '#')
                                                .css('font-family', font)
                                                .html(name)
                                                .click(function (event) {
                                                    $(element).wysiwyg('shell').fontName(font).closePopup();
                                                    event.stopPropagation();
                                                    event.preventDefault();
                                                    return false;
                                                });
                            $list.append($link);
                        });
                        $popup.append($list);
                    },
                    showselection: true
                },
                fontsize: {
                    title: '字体大小',
                    image: '\uf034',
                    popup: function ($popup, $button) {
                        var list_fontsizes = [];
                        for (var i = 8; i <= 11; ++i)
                            list_fontsizes.push(i + 'px');
                        for (var i = 12; i <= 28; i += 2)
                            list_fontsizes.push(i + 'px');
                        list_fontsizes.push('36px');
                        list_fontsizes.push('48px');
                        list_fontsizes.push('72px');
                        var $list = $('<div/>').addClass('wysiwyg-plugin-list')
                                               .attr('unselectable', 'on');
                        $.each(list_fontsizes, function (index, size) {
                            var $link = $('<a/>').attr('href', '#')
                                                .html(size)
                                                .click(function (event) {
                                                    $(element).wysiwyg('shell').fontSize(7).closePopup();
                                                    $(element).wysiwyg('container')
                                                            .find('font[size=7]')
                                                            .removeAttr("size")
                                                            .css("font-size", size);
                                                    event.stopPropagation();
                                                    event.preventDefault();
                                                    return false;
                                                });
                            $list.append($link);
                        });
                        $popup.append($list);
                    }
                },
                bold: {
                    title: '加粗 (Ctrl+B)',
                    image: '\uf032',
                    hotkey: 'b'
                },
                italic: {
                    title: '倾斜 (Ctrl+I)',
                    image: '\uf033',
                    hotkey: 'i'
                },
                underline: {
                    title: '下划线 (Ctrl+U)',
                    image: '\uf0cd',
                    hotkey: 'u'
                },
                forecolor: {
                    title: '字体颜色',
                    image: '\uf1fc'
                },
                subscript: {
                    title: '下标',
                    image: '\uf12c',
                    showselection: true
                },
                superscript: {
                    title: '上标',
                    image: '\uf12b',
                    showselection: true
                },
                removeformat: {
                    title: '清空格式',
                    image: '\uf12d'
                },
                kityformula: {
                    title: '插入公式',
                    image: '\u03A3',
                    popup: function ($popup, $button) {
                        $('#EditorModal').modal("toggle");

                        // var atid = $(".wysiwyg-active").parent().parent().attr("id");
                        // 获取当前焦点所在的富文本框所在textarea元素的id
                        var atid = $(".wysiwyg-active").find("textarea").attr("id");
                        // textarea元素的id保存在一个ID为imgDiv的div的span元素中
                        var span = document.createElement("span");
                        span.innerText = atid;
                        if ($('#imgDiv').length > 0) {
                            $('#imgDiv').html("");
                            $('#imgDiv').append(span);
                        }
                    }
                }
            },
            selectImage: '点击上传',
            placeholderUrl: 'www.ustcori.com',
            placeholderEmbed: '<embed/>',
            maxImageSize: [800, 600],
            onKeyDown: function (key, character, shiftKey, altKey, ctrlKey, metaKey) {
            },
            onKeyPress: function (key, character, shiftKey, altKey, ctrlKey, metaKey) {
            },
            onKeyUp: function (key, character, shiftKey, altKey, ctrlKey, metaKey) {
            },
            onImageUpload: function (insert_image) {
                var iframe_name = 'legacy-uploader-' + Math.random().toString(36).substring(2);
                $('<iframe>').attr('name', iframe_name)
                                         .load(function () {
                                             var iframe = this;
                                             var iframedoc = iframe.contentDocument ? iframe.contentDocument :
                                                           (iframe.contentWindow ? iframe.contentWindow.document : iframe.document);
                                             var iframebody = iframedoc.getElementsByTagName('body')[0];
                                             var image_url = iframebody.innerHTML;
                                             console.log(iframebody);
                                             if (image_url.indexOf("data:image/") >= 0) {
                                                 insert_image(image_url);
                                             }
                                             else {
                                                 alert(image_url);
                                             }
                                             $(iframe).remove();
                                         })
                                         .appendTo(document.body);
                var $input = $(this);
                $input.attr('name', 'file')
                                  .parents('form')
                                  .attr('action', '/Utils/Upload')
                                  .attr('method', 'POST')
                                  .attr('enctype', 'multipart/form-data')
                                  .attr('target', iframe_name)
                                  .submit();
            },
            forceImageUpload: false
        })
    .change(function () {
        if (typeof console != 'undefined')
            ;
    })
    .focus(function () {
        if (typeof console != 'undefined')
            ;
    })
    .blur(function () {
        if (typeof console != 'undefined')
            ;
    });
    });

    var option = {
        element: 'editor0', // or: document.getElementById('editor0')
        onKeyPress: function (key, character, shiftKey, altKey, ctrlKey, metaKey) {
            if (typeof console != 'undefined') { }
            //bootbox.alert('RAW: ' + character + ' key pressed');
        },
        onSelection: function (collapsed, rect, nodes, rightclick) {
            if (typeof console != 'undefined' && rect) { }
            // bootbox.alert('RAW: selection rect(' + rect.left + ',' + rect.top + ',' + rect.width + ',' + rect.height + '), ' + nodes.length + ' nodes');
        },
        onPlaceholder: function (visible) {
            if (typeof console != 'undefined') { }
            //bootbox.alert('RAW: placeholder ' + (visible ? 'visible' : 'hidden'));
        }
    };
    var wysiwygeditor = wysiwyg(option);
}

function ReBuildFuryText() {
    $.when($('.wysiwyg-container').each(function (index, element) {
        var newNode = element.getElementsByTagName("textarea")
        var className = newNode[0].className;
        if (className.indexOf("sktDATextArea") >= 0 || className.indexOf("sktTGTextArea") >= 0) {
            newNode[0].className = className.split(" hide").join('');
            element.parentNode.replaceChild(newNode[0], element);
        }
    })
    ).done(function (data) {
        BuildFuryText();
    });
}

//日期转换
function data_string(str) {
    var d = eval('new ' + str.substr(1, str.length - 2));
    var ar_date = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
    for (var i = 0; i < ar_date.length; i++) ar_date[i] = dFormat(ar_date[i]);
    return ar_date.join('-');

    function dFormat(i) { return i < 10 ? "0" + i.toString() : i; }
}
//时间转换
function getDateTime(date) {
    if (date != null && date != undefined && date != 'undefined' && date.length > 5) {
        var d = eval('new ' + date.substr(1, date.length - 2));
        var year = d.getFullYear();
        var month = d.getMonth() + 1;
        var day = d.getDate();
        var hh = d.getHours();
        var mm = d.getMinutes();
        var ss = d.getSeconds();
        return year + "-" + month + "-" + day + " " + hh + ":" + mm + ":" + ss;
    }
    else {
        return "";
    }
}

//日期加上天数得到新的日期
//dateTemp 需要参加计算的日期，days要添加的天数，返回新的日期，日期格式：YYYY-MM-DD
function getNewDay(dateTemp, days) {
    var dateTemp = dateTemp.split("-");
    var nDate = new Date(dateTemp[1] + '-' + dateTemp[2] + '-' + dateTemp[0]); //转换为MM-DD-YYYY格式  
    var millSeconds = Math.abs(nDate) + (days * 24 * 60 * 60 * 1000);
    var rDate = new Date(millSeconds);
    var year = rDate.getFullYear();
    var month = rDate.getMonth() + 1;
    if (month < 10) month = "0" + month;
    var date = rDate.getDate();
    if (date < 10) date = "0" + date;
    return (year + "-" + month + "-" + date);
}

//验证码方法
function rand() {
    var str = "abcdefghijklmnopqrstuvwxyz0123456789";
    var arr = str.split("");
    var validate = "";
    var ranNum;
    for (var i = 0; i < 4; i++) {
        ranNum = Math.floor(Math.random() * 36);   //随机数在[0,35]之间
        validate += arr[ranNum];
    }
    return validate;
}
/*干扰线的随机x坐标值*/
function lineX() {
    var ranLineX = Math.floor(Math.random() * 90);
    return ranLineX;
}
/*干扰线的随机y坐标值*/
function lineY() {
    var ranLineY = Math.floor(Math.random() * 40);
    return ranLineY;
}
//验证码方法结束

//阻止窗口改变时间冒泡（不稳定）
var debounce = function (func, threshold, execAsap) {
    var timeout;
    return function debounced() {
        var obj = this, args = arguments;
        function delayed() {
            if (!execAsap)
                func.apply(obj, args);
            timeout = null;
        };
        if (timeout)
            clearTimeout(timeout);
        else if (execAsap)
            func.apply(obj, args);
        timeout = setTimeout(delayed, threshold || 100);
    };
}

//sessionStorage转数组
function stringToArray(arr) {
    var tempArr = arr.split(',');
    var returnArr = new Array();
    var i, len = tempArr.length;
    for (i = 0; i < len; i++) {
        returnArr.push(tempArr[i]);
    }
    return returnArr;
}

// 关闭UEditor公式编辑框
function CloseEditor() {
    $('#EditorModal').modal("toggle");

}

// 将UEditor公式插件生成的公式图片放入wysiwyg富文本框中
function SaveEditor() {
    var iframe = document.getElementById("ueditor_0");
    if (iframe != null) {
        // 获取UEditor公式插件生成的公式图片
        var images = iframe.contentWindow.document.getElementsByTagName("img");
        if ($('#imgDiv').length > 0) {
            for (var i = 0; i < images.length; i++) {
                var img = document.createElement("img");
                img.src = images[i].src;
                // 因为原本生成的公式图片没有宽高信息，所以需要创建一个Image对象，获取图片的宽高
                var img1 = new Image();
                img1.src = img.src;
                img.width = img1.width;
                img.height = img1.height;
                var atid = $('#imgDiv span').text();
                //$("#" + atid).children().children().children().next().children().next().append(img);
                if (images[i].width > 0 && images[i].height > 0) {
                    img.width = images[i].width;
                    img.height = images[i].height;
                }
                $("#" + atid).next().append(img);
            }
        }
    }

    // 关闭公式编辑框
    $('#EditorModal').modal("toggle");
}

function clearNoNum(obj) {
    //    obj.value = obj.value.replace(/[^\d.]/g, "");  //清除“数字”和“.”以外的字符  
    //    obj.value = obj.value.replace(/^\./g, "");  //验证第一个字符是数字而不是. 
    //    obj.value = obj.value.replace(/\.{2,}/g, "."); //只保留第一个. 清除多余的.   
    //    obj.value = obj.value.replace(".", "$#$").replace(/\./g, "").replace("$#$", ".");

}

function chenckNum(obj) {
    var reg = /^\d+(\.\d+)?$/;
    if (reg.test(obj.value) == false && obj.value != "") {
        alert("请检查输入合法性");
    }
}

function clearRuleNoNum(obj) {
    //if (obj.value.indexOf(".") > -1) {
    //    obj.value = obj.value.split(".")[0]; //清除.后面的所有字符
    //}
    //obj.value = obj.value.replace(/[^\d-]/g, "");  //清除“数字”和“-”以外的字符
    //obj.value = obj.value.replace(/-{2,}/g, "-");  //只保留第一个- 清除多余的-
    //if (obj.value.indexOf("-") > -1) {
    //    obj.value = "-" + obj.value.split("-")[1]; //清除-前面的所有字符
    //}
    if (obj.value != "" && obj.value.match(/^(-?\d+)(\.\d+)?$/g) == null) {
        bootbox.alert("请输入正确的数值！");
        obj.value = "";
    }
}

function clearRulePositiveNum(obj) {
    //if (obj.value.indexOf(".") > -1) {
    //    obj.value = obj.value.split(".")[0]; //清除.后面的所有字符
    //}
    //obj.value = obj.value.replace(/[^\d]/g, "");  //清除“数字”以外的字符
    if (obj.value != "" && obj.value.match(/^(-?\d+)(\.\d+)?$/g) == null) {
        bootbox.alert("请输入正确的数值！");
        obj.value = "";
    }
}

function ShowBigImage(ele) {
    console.log(ele);
    var _this = $(ele); //将当前的pimg元素作为_this传入函数  
    imgShow("#outerdiv", "#innerdiv", "#bigimg", _this);
}

function imgShow(outerdiv, innerdiv, bigimg, _this) {
    var src = _this.attr("src"); //获取当前点击的pimg元素中的src属性  
    $(bigimg).attr("src", src); //设置#bigimg元素的src属性  


    /*获取当前点击图片的真实大小，并显示弹出层及大图*/
    $("<img/>").attr("src", src).load(function () {
        var windowW = $(window).width(); //获取当前窗口宽度  
        var windowH = $(window).height(); //获取当前窗口高度  
        var realWidth = this.width; //获取图片真实宽度  
        var realHeight = this.height; //获取图片真实高度  
        var imgWidth, imgHeight;
        var scale = 0.9; //缩放尺寸，当图片真实宽度和高度大于窗口宽度和高度时进行缩放  

        if (realHeight > windowH * scale) {//判断图片高度  
            imgHeight = windowH * scale; //如大于窗口高度，图片高度进行缩放  
            imgWidth = imgHeight / realHeight * realWidth; //等比例缩放宽度  
            if (imgWidth > windowW * scale) {//如宽度扔大于窗口宽度  
                imgWidth = windowW * scale; //再对宽度进行缩放  
            }
        } else if (realWidth > windowW * scale) {//如图片高度合适，判断图片宽度  
            imgWidth = windowW * scale; //如大于窗口宽度，图片宽度进行缩放  
            imgHeight = imgWidth / realWidth * realHeight; //等比例缩放高度  
        } else {//如果图片真实高度和宽度都符合要求，高宽不变  
            imgWidth = realWidth;
            imgHeight = realHeight;
        }
        $(bigimg).css("width", imgWidth); //以最终的宽度对图片缩放  

        var w = (windowW - imgWidth) / 2; //计算图片与窗口左边距  
        var h = (windowH - imgHeight) / 2; //计算图片与窗口上边距  
        $(innerdiv).css({ "top": h, "left": w }); //设置#innerdiv的top和left属性  
        $(outerdiv).fadeIn("fast"); //淡入显示#outerdiv及.pimg  
    });

    $(outerdiv).click(function () {//再次点击淡出消失弹出层  
        $(this).fadeOut("fast");
    });
}