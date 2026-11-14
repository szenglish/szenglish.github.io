// 網站的 Google Apps Script：意見投遞箱、會費查詢、幹部收費。
// 請從試算表的「擴充功能 > Apps Script」貼上這份程式，設定方式見 README.md。

// 幹部用 Google 帳號登入收費頁時用的 OAuth 用戶端 ID，和 config.js 的 googleClientId 相同。
var GOOGLE_CLIENT_ID = "938430486759-qsugaooebsk4i55q8k0946n68me4gus6.apps.googleusercontent.com";

var SHEETS = {
  feedback: "意見",
  roster: "名冊",
  payments: "收款紀錄",
  settings: "設定",
  officers: "幹部"
};
var HEADERS = {
  feedback: ["時間", "年級", "使用心得", "是否完成預期事項", "建議"],
  roster: ["學號", "姓名", "班級", "入會日期", "備註"],
  payments: ["時間", "學年", "學號", "姓名", "金額", "收據編號", "經手人", "經手人信箱", "狀態", "作廢原因"],
  settings: ["項目", "內容"],
  officers: ["Gmail", "姓名", "職稱"]
};
var VOID = "作廢";
var ID_PATTERN = /^\d{5,10}$/;
var CACHE_SECONDS = 60;

// 第一次使用時，在 Apps Script 編輯器選這個函式按「執行」，會建立缺少的分頁並完成授權。
function setup() {
  Object.keys(HEADERS).forEach(function (key) {
    var sheet = getSheet(key);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS[key]);
      sheet.setFrozenRows(1);
    }
  });
  var settings = getSheet("settings");
  if (settings.getLastRow() === 1) {
    settings.getRange(2, 1, 2, 2).setValues([["目前學年", 115], ["會費金額", ""]]);
  }
  ["roster", "payments"].forEach(function (key) {
    var col = HEADERS[key].indexOf("學號") + 1;
    getSheet(key).getRange(2, col, getSheet(key).getMaxRows() - 1, 1).setNumberFormat("@");
  });
}

// ── 網站入口 ─────────────────────────────────────────────

function doGet(e) {
  var params = (e && e.parameter) || {};
  try {
    if (params.action === "paycheck") return json(publicLookup(params.id));
    throw new Error("不支援的操作");
  } catch (err) {
    return json({ ok: false, error: err.message });
  }
}

function doPost(e) {
  var input;
  try {
    input = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "資料格式不正確" });
  }
  if (input.action) return json(handleOfficer(input));
  return json(handleFeedback(input));
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ── 意見投遞箱 ───────────────────────────────────────────

var FEEDBACK_MAX_LENGTH = 2000;
var FEEDBACK_OPTIONS = {
  grade: ["一年級", "二年級", "三年級", "四年級", "五年級", "已畢業"],
  rating: ["非常差勁", "有待加強", "普通", "非常好", "極佳"],
  completed: ["是", "否"]
};

function handleFeedback(input) {
  try {
    var row = feedbackRow(input);
    if (row) withLock(function () { getSheet("feedback", true).appendRow(row); });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
  return [new Date(), input.grade, input.rating, input.completed, safeText(suggestion)];
}

// ── 會費查詢（公開，不用登入） ───────────────────────────

function publicLookup(rawId) {
  var id = String(rawId || "").trim();
  if (!ID_PATTERN.test(id)) throw new Error("學號格式不正確");
  var snap = snapshot();
  var member = snap.roster[id];
  var payment = snap.paid[id];
  if (!member && !payment) return { ok: true, found: false };
  return {
    ok: true,
    found: true,
    name: maskName((member && member.name) || (payment && payment.name)),
    paid: Boolean(payment),
    graduated: isGraduated(id, member && member.joined, snap.year),
    receipt: payment ? payment.receipt : "",
    paidAt: payment ? payment.date : "",
    handler: payment ? payment.handler : ""
  };
}

// 名冊與已繳名單，快取 60 秒；收款或作廢時會立刻清掉快取。
// 五專會費入會時繳一次，五年有效，所以只要有一筆有效的收款就算已繳。
function snapshot() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("snapshot");
  if (cached) return JSON.parse(cached);

  var settings = readSettings();
  var roster = {};
  readTable("roster").forEach(function (r) {
    var id = idOf(r["學號"]);
    if (id) roster[id] = { name: text(r["姓名"]), joined: dateText(r["入會日期"]) };
  });
  var paid = {};
  allPayments().forEach(function (p) {
    if (p.void) return;
    paid[p.id] = { name: p.name, receipt: p.receipt, date: p.date, handler: p.handler };
  });
  var snap = { year: settings.year, roster: roster, paid: paid };
  var data = JSON.stringify(snap);
  if (data.length < 100000) cache.put("snapshot", data, CACHE_SECONDS);
  return snap;
}

