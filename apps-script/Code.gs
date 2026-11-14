// 網站的 Google Apps Script：意見反映（含進度查詢與幹部回覆）、會費查詢、幹部收費、線上投票、器材借用。
// 請從試算表的「擴充功能 > Apps Script」貼上這份程式，設定方式見 README.md。

// 幹部用 Google 帳號登入收費頁時用的 OAuth 用戶端 ID，和 config.js 的 googleClientId 相同。
var GOOGLE_CLIENT_ID = "938430486759-qsugaooebsk4i55q8k0946n68me4gus6.apps.googleusercontent.com";

var SHEETS = {
  feedback: "意見",
  feedbackThread: "意見回覆",
  roster: "名冊",
  payments: "收款紀錄",
  settings: "設定",
  officers: "幹部",
  voteEvents: "投票活動",
  voteQuestions: "投票題目",
  voteNamed: "投票紀錄",
  voteAnon: "投票結果",
  equipment: "器材",
  borrows: "借用申請"
};
var HEADERS = {
  feedback: ["案件編號", "時間", "姓名／科系", "回覆 Email", "意見", "指定部門", "處理狀態", "最後更新", "處理人"],
  feedbackThread: ["案件編號", "時間", "身分", "名稱", "部門", "內容"],
  roster: ["學號", "姓名", "班級", "入會日期", "備註"],
  payments: ["時間", "學年", "學號", "姓名", "金額", "收據編號", "經手人", "經手人信箱", "狀態", "作廢原因"],
  settings: ["項目", "內容"],
  officers: ["Gmail", "姓名", "職稱", "部門"],
  voteEvents: ["活動代號", "名稱", "說明", "開始時間", "結束時間", "公開結果"],
  voteQuestions: ["活動代號", "題號", "類型", "標題", "原條文", "修訂條文", "說明", "選項"],
  voteNamed: ["時間", "活動代號", "學號", "姓名", "信箱", "答案"],
  voteAnon: ["活動代號", "題號", "題目", "選擇"],
  equipment: ["器材名稱", "數量", "單位", "備註", "可借用"],
  borrows: ["申請編號", "申請時間", "學號", "借用人", "信箱", "借用單位", "聯絡電話", "開始日期", "結束日期", "借用物品",
    "用途說明", "使用地點", "狀態", "器材長審核", "會長審核", "退回原因", "借出紀錄", "歸還驗收", "歸還備註"]
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
      return;
    }
    // 舊分頁缺少的欄位補在最後面（程式依標題讀寫，欄位順序不影響）。
    var header = headerOf(sheet);
    var missing = HEADERS[key].filter(function (h) { return header.indexOf(h) < 0; });
    if (missing.length) sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
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
    if (params.action === "votes") return json(publicVoteList());
    if (params.action === "vote") return json(publicVote(params.event));
    if (params.action === "equipment") return json(publicEquipment(params.start, params.end));
    throw new Error("不支援此操作");
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
  if (input.action === "voteStatus" || input.action === "voteSubmit") return json(handleVoter(input));
  if (/^borrow/.test(input.action || "")) return json(handleBorrow(input));
  if (/^feedback/.test(input.action || "")) return json(handleFeedbackAction(input));
  if (input.action) return json(handleOfficer(input));
  return json(handleFeedback(input));
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ── 意見投遞箱 ───────────────────────────────────────────
// 送出後給案件編號（例如 F1115-01）；學生用「案件編號＋Email」查進度、補充說明；
// 幹部登入後在網站回覆，回覆會寄信通知學生。對話內容存在「意見回覆」分頁。

var FEEDBACK_MAX_LENGTH = 2000;
var FEEDBACK_DEPTS = ["不指定", "正副會長", "秘書處", "財務部", "企劃部", "廣宣部", "器材部"];
var FEEDBACK = { received: "已收到", working: "處理中", replied: "已回覆", closed: "已結案" };
var FEEDBACK_HIDE_DAYS = 30;
var FEEDBACK_URL = "https://szenglish.github.io/feedback.html";

// 防止表單被程式大量送出：同一個 Email 每天最多 3 則、全站每小時最多 20 則、每個案件每天最多補充 5 次。
// 寄信額度剩不多時，先不寄受理通知，把額度留給器材借用與回覆通知。
var FEEDBACK_LIMITS = { perEmailPerDay: 3, perHour: 20, followupsPerDay: 5, keepMailQuota: 30 };

