var view = new ViewModel();
$(function () {
    view.InitPage();
    view.GetActiveBGSemester();
    ko.applyBindings(view);

});

//初始化fileinput控件（第一次初始化）
function initFileInput() {
    $("#itemImagers").fileinput({
        uploadUrl: "/",
        uploadAsync: false,
        showRemove: true,
        showUpload: false,
        overwriteInitial: false,
        dropZoneEnabled: false,  //是否启用用于拖放文件的拖放区
        showPreview: true,  //是否显示预览
        initialPreviewShowDelete: true,//是否为每个使用initialPreview创建的缩略图显示删除按钮
        allowedFileExtensions: ['jpg', 'png', 'jpeg'],
        fileActionSettings: { showUpload: false, showRemove: false, showDrag: false },
    }).on('filepredelete', function (event, key, jqXHR, data) {
        if (!confirm("确定删除原文件？删除后不可恢复")) {
            return false;
        }
    });
}


$(function () {
    //页面初始化加载initFileInput()方法传入ID名和上传地址
    initFileInput();
})



function ViewModel() {
    var self = this;
    self.selCourseList = ko.observableArray();
    self.CompleteReportList = ko.observableArray();

    self.CourseID = ko.observable();

    self.PageIndex = ko.observable(1);
    self.PageSize = ko.observable(_enviroment.PageSize);
    self.TeacherClassID = ko.observable();
    self.StudentID = ko.observable();
    self.PaperContentXml = ko.observable();
    self.SemesterDataStatus = ko.observable();
    self.InitPage = function () {
        self.GetCourseList();
        self.GetStudentCompleteReportList();
    }

    self.GetActiveBGSemester = function () {
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportStudent/CompleteReport/GetActiveBGSemester',
            success: function (result) {
                self.SemesterDataStatus(result.RTNCode)
            }
        });
    }

    //获取实验列表
    self.GetCourseList = function () {
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportStudent/ResultInquiry/GetCourseInfo',
            data: {
                courseID: '',
                courseNo: ''
            },
            success: function (result) {
                self.selCourseList(result.Data);
                $('#selCourseID').val(-999);
            }
        });
    }

    self.GetStudentCompleteReportList = function () {
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportStudent/ResultInquiry/GetStudentReportScore',
            data: {
                courseNo: $("#selCourseID").val(),
                labID: '',
                labType: '',
                reportName: $("#inpReportName").val(),
                startDate: '',
                endDate: '',
                pageIndex: self.PageIndex(),
                pageSize: self.PageSize()
            },
            success: function (result) {
                //console.log(result)
                self.CompleteReportList(result.DataList);
                if (result.PageCount < self.PageIndex()) {
                    self.PageIndex(result.PageCount);
                    self.GetStudentCompleteReportList();
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
                            self.GetStudentCompleteReportList();
                        }
                    });
                }

            }
        });
    }
}

