var view = new ViewModel();
$(function () {
    $('.form_date').datetimepicker({
        language: 'zh-CN',
        weekStart: 1,
        todayBtn: 1,
        autoclose: 1,
        todayHighlight: 1,
        startView: 2,
        minView: 2,
        forceParse: 0,
        format: "yyyy-mm-dd"
    });
    view.InitPage();
    ko.applyBindings(view);

});

//浏览器改变大小
window.onresize = resizeFun;

//阻止冒泡定时
var resizeTimer = null;
//改变大小执行函数
function resizeFun() {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(function () {
        var winWidth;
        if (window.innerWidth) {
            winWidth = window.innerWidth;
        }
        else if ((document.body) && (document.body.clientWidth)) {
            winWidth = document.body.clientWidth;
        }
        _pdfMuti.scale = winWidth / 1000;
        view.PdfScale(_pdfMuti.scale);
        if ($("#ReportModal")[0].className == "modal fade in" && $("#contentDoc").css('display') != 'none') {
            showPdf('the-canvas');
        }
    }, 500);
}
$('#EditorModal').on('show.bs.modal', function () {
    //$("#AddReportModal").attr("class", "hideIndex");
    $(".modal").css("z-index", 40);
})
$('#EditorModal').on('hide.bs.modal', function () {
    //$("#AddReportModal").attr("class", "hideIndex");
    $(".modal").css("z-index", 1040);
})
function ViewModel() {
    var self = this;
    self.selLabIDList = ko.observableArray();
    self.AddLabList = ko.observableArray();
    self.selReportTypeList = ko.observableArray();
    self.BuildingReportList = ko.observableArray();

    self.PathInfo = ko.observable();
    self.OldScore = ko.observable();
    self.PaperName = ko.observable();
    self.Model = ko.observable();

    self.IsEdit = ko.observable(false);

    self.PageIndex = ko.observable(1);
    self.PageSize = ko.observable(_enviroment.PageSize);

    self.InitPage = function () {
        //初始化页面
        $("#inpCreateId").val("");
        $("#inpReportName").val("");
        self.GetLabIDList();
        self.GetReportTypeList();
        self.GetReportTemplateList();
    }




    self.GetLabIDList = function () {
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportTeacher/BuildingReport/GetAllBGPY_SysLabInfo',
            success: function (result) {
                self.selLabIDList(result.Data);
                self.AddLabList(result.Data);
                $('#selLabID').val(-999);

            }
        });
    }

    self.GetReportTypeList = function () {
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportTeacher/BuildingReport/GetAllReportTypeList',
            success: function (result) {
                self.selReportTypeList(result.Data);
                $('#selReportType').val(-1);
            }
        });
    }



    self.GetReportTemplateList = function () {
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportTeacher/BuildingReport/GetAllReportTemplateList',
            data: {
                labID: $("#selLabID").val(),
                reportName: $("#inpReportName").val(),
                creator: $("#inpCreateId").val(),
                startDate: $('#sDate').val(),
                endDate: $('#eDate').val(),
                paperType: $('#selReportType').val(),
                pageIndex: self.PageIndex(),
                pageSize: self.PageSize()
            },
            success: function (result) {
                self.BuildingReportList(result.DataList);
                if (result.PageCount < self.PageIndex()) {
                    self.PageIndex(result.PageCount);
                    self.GetReportTemplateList();
                }
                else {
                    $("#Pager").createPage({
                        pageCount: result.PageCount,
                        current: self.PageIndex(),
                        backFn: function (p) {
                            if (result.PageCount < p) {
                                p = result.PageCount;
                            }
                            self.PageIndex(p);
                            self.GetReportTemplateList();
                        }
                    });
                }
                //                $("#Pager").createPage({
                //                    pageCount: result.PageCount,
                //                    current: self.PageIndex(),
                //                    backFn: function (p) {
                //                        self.PageIndex(p);
                //                        self.GetReportTemplateList();
                //                    }
                //                });
            }
        });
    }


    self.PdfUrl = ko.observable();
    self.PdfPages = ko.observable();
    self.PdfPageCount = ko.observable();
    self.PdfScale = ko.observable();
}