function handleFeedback(input) {
  try {
    var row = feedbackRow(input);
    if (!row) return { ok: true, no: "" };
    var no = withLock(function () {
      checkFeedbackLimits(text(input.email));
      row["案件編號"] = nextFeedbackNo();
      getSheet("feedback", true).appendRow(rowFor("feedback", row));
      return row["案件編號"];
    });
    var c = { no: no, name: text(input.name), email: text(input.email), message: text(input.suggestion), dept: row["指定部門"] };
    if (mailQuotaLeft() > FEEDBACK_LIMITS.keepMailQuota) sendMail(c.email, "【應用英語科學會】意見反映受理通知（" + no + "）", {
      label: "意見反映通知", url: FEEDBACK_URL + "?no=" + no,
      title: "您的意見已收到",
      greeting: c.name + " 您好：",
      intro: "感謝您提供寶貴意見。本會已受理並轉交相關部門處理，原則上於 7 個工作天內回覆。",
      extra: [["案件編號", no], ["指定部門", c.dept], ["您的意見", c.message]],
      note: "查詢處理進度時，請輸入案件編號及本信收件 Email。",
      button: "查詢處理進度"
    });
    notifyFeedbackDept(c, "【應用英語科學會】新意見反映待處理（" + no + "）", "新的意見反映", "系統收到一則新的意見反映，請協助處理。");
    return { ok: true, no: no };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function checkFeedbackLimits(email) {
  var now = Date.now();
  var dayStart = new Date(today().replace(/\//g, "-") + "T00:00:00+08:00").getTime();
  var rows = readTable("feedback").map(function (r) {
    return { email: text(r["回覆 Email"]).replace(/^'/, "").toLowerCase(), time: r["時間"] instanceof Date ? r["時間"].getTime() : 0 };
  });
  var sameEmailToday = rows.filter(function (r) { return r.email === email.toLowerCase() && r.time >= dayStart; }).length;
  if (sameEmailToday >= FEEDBACK_LIMITS.perEmailPerDay) {
    throw new Error("此 Email 今日已送出 " + sameEmailToday + " 則意見，請於明日再試，或直接來信 szae.official@gmail.com");
  }
  var lastHour = rows.filter(function (r) { return r.time >= now - 3600e3; }).length;
  if (lastHour >= FEEDBACK_LIMITS.perHour) throw new Error("目前意見反映數量較多，請稍後再試，或直接來信 szae.official@gmail.com");
}

function mailQuotaLeft() {
  try {
    return MailApp.getRemainingDailyQuota();
  } catch (err) {
    return 100;
  }
}

// 回傳要寫入試算表的欄位；機器人填了隱藏欄位時回傳 null，並假裝成功。
function feedbackRow(input) {
  if (input.website) return null;
  var name = text(input.name);
  var email = text(input.email);
  var suggestion = text(input.suggestion);
  var dept = FEEDBACK_DEPTS.indexOf(text(input.dept)) >= 0 ? text(input.dept) : "不指定";
  if (!name || name.length > 50) throw new Error("請填寫姓名／科系");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) throw new Error("請填寫正確的 Email");
  if (!suggestion) throw new Error("請填寫意見內容");
  if (suggestion.length > FEEDBACK_MAX_LENGTH) throw new Error("意見內容超過 " + FEEDBACK_MAX_LENGTH + " 字");
  var now = new Date();
  return {
    "時間": now, "姓名／科系": safeText(name), "回覆 Email": safeText(email),
    "意見": safeText(suggestion), "指定部門": dept, "處理狀態": FEEDBACK.received, "最後更新": now
  };
}

function handleFeedbackAction(input) {
  try {
    var action = input.action;
    if (action === "feedbackLookup") return { ok: true, item: publicCase(findCaseFor(input)) };
    if (action === "feedbackFollowup") return feedbackFollowup(input);
    var officer = verifyOfficer(input.token);
    if (action === "feedbackList") return feedbackList(officer);
    if (action === "feedbackReply") return feedbackReply(officer, input);
    if (action === "feedbackStatus") return feedbackSetStatus(officer, input);
    throw new Error("不支援此操作");
  } catch (err) {
    return { ok: false, error: err.message, auth: Boolean(err.auth), denied: Boolean(err.denied) };
  }
}

// 案件編號和 Email 都要對才看得到；兩種錯誤用同一句話，避免被拿來猜編號。
function findCaseFor(input) {
  var no = text(input.no).toUpperCase();
  var email = text(input.email).toLowerCase();
  var c = feedbackCases().filter(function (x) { return x.no === no; })[0];
  if (!c || !email || c.email.toLowerCase() !== email) throw new Error("查無此案件，請確認案件編號與 Email 是否正確");
  return c;
}

function publicCase(c) {
  var hidden = c.status === FEEDBACK.closed && c.updatedAt && Date.now() - c.updatedAt > FEEDBACK_HIDE_DAYS * 864e5;
  var base = { no: c.no, status: c.status, created: c.created, updated: c.updated, dept: c.dept };
  if (hidden) {
    base.hidden = true;
    return base;
  }
  base.name = c.name;
  base.message = c.message;
  base.thread = threadOf(c.no).map(function (t) {
    return { time: t.time, role: t.role, who: t.role === "學生" ? c.name : "應用英語科學會" + (t.dept ? "　" + t.dept : ""), text: t.text };
  });
  return base;
}

function feedbackFollowup(input) {
  var message = text(input.message);
  if (!message) throw new Error("請填寫補充內容");
  if (message.length > FEEDBACK_MAX_LENGTH) throw new Error("補充內容超過 " + FEEDBACK_MAX_LENGTH + " 字");
  var c = withLock(function () {
    var found = findCaseFor(input);
    if (found.status === FEEDBACK.closed) throw new Error("本案件已結案，如有其他意見，請重新提出意見反映");
    var todayCount = threadOf(found.no).filter(function (t) { return t.role === "學生" && t.time.indexOf(today()) === 0; }).length;
    if (todayCount >= FEEDBACK_LIMITS.followupsPerDay) throw new Error("本案件今日補充次數已達上限，請於明日再試");
    appendThread(found.no, "學生", found.name, "", message);
    setCase(found, { "處理狀態": FEEDBACK.working, "最後更新": new Date() });
    return found;
  });
  c.message = message;
  notifyFeedbackDept(c, "【應用英語科學會】意見反映補充說明（" + c.no + "）", "意見反映補充說明", "反映人針對以下案件提出補充說明，請協助處理。");
  return { ok: true, item: publicCase(feedbackCases().filter(function (x) { return x.no === c.no; })[0]) };
}

function feedbackList(officer) {
  var threads = {};
  readTable("feedbackThread").forEach(function (r) {
    var no = text(r["案件編號"]);
    if (!no) return;
    (threads[no] = threads[no] || []).push(threadRow(r));
  });
  var items = feedbackCases().reverse().slice(0, 300).map(function (c) {
    var copy = {};
    Object.keys(c).forEach(function (k) { if (k !== "row" && k !== "updatedAt") copy[k] = c[k]; });
    copy.thread = threads[c.no] || [];
    return copy;
  });
  return { ok: true, officer: { name: officer.name, dept: officer.dept, title: officer.title }, items: items };
}

function feedbackReply(officer, input) {
  var message = text(input.message);
  if (!message) throw new Error("請填寫回覆內容");
  if (message.length > FEEDBACK_MAX_LENGTH) throw new Error("回覆內容超過 " + FEEDBACK_MAX_LENGTH + " 字");
  var status = text(input.status) === FEEDBACK.closed ? FEEDBACK.closed : FEEDBACK.replied;
  var c = withLock(function () {
    var found = findCase(input.no);
    appendThread(found.no, "科學會", officer.name, officer.dept, message);
    setCase(found, { "處理狀態": status, "最後更新": new Date(), "處理人": officer.name });
    return found;
  });
  sendMail(c.email, "【應用英語科學會】意見反映回覆通知（" + c.no + "）", {
    label: "意見反映通知", url: FEEDBACK_URL + "?no=" + c.no,
    title: "您的意見已有回覆",
    tone: "ok",
    greeting: c.name + " 您好：",
    intro: "您反映的意見已由本會" + (officer.dept ? officer.dept : "") + "回覆，內容如下。",
    extra: [["案件編號", c.no], ["您的意見", shorten(c.message, 200)], ["回覆內容", message]],
    note: status === FEEDBACK.closed ? "本案件已結案。如有其他意見，歡迎重新提出意見反映。" : "如需補充說明，請至查詢頁面輸入案件編號及 Email 後回覆。",
    button: "查看完整紀錄"
  });
  return { ok: true };
}

function feedbackSetStatus(officer, input) {
  var status = text(input.status);
  if ([FEEDBACK.working, FEEDBACK.closed].indexOf(status) < 0) throw new Error("不支援此狀態");
  withLock(function () {
    var c = findCase(input.no);
    setCase(c, { "處理狀態": status, "最後更新": new Date(), "處理人": officer.name });
  });
  return { ok: true };
}

// 依指定部門通知幹部；「不指定」或該部門沒有人時，通知正副會長。
function notifyFeedbackDept(c, subject, title, intro) {
  var officers = readTable("officers").filter(function (r) { return text(r["Gmail"]); });
  var target = c.dept === "不指定" ? "正副會長" : c.dept;
  var list = officers.filter(function (r) { return text(r["部門"]) === target; });
  if (!list.length) list = officers.filter(function (r) { return text(r["部門"]) === "正副會長"; });
  if (!list.length) list = officers.filter(function (r) { return ["會長", "副會長"].indexOf(text(r["職稱"])) >= 0; });
  list.forEach(function (r) {
    sendMail(text(r["Gmail"]), subject, {
      label: "意見反映通知", url: FEEDBACK_URL + "?admin=1",
      title: title,
      greeting: (text(r["姓名"]) || "幹部") + " 您好：",
      intro: intro,
      extra: [["案件編號", c.no], ["反映人", c.name], ["指定部門", c.dept], ["內容", c.message]],
      button: "前往處理"
    });
  });
}

function feedbackCases() {
  return readTable("feedback").filter(function (r) { return text(r["案件編號"]); }).map(function (r) {
    var updated = r["最後更新"] instanceof Date ? r["最後更新"] : (r["時間"] instanceof Date ? r["時間"] : null);
    return {
      row: r._row, no: text(r["案件編號"]), created: stampText(r["時間"]), name: text(r["姓名／科系"]).replace(/^'/, ""),
      email: text(r["回覆 Email"]).replace(/^'/, ""), message: text(r["意見"]).replace(/^'/, ""), dept: text(r["指定部門"]) || "不指定",
      status: normalizeStatus(text(r["處理狀態"])), updated: stampText(updated), updatedAt: updated ? updated.getTime() : 0,
      handler: text(r["處理人"])
    };
  });
}

// 舊資料的「未回覆」視為「已收到」。
function normalizeStatus(value) {
  var all = [FEEDBACK.received, FEEDBACK.working, FEEDBACK.replied, FEEDBACK.closed];
  return all.indexOf(value) >= 0 ? value : FEEDBACK.received;
}

function findCase(no) {
  var c = feedbackCases().filter(function (x) { return x.no === text(no).toUpperCase(); })[0];
  if (!c) throw new Error("查無此案件");
  return c;
}

function setCase(c, values) {
  var sheet = getSheet("feedback");
  var header = headerOf(sheet);
  Object.keys(values).forEach(function (h) {
    var col = header.indexOf(h);
    if (col >= 0) sheet.getRange(c.row, col + 1).setValue(values[h]);
  });
}

function threadOf(no) {
  return readTable("feedbackThread").filter(function (r) { return text(r["案件編號"]) === no; }).map(threadRow);
}

function threadRow(r) {
  return { time: stampText(r["時間"]), role: text(r["身分"]), name: text(r["名稱"]), dept: text(r["部門"]), text: text(r["內容"]).replace(/^'/, "") };
}

function appendThread(no, role, name, dept, message) {
  getSheet("feedbackThread", true).appendRow(rowFor("feedbackThread", {
    "案件編號": no, "時間": new Date(), "身分": role, "名稱": safeText(name), "部門": dept, "內容": safeText(message)
  }));
}

// 案件編號：F + 日期 + 流水號，例如 F1115-01。
function nextFeedbackNo() {
  var prefix = "F" + formatDate(new Date(), "MMdd") + "-";
  var max = 0;
  feedbackCases().forEach(function (c) {
    if (c.no.indexOf(prefix) === 0) max = Math.max(max, Number(c.no.slice(prefix.length)) || 0);
  });
  return prefix + String(max + 1).padStart(2, "0");
}

function stampText(value) {
  return value instanceof Date ? formatDate(value, "yyyy/MM/dd HH:mm") : text(value);
}

function shorten(value, n) {
  value = text(value);
  return value.length > n ? value.slice(0, n) + "…" : value;
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
    if (!actions[input.action]) throw new Error("不支援此操作");
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

// 向 Google 確認登入憑證，回傳信箱。驗證結果快取 10 分鐘。
function verifyGoogleEmail(token) {
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
  return email;
}

// 確認登入的帳號在「幹部」分頁。
function verifyOfficer(token) {
  var email = verifyGoogleEmail(token);
  var match = readTable("officers").filter(function (r) {
    return text(r["Gmail"]).toLowerCase() === email;
  })[0];
  if (!match) throw authError(email + " 不在幹部名單中，請聯絡會長加入", true);
  return { email: email, name: text(match["姓名"]) || email.split("@")[0], title: text(match["職稱"]), dept: text(match["部門"]) };
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

// ── 線上投票 ─────────────────────────────────────────────
// 投票活動和題目都在試算表設定，不用改程式。
// 學生用學校 Google 帳號（s學號@student.szmc.edu.tw）登入，學號直接從信箱取得。
// 每張票寫兩份：「投票紀錄」記名，供選委會查核；「投票結果」不含學號，可以公開。

var VOTE_TYPES = { agree: "同意反對", choice: "單選" };
var AGREE_OPTIONS = ["同意", "反對"];
var SCHOOL_EMAIL = /^s(\d{8})@student\.szmc\.edu\.tw$/;

// 公開：列出所有投票活動。
function publicVoteList() {
  var now = Date.now();
  var events = readTable("voteEvents").map(function (r) { return eventOf(r, now); })
    .filter(function (e) { return e.id; })
    .sort(function (a, b) { return b.start - a.start; });
  return { ok: true, events: events.map(publicEvent) };
}

// 公開：單一活動的題目；活動結束且設定公開時，附上統計結果。
function publicVote(eventId) {
  var event = findEvent(eventId);
  var questions = questionsOf(event.id);
  var data = publicEvent(event);
  data.questions = questions.map(function (q) {
    return { no: q.no, type: q.type, title: q.title, original: q.original, revised: q.revised, note: q.note, options: q.options };
  });
  if (event.status === "closed" && event.showResults) data.results = tally(event.id, questions);
  return { ok: true, event: data };
}

function handleVoter(input) {
  try {
    var voter = verifyStudent(input.token);
    var event = findEvent(input.event);
    if (input.action === "voteStatus") {
      return {
        ok: true, id: voter.id, name: voter.name, eligible: voter.eligible,
        voted: hasVoted(event.id, voter.id), status: event.status
      };
    }
    if (input.action === "voteSubmit") return submitVote(event, voter, input.answers || {});
    throw new Error("不支援此操作");
  } catch (err) {
    return { ok: false, error: err.message, auth: Boolean(err.auth), denied: Boolean(err.denied) };
  }
}

function submitVote(event, voter, answers) {
  if (event.status !== "open") throw new Error(event.status === "upcoming" ? "本次投票尚未開始" : "本次投票已截止");
  if (!voter.eligible) throw new Error("此帳號不具本次投票資格");
  var questions = questionsOf(event.id);
  var picked = questions.map(function (q) {
    var answer = text(answers[q.no]);
    if (q.options.indexOf(answer) < 0) throw new Error("第 " + q.no + " 題尚未作答");
    return { q: q, answer: answer };
  });
  return withLock(function () {
    if (hasVoted(event.id, voter.id)) return { ok: false, error: "此帳號已完成本次投票，每人限投一次", voted: true };
    getSheet("voteNamed", true).appendRow(rowFor("voteNamed", {
      "時間": new Date(), "活動代號": event.id, "學號": "'" + voter.id, "姓名": voter.name, "信箱": voter.email,
      "答案": picked.map(function (p) { return p.q.no + ". " + p.answer; }).join("\n")
    }));
    var anon = getSheet("voteAnon", true);
    var header = headerOf(anon);
    var rows = picked.map(function (p) {
      var values = { "活動代號": event.id, "題號": p.q.no, "題目": p.q.title, "選擇": p.answer };
      return header.map(function (h) { return values.hasOwnProperty(h) ? values[h] : ""; });
    });
    anon.getRange(anon.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
    // 依活動、題號排序，同一題的票混在一起，看不出投票順序。
    if (anon.getLastRow() > 2) {
      anon.getRange(2, 1, anon.getLastRow() - 1, header.length).sort([
        { column: header.indexOf("活動代號") + 1, ascending: true },
        { column: header.indexOf("題號") + 1, ascending: true },
        { column: header.indexOf("選擇") + 1, ascending: true }
      ]);
    }
    return { ok: true };
  });
}

// 驗證學校帳號，判斷是不是還沒畢業的應英科學生。
function verifyStudent(token) {
  var email = verifyGoogleEmail(token);
  var match = SCHOOL_EMAIL.exec(email);
  // 開發者只在「測試模式」開著時，可以用自己的 Gmail 測試投票，紀錄的學號欄會寫「開發者」。
  // 正式投票（測試模式為「否」）時一律只收學校帳號，開發者的票不會算進結果。
  var developer = !match && readSettings().testMode && readTable("officers").filter(function (r) {
    return text(r["Gmail"]).toLowerCase() === email && text(r["職稱"]) === "開發者";
  })[0];
  if (!match && developer) return { id: "開發者", email: email, name: text(developer["姓名"]), eligible: true };
  if (!match) throw authError("請以學校信箱（s學號@student.szmc.edu.tw）登入。" + email + " 不具投票資格", true);
  var id = match[1];
  var member = findMember(id);
  var year = readSettings().year;
  var applied = /^5\d{2}06\d{3}$/.test(id) || Boolean(member);
  return {
    id: id,
    email: email,
    name: member ? member.name : "",
    eligible: applied && !isGraduated(id, member && member.joined, year)
  };
}

function hasVoted(eventId, id) {
  return readTable("voteNamed").some(function (r) {
    return text(r["活動代號"]) === eventId && idOf(r["學號"]) === id;
  });
}

function tally(eventId, questions) {
  var counts = {};
  questions.forEach(function (q) {
    counts[q.no] = {};
    q.options.forEach(function (o) { counts[q.no][o] = 0; });
  });
  var ballots = 0;
  readTable("voteAnon").forEach(function (r) {
    if (text(r["活動代號"]) !== eventId) return;
    var no = text(r["題號"]);
    var choice = text(r["選擇"]);
    if (counts[no] && counts[no].hasOwnProperty(choice)) counts[no][choice] += 1;
  });
  readTable("voteNamed").forEach(function (r) { if (text(r["活動代號"]) === eventId) ballots += 1; });
  return { ballots: ballots, counts: counts };
}

function findEvent(rawId) {
  var id = text(rawId);
  var now = Date.now();
  var event = readTable("voteEvents").map(function (r) { return eventOf(r, now); })
    .filter(function (e) { return e.id && e.id === id; })[0];
  if (!event) throw new Error("查無此投票活動");
  return event;
}

function eventOf(r, now) {
  var start = toTime(r["開始時間"]);
  var end = toTime(r["結束時間"]);
  return {
    id: text(r["活動代號"]),
    name: text(r["名稱"]),
    description: text(r["說明"]),
    start: start,
    end: end,
    status: !start || now < start ? "upcoming" : (end && now >= end ? "closed" : "open"),
    showResults: text(r["公開結果"]) === "是"
  };
}

function publicEvent(e) {
  return {
    id: e.id, name: e.name, description: e.description, status: e.status, showResults: e.showResults,
    start: e.start ? formatDate(new Date(e.start), "yyyy/MM/dd HH:mm") : "",
    end: e.end ? formatDate(new Date(e.end), "yyyy/MM/dd HH:mm") : ""
  };
}

function questionsOf(eventId) {
  return readTable("voteQuestions").filter(function (r) {
    return text(r["活動代號"]) === eventId && text(r["題號"]);
  }).map(function (r) {
    var type = text(r["類型"]) === VOTE_TYPES.choice ? "choice" : "agree";
    var options = type === "choice"
      ? text(r["選項"]).split(/[\n、,，]/).map(text).filter(Boolean)
      : AGREE_OPTIONS;
    return {
      no: text(r["題號"]), type: type, title: text(r["標題"]),
      original: text(r["原條文"]), revised: text(r["修訂條文"]), note: text(r["說明"]), options: options
    };
  }).sort(function (a, b) { return Number(a.no) - Number(b.no); });
}

function toTime(value) {
  if (value instanceof Date) return value.getTime();
  var t = Date.parse(text(value).replace(/\//g, "-").replace(" ", "T"));
  return isNaN(t) ? 0 : t;
}

// ── 器材借用 ─────────────────────────────────────────────
// 學生用學校帳號申請；器材長審核 → 會長審核 → 借出 → 歸還。
// 器材長、會長依「幹部」分頁的職稱判斷（職稱「開發者」兩關都能審），審核結果會寄信通知申請人。

var BORROW = {
  equipApprove: "待器材長審核",
  presidentApprove: "待會長審核",
  approved: "已核准",
  lent: "已借出",
  returned: "已歸還",
  rejected: "已退回",
  cancelled: "已取消"
};
var BORROW_ACTIVE = [BORROW.equipApprove, BORROW.presidentApprove, BORROW.approved, BORROW.lent];
var BORROW_NOTICE_DAYS = 3;

// 公開：器材清單；帶日期時，附上那段期間還能借的數量。
function publicEquipment(start, end) {
  var range = start && end ? dateRange(start, end) : null;
  var items = equipmentList().map(function (item) {
    var data = { name: item.name, total: item.total, unit: item.unit, note: item.note };
    if (range) data.available = item.total - bookedQuantity(item.name, range.start, range.end, "");
    return data;
  });
  return { ok: true, items: items, noticeDays: BORROW_NOTICE_DAYS };
}

function handleBorrow(input) {
  try {
    var email = verifyGoogleEmail(input.token);
    var who = borrowWho(email);
    var action = input.action;
    if (action === "borrowWho") return borrowWhoResult(who);
    if (action === "borrowMine") return { ok: true, items: borrowRequests().filter(function (r) { return r.email === email; }).reverse().map(publicRequest) };
    if (action === "borrowSubmit") return borrowSubmit(who, input);
    if (action === "borrowCancel") return borrowCancel(who, input);
    if (action === "borrowList") {
      if (!who.officer) throw authError("僅限幹部查看審核清單", true);
      return { ok: true, roles: who.roles, items: borrowRequests().reverse().slice(0, 200).map(publicRequest) };
    }
    if (action === "borrowAct") return borrowAct(who, input);
    throw new Error("不支援此操作");
  } catch (err) {
    return { ok: false, error: err.message, auth: Boolean(err.auth), denied: Boolean(err.denied) };
  }
}

// 判斷登入的人是學生、幹部，或兩者都是。
function borrowWho(email) {
  var who = { email: email, student: null, officer: null, roles: { equip: false, president: false } };
  var school = SCHOOL_EMAIL.exec(email);
  if (school) {
    var member = findMember(school[1]);
    who.student = { id: school[1], name: member ? member.name : "" };
  }
  var officer = readTable("officers").filter(function (r) { return text(r["Gmail"]).toLowerCase() === email; })[0];
  if (officer) {
    var title = text(officer["職稱"]);
    who.officer = { name: text(officer["姓名"]) || email.split("@")[0], title: title };
    var developer = title === "開發者"; // 開發者擁有所有權限（不會收到通知信）
    who.roles.equip = developer || title.indexOf("器材") >= 0;
    who.roles.president = developer || title === "會長";
  }
  if (!who.student && !who.officer) throw authError("申請借用請以學校信箱（s學號@student.szmc.edu.tw）登入", true);
  return who;
}

function borrowWhoResult(who) {
  return {
    ok: true,
    email: who.email,
    student: who.student,
    officer: who.officer ? { name: who.officer.name, title: who.officer.title } : null,
    roles: who.roles
  };
}

function borrowSubmit(who, input) {
  if (!who.student) throw new Error("申請借用請以學校信箱登入");
  var unit = text(input.unit).slice(0, 50);
  var phone = text(input.phone).slice(0, 30);
  var purpose = text(input.purpose).slice(0, 500);
  var place = text(input.place).slice(0, 100);
  var name = text(input.name).slice(0, 30) || who.student.name;
  if (!unit) throw new Error("請填寫借用單位");
  if (!name) throw new Error("請填寫借用人姓名");
  if (!/^[0-9+\-\s()#]{8,}$/.test(phone)) throw new Error("聯絡電話格式不正確");
  if (!purpose) throw new Error("請填寫用途說明");
  if (!place) throw new Error("請填寫使用地點");
  var range = dateRange(input.start, input.end);
  var earliest = addDays(today(), BORROW_NOTICE_DAYS);
  if (range.start < earliest) throw new Error("依規定須於借用日 " + BORROW_NOTICE_DAYS + " 天前提出申請，可申請 " + earliest + " 起之借用");

  var catalog = {};
  equipmentList().forEach(function (item) { catalog[item.name] = item; });
  var items = (input.items || []).map(function (i) {
    return { name: text(i.name), qty: Math.floor(Number(i.qty)) };
  }).filter(function (i) { return i.qty > 0; });
  if (!items.length) throw new Error("請選擇借用器材");

  return withLock(function () {
    items.forEach(function (i) {
      var item = catalog[i.name];
      if (!item) throw new Error("器材清單中查無「" + i.name + "」");
      var left = item.total - bookedQuantity(i.name, range.start, range.end, "");
      if (i.qty > left) throw new Error("「" + i.name + "」於本期間僅剩 " + Math.max(left, 0) + " " + item.unit + "可借");
    });
    var no = nextBorrowNo();
    getSheet("borrows", true).appendRow(rowFor("borrows", {
      "申請編號": no, "申請時間": new Date(), "學號": "'" + who.student.id, "借用人": safeText(name),
      "信箱": who.email, "借用單位": safeText(unit), "聯絡電話": "'" + phone,
      "開始日期": range.start, "結束日期": range.end,
      "借用物品": items.map(function (i) { return i.name + " × " + i.qty + " " + catalog[i.name].unit; }).join("\n"),
      "用途說明": safeText(purpose), "使用地點": safeText(place), "狀態": BORROW.equipApprove
    }));
    notifyRole("equip", "【應用英語科學會】器材借用申請待審核通知（" + no + "）", {
      title: "器材借用申請待審核",
      intro: "系統收到一筆新的器材借用申請，請進行器材長審核。",
      request: { no: no, unit: unit, name: name, id: who.student.id, start: range.start, end: range.end,
        items: items.map(function (i) { return i.name + " × " + i.qty + " " + catalog[i.name].unit; }).join("\n"),
        place: place, purpose: purpose, phone: phone },
      button: "前往審核"
    });
    return { ok: true, no: no };
  });
}

function borrowCancel(who, input) {
  return withLock(function () {
    var r = findRequest(input.no);
    if (r.email !== who.email) throw new Error("僅能取消本人之申請");
    if ([BORROW.equipApprove, BORROW.presidentApprove].indexOf(r.status) < 0) throw new Error("本申請已核准或已結案，無法取消，請洽器材長");
    setRequest(r, { "狀態": BORROW.cancelled });
    return { ok: true };
  });
}

function borrowAct(who, input) {
  if (!who.officer) throw authError("僅限幹部進行審核", true);
  var act = text(input.act);
  var stamp = who.officer.name + " " + formatDate(new Date(), "yyyy/MM/dd HH:mm");
  return withLock(function () {
    var r = findRequest(input.no);
    if (act === "approve") {
      if (r.status === BORROW.equipApprove) {
        if (!who.roles.equip) throw new Error("此階段須由器材長審核");
        var left = shortages(r);
        if (left) throw new Error(left);
        setRequest(r, { "狀態": BORROW.presidentApprove, "器材長審核": "同意（" + stamp + "）" });
        notifyRole("president", "【應用英語科學會】器材借用申請待會長核定通知（" + r.no + "）", {
          title: "器材借用申請待會長核定",
          intro: "以下申請已經器材長審核同意，請進行會長核定。",
          request: r,
          button: "前往審核"
        });
      } else if (r.status === BORROW.presidentApprove) {
        if (!who.roles.president) throw new Error("此階段須由會長審核");
        setRequest(r, { "狀態": BORROW.approved, "會長審核": "同意（" + stamp + "）" });
        mailApplicant(r, "【應用英語科學會】器材借用申請核准通知（" + r.no + "）", {
          title: "器材借用申請已核准",
          tone: "ok",
          intro: "您的器材借用申請已通過審核。請於借用期間開始時，至科學會辦公室（A717）領取器材。",
          note: "領取時請與承辦人員當面清點器材；器材若有遺失或損壞，需照價賠償。"
        });
      } else {
        throw new Error("本申請目前狀態為「" + r.status + "」，無法核准");
      }
    } else if (act === "reject") {
      if ([BORROW.equipApprove, BORROW.presidentApprove].indexOf(r.status) < 0) throw new Error("本申請目前狀態為「" + r.status + "」，無法退回");
      if (r.status === BORROW.equipApprove && !who.roles.equip) throw new Error("此階段須由器材長審核");
      if (r.status === BORROW.presidentApprove && !who.roles.president) throw new Error("此階段須由會長審核");
      var reason = text(input.reason).slice(0, 200);
      if (!reason) throw new Error("請填寫退回原因");
      var column = r.status === BORROW.equipApprove ? "器材長審核" : "會長審核";
      var change = { "狀態": BORROW.rejected, "退回原因": safeText(reason) };
      change[column] = "退回（" + stamp + "）";
      setRequest(r, change);
      mailApplicant(r, "【應用英語科學會】器材借用申請退回通知（" + r.no + "）", {
        title: "器材借用申請已退回",
        tone: "warn",
        intro: "很抱歉，您的器材借用申請未通過審核。",
        extra: [["退回原因", reason]],
        note: "如有疑問，請洽應用英語科學會器材長。"
      });
    } else if (act === "lend") {
      if (r.status !== BORROW.approved) throw new Error("申請核准後方可登記借出");
      setRequest(r, { "狀態": BORROW.lent, "借出紀錄": stamp });
    } else if (act === "return") {
      if (r.status !== BORROW.lent) throw new Error("器材借出後方可登記歸還");
      setRequest(r, { "狀態": BORROW.returned, "歸還驗收": stamp, "歸還備註": safeText(text(input.note).slice(0, 200)) });
      mailApplicant(r, "【應用英語科學會】器材歸還完成通知（" + r.no + "）", {
        title: "器材歸還完成",
        tone: "ok",
        intro: "您借用的器材已完成歸還驗收，感謝您的配合。",
        extra: text(input.note) ? [["驗收備註", text(input.note)]] : []
      });
    } else {
      throw new Error("不支援此操作");
    }
    return { ok: true };
  });
}

// 核准前再確認一次數量（扣掉這筆自己）。
function shortages(r) {
  var catalog = {};
  equipmentList().forEach(function (item) { catalog[item.name] = item; });
  var problems = parseItems(r.items).filter(function (i) {
    var item = catalog[i.name];
    return !item || i.qty > item.total - bookedQuantity(i.name, r.start, r.end, r.no);
  }).map(function (i) { return i.name; });
  return problems.length ? "本期間數量不足：" + problems.join("、") : "";
}

function equipmentList() {
  return readTable("equipment").filter(function (r) {
    return text(r["器材名稱"]) && text(r["可借用"]) !== "否";
  }).map(function (r) {
    return { name: text(r["器材名稱"]), total: Number(r["數量"]) || 0, unit: text(r["單位"]) || "個", note: text(r["備註"]) };
  });
}

// 期間重疊、還在進行中的申請，總共借走多少。
function bookedQuantity(name, start, end, exceptNo) {
  return borrowRequests().filter(function (r) {
    return BORROW_ACTIVE.indexOf(r.status) >= 0 && r.no !== exceptNo && r.start <= end && start <= r.end;
  }).reduce(function (sum, r) {
    return sum + parseItems(r.items).filter(function (i) { return i.name === name; })
      .reduce(function (s, i) { return s + i.qty; }, 0);
  }, 0);
}

// 「麥克風 × 2 支」一行一項。
function parseItems(value) {
  return text(value).split("\n").map(function (line) {
    var match = /^(.*?)\s*×\s*(\d+)/.exec(line);
    return match ? { name: match[1].trim(), qty: Number(match[2]) } : null;
  }).filter(Boolean);
}

function borrowRequests() {
  return readTable("borrows").filter(function (r) { return text(r["申請編號"]); }).map(function (r) {
    return {
      row: r._row, no: text(r["申請編號"]), created: dateText(r["申請時間"]),
      id: idOf(r["學號"]), name: text(r["借用人"]), email: text(r["信箱"]).toLowerCase(),
      unit: text(r["借用單位"]), phone: text(r["聯絡電話"]).replace(/^'/, ""),
      start: dayText(r["開始日期"]), end: dayText(r["結束日期"]),
      items: text(r["借用物品"]), purpose: text(r["用途說明"]), place: text(r["使用地點"]),
      status: text(r["狀態"]), equip: text(r["器材長審核"]), president: text(r["會長審核"]),
      reason: text(r["退回原因"]), lent: text(r["借出紀錄"]), returned: text(r["歸還驗收"]), returnNote: text(r["歸還備註"])
    };
  });
}

function publicRequest(r) {
  var copy = {};
  Object.keys(r).forEach(function (k) { if (k !== "row") copy[k] = r[k]; });
  return copy;
}

function findRequest(no) {
  var r = borrowRequests().filter(function (x) { return x.no === text(no); })[0];
  if (!r) throw new Error("查無此申請");
  return r;
}

function setRequest(r, values) {
  var sheet = getSheet("borrows");
  var header = headerOf(sheet);
  Object.keys(values).forEach(function (h) {
    var col = header.indexOf(h);
    if (col >= 0) sheet.getRange(r.row, col + 1).setValue(values[h]);
  });
}

// 申請編號：B + 日期 + 流水號，例如 B1115-01（11 月 15 日第 1 筆）。
function nextBorrowNo() {
  var prefix = "B" + formatDate(new Date(), "MMdd") + "-";
  var max = 0;
  borrowRequests().forEach(function (r) {
    if (r.no.indexOf(prefix) === 0) max = Math.max(max, Number(r.no.slice(prefix.length)) || 0);
  });
  return prefix + String(max + 1).padStart(2, "0");
}

function notifyRole(role, subject, mail) {
  readTable("officers").forEach(function (r) {
    var title = text(r["職稱"]);
    var match = role === "equip" ? title.indexOf("器材") >= 0 : title === "會長";
    if (!match || !text(r["Gmail"])) return;
    sendMail(text(r["Gmail"]), subject, merge({ greeting: (text(r["姓名"]) || "幹部") + " 您好：", officer: true }, mail));
  });
}

function mailApplicant(r, subject, mail) {
  sendMail(r.email, subject, merge({ greeting: r.name + " 同學您好：", request: r, button: "查看申請進度" }, mail));
}

function merge(base, extra) {
  Object.keys(extra).forEach(function (k) { base[k] = extra[k]; });
  return base;
}

// ── 通知信版面 ──
// 同一份內容產生 HTML 版（排版過的卡片）和純文字版（收信軟體不支援 HTML 時使用）。

var MAIL_URL = "https://szenglish.github.io/borrow.html";
var MAIL_LOGO = "https://szenglish.github.io/assets/images/logo-email.png";

function mailRows(mail) {
  var r = mail.request || {};
  var rows = [
    ["申請編號", r.no],
    ["借用單位", r.unit],
    ["借用人", r.name ? r.name + (r.id ? "（學號 " + r.id + "）" : "") : ""],
    ["借用期間", r.start && r.end ? r.start + " 至 " + r.end : ""],
    ["借用物品", r.items],
    ["使用地點", r.place]
  ];
  if (mail.officer) rows.push(["用途說明", r.purpose], ["聯絡電話", r.phone]);
  return rows.concat(mail.extra || []).filter(function (row) { return text(row[1]); });
}

function mailText(mail) {
  var lines = [mail.greeting, "", mail.intro, ""];
  mailRows(mail).forEach(function (row) {
    var value = text(row[1]);
    lines.push(value.indexOf("\n") >= 0 ? row[0] + "：\n  " + value.split("\n").join("\n  ") : row[0] + "：" + value);
  });
  if (mail.note) lines.push("", mail.note);
  lines.push("", (mail.button || "查看") + "：" + (mail.url || MAIL_URL), "", "樹人醫專應用英語科學會", "（本信由系統自動發送，請勿直接回覆）");
  return lines.join("\n");
}

function mailHtml(mail) {
  var accent = { ok: "#1f6f43", warn: "#8b1a20" }[mail.tone] || "#1d2a44";
  var font = "'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  var rows = mailRows(mail).map(function (row) {
    var value = htmlEscape(text(row[1])).replace(/\n/g, "<br>");
    return '<tr><td style="padding:10px 0;border-bottom:1px solid #e5e1d8;color:#6b6b6b;font-size:14px;line-height:1.85;width:84px;vertical-align:top;white-space:nowrap">' +
      htmlEscape(row[0]) + '</td><td style="padding:10px 0 10px 12px;border-bottom:1px solid #e5e1d8;color:#1d2a44;font-size:15px;line-height:1.7;vertical-align:top">' +
      value + "</td></tr>";
  }).join("");
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f4f1ea">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:24px 12px;font-family:' + font + '">' +
    '<tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e1d8">' +
    '<tr><td style="background:#8b1a20;padding:16px 24px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="vertical-align:middle"><img src="' + MAIL_LOGO + '" width="163" height="48" alt="樹人醫專應用英語科學會" style="display:block;border:0;width:163px;height:48px;color:#ffffff;font-size:15px;font-weight:700"></td>' +
    '<td align="right" style="vertical-align:middle;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.08em;white-space:nowrap">' + htmlEscape(mail.label || "器材借用通知") + '</td>' +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:28px 24px 8px">' +
    '<p style="margin:0;font-size:22px;font-weight:900;color:' + accent + '">' + htmlEscape(mail.title) + "</p>" +
    '<p style="margin:16px 0 4px;font-size:15px;color:#1d2a44">' + htmlEscape(mail.greeting) + "</p>" +
    '<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#1d2a44">' + htmlEscape(mail.intro) + "</p>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e1d8">' + rows + "</table>" +
    (mail.note ? '<p style="margin:18px 0 0;padding:12px 14px;background:#f4f1ea;font-size:14px;line-height:1.7;color:#1d2a44">' + htmlEscape(mail.note) + "</p>" : "") +
    '<p style="margin:24px 0 8px"><a href="' + htmlEscape(mail.url || MAIL_URL) + '" style="display:inline-block;padding:12px 22px;background:#1d2a44;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px">' +
    htmlEscape(mail.button || "查看") + "</a></p></td></tr>" +
    '<tr><td style="padding:18px 24px 22px;color:#8a8a8a;font-size:12px;line-height:1.7;border-top:1px solid #e5e1d8">樹人醫專應用英語科學會<br>本信由系統自動發送，請勿直接回覆。</td></tr>' +
    "</table></td></tr></table></body></html>";
}

function htmlEscape(value) {
  return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 寄信失敗（例如超過每日額度）不影響審核結果。
// 「設定」分頁的「測試模式」為「是」時，所有信件改寄給職稱「開發者」的人，主旨標出原本的收件人。
function sendMail(to, subject, mail) {
  try {
    if (readSettings().testMode) {
      var developers = readTable("officers").filter(function (r) {
        return text(r["職稱"]) === "開發者" && text(r["Gmail"]);
      }).map(function (r) { return text(r["Gmail"]); });
      if (!developers.length) return;
      subject = "[測試模式] " + subject + "｜原收件人：" + to;
      to = developers.join(",");
    }
    MailApp.sendEmail({ to: to, subject: subject, body: mailText(mail), htmlBody: mailHtml(mail), name: "應用英語科學會" });
  } catch (err) {
    console.error("寄信失敗", to, err);
  }
}

function dateRange(start, end) {
  var s = dayText(start);
  var e = dayText(end);
  if (!s || !e) throw new Error("請選擇借用期間");
  if (e < s) throw new Error("結束日期不得早於開始日期");
  return { start: s, end: e };
}

// 日期統一成 yyyy/MM/dd，方便比較。
function dayText(value) {
  if (value instanceof Date) return formatDate(value, "yyyy/MM/dd");
  var match = /^(\d{4})\D(\d{1,2})\D(\d{1,2})/.exec(text(value));
  if (!match) return "";
  return match[1] + "/" + ("0" + match[2]).slice(-2) + "/" + ("0" + match[3]).slice(-2);
}

function today() {
  return formatDate(new Date(), "yyyy/MM/dd");
}

function addDays(day, n) {
  var parts = day.split("/");
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + n, 12);
  return d.getFullYear() + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + ("0" + d.getDate()).slice(-2);
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
  return {
    year: parseInt(text(map["目前學年"]), 10) || 0,
    fee: Number(map["會費金額"]) || 0,
    testMode: text(map["測試模式"]) === "是"
  };
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