$('#EditorModal').on('show.bs.modal', function () {
    //$("#AddReportModal").attr("class", "hideIndex");
    $(".modal").css("z-index", 40);
})
$('#EditorModal').on('hide.bs.modal', function () {
    //$("#AddReportModal").attr("class", "hideIndex");
    $(".modal").css("z-index", 1040);
})
//模板设置
function ShowModel(data) {
    if (data.PaperContentXml == "-1" || data.PaperContentXml.indexOf('.') == -1) {
        initFileInput();
        $('#itemImagers').fileinput('clear');
        view.TeacherClassID(data.TeacherClassID);
        view.StudentID(data.StudentID);
        //  alert(data.PaperContentXml);
        view.PaperContentXml(data.PaperContentXml);
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportStudent/CompleteReport/UpdateStudentReportArrange',
            data: {
                teacherClassID: data.TeacherClassID,
                paperTemplateID: data.PaperTemplateID
            },
            success: function (result) {
                if (!result.IsSuccess) {
                    bootbox.alert(result.Data);
                }
                else {
                    $("#ReportModal_Pic").modal("toggle");
                    $('#itemImagers').fileinput('clear');
                    BuildFuryText();
                }
            }
        });

    } else {
        $.ajax({
            async: false,
            type: 'post',
            url: _websiteName + '/ReportStudent/CompleteReport/CheckIsKK',
            data: {
                StudentID: _userInfo.UserID,
                CourseID: data.CourseID,
                LabID: data.LabID,
                Weeks: data.Weeks,
                WeekID: data.WeekID,
                TimePartID: data.TimePartID,
                LabName: data.LabName
            },
            success: function (checkresult) {
                checkresult.IsSuccess = true;//是否检测旷课  一般不使用
                if (checkresult.IsSuccess) {
                    if (data.PaperContentXml.toString() == "") {
                        bootbox.alert("该报告无模板，不能下载！");
                        return false;
                    }
                    view.TeacherClassID(data.TeacherClassID);
                    view.StudentID(data.StudentID);
                    view.PaperContentXml(data.PaperContentXml);
                    var arr = data.PaperContentXml.split('.');
                    //提交XML报告
                    if (arr[arr.length - 1].toLowerCase() == "xml" || arr[arr.length - 1].toLowerCase() == "labrpt") {
                        //设置【临时提交】的按钮是否显示
                        $.ajax({
                            type: 'post',
                            url: _websiteName + '/ReportStudent/CompleteReport/GetReportKSContent',
                            data: {
                                title: data.PaperName,
                                ContentXml: data.PaperContentXml,
                                StudentID: _userInfo.UserID,
                                TeacherClassID: data.TeacherClassID
                            },
                            success: function (result) {
                                if (result.IsSuccess) {
                                    //打开报告时，更新学生实验报告安排                                 

                                    $.ajax({
                                        type: 'post',
                                        url: _websiteName + '/ReportStudent/CompleteReport/UpdateStudentReportArrange',
                                        data: {
                                            teacherClassID: data.TeacherClassID,
                                            paperTemplateID: data.PaperTemplateID
                                        },
                                        success: function (result2) {
                                            if (!result2.IsSuccess) {
                                                bootbox.alert(result2.Data);
                                            }
                                            else {
                                                //记录学生开始时间日志
                                                $.ajax({
                                                    async: false,
                                                    type: 'post',
                                                    url: _websiteName + '/ReportStudent/CompleteReport/SetLoginText',
                                                    data: {
                                                        type: 1,
                                                        loginTextID: _userInfo.LoginTextID,
                                                        userId: _userInfo.UserID,
                                                        userName: _userInfo.UserName,
                                                        teacherClassID: view.TeacherClassID()
                                                    },
                                                    success: function (result3) {
                                                        _userInfo.LogTimeId = result3;
                                                    }
                                                });
                                                $('#content').html(result.Data);
                                                $("#ReportModalLabel").text("完成" + data.PaperName + "报告");
                                                $('#ReportModalLabel').on('hidden.bs.modal', function (e) {
                                                    $('#content input[type="number"]').attr('title', '');
                                                })
                                                $("#ReportModal").modal("toggle");
                                                BuildFuryText();
                                                $('#content input[type="number"]').attr('title', '');
                                                var reg = /^[+-]?\d+(\.\d+)?$/;
                                                $("input[type='number']").each(function (i, ipt) {
                                                    $(ipt).blur(function () {
                                                        if (this.value && this.value.length > 0) {
                                                            if (reg.test(this.value) == false || isNaN(parseFloat(this.value))) {
                                                                alert("请检查输入合法性");
                                                                this.value = "";
                                                            }
                                                        } else {
                                                            this.value = "";
                                                        }
                                                    });
                                                });

                                                $(".tab1").click(function () {
                                                    var id = this.id;
                                                    var datatabletype = $(this).attr("datatabletype");
                                                    var axisinfo = $(this).attr("axisinfo").split(',');

                                                    var rownum = parseInt(axisinfo[0]) - 1;
                                                    var colnum = parseInt(axisinfo[1]) - 1;

                                                    var divid = this.id + "DIV";
                                                    var tab = $(".divtab" + id).eq(0).find("table>tbody>tr")
                                                    var tabletype = $(this).attr("tabletype");
                                                    var ImageSize = $(this).attr("ImageSize").split(',');
                                                    $("#" + divid).css({ "width": ImageSize[0], "height": ImageSize[1] });


                                                    var xname = "";
                                                    var yname = "";
                                                    var Datalist = [];

                                                    if (datatabletype == "1") {
                                                        xname = $(tab[rownum]).find("td:eq(0)").text();
                                                        yname = $(tab[colnum]).find("td:eq(0)").text();
                                                        for (var i = 1; i < $(tab[rownum]).find("td").length; i++) {
                                                            var xval;
                                                            if ($(tab[rownum]).find("td:eq(" + i + ")").find("input").length != 0) {
                                                                xval = $(tab[rownum]).find("td:eq(" + i + ")").find("input").val();
                                                            }
                                                            else {
                                                                xval = $(tab[rownum]).find("td:eq(" + i + ")").text();
                                                            }

                                                            var yval;
                                                            if ($(tab[colnum]).find("td:eq(" + i + ")").find("input").length != 0) {
                                                                yval = $(tab[colnum]).find("td:eq(" + i + ")").find("input").val();
                                                            }
                                                            else {
                                                                yval = $(tab[colnum]).find("td:eq(" + i + ")").text();
                                                            }
                                                            if (xval != "" && yval != "") {
                                                                var arr = Array(2);
                                                                arr[0] = xval;
                                                                arr[1] = yval;
                                                                Datalist.push(arr);
                                                            }
                                                        }
                                                    }
                                                    else {
                                                        xname = $(tab[0]).find("td").eq(rownum).text();
                                                        yname = $(tab[0]).find("td").eq(colnum).text();
                                                        var rownum_div = $(tab[0]).find("td");
                                                        for (var i = 1; i < tab.length; i++) {
                                                            var xval;
                                                            if ($(tab[i]).find("td").eq(rownum).find("input").length != 0) {
                                                                xval = $(tab[i]).find("td").eq(rownum).find("input").val();
                                                            }
                                                            else {
                                                                xval = $(tab[i]).find("td").eq(rownum).find("input").text();
                                                            }

                                                            var yval;
                                                            if ($(tab[i]).find("td").eq(colnum).find("input").length != 0) {
                                                                yval = $(tab[i]).find("td").eq(colnum).find("input").val();
                                                            }
                                                            else {
                                                                yval = $(tab[i]).find("td").eq(colnum).find("input").text();
                                                            }

                                                            if (xval != "" && yval != "") {
                                                                var arr = Array(2);
                                                                arr[0] = xval;
                                                                arr[1] = yval;
                                                                Datalist.push(arr);
                                                            }
                                                        }
                                                    }
                                                    // 基于准备好的dom，初始化echarts实例
                                                    var myChart = echarts.init(document.getElementById(divid));
                                                    // 指定图表的配置项和数据
                                                    option = {
                                                        animation: false,
                                                        grid: {
                                                            top: 50,
                                                            left: 50,
                                                            right: 40,
                                                            bottom: 50
                                                        },
                                                        xAxis: {
                                                            name: xname,
                                                            nameLocation: 'middle',
                                                            nameTextStyle: {
                                                                padding: 15
                                                            }
                                                        },
                                                        yAxis: {
                                                            name: yname
                                                        },
                                                        series: [
                                                            {
                                                                type: tabletype == "Line" ? 'line' : 'scatter',
                                                                symbolSize: 13,
                                                                symbol: 'circle',
                                                                smooth: true,
                                                                clip: true,
                                                                smooth: true,
                                                                data: Datalist
                                                            }
                                                        ]
                                                    };
                                                    // 使用刚指定的配置项和数据显示图表。
                                                    myChart.setOption(option);
                                                    var img = new Image();
                                                    img.src = myChart.getDataURL({
                                                        pixelRatio: 2,
                                                        backgroundColor: '#fff'
                                                    });
                                                    var _textarea = id + "Area";
                                                    var imgurl = "<img style='width:" + ImageSize[0] + "px;' src='" + img.src + "'>"
                                                    $("." + _textarea).next().html(imgurl);
                                                })

                                            }
                                        }
                                    });

                                    //加载公式输入弹出框
                                    var ue = UE.getEditor('editor', {
                                        toolbars: [[
                                            'kityformula'
                                        ]],
                                        autoHeightEnabled: true,
                                        autoFloatEnabled: true
                                    });
                                }
                                else {
                                    bootbox.alert(result.Data);
                                }
                            }
                        });
                    }
                    else {
                        $.ajax({
                            type: 'post',
                            url: _websiteName + '/ReportStudent/CompleteReport/UpdateStudentReportArrange',
                            data: {
                                teacherClassID: data.TeacherClassID,
                                paperTemplateID: data.PaperTemplateID
                            },
                            success: function (result) {
                                if (!result.IsSuccess) {
                                    bootbox.alert(result.Data);
                                }
                                else {
                                    //提交word版本的报告

                                    $("#ReportModal_Word").modal("toggle");
                                    $("#fileNames").val("");
                                    if (data.PaperContentXml.indexOf('StudentReport') >= 0) {
                                        $("#reportFileName").text(data.PaperContentXml.substring(data.PaperContentXml.lastIndexOf("\\") + 1));
                                    }
                                    else {
                                        $("#reportFileName").text("当前为初始模板，无需保证文件名一致");
                                    }
                                    BuildFuryText();
                                }
                            }
                        });
                    }
                } else {
                    bootbox.alert(checkresult.Data);
                    return false;
                }
            }
        });
    }
}