function showPdf(eleid) {
    $("#canvasdiv").empty();
    PDFJS.workerSrc = _websiteName + '/Scripts/pdf.worker.js';
    PDFJS.getDocument(view.PdfUrl()).then(function getPdfHelloWorld(pdf) {
        var i = 0
        var setpdf = setInterval(function () {
            i++;
            //for (var i = 1; i < pdf.numPages + 1; i++) {
            pdf.getPage(i).then(function getPageHelloWorld(page) {
                var scale = view.PdfScale();
                if (page.getViewport(scale).width > scale * 1000 * 0.6) {
                    scale = scale * 0.6;
                }
                var viewport = page.getViewport(scale);
                //var canvas = document.getElementById(eleid);
                var canvas = document.createElement('canvas');
                var context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                var renderContext = {
                    canvasContext: context,
                    viewport: viewport
                };
                $("#canvasdiv").append(canvas);
                page.render(renderContext);
                //view.PdfPageCount(pdf.numPages);
                //$("#pageNum").val(view.PdfPages())
            });
            //}
            if (i >= pdf.numPages) {
                clearInterval(setpdf);
            }
        }, 400);
    });
}

//function goPrev() {
//    if (view.PdfPages() == 1) {
//        bootbox.alter("当前已经是第一页");
//    }
//    else {
//        view.PdfPages(view.PdfPages() - 1);
//        showPdf('the-canvas');
//    }
//}

//function goNext() {
//    if (view.PdfPages() == view.PdfPageCount()) {
//        bootbox.alter("当前已经是最后一页");
//    }
//    else {
//        view.PdfPages(view.PdfPages() + 1);
//        showPdf('the-canvas');
//    }
//}

//function ChangePdfPage() {
//    var code = event.keyCode;
//    if (code == 13) {
//        var value = isNaN($("#pageNum").val()) ? 1 : parseInt($("#pageNum").val());
//        if (value <= 0) {
//            value = 1;
//        }
//        if (value > view.PdfPageCount()) {
//            value = view.PdfPageCount();
//        }
//        view.PdfPages(parseInt(value));
//        showPdf('the-canvas');
//    }
//}

//function addScale() {
//    if (view.PdfScale() == 2) {
//        bootbox.alter("最大为200%");
//    }
//    else {
//        view.PdfScale(view.PdfScale() + 0.25);
//        showPdf('the-canvas');
//    }
//}

//function reduceScale() {
//    if (view.PdfScale() == 0.5) {
//        bootbox.alter("最小为50%");
//    }
//    else {
//        view.PdfScale(view.PdfScale() - 0.25);
//        showPdf('the-canvas');
//    }
//}



//模板设置
function ShowModel(data) {
    if (data.ContentXml.toString() == "") {
        bootbox.alert("文件丢失，不能查看！");
        return false;
    }
    var info = data.Creator;
    $.ajax({
        type: 'post',
        url: _websiteName + '/ReportTeacher/ReportList/GetReportTempContent',
        data: {
            title: data.PaperName,
            info: info,
            ContentXml: encodeURIComponent(data.ContentXml)
        },
        success: function (result) {
            if (result.IsSuccess) {
                if (result.RTNCode == 0) {
                    $('#content').html(result.Data);
                    $('#content').show();
                    $('#contentDoc').hide();
                    $('#pdfOption').hide();
                }
                else {
                    view.PdfUrl(_websiteName + '/' + result.Data);
                    view.PdfPages(1);
                    view.PdfScale(_pdfMuti.scale);
                    showPdf('the-canvas');
                    $('#contentDoc').show();
                    $('#pdfOption').show();
                    $('#content').hide();
                }
                //                $('#content').html(result.Data);
                $("#ReportModalLabel").text("查看" + data.PaperName + "报告");
                $("#ReportModal").modal("toggle");
                BuildFuryText();
            }
            else {
                bootbox.alert(result.Data);
            }
        }
    });
}

