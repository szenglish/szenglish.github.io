// 接收網站「意見投遞箱」的回覆並寫入試算表。
// 請從試算表的「擴充功能 > Apps Script」貼上這份程式，設定方式見 README.md。

var FEEDBACK_SHEET = "意見";
var FEEDBACK_MAX_LENGTH = 2000;
var FEEDBACK_OPTIONS = {
  grade: ["一年級", "二年級", "三年級", "四年級", "五年級", "已畢業"],
  rating: ["非常差勁", "有待加強", "普通", "非常好", "極佳"],
  completed: ["是", "否"]
};

function doPost(e) {
  var result;
  try {
    var row = feedbackRow(JSON.parse(e.postData.contents));
    if (row) appendFeedback(row);
    result = { ok: true };
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// 回傳要寫入試算表的一列；機器人填了隱藏欄位時回傳 null，並假裝成功。
function feedbackRow(input) {
  if (input.website) return null;
  Object.keys(FEEDBACK_OPTIONS).forEach(function (key) {
    if (FEEDBACK_OPTIONS[key].indexOf(input[key]) < 0) throw new Error("欄位內容不正確：" + key);
  });
  var suggestion = String(input.suggestion || "").trim();
  if (!suggestion) throw new Error("請填寫建議內容");
  if (suggestion.length > FEEDBACK_MAX_LENGTH) throw new Error("建議內容太長");
  // 開頭加上 ' 避免內容被試算表當成公式執行。
  if (/^[=+\-@]/.test(suggestion)) suggestion = "'" + suggestion;
  return [new Date(), input.grade, input.rating, input.completed, suggestion];
}

function appendFeedback(row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = spreadsheet.getSheetByName(FEEDBACK_SHEET);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(FEEDBACK_SHEET);
      sheet.appendRow(["時間", "年級", "使用心得", "是否完成預期事項", "建議"]);
    }
    sheet.appendRow(row);
  } finally {
    lock.releaseLock();
  }
}
