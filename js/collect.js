// 幹部收費頁：用 Google 登入，把收款寫進試算表。權限由 Apps Script 比對「幹部」分頁決定。
// 登入後先把名冊下載到手機，查學號、找姓名、看班級都不用等網路；只有收款和復原會送到試算表。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var TOKEN_KEY = "szae-collect-token";
  var SCANNER_SRC = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";
  var UNDO_SECONDS = 10;
  var REFRESH_MS = 60000;
  var ID_PATTERN = /^\d{5,10}$/;
  var GRADES = ["一", "二", "三", "四", "五"];

  var token = null;
  var refreshTimer = null;
  var state = {
    officer: "", year: 0, fee: 0, loaded: false,
    members: {}, paid: {}, pending: {},
    mode: "id", selected: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var signin = $("collect-signin");
  var app = $("collect-app");
  var idForm = $("id-form");
  var idInput = $("collect-id");
  var idError = $("collect-error");
  var nameInput = $("collect-name");
  var classSelect = $("collect-class");
  var unpaidOnly = $("unpaid-only");
  var result = $("collect-result");
  var people = $("collect-list");

  function replace(target, nodes) {
    target.textContent = "";
    nodes.forEach(function (node) { if (node) target.appendChild(node); });
  }

  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  function money(n) { return "NT$" + Number(n || 0).toLocaleString("en-US"); }

  function digitsOnly(value) {
    return value.replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/\D/g, "");
  }

  // ── 登入 ──

  function tokenExpiry(jwt) {
    try {
      var payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.exp * 1000;
    } catch (err) {
      return 0;
    }
  }

  function saveToken(value) {
    token = value;
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (err) { /* 無痕模式可能不能存，重新整理後再登入一次即可 */ }
  }

  function loadToken() {
    try {
      var saved = sessionStorage.getItem(TOKEN_KEY);
      if (saved && tokenExpiry(saved) > Date.now() + 60000) return saved;
    } catch (err) { /* 同上 */ }
    return null;
  }

  function showSignin(message) {
    saveToken(null);
    clearInterval(refreshTimer);
    stopScanner();
    app.hidden = true;
    signin.hidden = false;
    $("collect-term").textContent = "登入後開始收費";
    $("signin-message").className = "form-message" + (message ? " is-error" : "");
    $("signin-message").textContent = message || "";
  }

  function setupGoogle() {
    // 示範模式（網址加 ?demo=1）不用 Google 登入，直接以示範幹部身分使用。
    if (S.config.demo) {
      var demo = el("button", { class: "collect-demo-login", type: "button", text: "以示範幹部身分登入" });
      demo.addEventListener("click", function () { start("demo"); });
      replace($("signin-button"), [demo]);
      return;
    }
    if (!S.config.googleClientId || !S.config.paycheckUrl) {
      showSignin("網站還沒有設定 googleClientId 或 paycheckUrl，請參考 README 的設定步驟。");
      return;
    }
    if (!window.google || !google.accounts) {
      setTimeout(setupGoogle, 200);
      return;
    }
    google.accounts.id.initialize({
      client_id: S.config.googleClientId,
      callback: function (response) { start(response.credential); },
      auto_select: true,
      use_fedcm_for_prompt: true
    });
    google.accounts.id.renderButton($("signin-button"), {
      theme: "filled_black", size: "large", shape: "rectangular", text: "signin_with", locale: "zh-TW", width: 280
    });
    if (!token) google.accounts.id.prompt();
  }

  function api(body) {
    body.token = token;
    return fetch(S.config.paycheckUrl, {
      method: "POST",
      // 用 text/plain 才不會觸發 Apps Script 不支援的跨網域預檢。
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json();
    }).then(function (data) {
      if (data.auth || data.denied) {
        showSignin(data.error);
        if (data.denied && window.google) google.accounts.id.disableAutoSelect();
        throw Object.assign(new Error(data.error), { handled: true });
      }
      return data;
    });
  }

  function start(credential) {
    saveToken(credential);
    $("signin-message").className = "form-message";
    $("signin-message").textContent = "登入中…";
    api({ action: "me" }).then(function (me) {
      if (!me.ok) throw new Error(me.error);
      state.officer = me.officer;
      $("officer-name").textContent = me.officer;
      setYear(me.year, me.fee);
      signin.hidden = true;
      app.hidden = false;
      setMode(state.mode);
      loadRoster();
      loadToday();
      clearInterval(refreshTimer);
      refreshTimer = setInterval(loadRoster, REFRESH_MS);
    }).catch(function (err) {
      if (!err.handled) showSignin("登入失敗：" + err.message);
    });
  }

  function setYear(year, fee) {
    state.year = year;
    state.fee = fee;
    $("collect-term").textContent = year + " 學年・" + money(fee);
  }

  $("signout").addEventListener("click", function () {
    if (!confirm("要登出 " + state.officer + " 嗎？")) return;
    if (window.google) google.accounts.id.disableAutoSelect();
    state.selected = null;
    render();
    showSignin("");
  });

  // ── 名冊（存在手機上，每分鐘和試算表同步一次） ──

  function loadRoster() {
    return api({ action: "roster" }).then(function (data) {
      if (!data.ok) throw new Error(data.error);
      setYear(data.year, data.fee);
      var members = {};
      data.members.forEach(function (m) { members[m.id] = m; });
      state.members = members;
      state.paid = data.paid;
      state.loaded = true;
      fillClasses();
      render();
    }).catch(function (err) {
      if (!err.handled && !state.loaded) toast({ kind: "error", text: "名冊載入失敗：" + err.message, action: { label: "重試", run: loadRoster } });
    });
  }

  // 入學年由 Apps Script 依學號推算（例如 51106069 是 111 學年入學）。
  function entryOf(member) {
    if (member.entry) return member.entry;
    var match = /^5(\d{2})\d{5}$/.exec(member.id);
    return match ? 100 + Number(match[1]) : 0;
  }

  // 五專讀五年：入學年加 5 以後就算畢業。
  function isGraduated(member) {
    var entry = member ? entryOf(member) : 0;
    return Boolean(entry && state.year && state.year - entry >= 5);
  }

  // 有填「班級」就用班級；沒填的話，依入學年分成一到五年級，已畢業的排在最後。
  function groupOf(member) {
    if (member.className) return { key: "0" + member.className, label: member.className };
    var entry = entryOf(member);
    if (!entry) return { key: "9", label: "其他學號" };
    if (isGraduated(member)) return { key: "8" + (999 - entry), label: "已畢業（" + entry + " 入學）" };
    var grade = state.year - entry + 1;
    var label = grade >= 1 && grade <= 5 ? GRADES[grade - 1] + "年級（" + entry + " 入學）" : entry + " 入學";
    return { key: "1" + (999 - entry), label: label };
  }

  function statusOf(id) {
    if (state.paid[id]) return "paid";
    if (state.pending[id]) return "pending";
    return "unpaid";
  }

  function fillClasses() {
    var groups = {};
    Object.keys(state.members).forEach(function (id) {
      var g = groupOf(state.members[id]);
      groups[g.key] = groups[g.key] || { label: g.label, total: 0, unpaid: 0 };
      groups[g.key].total += 1;
      if (statusOf(id) === "unpaid") groups[g.key].unpaid += 1;
    });
    var current = classSelect.value;
    replace(classSelect, Object.keys(groups).sort().map(function (key) {
      var g = groups[key];
      var option = el("option", { value: g.label, text: g.label + "・未繳 " + g.unpaid + "／" + g.total });
      if (g.label === current) option.selected = true;
      return option;
    }));
  }

  // ── 收款與復原 ──

  function collect(id, extra) {
    if (state.paid[id] || state.pending[id]) return;
    extra = extra || {};
    var member = state.members[id] || { id: id, name: extra.name, className: extra.className || "" };
    state.pending[id] = true;
    var note = toast({ kind: "pending", text: member.name + " 登記中…" });
    afterCollect();

    api({ action: "pay", id: id, name: extra.name || "", className: extra.className || "" }).then(function (res) {
      delete state.pending[id];
      if (!res.ok && res.payment) {
        state.paid[id] = res.payment;
        note.update({ kind: "warn", text: member.name + " 已經繳過會費了", sub: "經手人 " + res.payment.handler + "，請不要重複收費。", timeout: 8 });
        render();
        return;
      }
      if (!res.ok) throw new Error(res.error);
      if (!state.members[id]) state.members[id] = member;
      state.paid[id] = { receipt: res.receipt, handler: state.officer, time: res.time };
      note.update({
        kind: "ok",
        text: res.name + " 收款完成",
        sub: money(res.amount) + "・" + res.receipt,
        action: { label: "復原", run: function () { undo(id, res.receipt, res.name); } },
        timeout: UNDO_SECONDS
      });
      render();
      loadToday();
    }).catch(function (err) {
      delete state.pending[id];
      render();
      if (err.handled) { note.remove(); return; }
      note.update({ kind: "error", text: member.name + " 登記失敗，這筆還沒有記錄", sub: err.message, action: { label: "重試", run: function () { collect(id, extra); } } });
    });
  }

  function undo(id, receipt, name) {
    var note = toast({ kind: "pending", text: "復原 " + name + "…" });
    api({ action: "void", receipt: receipt, reason: "按錯復原" }).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      delete state.paid[id];
      note.update({ kind: "info", text: name + " 已復原，這筆不算收款", timeout: 4 });
      render();
      loadToday();
    }).catch(function (err) {
      if (err.handled) { note.remove(); return; }
      note.update({ kind: "error", text: "復原失敗：" + err.message, sub: "可以到下方「今日收款」按作廢。" });
    });
  }

  // 收款送出後馬上準備下一位，不用等試算表回應。
  function afterCollect() {
    if (state.mode === "id") {
      idInput.value = "";
      state.selected = null;
      idInput.focus();
    } else if (state.mode === "scan") {
      resumeScanner();
    } else if (state.mode === "name") {
      nameInput.value = "";
      nameInput.focus();
    }
    render();
  }

  // ── 畫面 ──

  function select(id) {
    state.selected = id;
    render();
    var focus = result.querySelector("#new-name") || result.querySelector(".collect-pay");
    if (focus) focus.focus();
  }

  function badge(id) {
    var status = statusOf(id);
    var text = { paid: "已繳費", pending: "登記中…", unpaid: "未繳費" }[status];
    return el("span", { class: "collect-chip is-" + status }, [status === "paid" ? icon("check") : null, document.createTextNode(text)]);
  }

  function personCard(id) {
    var member = state.members[id];
    var payment = state.paid[id];
    var status = statusOf(id);
    if (!member && !payment) return newMemberCard(id);
    var name = member ? member.name : "";
    var pay = null;
    if (status === "unpaid") {
      pay = el("button", { class: "button button-navy collect-pay", type: "button", text: "收款 " + money(state.fee) });
      pay.addEventListener("click", function () { collect(id); });
    }
    return el("div", { class: "paycheck-card " + { paid: "is-paid", pending: "is-other", unpaid: "is-unpaid" }[status] }, [
      el("div", { class: "paycheck-card-head" }, [
        el("div", {}, [
          el("p", { class: "paycheck-card-id", text: id }),
          el("p", { class: "paycheck-card-name", text: name }),
          member ? el("p", { class: "paycheck-card-text", text: groupOf(member).label }) : null
        ]),
        badge(id)
      ]),
      payment ? el("dl", { class: "paycheck-details" }, [
        el("div", {}, [el("dt", { text: "經手人" }), el("dd", { text: payment.handler })]),
        el("div", {}, [el("dt", { text: "時間" }), el("dd", { text: ((payment.date || "") + " " + (payment.time || "")).trim() })])
      ]) : null,
      status === "unpaid" && isGraduated(member)
        ? el("p", { class: "collect-warning", text: "依學號推算已經畢業。延畢的同學一樣可以收款。" })
        : null,
      pay,
      state.mode === "scan" ? scanAgainButton() : null
    ]);
  }

  function newMemberCard(id) {
    var name = el("input", { id: "new-name", type: "text", maxlength: "30", autocomplete: "off", placeholder: "例如 王小明" });
    var className = el("input", { id: "new-class", type: "text", maxlength: "30", autocomplete: "off", placeholder: "例如 應英一忠（可不填）" });
    var pay = el("button", { class: "button button-navy collect-pay", type: "button", text: "新增並收款 " + money(state.fee) });
    var note = el("p", { class: "form-message", role: "status" });
    pay.addEventListener("click", function () {
      if (!name.value.trim()) {
        note.className = "form-message is-error";
        note.textContent = "請填寫姓名。";
        name.focus();
        return;
      }
      collect(id, { name: name.value.trim(), className: className.value.trim() });
    });
    return el("div", { class: "paycheck-card is-other" }, [
      el("div", { class: "paycheck-card-head" }, [
        el("div", {}, [
          el("p", { class: "paycheck-card-id", text: id }),
          el("p", { class: "paycheck-card-name", text: "新會員" })
        ]),
        el("span", { class: "collect-chip is-new", text: "名冊沒有" })
      ]),
      el("div", { class: "collect-new" }, [
        el("div", { class: "field" }, [el("label", { for: "new-name", text: "姓名" }), name]),
        el("div", { class: "field" }, [el("label", { for: "new-class", text: "班級" }), className])
      ]),
      pay,
      note,
      state.mode === "scan" ? scanAgainButton() : null
    ]);
  }

  function scanAgainButton() {
    var button = el("button", { class: "text-button collect-again", type: "button", text: "繼續掃描下一位" });
    button.addEventListener("click", resumeScanner);
    return button;
  }

  // 名單的一列：右邊直接放「收款」按鈕，一按就收。
  function personRow(member) {
    var status = statusOf(member.id);
    var right;
    if (status === "unpaid") {
      right = el("button", { class: "button button-navy collect-row-pay", type: "button", text: "收款" });
      right.addEventListener("click", function () { collect(member.id); });
    } else {
      right = el("span", { class: "collect-chip is-" + status }, [status === "paid" ? icon("check") : null, document.createTextNode(status === "paid" ? "已繳" : "登記中…")]);
    }
    return el("li", { class: "is-" + status }, [
      el("div", { class: "collect-row-main" }, [
        el("p", { class: "collect-row-name", text: member.name }),
        el("p", { class: "collect-row-meta", text: member.id + (state.mode === "name" ? "・" + groupOf(member).label : "") })
      ]),
      right
    ]);
  }

  function render() {
    fillClasses();
    // 掃到人之後先收起相機畫面，收款按鈕才不會被擠到螢幕外。
    document.querySelector("[data-panel=scan]").classList.toggle("has-result", Boolean(state.selected));
    var nodes = [];
    if (state.selected && (state.mode === "id" || state.mode === "scan")) {
      nodes.push(state.loaded ? personCard(state.selected) : el("div", { class: "paycheck-card is-loading", "aria-hidden": "true" }));
    }
    replace(result, nodes);

    var rows = [];
    var all = Object.keys(state.members).map(function (id) { return state.members[id]; });
    if (state.mode === "name") {
      var query = nameInput.value.trim();
      if (query) {
        var matches = all.filter(function (m) { return m.name.indexOf(query) >= 0; }).slice(0, 30);
        rows = matches.length ? matches.map(personRow) : [el("li", { class: "collect-people-empty", text: "名冊裡沒有「" + query + "」，可以改用學號新增。" })];
      }
    } else if (state.mode === "class" && classSelect.value) {
      var members = all.filter(function (m) {
        return groupOf(m).label === classSelect.value && (!unpaidOnly.checked || statusOf(m.id) !== "paid");
      }).sort(function (a, b) { return a.id.localeCompare(b.id); });
      rows = members.length ? members.map(personRow) : [el("li", { class: "collect-people-empty", text: "這一班都繳完了。" })];
    }
    if (!state.loaded && (state.mode === "name" || state.mode === "class")) {
      rows = [el("li", { class: "collect-people-empty", text: "名冊載入中…" })];
    }
    replace(people, rows);
  }

  // ── 找人的方式 ──

  function setMode(mode) {
    state.mode = mode;
    state.selected = null;
    document.querySelectorAll(".collect-tabs [data-mode]").forEach(function (tab) {
      tab.setAttribute("aria-selected", String(tab.getAttribute("data-mode") === mode));
    });
    document.querySelectorAll(".collect-mode").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-panel") !== mode;
    });
    if (mode === "scan") startScanner();
    else stopScanner();
    render();
    window.scrollTo({ top: 0 });
    if (mode === "id") idInput.focus();
    if (mode === "name") nameInput.focus();
  }

  document.querySelectorAll(".collect-tabs [data-mode]").forEach(function (tab) {
    tab.addEventListener("click", function () { setMode(tab.getAttribute("data-mode")); });
  });

  function setIdHelp(isError) {
    idError.textContent = isError ? "學號是 5 到 10 位數字，請再確認一次。" : "打滿 8 碼會自動查詢。";
    idError.classList.toggle("is-error", isError);
    if (isError) idInput.setAttribute("aria-invalid", "true");
    else idInput.removeAttribute("aria-invalid");
  }

  idInput.addEventListener("input", function () {
    var clean = digitsOnly(idInput.value);
    if (clean !== idInput.value) idInput.value = clean;
    setIdHelp(false);
    // 一般學號是 8 碼，打滿就直接查，不用再按查詢。
    if (clean.length === 8) select(clean);
    else if (state.selected) { state.selected = null; render(); }
  });

  idForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var id = idInput.value.trim();
    if (!ID_PATTERN.test(id)) {
      setIdHelp(true);
      idInput.focus();
      return;
    }
    select(id);
  });

  nameInput.addEventListener("input", render);
  classSelect.addEventListener("change", render);
  unpaidOnly.addEventListener("change", render);

  // ── 掃描學生證條碼 ──

  var scanner = null;
  var lastScan = { id: "", at: 0 };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error("掃描元件載入失敗")); };
      document.head.appendChild(script);
    });
  }

  function scanHint(text, isError) {
    $("scan-hint").textContent = text;
    $("scan-hint").classList.toggle("is-error", Boolean(isError));
  }

  // 條碼內容可能有前後符號，取出其中的學號。
  function idFromBarcode(text) {
    var digits = digitsOnly(String(text));
    if (state.members[digits]) return digits;
    var match = String(text).match(/\d{8}/);
    if (match) return match[0];
    return ID_PATTERN.test(digits) ? digits : null;
  }

  function onScan(text) {
    var id = idFromBarcode(text);
    if (!id) {
      scanHint("讀到的條碼不是學號（" + text + "）。", true);
      return;
    }
    if (state.selected === id || (id === lastScan.id && Date.now() - lastScan.at < 3000)) return;
    lastScan = { id: id, at: Date.now() };
    if (navigator.vibrate) navigator.vibrate(60);
    try { scanner.pause(true); } catch (err) { /* 已經暫停 */ }
    scanHint("把學生證條碼對準框線，掃到後會自動顯示。");
    select(id);
  }

  function startScanner() {
    scanHint("開啟相機中…");
    (window.Html5Qrcode ? Promise.resolve() : loadScript(SCANNER_SRC)).then(function () {
      if (state.mode !== "scan") return null;
      var F = window.Html5QrcodeSupportedFormats;
      if (!scanner) {
        scanner = new Html5Qrcode("scanner", {
          formatsToSupport: [F.CODE_39, F.CODE_128, F.CODABAR, F.ITF, F.EAN_13, F.QR_CODE],
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false
        });
      }
      if (scanner.isScanning) return null;
      return scanner.start({ facingMode: "environment" }, {
        fps: 12,
        qrbox: function (width, height) {
          return { width: Math.floor(width * 0.86), height: Math.floor(Math.min(width, height) * 0.42) };
        }
      }, onScan, function () { /* 這一格沒有讀到條碼，繼續掃 */ });
    }).then(function () {
      if (state.mode === "scan") scanHint("把學生證條碼對準框線，掃到後會自動顯示。");
    }).catch(function (err) {
      scanHint("無法開啟相機：" + (err && err.message ? err.message : err) + "。請在瀏覽器允許使用相機，或改用學號輸入。", true);
    });
  }

  function stopScanner() {
    if (scanner && scanner.isScanning) scanner.stop().catch(function () { /* 已經停止 */ });
  }

  function resumeScanner() {
    state.selected = null;
    render();
    try { if (scanner) scanner.resume(); } catch (err) { /* 沒有暫停 */ }
  }

  // ── 提示訊息（畫面底部） ──

  function toast(options) {
    var box = el("div", { class: "collect-toast", role: "status" });
    var timer = null;
    function draw(opts) {
      clearTimeout(timer);
      box.className = "collect-toast is-" + (opts.kind || "info");
      var action = null;
      if (opts.action) {
        action = el("button", { class: "collect-toast-action", type: "button", text: opts.action.label });
        action.addEventListener("click", function () { remove(); opts.action.run(); });
      }
      replace(box, [
        el("div", { class: "collect-toast-body" }, [
          el("p", { class: "collect-toast-text", text: opts.text }),
          opts.sub ? el("p", { class: "collect-toast-sub", text: opts.sub }) : null
        ]),
        action,
        opts.timeout ? el("span", { class: "collect-toast-timer", style: "animation-duration:" + opts.timeout + "s" }) : null,
        opts.kind === "pending" ? null : closeButton()
      ]);
      if (opts.timeout) timer = setTimeout(remove, opts.timeout * 1000);
    }
    function closeButton() {
      var close = el("button", { class: "collect-toast-close", type: "button", "aria-label": "關閉", text: "×" });
      close.addEventListener("click", remove);
      return close;
    }
    function remove() {
      clearTimeout(timer);
      if (box.parentNode) box.parentNode.removeChild(box);
    }
    draw(options);
    $("toasts").appendChild(box);
    // 最多同時顯示 3 則，較舊的先收起來。
    while ($("toasts").children.length > 3) $("toasts").removeChild($("toasts").firstChild);
    return { update: draw, remove: remove };
  }

  // ── 今日收款 ──

  function stat(label, data) {
    return el("div", { class: "collect-stat" }, [
      el("p", { class: "collect-stat-label", text: label }),
      el("p", { class: "collect-stat-value", text: data.count + " 筆" }),
      el("p", { class: "collect-stat-note", text: money(data.amount) })
    ]);
  }

  function todayRow(item) {
    var voidButton = !item.void ? el("button", { class: "text-button", type: "button", text: "作廢" }) : null;
    if (voidButton) {
      voidButton.addEventListener("click", function () {
        var reason = prompt("作廢 " + item.name + "（" + item.receipt + "）\n請輸入原因：");
        if (reason === null) return;
        if (!reason.trim()) { alert("要填寫原因才能作廢。"); return; }
        voidButton.disabled = true;
        api({ action: "void", receipt: item.receipt, reason: reason.trim() }).then(function (res) {
          if (!res.ok) throw new Error(res.error);
          if (state.paid[item.id] && state.paid[item.id].receipt === item.receipt) delete state.paid[item.id];
          render();
          loadToday();
        }).catch(function (err) {
          if (err.handled) return;
          voidButton.disabled = false;
          alert("作廢失敗：" + err.message);
        });
      });
    }
    return el("li", { class: item.void ? "is-void" : "" }, [
      el("span", { class: "collect-list-time", text: item.time }),
      el("div", { class: "collect-list-main" }, [
        el("p", { text: item.name + "　" + item.id }),
        el("p", { class: "collect-list-meta", text: item.handler + "・" + item.receipt + (item.void ? "・已作廢" : "") })
      ]),
      voidButton
    ]);
  }

  function loadToday() {
    var list = $("today-list");
    api({ action: "today" }).then(function (data) {
      if (!data.ok) throw new Error(data.error);
      replace($("today-stats"), [stat("全部幹部", data.total), stat("我經手", data.mine)]);
      $("today-chip").textContent = "今日 " + data.total.count + " 筆";
      replace(list, data.items.length ? data.items.map(todayRow) : [el("li", { class: "collect-list-empty", text: "今天還沒有收款紀錄。" })]);
    }).catch(function (err) {
      if (!err.handled) replace(list, [el("li", { class: "collect-list-empty", text: "讀取失敗：" + err.message })]);
    });
  }

  $("today-refresh").addEventListener("click", function () {
    loadToday();
    loadRoster();
  });

  token = loadToken();
  if (token) start(token);
  setupGoogle();
})();