//编辑报告模板
function ShowEditTemplate(data) {
    console.log(data);
    console.log(_userInfo.UserID);
    if (data.PaperType == 1 && _userInfo.UserID == data.CreaterID) {
        view.PathInfo(data.ContentXml);
        view.Model = data;
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportTeacher/ReportList/EditReportTempContent',
            data: {
                title: data.PaperName,
                info: data.Creator,
                contentXml: encodeURIComponent(data.ContentXml)
            },
            success: function (result) {
                if (result.IsSuccess) {
                    $('#contentEdit').html(result.Data);
                    $("#ReportModalLabelEdit").text("编辑" + data.PaperName + "报告");
                    $("#ReportModalEdit").modal("toggle");
                    BuildFuryText();
                    view.OldScore($("#optotalscore").val());
                    view.PaperName(data.PaperName);
                }
                else {
                    bootbox.alert(result.Data);
                }
            }
        });

        //加载公式输入弹出框
        var ue = UE.getEditor('editor', {
            toolbars: [[//'fullscreen', 'source', '|',
            //                'undo', 'redo', '|',
            //'bold', 'italic', 'underline', 'superscript', 'subscript', 'pasteplain', '|',
            //'forecolor', 'backcolor', 'insertorderedlist', 'insertunorderedlist', '|',
            //                'paragraph', 'fontfamily', 'fontsize', '|',
            //                'indent', 'justifyleft', 'justifycenter', 'justifyright', 'justifyjustify', '|',
            //                'simpleupload', 'horizontal', 'inserttable', '|','searchreplace',
                            'kityformula'
            ]],
            autoHeightEnabled: true,
            autoFloatEnabled: true
        });

    }
    else {
        bootbox.alert("当前模板不满足编辑条件，不能编辑！");
    }

}


//搜索
function SelScoreInfo() {
    view.PageIndex(1);
    view.GetReportTemplateList();
}


//保存
function SaveTemplete() {
    var data = $("#hiddenValue").val();
    if (data == null) {
        return false;
    }
    TempleteValidator();
    $('#TempleteForm').data('bootstrapValidator').validate();
    if ($("#TempleteForm").data('bootstrapValidator').isValid() == true) {
        view.AddLabName($("#AddLabID").find("option:selected").text())
        if (!view.IsEdit()) {
            if ($('#importButton').val().length < 2) {
                bootbox.alert("请上传模板文件");
                return;
            }
            $.ajaxFileUpload({
                type: "post",
                url: _websiteName + "/ReportAdmin/ReportSetting/AddReportTemplete",
                secureuri: false,
                fileElementId: "importButton",
                dataType: "json",
                data: {
                    labId: data.LabID,
                    labName: data.LabName,
                    paperName: $("#inpReportName").val()
                },
                success: function (data, status) {
                    data = $.parseJSON(data.getElementsByTagName("body")[0].innerHTML);
                    bootbox.alert(data.Data);
                    view.GetReportTemplateList();
                    $("#TempleteModal").modal("toggle");
                },
                error: function (data, status, e) {
                    var data;
                    try {
                        data = $.parseJSON(jQuery(data.responseText).text());
                        bootbox.alert(data.Data);
                    }
                    catch (ex) {
                        data = $.parseJSON(data.responseText)
                        bootbox.alert(data.Data);
                    }
                }
            });
        }
        $("#TempleteForm").data('bootstrapValidator').destroy();
        $('#TempleteForm').data('bootstrapValidator', null);
    }
}


//输入验证
function TempleteValidator() {
    $('#TempleteForm').bootstrapValidator({
        message: 'This value is not valid',
        feedbackIcons: {
            valid: 'fa fa-check',
            invalid: 'fa fa-remove',
            validating: 'fa fa-refresh'
        },
        fields: {
            AddPaperName: {
                message: '模板名称无效！',
                validators: {
                    notEmpty: {
                        message: '模板名称不能为空！'
                    },
                    stringLength: {
                        min: 2,
                        max: 50,
                        message: '模板名称长度为2-50个字符'
                    },
                    regexp: {
                        regexp: /^[0-9a-zA-Z_\u4e00-\u9fa5]+[0-9a-zA-Z_\u4e00-\u9fa5]$/,
                        message: '模板名称由字母，下划线、数字、中文组成'
                    }
                }
            },
            AddLabID: {
                validators: {
                    notEmpty: {
                        message: '分组名称不能为空！'
                    },
                    between: {
                        min: 1,
                        max: 9999,
                        message: "请选择实验"
                    }
                }
            }
        },
        removeClass: "form-group"
    });
}

