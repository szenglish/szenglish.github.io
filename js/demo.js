// 示範模式：網址加上 ?demo=1 時，用假的名單在手機上模擬 Apps Script，
// 不會連到試算表，也沒有真實學生資料。資料只存在這支手機的瀏覽器裡。
(function () {
  if (!/[?&]demo=1(&|$)/.test(location.search)) return;

  var STORE_KEY = "szae-demo-v2";
  var DEMO_URL = "https://demo.invalid/exec";
  var OFFICER = { name: "示範幹部", email: "demo@example.com" };
  var config = window.SZAE_CONFIG;
  config.demo = true;
  config.paycheckUrl = DEMO_URL;
  config.googleClientId = "demo";

  // ── 假名單：固定的亂數種子，每次產生一樣的名字 ──

  var SURNAMES = "陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周徐蘇葉莊呂江何蕭羅高";
  var GIVEN = "怡婷雅涵宇軒家豪筱萱子晴品妤冠廷柏翰詩涵佳穎承恩宥辰語彤芷瑜俊傑思妤彥廷欣妍立安";

  function makeRoster() {
    var seed = 20261114;
    function rand(n) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    }
    var members = [];
    [13, 12, 11, 10].forEach(function (year) {
      for (var seat = 1; seat <= (year === 10 ? 20 : 40); seat++) {
        var name = SURNAMES.charAt(rand(SURNAMES.length)) + GIVEN.charAt(rand(GIVEN.length)) + GIVEN.charAt(rand(GIVEN.length));
        members.push({ id: "5" + year + "06" + String(seat).padStart(3, "0"), name: name, className: "", entry: 100 + year });
      }
    });
    return { members: members, seed: rand };
  }

  function freshState() {
    var made = makeRoster();
    var state = { year: 115, fee: 1000, members: made.members, payments: [] };
    // 先放一些以前入會時就繳過的紀錄，和幾筆今天別的幹部收的，畫面比較像實際情況。
    made.members.forEach(function (m) {
      if (made.seed(10) < 4) {
        state.payments.push(payment(state, m, "舊系統", "", new Date(1911 + m.entry, 8, 20), m.entry));
      }
    });
    var start = Date.now() - 2 * 3600 * 1000;
    made.members.filter(function (m) { return m.entry === 113 && !state.payments.some(function (p) { return p.id === m.id; }); })
      .slice(0, 3).forEach(function (m, i) {
        state.payments.push(payment(state, m, i % 2 ? "示範幹部B" : "示範幹部C", "other@example.com", new Date(start + i * 600000)));
      });
    return state;
  }

  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && saved.members) return saved;
    } catch (err) { /* 無痕模式或資料損壞，就重新產生 */ }
    return freshState();
  }

  var db = load();

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (err) { /* 存不了就只留在這一頁 */ }
  }

  // ── 模擬 Code.gs 的行為 ──

  function pad(n) { return String(n).padStart(2, "0"); }
  function dateText(d) { return d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()); }
  function timeText(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  function nextReceipt(state, year) {
    var prefix = year + "-";
    var max = 0;
    state.payments.forEach(function (p) {
      if (p.receipt.indexOf(prefix) === 0) max = Math.max(max, Number(p.receipt.slice(prefix.length)) || 0);
    });
    return prefix + String(max + 1).padStart(3, "0");
  }

  function payment(state, member, handler, email, when, year) {
    year = year || state.year;
    return {
      time: when.getTime(), year: year, id: member.id, name: member.name, amount: state.fee,
      receipt: nextReceipt(state, year), handler: handler, email: email, void: false
    };
  }

  // 會費入會時繳一次，五年有效，所以看全部的收款紀錄。
  function current() {
    return db.payments;
  }

  function graduated(member) {
    return Boolean(member && member.entry && db.year - member.entry >= 5);
  }

  function validPayment(id) {
    return current().filter(function (p) { return p.id === id && !p.void; })[0];
  }

  function publicPayment(p) {
    var d = new Date(p.time);
    return { receipt: p.receipt, date: dateText(d), time: timeText(d), handler: p.handler };
  }

  function findMember(id) {
    return db.members.filter(function (m) { return m.id === id; })[0];
  }

  function maskName(name) {
    if (name.length <= 1) return name;
    if (name.length === 2) return name.charAt(0) + "○";
    return name.charAt(0) + new Array(name.length - 1).join("○") + name.charAt(name.length - 1);
  }

  var ACTIONS = {
    paycheck: function (input) {
      var id = String(input.id || "").trim();
      if (!/^\d{5,10}$/.test(id)) return { ok: false, error: "學號格式不正確" };
      var m = findMember(id);
      var p = validPayment(id);
      if (!m && !p) return { ok: true, found: false };
      var pub = p ? publicPayment(p) : null;
      return { ok: true, found: true, name: maskName((m || p).name), paid: Boolean(p), graduated: graduated(m),
        receipt: pub ? pub.receipt : "", paidAt: pub ? pub.date : "", handler: pub ? pub.handler : "" };
    },
    me: function () {
      return { ok: true, officer: OFFICER.name, email: OFFICER.email, year: db.year, fee: db.fee };
    },
    roster: function () {
      var paid = {};
      current().forEach(function (p) { if (!p.void) paid[p.id] = publicPayment(p); });
      return { ok: true, year: db.year, fee: db.fee, members: db.members, paid: paid };
    },
    lookup: function (input) {
      var m = findMember(input.id);
      var p = validPayment(input.id);
      return { ok: true, id: input.id, year: db.year, fee: db.fee, member: m || null, payment: p ? publicPayment(p) : null };
    },
    pay: function (input) {
      var existing = validPayment(input.id);
      if (existing) return { ok: false, error: "這位同學已經繳過會費了", payment: publicPayment(existing) };
      var m = findMember(input.id);
      if (!m) {
        if (!String(input.name || "").trim()) return { ok: false, error: "名冊裡沒有這個學號，請填寫姓名" };
        var match = /^5(\d{2})\d{5}$/.exec(input.id);
        m = { id: input.id, name: String(input.name).trim(), className: String(input.className || "").trim(), entry: match ? 100 + Number(match[1]) : db.year };
        db.members.push(m);
      }
      var p = payment(db, m, OFFICER.name, OFFICER.email, new Date());
      db.payments.push(p);
      save();
      return { ok: true, id: m.id, name: m.name, receipt: p.receipt, amount: p.amount, time: timeText(new Date(p.time)) };
    },
    "void": function (input) {
      var target = current().filter(function (p) { return p.receipt === input.receipt; })[0];
      if (!target) return { ok: false, error: "找不到這張收據" };
      if (target.void) return { ok: false, error: "這張收據已經作廢了" };
      if (!String(input.reason || "").trim()) return { ok: false, error: "請填寫作廢原因" };
      target.void = true;
      target.reason = input.reason;
      save();
      return { ok: true };
    },
    today: function () {
      var today = dateText(new Date());
      var items = current().filter(function (p) { return dateText(new Date(p.time)) === today; }).reverse();
      var valid = items.filter(function (p) { return !p.void; });
      var mine = valid.filter(function (p) { return p.email === OFFICER.email; });
      function sum(list) { return list.reduce(function (t, p) { return t + p.amount; }, 0); }
      return {
        ok: true, year: db.year,
        total: { count: valid.length, amount: sum(valid) },
        mine: { count: mine.length, amount: sum(mine) },
        items: items.map(function (p) {
          var item = publicPayment(p);
          item.id = p.id; item.name = p.name; item.amount = p.amount; item.void = p.void; item.mine = p.email === OFFICER.email;
          return item;
        })
      };
    }
  };

  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, options) {
    if (String(url).indexOf(DEMO_URL) !== 0) return realFetch(url, options);
    var input = options && options.body ? JSON.parse(options.body) : {};
    if (!input.action) {
      var params = new URL(url).searchParams;
      input = { action: params.get("action"), id: params.get("id") };
    }
    var handler = ACTIONS[input.action];
    var data = handler ? handler(input) : { ok: false, error: "不支援的操作" };
    // 稍微延遲，模擬實際連線到試算表的等待時間。
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(JSON.stringify(data))); } });
      }, input.action === "pay" || input.action === "void" ? 700 : 300);
    });
  };

  // ── 頁面上方的示範提示 ──

  function banner() {
    var box = document.createElement("div");
    box.className = "demo-banner";
    box.setAttribute("role", "note");
    var text = document.createElement("p");
    text.innerHTML = "<strong>示範模式</strong>：名單是假的，不會寫進試算表。可以試學號 <b>51306001</b>、<b>51206010</b>，或新學號 <b>51499999</b>。";
    var reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "重設";
    reset.addEventListener("click", function () {
      if (!confirm("清除示範資料，回到一開始的樣子？")) return;
      try { localStorage.removeItem(STORE_KEY); } catch (err) { /* 沒有存過 */ }
      try { sessionStorage.removeItem("szae-collect-token"); } catch (err) { /* 同上 */ }
      location.reload();
    });
    box.appendChild(text);
    box.appendChild(reset);
    document.body.insertBefore(box, document.body.firstChild);
  }

  if (document.body) banner();
  else document.addEventListener("DOMContentLoaded", banner);
})();