//////报告关闭事件
//$('#ReportModal').on('hide.bs.modal', function () {
//    //记录结束时间
//        $.ajax({
//            async: false,
//            type: 'post',
//            url: _websiteName + '/ReportStudent/CompleteReport/SetLoginText',
//            data: {
//                type: 2,
//                loginTextID: _userInfo.LoginTextID,
//                userId:_userInfo.UserID,
//                userName:_userInfo.UserName,
//            },
//            success: function (result3) {

//            }
//        });
//})

//搜索
function SelScoreInfo() {
    view.PageIndex(1);
    view.GetStudentCompleteReportList();
}

//更新学生报告安排信息
function UpdateStudentArrange(data) {
    $.ajax({
        type: 'post',
        url: _websiteName + '/ReportStudent/CompleteReport/UpdateStudentReportArrange',
        data: {
            teacherClassID: data.TeacherClassID,
            paperTemplateID: data.PaperTemplateID
        },
        success: function (result) {
            if (!result.IsSuccess) {
                bootbox.alert(result.Data);
            }
            view.IsTrue = result.IsSuccess;

        }
    });
}

//提交Word版本的报告
function SubmitReport_doc_LS() {
    SubmitReport_doc(1);
}

function SubmitReport_doc_ZS() {
    SubmitReport_doc(2);
}