//删除教师报告
function DeltetTeacherReport(data) {

    if (data.PaperType != 1) {
        bootbox.alert("系统报告模板，不允许删除！");
        return false;
    }
    if (_userInfo.UserID != data.CreaterID) {
        bootbox.alert("该报告模板不是您生成，不允许您删除！");
        return false;
    }
    if (data.PaperStatus != 0) {
        bootbox.alert("该报告模板已经开始使用，不允许删除！");
        return false;
    }
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
        message: '您确认删除选定的记录吗？',
        callback: function (result) {
            if (result) {
                $.ajax({
                    type: 'post',
                    url: _websiteName + '/ReportTeacher/BuildingReport/DeleteReportTemplete',
                    data: {
                        ids: data.PaperTemplateID
                    },
                    success: function (result) {
                        bootbox.alert(result.Data);
                        view.GetReportTemplateList();
                    }
                });
            }
        },
        title: "删除提示"
    });
}

//刷新分数
var RefreshScore = function () {
    var totalscore = 0;
    var inputs = document.getElementsByTagName("input");
    for (var ii = 0; ii < inputs.length; ii++) {
        var scoretype = inputs[ii].getAttribute("id");
        var scorePara = {};
        scorePara["Name"] = scoretype;
        scorePara["Value"] = inputs[ii].value;
        var scoreclass = inputs[ii].getAttribute("Class");
        if (scoreclass == "inputCss_MS" || scoreclass == "inputCss_OP" || scoreclass == "inputCss") {
            //alert(scorePara["Value"]);
            totalscore += parseFloat(scorePara["Value"]);
        }
    }
    var TempCheck = $(".inputCheckBox");
    for (var i = 0; i < TempCheck.length; i++) {
        if ($("#OPCheck" + i)[0].checked) {
        } else {
            for (var j = 0; j < inputs.length; j++) {
                if (inputs[j].getAttribute("id") == "OP" + i.toString() + "Score") {
                    totalscore -= parseFloat(inputs[j].value);
                }
            }
        }
    }
    $("#ZF").text(totalscore);
    bootbox.alert('当前总分：' + totalscore);
}