// 入學年：應英科學號是 5 + 入學年後兩碼 + 科別 + 座號，例如 51106069 是 111 學年入學；
// 學號看不出來時，改用入會日期推算（8 月以後算當學年）。
function entryYear(id, joined) {
  var match = /^5(\d{2})\d{5}$/.exec(id);
  if (match) return 100 + Number(match[1]);
  var date = /^(\d{4})\D(\d{1,2})/.exec(joined || "");
  if (!date) return 0;
  return Number(date[1]) - 1911 - (Number(date[2]) >= 8 ? 0 : 1);
}

// 五專讀五年：入學年加 5 以後就算畢業（延畢的同學一樣可以收款）。
function isGraduated(id, joined, year) {
  var entry = entryYear(id, joined);
  return Boolean(entry && year && year - entry >= 5);
}

// 只顯示姓氏和最後一個字，例如「王小明」→「王○明」。
function maskName(name) {
  name = text(name);
  if (name.length <= 1) return name;
  if (name.length === 2) return name.charAt(0) + "○";
  return name.charAt(0) + new Array(name.length - 1).join("○") + name.charAt(name.length - 1);
}

// ── 幹部收費（要用幹部名單上的 Google 帳號登入） ─────────

function handleOfficer(input) {
  try {
    var officer = verifyOfficer(input.token);
    var actions = { me: officerMe, roster: officerRoster, lookup: officerLookup, pay: officerPay, "void": officerVoid, today: officerToday };
    if (!actions[input.action]) throw new Error("不支援的操作");
    return actions[input.action](input, officer);
  } catch (err) {
    return { ok: false, error: err.message, auth: Boolean(err.auth), denied: Boolean(err.denied) };
  }
}

function authError(message, denied) {
  var err = new Error(message);
  err.auth = !denied;
  err.denied = Boolean(denied);
  return err;
}

// 向 Google 確認登入憑證，再比對「幹部」分頁。驗證結果快取 10 分鐘。
function verifyOfficer(token) {
  if (!GOOGLE_CLIENT_ID) throw new Error("Apps Script 還沒有設定 GOOGLE_CLIENT_ID");
  if (!token) throw authError("請先登入");
  var cache = CacheService.getScriptCache();
  var key = "tok:" + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var email = cache.get(key);
  if (!email) {
    var res = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw authError("登入已過期，請重新登入");
    var info = JSON.parse(res.getContentText());
    var secondsLeft = Number(info.exp) - Math.floor(Date.now() / 1000);
    if (info.aud !== GOOGLE_CLIENT_ID || String(info.email_verified) !== "true" || secondsLeft <= 0) {
      throw authError("登入已過期，請重新登入");
    }
    email = String(info.email).toLowerCase();
    cache.put(key, email, Math.min(600, secondsLeft));
  }
  var match = readTable("officers").filter(function (r) {
    return text(r["Gmail"]).toLowerCase() === email;
  })[0];
  if (!match) throw authError(email + " 不在幹部名單中，請聯絡會長加入", true);
  return { email: email, name: text(match["姓名"]) || email.split("@")[0] };
}

function officerMe(input, officer) {
  var settings = readSettings();
  return { ok: true, officer: officer.name, email: officer.email, year: settings.year, fee: settings.fee };
}