function SubmitReport_doc(subresult) {
    if ($('#importButton').val().length < 2) {
        bootbox.alert("请上传报告文件");
        return;
    }
    $('body').append("<div id='ajaxInfo' class='loadingLayout'><div class='loading'>正在请求数据,请稍等...</div></div>");
    //判断文件名是否一致
    if (view.PaperContentXml().indexOf('StudentReport') >= 0) {
        var oldArr = view.PaperContentXml().split('\\');
        var oldFileName = oldArr[oldArr.length - 1].split('.')[0];
        var newArr = $('#importButton').val().toString().split('\\');
        var newFileName = newArr[newArr.length - 1].split('.')[0];
        if (oldFileName != newFileName) {
            alert("请保持文件名一致！");
            $("#ajaxInfo").remove();
            return false;
        }
    }
    $.ajaxFileUpload({
        type: "post",
        url: _websiteName + "/ReportStudent/CompleteReport/SubmitBGContent_word_pdf",
        secureuri: false,
        fileElementId: "importButton",
        data: {
            teacherClassID: view.TeacherClassID(),
            studentID: view.StudentID(),
            studentName: _userInfo.UserName,
            SubResult: subresult
        },
        success: function (data, status) {
            //记录结束时间
            $.ajax({
                async: false,
                type: 'post',
                url: _websiteName + '/ReportStudent/CompleteReport/SetLoginText',
                data: {
                    type: 2,
                    loginTextID: _userInfo.LoginTextID,
                    userId: _userInfo.UserID,
                    userName: _userInfo.UserName,
                    teacherClassID: view.TeacherClassID(),
                    LogTimeId: _userInfo.LogTimeId
                },
                success: function (result3) {

                }
            });
            data = $.parseJSON(data.getElementsByTagName("body")[0].innerHTML);
            bootbox.alert(data.Data);
            // $("#ReportModal_Word").modal("toggle");
            $('#importButton').val("");
            view.GetStudentCompleteReportList();
            $("#ajaxInfo").remove();
        },
        error: function (data, status, e) {
            $("#ajaxInfo").remove();
            var data;
            try {
                data = $.parseJSON(jQuery(data.responseText).text());
                bootbox.alert(data.Data);
                // $("#ReportModal_Word").modal("toggle");
                $('#importButton').val("");
                $("#fileNames").val("");
                $("#reportFileName").text("");
                view.GetStudentCompleteReportList();
            }
            catch (ex) {
                data = $.parseJSON(data.responseText)
                bootbox.alert(data.Data);
                //  $("#ReportModal_Word").modal("toggle");
                $('#importButton').val("");
                $("#fileNames").val("");
                $("#reportFileName").text("");
                view.GetStudentCompleteReportList();
            }
        }
    });
}