//保存编辑模板
var SaveEditTemllate = function () {
    //是否是非物理
    var fwlText = $("#FWL").text();
    var fwl = false;
    if (fwlText != null) {
        if (fwlText == "FWL") {
            fwl = true;
        }
    };
    var buildModel = view.Model;
    var arrayContent = new Array();
    var TempElement = $(".editorClass");

    if (!fwl) {
        for (var i = 0; i < TempElement.length; i++) {
            var param = {};
            param["Name"] = TempElement[i].getAttribute("id");
            param["Value"] = TempElement[i].value;
            var opindex;
            if (TempElement[i].getAttribute("id").toString().indexOf("OP") >= 0) {
                if (TempElement[i].getAttribute("id").toString().indexOf("Equation") >= 0) {
                    opindex = TempElement[i].getAttribute("id").substring(2, TempElement[i].getAttribute("id").length).substring(0, TempElement[i].getAttribute("id").length - 10)
                }
                else if (TempElement[i].getAttribute("id").toString().indexOf("Area") >= 0) {
                    opindex = TempElement[i].getAttribute("id").substring(2, TempElement[i].getAttribute("id").length - 4)
                }
                else {
                    opindex = TempElement[i].getAttribute("id").substring(2, TempElement[i].getAttribute("id").length)
                }
                if ($("#OPCheck" + opindex)[0].checked) {
                    arrayContent.push(param);
                }
            } else {
                arrayContent.push(param);
            }
        }
        var totalscore = 0;
        var inputs = document.getElementsByTagName("input");
        for (var ii = 0; ii < inputs.length; ii++) {
            var scoretype = inputs[ii].getAttribute("id");
            var scorePara = {};
            scorePara["Name"] = scoretype;
            scorePara["Value"] = inputs[ii].value;
            var scoreclass = inputs[ii].getAttribute("Class");
            if (scoreclass == "inputCss_MS" || scoreclass == "inputCss_OP" || scoreclass == "inputCss") {
                if (scoretype.indexOf("OP") >= 0 && scoretype.indexOf("Score") >= 0) {
                    if ($("#OPCheck" + scoretype.substring(2, scoretype.length).substring(0, scoretype.length - 7))[0].checked) {
                        totalscore += parseFloat(scorePara["Value"]);
                    }
                } else {
                    totalscore += parseFloat(scorePara["Value"]);
                }
            }

            if (scoretype != null && scoretype != "") {
                if (scoretype.indexOf("OP") >= 0 && scoretype.indexOf("Score") >= 0) {
                    if ($("#OPCheck" + scoretype.substring(2, scoretype.length).substring(0, scoretype.length - 7))[0].checked) {
                        arrayContent.push(scorePara);
                    }
                } else {
                    arrayContent.push(scorePara);
                }
            }
        }
    }
    else {
        for (var i = 0; i < TempElement.length; i++) {
            var param = {};
            param["Name"] = TempElement[i].getAttribute("id");
            param["Value"] = TempElement[i].value;
            arrayContent.push(param);
        }
        var totalscore = 0;
        var inputs = document.getElementsByTagName("input");
        for (var ii = 0; ii < inputs.length; ii++) {
            var scoretype = inputs[ii].getAttribute("id");
            var scorePara = {};
            scorePara["Name"] = scoretype;
            scorePara["Value"] = inputs[ii].value;
            var scoreclass = inputs[ii].getAttribute("Class");
            if (scoreclass == "inputCss_MS" || scoreclass == "inputCss_OP" || scoreclass == "inputCss") {
                totalscore += parseFloat(scorePara["Value"]);
            }

            if (scoretype != null && scoretype != "") {
                arrayContent.push(scorePara);
            }
        }
    }
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
        message: '当前总分为' + totalscore + '，是否确认保存？',
        callback: function (result) {
            if (result) {
                var dataContent = JSON.stringify(arrayContent);
                $.ajax({
                    type: 'post',
                    url: _websiteName + '/ReportTeacher/ReportList/SaveBuildTemplate',
                    data: {
                        contentXml: encodeURIComponent(buildModel.ContentXml),
                        editContent: encodeURIComponent(dataContent),
                        labId: buildModel.LabID,
                        labName: buildModel.LabName,
                        paperName: view.PaperName,
                        path: view.PathInfo(),
                        FullScore: totalscore

                    },
                    success: function (result) {
                        if (result.IsSuccess) {
                            $.ajax({
                                type: 'post',
                                url: _websiteName + '/ReportTeacher/ReportList/EditReportTemplete',
                                data: {
                                    labId: buildModel.LabID,
                                    FullScore: totalscore,
                                    PapertemplateID: buildModel.PaperTemplateID
                                },
                                success: function (result) {
                                    bootbox.alert(result.Data);
                                    if (result.IsSuccess) {
                                        $("#ReportModalEdit").modal("toggle");
                                    }
                                }
                            });
                        }
                    }
                });
            }
        },
        title: "编辑提示"
    });

}