// 登入後把整份名冊和已繳名單一次傳給收費頁，之後查學號、找姓名、看班級都不用再等網路。
function officerRoster(input, officer) {
  var settings = readSettings();
  var members = readTable("roster").map(function (r) {
    var id = idOf(r["學號"]);
    var joined = dateText(r["入會日期"]);
    return { id: id, name: text(r["姓名"]), className: text(r["班級"]), entry: entryYear(id, joined) };
  }).filter(function (m) { return m.id; });
  var paid = {};
  allPayments().forEach(function (p) {
    if (!p.void) paid[p.id] = publicPayment(p);
  });
  return { ok: true, year: settings.year, fee: settings.fee, members: members, paid: paid };
}

function officerLookup(input, officer) {
  var id = requireId(input.id);
  var settings = readSettings();
  var member = findMember(id);
  var payment = allPayments().filter(function (p) { return p.id === id && !p.void; })[0];
  return {
    ok: true,
    id: id,
    year: settings.year,
    fee: settings.fee,
    member: member ? { name: member.name, className: member.className } : null,
    payment: payment ? publicPayment(payment) : null
  };
}

function officerPay(input, officer) {
  var id = requireId(input.id);
  return withLock(function () {
    var settings = readSettings();
    if (!settings.year) throw new Error("請先在「設定」分頁填寫目前學年");
    if (!(settings.fee > 0)) throw new Error("請先在「設定」分頁填寫會費金額");

    var payments = allPayments();
    var existing = payments.filter(function (p) { return p.id === id && !p.void; })[0];
    if (existing) return { ok: false, error: "這位同學已經繳過會費了", payment: publicPayment(existing) };

    var member = findMember(id);
    if (!member) {
      var name = text(input.name);
      if (!name) throw new Error("名冊裡沒有這個學號，請填寫姓名");
      if (name.length > 30) throw new Error("姓名太長");
      member = { name: name, className: text(input.className).slice(0, 30) };
      getSheet("roster", true).appendRow(rowFor("roster", {
        "學號": "'" + id, "姓名": safeText(member.name), "班級": safeText(member.className),
        "入會日期": formatDate(new Date(), "yyyy/MM/dd")
      }));
    }

    var receipt = nextReceipt(settings.year, payments);
    var now = new Date();
    getSheet("payments", true).appendRow(rowFor("payments", {
      "時間": now, "學年": settings.year, "學號": "'" + id, "姓名": safeText(member.name), "金額": settings.fee,
      "收據編號": receipt, "經手人": officer.name, "經手人信箱": officer.email, "狀態": "有效"
    }));
    CacheService.getScriptCache().remove("snapshot");
    return { ok: true, id: id, name: member.name, receipt: receipt, amount: settings.fee, time: formatDate(now, "HH:mm") };
  });
}

function officerVoid(input, officer) {
  var receipt = text(input.receipt);
  var reason = text(input.reason);
  if (!receipt) throw new Error("缺少收據編號");
  if (!reason) throw new Error("請填寫作廢原因");
  return withLock(function () {
    var settings = readSettings();
    var target = allPayments().filter(function (p) { return p.receipt === receipt; })[0];
    if (!target) throw new Error("找不到這張收據");
    if (target.void) throw new Error("這張收據已經作廢了");
    var sheet = getSheet("payments");
    var header = headerOf(sheet);
    sheet.getRange(target.row, header.indexOf("狀態") + 1).setValue(VOID);
    sheet.getRange(target.row, header.indexOf("作廢原因") + 1).setValue(safeText(reason.slice(0, 100)) + "（" + officer.name + "）");
    CacheService.getScriptCache().remove("snapshot");
    return { ok: true };
  });
}