function SubmitReport_Pic_ZS() {
    if ($('#itemImagers').val().length < 2) {
        bootbox.alert("请上传报告文件");
        return;
    }
    $('body').append("<div id='ajaxInfo' class='loadingLayout'><div class='loading'>正在请求数据,请稍等...</div></div>");
    $.ajaxFileUpload({
        type: "post",
        url: _websiteName + "/ReportStudent/CompleteReport/SubmitBGContent_Pic",
        secureuri: false,
        fileElementId: "itemImagers",
        data: {
            teacherClassID: view.TeacherClassID(),
            studentID: view.StudentID(),
            studentName: _userInfo.UserName,
            SubResult: 2
        },
        success: function (data, status) {
            //记录结束时间
            $.ajax({
                async: false,
                type: 'post',
                url: _websiteName + '/ReportStudent/CompleteReport/SetLoginText',
                data: {
                    type: 2,
                    loginTextID: _userInfo.LoginTextID,
                    userId: _userInfo.UserID,
                    userName: _userInfo.UserName,
                    teacherClassID: view.TeacherClassID(),
                    LogTimeId: _userInfo.LogTimeId
                },
                success: function (result3) {

                }
            });
            data = $.parseJSON(data.getElementsByTagName("body")[0].innerHTML);
            bootbox.alert(data.Data);
            // $("#ReportModal_Word").modal("toggle");
            $('#itemImagers').fileinput('clear');
            view.GetStudentCompleteReportList();
            $("#ajaxInfo").remove();
            setTimeout(reloadView, 1000);
        },
        error: function (data, status, e) {
            $("#ajaxInfo").remove();
            var data;
            try {
                data = $.parseJSON(jQuery(data.responseText).text());
                bootbox.alert(data.Data);
                // $("#ReportModal_Word").modal("toggle");
                $('#itemImagers').fileinput('clear');
                view.GetStudentCompleteReportList();
                setTimeout(reloadView, 1000);
            }
            catch (ex) {
                data = $.parseJSON(data.responseText)
                bootbox.alert(data.Data);
                //  $("#ReportModal_Word").modal("toggle");
                $('#itemImagers').fileinput('clear');
                view.GetStudentCompleteReportList();
                setTimeout(reloadView, 1000);
            }
        }
    });
}


function reloadView() {
    location.reload();
}

function DownReportTemp() {
    window.location.href = _websiteName + "/" + view.PaperContentXml();
}

function UploadReportFile() {
    $("#importButton").click();
}

//临时提交
function XMLSubmitReport_LSTJ() {
    SubmitReport(0);
}