//新增题目
function AddSubject() {
    // var allChildren = $("#sktAll").children(".panel-heading.row").each(function () { alert(this.innerHTML) })
    var all = $("#sktAll").html();
    var allChildren = $("#sktAll").children("div");
    //  alert($("#skt0SKTDA").val());
    //   $("#123").val(allChildren[1].innerHTML);
    var index = $("#sktAll").children(".panel-heading.row").length;
    var Bhtml = "";
    for (var i = 1; i <= index; i++) {
        Bhtml += GetBTiMuStr(i);
    }
    var Timu = '<div class="panel-heading row" id="sktTMDiv' + (index + 1) +
     '"><span class="col-md-6 text-left"><button class="btnUp" data-toggle="collapse" data-target="#skt' + (index + 1)
     + '" onclick="javascript:if($(&quot;#skt' + (index + 1) + '&quot;).hasClass(&quot;in&quot;)){this.className = &quot;btnDown&quot;}else{this.className = &quot;btnUp&quot;}"></button>思考题<span>' + (index + 1)
     + '</span><input type="button" id="sktDel' + (index + 1) + 'btn" onclick=DeleteSubject(' + (index + 1) + ') class="btn btn-LightGreen" value="删除题目"></span><div class="col-md-6 text-right"><span>总分值：<span class="red"><input id="SKT' + (index + 1) + 'Score"  onchange="CheckValue(0);" type="number"  class="inputCss" step="0.01" min="0" max="100" class="inputCss" onkeyup="javascript:if(this.value<0){this.value=0;};if(this.value>100){this.value=100;}"  value="' + $("#SKT1Score").val() + '"></span></span></div></div>';

    var Daan = '<div class=\"panel-body\"  id=sktDADiv' + (index + 1) + '>' +
                 '<div class="skt panel-collapse collapse in" id="skt' + (index + 1) + '">' +
                  '<textarea class="editorClass sktTGTextArea" id="SKT' + (index + 1) + 'Script" name="editor" placeholder="请输入文本……"></textarea>' +
                 '<br />' +
               '<div style="color:black;font-size:16px;font-weight:700">标准答案：</div>' +
                        '<textarea class="editorClass sktDATextArea" id="SKT' + (index + 1) + 'StdResult" name="editor" placeholder="请输入文本……"></textarea>' +
                '</div>' +
                '</div></div>';
    //var html = $("#sktAll").html() + Timu + Daan;
    var html = Bhtml + Timu + Daan;
    for (var i = 1; i <= index; i++) {
        $("#sktTMDiv" + i).remove();
        $("#sktDADiv" + i).remove();
    }
    $("#sktAll").html(html);
    // BuildFuryTextByID("skt" + (index+1) + "Area");
    // BuildFuryTextByID("skt" + (index+1) + "SKTDA");
    ReBuildFuryText();
    $("#sktDel1btn").show();
    //刷新思考题分数
    CheckValue(0);
}



//删除题目
function DeleteSubject(index) {
    var len = $("#sktAll").children(".panel-heading.row").length;
    var htmlStr = "";
    for (var i = (index + 1) ; i <= len; i++) {
        htmlStr += GetNewTiMuStr(i - 1);
    }
    //var all = $("#sktAll").children("div");
    for (var i = index; i <= len; i++) {
        $("#sktTMDiv" + i).remove();
        $("#sktDADiv" + i).remove();
    }
    // alert($("#sktAll").html());
    var html = $("#sktAll").html() + htmlStr;
    $("#sktAll").html(html);
    ReBuildFuryText();
    //检查删除按钮的个数
    if ((len - 1) == 1) {
        $("#sktDel1btn").hide();
    }
    else {
        $("#sktDel1btn").show();
    }
    //刷新思考题分数
    CheckValue(0);
}

//刷新思考题
function GetNewTiMuStr(index) {
    var Timu = '<div class="panel-heading row" id="sktTMDiv' + index +
     '"><span class="col-md-6 text-left"><button class="btnUp" data-toggle="collapse" data-target="#skt' + index
     + '" onclick="javascript:if($(&quot;#skt' + index + '&quot;).hasClass(&quot;in&quot;)){this.className = &quot;btnDown&quot;}else{this.className = &quot;btnUp&quot;}"></button>思考题<span>' + index
     + '</span><input type="button" id="sktDel' + index + 'btn" onclick=DeleteSubject(' + index + ') class="btn btn-LightGreen" value="删除题目"></span><div class="col-md-6 text-right"><span>总分值：<span class="red"><input id="SKT' + index + 'Score"  onchange="CheckValue(0);" type="number"  class="inputCss" step="0.01" min="0" max="100" class="inputCss" onkeyup="javascript:if(this.value<0){this.value=0;};if(this.value>100){this.value=100;}" value="' + $("#SKT" + (index + 1) + "Score").val() + '"></span></span></div></div>';

    var Daan = '<div class=\"panel-body\"  id=sktDADiv' + index + '>' +
                 '<div class="skt panel-collapse collapse in" id="skt' + index + '">' +
                  '<textarea class="editorClass sktTGTextArea" id="SKT' + index + 'Script" name="editor" placeholder="请输入文本……">' + $("#SKT" + (index + 1) + "Script").val() + '</textarea>' +
                 '<br />' +
               '<div style="color:black;font-size:16px;font-weight:700">标准答案：</div>' +
                        '<textarea class="editorClass sktDATextArea" id="SKT' + index + 'StdResult" name="editor" placeholder="请输入文本……">' + $("#SKT" + (index + 1) + "StdResult").val() + '</textarea>' +
                '</div>' +
                '</div></div>';
    return Timu + Daan;
}
// onkeyup='javascript:if(this.value<0){this.value=0;};if(this.value>100){this.value=100;}'

