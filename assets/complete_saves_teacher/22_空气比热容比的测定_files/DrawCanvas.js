
function Draw(obj, setting) {
    this.obj = obj;
    this.type = setting.type || "stroke";
    this.color = setting.color || "#000";
    this.width = setting.width || "1";
    this.size = setting.size || 14;
    this.weight = setting.weight || "normal";
}
Draw.prototype = {
    init: function () {
        this.obj.strokeStyle = this.color;
        this.obj.fillStyle = this.color;
        this.obj.lineWidth = this.width;
        this.obj.globalAlpha = 1;
        var fonts = this.weight + " " + this.size + "px Arial";
        this.obj.font = fonts;
    },
    rect: function (x, y, x1, y1) {
        this.init();
        this.obj.beginPath();
        this.obj.rect(x, y, x1 - x, y1 - y);
        if (this.type == "stroke") {
            this.obj.stroke();
        } else if (this.type == "fill") {
            this.obj.fill();
        }
    },
    line: function (x, y, x1, y1) {
        this.init();
        this.obj.beginPath();
        this.obj.moveTo(x, y);
        this.obj.lineTo(x1, y1);
        this.obj.stroke();
    },
    circle: function (x, y, x1, y1) {
        this.init();
        var r = Math.sqrt(Math.pow(x - x1, 2) + Math.pow(y - y1, 2));
        this.obj.beginPath();
        this.obj.arc(x, y, r, 0, 2 * Math.PI);
        if (this.type == "stroke") {
            this.obj.stroke();
        } else if (this.type == "fill") {
            this.obj.fill();
        }
    },
    pen: function (x, y, x1, y1) {
        this.init();
        this.obj.save();
        //this.obj.beginPath();
        this.obj.lineCap = "round";
        this.obj.lineTo(x1, y1);
        this.obj.stroke();
        this.obj.restore();
    },
    txt: function (x, y, x1, y1, txtstr) {
        this.init();
        this.obj.save();
        var chr = txtstr.split("");
        var temp = "";
        var row = [];
        for (var a = 0; a < chr.length; a++) {
            if (this.obj.measureText(temp).width < x1) {

            }
            else {
                row.push(temp);
                temp = "";
            }
            temp += chr[a];
        }
        row.push(temp);

        for (var b = 0; b < row.length; b++) {
            this.obj.fillText(row[b], x, y + b * parseInt(this.size));
        }
        //this.obj.fillText(txtstr, x, y);
    },
    eraser: function (x, y, x1, y1) {
        this.obj.lineCap = "round";
        this.obj.clearRect(x1 - 10, y1 - 10, 20, 20);
    }
}