function XMLSubmitReport_ZSTJ() {
    //厦门大学定制化需求
    //bootbox.confirm("学生实验开始前不能提交报告！", function (result) {
    //    if (result) {
    //        SubmitReport(1);
    //    }
    //});
    SubmitReport(1);
}
var SubmitReport = function (tjType) {
    var arrayContent = new Array();
    //判断是否原始数据是否存在照片    
    var yssjElement = $("#YSSJDrawingArea");
    if (yssjElement.length === 1) {
        var textarea = yssjElement[0].value;
        let hasImage = checkTextareaHasImage(textarea);
        if (!hasImage) {
            bootbox.alert("请拍照上传原始数据！");
            return false;
        }
    }
    //判断是否非物理
    var fwlText = $("#FWL").text();
    var fwl = false;
    if (fwlText != null) {
        if (fwlText == "FWL") {
            fwl = true;
        }
    };
    if (fwl) {
        var tyElement = $(".bkdms");
        for (var i = 0; i < tyElement.length; i++) {
            var area = tyElement[i].getElementsByTagName("textarea");
            var param = {};
            param["Name"] = tyElement[i].getAttribute("id");
            param["Value"] = tyElement[i].value;
            arrayContent.push(param);
        }
    } //非物理
    else {
        var arrayContent = new Array();
        var opElement = $(".op");
        for (var i = 0; i < opElement.length; i++) {
            var tables = opElement[i].getElementsByTagName("table");
            var inputs = opElement[i].getElementsByTagName("input");
            for (var ti = 0; ti < tables.length; ti++) {
                var tableName = tables[ti].getAttribute("id");
                var classType = tables[ti].getAttribute("class");
                var content = "";
                var NumberSimilarity = "";
                var StringSimilarity = "";

                for (var col = 0; col < tables[ti].rows[0].cells.length; col++) {
                    content += "(";
                    for (var row = 0; row < tables[ti].rows.length; row++) {
                        switch (classType) {
                            case "TList":
                                var inputtab = tables[ti].rows[row].cells[col].getElementsByTagName("input");
                                if (inputtab.length == 1) {
                                    content += inputtab[0].value + ",";
                                    NumberSimilarity += inputtab[0].value;
                                }
                                else {
                                    var value = tables[ti].rows[row].cells[col].innerText;
                                    content += value + ",";
                                }
                                break;
                            case "MatrixList":
                                var inputtab = tables[ti].rows[row].cells[col].getElementsByTagName("input");
                                if (inputtab.length > 0) {
                                    if (inputtab.length > 1) {
                                        content += inputtab[0].value + "°" + inputtab[1].value + "′" + ",";
                                        NumberSimilarity += inputtab[0].value + inputtab[1].value;
                                    }
                                    else {
                                        content += inputtab[0].value + ",";
                                        NumberSimilarity += inputtab[0].value;
                                    }
                                }
                                else {
                                    var value = tables[ti].rows[row].cells[col].innerText;
                                    content += value + ",";
                                }
                                break;
                            default:
                                var value = tables[ti].rows[row].cells[col].innerText;
                                content += value + ",";
                                NumberSimilarity += value;
                                break;
                        }
                    }
                    content = content.substr(0, content.length - 1);
                    content += ");";
                }
                content = content.substr(0, content.length - 1);
                var param = {};
                param["Name"] = tableName;
                param["Value"] = content;
                arrayContent.push(param);
            }
            for (var ii = 0; ii < inputs.length; ii++) {
                var className = inputs[ii].getAttribute("class");
                switch (className) {
                    case "ANGLE0TO360":
                        var param = {};
                        param["Name"] = inputs[ii].getAttribute("id");
                        param["Value"] = inputs[ii].value + "°" + inputs[ii + 1].value + "′";
                        NumberSimilarity += inputs[ii].value + inputs[ii + 1].value;
                        arrayContent.push(param);
                        ii++;
                        break;
                    case "inputExp":
                        var param = {};
                        param["Name"] = inputs[ii].getAttribute("id");
                        param["Value"] = inputs[ii].value + "±" + inputs[ii + 1].value;
                        NumberSimilarity += inputs[ii].value + inputs[ii + 1].value;
                        arrayContent.push(param);
                        ii++;
                        break;
                    case "ANGLEEX":
                        var param = {};
                        param["Name"] = inputs[ii].getAttribute("id");
                        param["Value"] = inputs[ii].value + "°" + inputs[ii + 1].value + "′" + "±" + inputs[ii + 2].value + "°" + inputs[ii + 3].value + "′";
                        NumberSimilarity += inputs[ii].value + inputs[ii + 1].value + inputs[ii + 2].value + inputs[ii + 3].value;
                        arrayContent.push(param);
                        ii += 3;
                        break;
                    case "input":
                        break;
                    case "String":
                        var param = {};
                        param["Name"] = inputs[ii].getAttribute("id");
                        param["Value"] = inputs[ii].value;
                        StringSimilarity += inputs[ii].value;
                        arrayContent.push(param);
                        break;
                    case "string":
                        var param = {};
                        param["Name"] = inputs[ii].getAttribute("id");
                        param["Value"] = inputs[ii].value;
                        StringSimilarity += inputs[ii].value;
                        arrayContent.push(param);
                        break;
                    default:
                        var param = {};
                        param["Name"] = inputs[ii].getAttribute("id");
                        param["Value"] = inputs[ii].value;
                        NumberSimilarity += inputs[ii].value;
                        arrayContent.push(param);
                        break;
                }
            }
        }

        var param = {};
        param["Name"] = "yssjArea";
        param["Value"] = $("#yssjArea").val();
        arrayContent.push(param);

        var msElement = $(".bkdms");
        for (var i = 0; i < msElement.length; i++) {
            var area = msElement[i].getElementsByTagName("textarea");
            var param = {};
            param["Name"] = msElement[i].getAttribute("id");
            param["Value"] = msElement[i].value;
            arrayContent.push(param);
        }
        var sktElement = $(".zj");
        for (var i = 0; i < sktElement.length; i++) {
            var area = sktElement[i].getElementsByTagName("textarea");
            var param = {};
            param["Name"] = area[0].getAttribute("id");
            param["Value"] = area[0].value;
            var dd = area[0].value.replace(/<\/?.+?>/g, "");
            var dds = dd.replace(/ /g, "");
            if (dds != null && dds != undefined) {
                StringSimilarity += dds.replace(/\s+/g, "");
            }
            else {
                StringSimilarity += dds;
            }
            arrayContent.push(param);
        }
        var DwElement = $(".Drawing");
        for (var i = 0; i < DwElement.length; i++) {
            var dd = DwElement[i].value.replace(/<\/?.+?>/g, "");
            var dds = dd.replace(/ /g, "");
            StringSimilarity += dds;
            var param = {};
            param["Name"] = DwElement[i].getAttribute("id");
            param["Value"] = DwElement[i].value;
            //console.log(DwElement[i].value);
            arrayContent.push(param);
        }
    } //物理
    //实验目的、实验仪器、实验原理、实验步骤
    var vacancyElement = $(".vacancy");
    for (var i = 0; i < vacancyElement.length; i++) {
        var param = {};
        param["Name"] = vacancyElement[i].getAttribute("id");
        param["Value"] = vacancyElement[i].value;
        arrayContent.push(param);
    }
    //思考题
    var sktElement = $(".skt");
    for (var i = 0; i < sktElement.length; i++) {
        var area = sktElement[i].getElementsByTagName("textarea");
        var param = {};
        param["Name"] = area[0].getAttribute("id");
        param["Value"] = area[0].value;
        var dd = area[0].value.replace(/<\/?.+?>/g, "");
        var dds = dd.replace(/ /g, "");
        if (dds != null && dds != undefined) {
            StringSimilarity += dds.replace(/\s+/g, "");
        }
        else {
            StringSimilarity += dds;
        }
        arrayContent.push(param);
    }
    var data = JSON.stringify(arrayContent);
    if (data.length < _fileInfo.ReportSize) {
        $.ajax({
            type: 'post',
            url: _websiteName + '/ReportStudent/CompleteReport/SubmitBGContent',
            data: {
                teacherClassID: view.TeacherClassID(),
                studentID: view.StudentID(),
                BGContent: encodeURIComponent(data),
                StringSimilarity: StringSimilarity,
                NumberSimilarity: NumberSimilarity,
                studentName: _userInfo.UserName,
                tjType: tjType,
                fwl: fwl
            },
            success: function (result) {
                console.log(result.ErrorInfo);
                if (result.ErrorInfo != "Success") {
                    bootbox.alert(result.ShowInfo);
                }
                else {
                    bootbox.alert("提交成功！");
                    // $("#ReportModal").modal("toggle");
                    view.GetStudentCompleteReportList();
                    //记录结束时间
                    $.ajax({
                        async: false,
                        type: 'post',
                        url: _websiteName + '/ReportStudent/CompleteReport/SetLoginText',
                        data: {
                            type: 2,
                            loginTextID: _userInfo.LoginTextID,
                            userId: _userInfo.UserID,
                            userName: _userInfo.UserName,
                            teacherClassID: view.TeacherClassID(),
                            LogTimeId: _userInfo.LogTimeId
                        },
                        success: function (result3) {

                        }
                    });
                }
            },
            error: function (data) {
                bootbox.alert(data.ShowInfo)
            }
        });
    }
    else {
        bootbox.alert("报告太大，规定大小为：" + _fileInfo.ReportSize / 1024 / 1024 + "MB");
    }
}