function GetBTiMuStr(index) {
    var Timu = '<div class="panel-heading row" id="sktTMDiv' + index +
     '"><span class="col-md-6 text-left"><button class="btnUp" data-toggle="collapse" data-target="#skt' + index
     + '" onclick="javascript:if($(&quot;#skt' + index + '&quot;).hasClass(&quot;in&quot;)){this.className = &quot;btnDown&quot;}else{this.className = &quot;btnUp&quot;}"></button>思考题<span>' + index
     + '</span><input type="button" id="sktDel' + index + 'btn" onclick=DeleteSubject(' + index + ') class="btn btn-LightGreen" value="删除题目"></span><div class="col-md-6 text-right"><span>总分值：<span class="red"><input id="SKT' + index + 'Score"  onchange="CheckValue(0);" type="number"  class="inputCss" step="0.01" min="0" max="100" class="inputCss" onkeyup="javascript:if(this.value<0){this.value=0;};if(this.value>100){this.value=100;}" value="' + $("#SKT" + index + "Score").val() + '"></span></span></div></div>';

    var Daan = '<div class=\"panel-body\"  id=sktDADiv' + index + '>' +
                 '<div class="skt panel-collapse collapse in" id="skt' + index + '">' +
                  '<textarea class="editorClass sktTGTextArea" id="SKT' + index + 'Script" name="editor" placeholder="请输入文本……">' + $("#SKT" + index + "Script").val() + '</textarea>' +
                 '<br />' +
               '<div style="color:black;font-size:16px;font-weight:700">标准答案：</div>' +
                        '<textarea class="editorClass sktDATextArea" id="SKT' + index + 'StdResult" name="editor" placeholder="请输入文本……">' + $("#SKT" + index + "StdResult").val() + '</textarea>' +
                '</div>' +
                '</div></div>';
    return Timu + Daan;
}


//刷新思考题分数
function CheckValue(type) {
    var allScore = 0;
    var all = $("#sktAll").children(".panel-heading.row").length;
    for (var i = 0; i < all; i++) {
        allScore += parseFloat($("#SKT" + (i + 1) + "Score").val());
    }
    var a = Math.abs(parseFloat($("#SKTAllSCORE").val()) - allScore);
    if (a < 0.001) {
        return;
    }
    $("#SKTALLSCORE").html(allScore.toFixed(2));

}


//刷新OP分数
function CheckOPScore(index) {
    //判断该OP是否被选中
    if ($('#OPCheck' + index).attr('checked')) {
        //获取单个OP的总分
        var score = parseFloat($("#OP" + index + "Score").val());
        //获取单个OP下所有的题目的分数
        var allTiM = $(".OPKCD" + index);
        var allTiMScore = 0;
        for (var i = 0; i < allTiM.length; i++) {
            allTiMScore += parseFloat(allTiM[i].innerText);
        }
        //alert("累加：" + allTiMScore.toFixed(2));
        if (Math.abs(allTiMScore - score) < 0.001) {
            return;
        }
        else {
            for (var i = 0; i < allTiM.length; i++) {
                var a = ((score / allTiMScore.toFixed(2)) * (parseFloat(allTiM[i].innerText))).toFixed(2);
                allTiM[i].innerText = a;
            }
            //刷新评分规则的分数
            var allPFGZ = $(".OPPSGZ" + index);
            for (var i = 0; i < allPFGZ.length; i++) {
                var a = ((score / allTiMScore.toFixed(2)) * (parseFloat(allPFGZ[i].innerText))).toFixed(2);
                allPFGZ[i].innerText = a;
            }
        }
    }
    else {
        return;
    }
}