function officerToday(input, officer) {
  var settings = readSettings();
  var today = formatDate(new Date(), "yyyy/MM/dd");
  var items = allPayments().filter(function (p) { return p.date === today; }).reverse();
  var valid = items.filter(function (p) { return !p.void; });
  var mine = valid.filter(function (p) { return p.email === officer.email; });
  function sum(list) { return list.reduce(function (total, p) { return total + p.amount; }, 0); }
  return {
    ok: true,
    year: settings.year,
    total: { count: valid.length, amount: sum(valid) },
    mine: { count: mine.length, amount: sum(mine) },
    items: items.slice(0, 200).map(function (p) {
      var item = publicPayment(p);
      item.id = p.id;
      item.name = p.name;
      item.amount = p.amount;
      item.void = p.void;
      item.mine = p.email === officer.email;
      return item;
    })
  };
}

function publicPayment(p) {
  return { receipt: p.receipt, date: p.date, time: p.time, handler: p.handler };
}

// 收據編號：學年加流水號，例如 115 學年是 115-001、115-002…，作廢的號碼不再使用。
function nextReceipt(year, payments) {
  var prefix = year + "-";
  var max = 0;
  payments.forEach(function (p) {
    if (p.receipt.indexOf(prefix) === 0) max = Math.max(max, Number(p.receipt.slice(prefix.length)) || 0);
  });
  var seq = String(max + 1);
  while (seq.length < 3) seq = "0" + seq;
  return prefix + seq;
}

// ── 試算表讀寫 ───────────────────────────────────────────

function getSheet(key, create) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(SHEETS[key]);
  if (!sheet) {
    if (create === false) throw new Error("找不到「" + SHEETS[key] + "」分頁");
    sheet = spreadsheet.insertSheet(SHEETS[key]);
    sheet.appendRow(HEADERS[key]);
  }
  return sheet;
}

function headerOf(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(text);
}

// 依第一列標題把每一列轉成物件，欄位順序可以自由調整。_row 是試算表上的列號。
function readTable(key) {
  var values = getSheet(key).getDataRange().getValues();
  var header = values.shift().map(text);
  return values.map(function (row, i) {
    var record = { _row: i + 2 };
    header.forEach(function (h, j) { if (h) record[h] = row[j]; });
    return record;
  });
}

// 依標題順序排出要新增的一列。
function rowFor(key, values) {
  return headerOf(getSheet(key)).map(function (h) { return values.hasOwnProperty(h) ? values[h] : ""; });
}

function readSettings() {
  var map = {};
  getSheet("settings").getDataRange().getValues().forEach(function (row) { map[text(row[0])] = row[1]; });
  return { year: parseInt(text(map["目前學年"]), 10) || 0, fee: Number(map["會費金額"]) || 0 };
}

function findMember(id) {
  var match = readTable("roster").filter(function (r) { return idOf(r["學號"]) === id; })[0];
  return match ? { name: text(match["姓名"]), className: text(match["班級"]) } : null;
}

// 所有收款紀錄（含作廢的），依試算表的順序。
function allPayments() {
  return readTable("payments").filter(function (r) {
    return idOf(r["學號"]);
  }).map(function (r) {
    var time = r["時間"] instanceof Date ? r["時間"] : new Date(r["時間"]);
    var valid = !isNaN(time.getTime());
    return {
      row: r._row,
      id: idOf(r["學號"]),
      name: text(r["姓名"]),
      amount: Number(r["金額"]) || 0,
      receipt: text(r["收據編號"]),
      handler: text(r["經手人"]),
      email: text(r["經手人信箱"]).toLowerCase(),
      void: text(r["狀態"]) === VOID,
      date: valid ? formatDate(time, "yyyy/MM/dd") : "",
      time: valid ? formatDate(time, "HH:mm") : ""
    };
  });
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function requireId(raw) {
  var id = text(raw);
  if (!ID_PATTERN.test(id)) throw new Error("學號格式不正確");
  return id;
}

// 數字格式的學號可能被讀成 51106069.0，統一去掉小數和開頭的 '。
function idOf(value) {
  return text(value).replace(/^'/, "").replace(/\.0+$/, "");
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

// 開頭加上 ' 避免內容被試算表當成公式執行。
function safeText(value) {
  value = text(value);
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function dateText(value) {
  return value instanceof Date ? formatDate(value, "yyyy/MM/dd") : text(value);
}

function formatDate(date, pattern) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), pattern);
}