//点击打开后显示文件名
var GetFileName = function () {
    var fileName = $('#importButton').val();
    $("#fileNames").val(fileName.substring(fileName.lastIndexOf("\\") + 1));
}

//弹出数据
function ShowData(data) {
    if (data.IsReset == 1 || data.IsReset == "1") {
        bootbox.alert("重做原因【" + data.JSComment + "】");
    }
    else {
        bootbox.alert("暂无重做信息 ");
    }
}

var tableId = "";

//导入
function ImportXml(index) {
    tableId = index;
    $("#importButtonXml").click();
}

//导入
function Import() {
    $.ajaxFileUpload({
        type: "post",       //请求类型：post或get,当要使用data提交自定义参数时一定要设置为post
        url: _websiteName + "/ReportStudent/CompleteReport/ImportXmlTable",     //文件上传的服务器端请求地址
        secureuri: false,      //是否启用安全提交，一般默认为false就行，不用特殊处理
        fileElementId: "importButtonXml",   //文件上传控件的id
        dataType: "jsonp",      //返回值类型，一般设置为json，还支持html\xml\script类型
        success: function (data) {
            $('#importButtonXml').val('');//防止第二次选中无法生效
            var dataObj = JSON.parse(data);
            if (dataObj.Data.length > 0) {
                for (var i = 0; i < dataObj.Data.length; i++) {
                    for (var j = 0; j < dataObj.Data[i].length; j++) {
                        dataObj.Data[i][j] = dataObj.Data[i][j].replace('′', '').replace('分', '').replace('度', '°')
                        if (dataObj.Data[i][j].indexOf('°') != -1) {
                            var dataArr = dataObj.Data[i][j].split('°')
                            if (dataArr.length >= 2) {
                                if (isNaN(dataArr[0]) || isNaN(dataArr[1])) {
                                    bootbox.alert("只允许导入数字类型！");
                                    return;
                                }
                                $('#' + tableId + i + '-' + j + 'a').val(dataArr[0]);
                                $('#' + tableId + i + '-' + j + 'b').val(dataArr[1]);
                            }
                        } else {
                            if (isNaN(dataObj.Data[i][j])) {
                                bootbox.alert("只允许导入数字类型！");
                                return;
                            }
                            $('#' + tableId + i + '-' + j).val(dataObj.Data[i][j]);
                        }

                    }
                }
            }
        },
        error: function (data, status, e) { //服务器响应失败处理函数
            $('#importButtonXml').val('');
            bootbox.alert("上传失败，请稍后重试！");
        }
    });
}

function validateInteger(input) {
    if (input.value != "-") {
        // 用正则表达式检查输入的值是否为整数
        input.value = input.value.replace(/[^-?\d]/g, '');  // 替换非数字字符
    }
}


function checkTextareaHasImage(content) {   
    if (!content) {
        return false; // 内容为空，直接返回false
    }

    // 匹配常见的图片URL Base64图片编码
    const imagePattern = /^(data:image\/.+;base64,)/i;
    return imagePattern.test(content);
}
