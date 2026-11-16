// 器材借用：學生用學校帳號申請、查進度；幹部（器材長、會長）在同一頁審核、登記借出與歸還。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var API = S.config.paycheckUrl; // 和會費系統共用同一支 Apps Script
  var STATUS_CLASS = {
    "待器材長審核": "upcoming", "待會長審核": "upcoming", "已核准": "approved",
    "已借出": "lent", "已歸還": "closed", "已退回": "rejected", "已取消": "closed"
  };

  var app = document.getElementById("borrow-app");
  var token = null;
  var who = null;
  var noticeDays = 3;

  function replace(target, nodes) {
    target.textContent = "";
    nodes.forEach(function (node) { if (node) target.appendChild(node); });
  }

  function post(body) {
    body.token = token;
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (data.auth || data.denied) {
        token = null;
        if (!data.denied) S.auth.forget(); // 登入過期：讓 Google 自動重新登入
        showSignin(data.error, data.denied);
        throw Object.assign(new Error(data.error), { handled: true });
      }
      if (!data.ok) throw new Error(data.error || "系統處理失敗");
      return data;
    });
  }

  function equipment(start, end) {
    var query = "action=equipment" + (start && end ? "&start=" + start + "&end=" + end : "");
    return fetch(API + "?" + query).then(function (res) { return res.json(); });
  }

  function notice(text, kind) {
    return el("p", { class: "vote-notice" + (kind ? " is-" + kind : ""), text: text });
  }

  function isoDay(offset) {
    var d = new Date();
    d.setDate(d.getDate() + offset);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // ── 登入 ──

  // noPrompt：剛被拒絕或換帳號時，不要自動跳出帳號選擇。
  function showSignin(message, noPrompt) {
    var box = el("div", { class: "vote-signin" }, [
      el("h3", { text: "請登入以申請或審核" }),
      el("p", { text: "申請借用請以學校 Google 帳號（s學號@student.szmc.edu.tw）登入；幹部請以登記於幹部名單之帳號登入審核。" }),
      el("div", { class: "signin-button", id: "borrow-signin-button" }),
      el("p", { class: "vote-signin-tip", text: "若無法登入，請改以 Chrome 或 Safari 開啟本頁面。" })
    ]);
    replace(app, [message ? notice(message, "error") : null, box]);
    setupGoogle(box.querySelector("#borrow-signin-button"), noPrompt);
  }

  // 登入由 site.js 的 S.auth 統一處理，換頁或重新整理都會沿用同一個登入。
  function setupGoogle(target, noPrompt) {
    S.auth.button(target, function (credential) { token = credential; start(); }, { prompt: !noPrompt });
  }

  function start() {
    replace(app, [S.statusMessage("登入中…")]);
    post({ action: "borrowWho" }).then(function (data) {
      who = data;
      render();
    }).catch(function (err) {
      if (!err.handled) showSignin("登入失敗：" + err.message);
    });
  }

  // 登入者資訊卡：頭像、姓名、身分標籤和換帳號按鈕。
  function whoCard() {
    var name = (who.student && who.student.name) || (who.officer && who.officer.name) || who.email.split("@")[0];
    var tags = [];
    if (who.student) tags.push(el("span", { class: "borrow-tag", text: "學號 " + who.student.id }));
    if (who.officer) tags.push(el("span", { class: "borrow-tag is-officer", text: who.officer.title || "幹部" }));
    var change = el("button", { class: "text-button borrow-switch", type: "button", text: "換帳號" });
    change.addEventListener("click", function () {
      token = null;
      who = null;
      S.auth.clear();
      showSignin("", true);
    });
    return el("div", { class: "borrow-who" }, [
      S.avatar(name, S.googleProfile(token).picture),
      el("div", { class: "borrow-who-text" }, [
        el("p", { class: "borrow-who-name", text: name }),
        el("p", { class: "borrow-who-meta" }, tags.concat([el("span", { class: "borrow-who-email", text: who.email })]))
      ]),
      change
    ]);
  }

  function render() {
    var rules = document.querySelector(".borrow-rules");
    if (rules && who.officer) rules.open = false;
    var parts = [whoCard()];
    if (who.officer) parts.push(reviewSection());
    if (who.student) parts.push(applySection(), mineSection());
    replace(app, parts);
  }

  // ── 申請單卡片（學生和幹部共用） ──

  // 「同意（王小明 2026/11/15 00:47）」或「王小明 2026/11/15 00:48」拆成結果、經手人、時間。
  function parseStamp(value) {
    var m = /^(?:(同意|退回)（)?(.*?)\s+(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})）?$/.exec(value || "");
    return m ? { verdict: m[1] || "", who: m[2], time: m[3] } : { verdict: "", who: value || "", time: "" };
  }

  function itemList(items) {
    return el("ul", { class: "borrow-items" }, items.split("\n").filter(Boolean).map(function (line) {
      var m = /^(.*?)\s*×\s*(.+)$/.exec(line);
      return el("li", {}, m ? [el("span", { text: m[1] }), el("span", { class: "borrow-qty", text: "× " + m[2] })] : [el("span", { text: line })]);
    }));
  }

  // 審核進度：器材長 → 會長 → 借出 → 歸還。
  function progress(r) {
    var ended = r.status === "已退回" || r.status === "已取消";
    var current = { "待器材長審核": "equip", "待會長審核": "president", "已核准": "lent", "已借出": "returned" }[r.status];
    var steps = [
      { key: "equip", label: "器材長審核", value: r.equip },
      { key: "president", label: "會長審核", value: r.president },
      { key: "lent", label: "借出", value: r.lent },
      { key: "returned", label: "歸還驗收", value: r.returned }
    ];
    return el("ol", { class: "borrow-steps" }, steps.map(function (s) {
      var stamp = parseStamp(s.value);
      var state = !s.value ? (s.key === current && !ended ? "current" : "todo") : (stamp.verdict === "退回" ? "rejected" : "done");
      var result = state === "current" ? "處理中" : state === "todo" ? "—" : (stamp.verdict || "完成");
      var extra = [];
      if (state === "rejected" && r.reason) extra.push(el("p", { class: "borrow-step-note", text: "退回原因：" + r.reason }));
      if (s.key === "returned" && r.returnNote) extra.push(el("p", { class: "borrow-step-note", text: "備註：" + r.returnNote }));
      return el("li", { class: "borrow-step is-" + state }, [
        el("span", { class: "borrow-step-dot", "aria-hidden": "true" }),
        el("div", { class: "borrow-step-body" }, [
          el("p", { class: "borrow-step-head" }, [el("span", { class: "borrow-step-label", text: s.label }), el("span", { class: "borrow-step-result", text: result })]),
          s.value ? el("p", { class: "borrow-step-meta", text: [stamp.who, stamp.time].filter(Boolean).join(" · ") }) : null
        ].concat(extra))
      ]);
    }));
  }

  function requestCard(r, actions) {
    function row(label, value) {
      if (!value) return null;
      var nodes = [].concat(value).map(function (v) { return typeof v === "string" ? document.createTextNode(v) : v; });
      return el("div", { class: "borrow-row" }, [el("dt", { text: label }), el("dd", {}, nodes)]);
    }
    return el("article", { class: "borrow-card" }, [
      el("header", { class: "borrow-card-head" }, [
        el("div", {}, [
          el("p", { class: "borrow-no", text: "申請編號 " + r.no }),
          el("h3", { text: r.unit })
        ]),
        el("span", { class: "vote-chip is-" + (STATUS_CLASS[r.status] || "closed"), text: r.status })
      ]),
      el("dl", { class: "borrow-details" }, [
        row("借用期間", el("strong", { text: r.start + " – " + r.end })),
        row("借用人", [document.createTextNode(r.name + " "), el("span", { class: "borrow-muted", text: "學號 " + r.id })]),
        row("聯絡電話", el("a", { href: "tel:" + r.phone.replace(/[^0-9+]/g, ""), text: r.phone })),
        row("使用地點", r.place),
        row("用途說明", r.purpose),
        row("借用物品", itemList(r.items))
      ]),
      r.status === "已取消" ? el("p", { class: "borrow-step-note", text: "本申請已由申請人取消。" }) : progress(r),
      actions && actions.length ? el("div", { class: "borrow-actions" }, actions) : null
    ]);
  }

  // 操作按鈕：run(begin) 先做確認或填備註，真的要送出時呼叫 begin()，
  // 整張卡片進入「處理中」狀態，避免重複點擊，也讓使用者知道系統正在處理。
  function actionButton(label, kind, busyText, run) {
    var button = el("button", { class: kind === "primary" ? "button button-navy" : "text-button", type: "button", text: label });
    button.addEventListener("click", function () {
      var card = button.closest(".borrow-card");
      var buttons = card ? card.querySelectorAll(".borrow-actions button") : [button];
      function setBusy(on) {
        [].forEach.call(buttons, function (b) { b.disabled = on; });
        button.textContent = on ? busyText : label;
        button.classList.toggle("is-busy", on);
        if (card) {
          card.classList.toggle("is-busy", on);
          if (on) card.setAttribute("aria-busy", "true"); else card.removeAttribute("aria-busy");
        }
      }
      var started = false;
      Promise.resolve(run(function () { started = true; setBusy(true); })).catch(function (err) {
        if (started) setBusy(false);
        if (!err.handled) toast("error", "處理失敗", err.message);
      });
    });
    return button;
  }

  // 需要確認或填寫內容的操作：在卡片內展開確認面板，不用瀏覽器的彈出視窗。
  // opts: { text, field: { label, placeholder, required }, confirm, busy, danger, submit(value) }
  function panelButton(label, kind, opts) {
    var button = el("button", { class: kind === "primary" ? "button button-navy" : "text-button", type: "button", text: label });
    button.addEventListener("click", function () {
      var actions = button.parentNode;
      var card = button.closest(".borrow-card");
      var saved = [].slice.call(actions.childNodes);
      var input = null;
      var error = el("p", { class: "field-error", hidden: true });
      var ok = el("button", { class: "button " + (opts.danger ? "button-red" : "button-navy"), type: "submit", text: opts.confirm });
      var cancel = el("button", { class: "text-button", type: "button", text: "取消" });
      var form = el("form", { class: "borrow-panel", novalidate: true }, [
        el("p", { class: "borrow-panel-text", text: opts.text }),
        opts.field ? el("label", { class: "borrow-panel-field" }, [
          el("span", { text: opts.field.label + (opts.field.required ? "" : "（選填）") }),
          input = el("textarea", { rows: 2, maxlength: 200, placeholder: opts.field.placeholder || "" })
        ]) : null,
        error,
        el("div", { class: "borrow-panel-actions" }, [ok, cancel])
      ]);
      function close() { replace(actions, saved); button.focus(); }
      function setBusy(on) {
        ok.disabled = cancel.disabled = on;
        if (input) input.disabled = on;
        ok.textContent = on ? opts.busy : opts.confirm;
        ok.classList.toggle("is-busy", on);
        card.classList.toggle("is-busy", on);
        if (on) card.setAttribute("aria-busy", "true"); else card.removeAttribute("aria-busy");
      }
      cancel.addEventListener("click", close);
      form.addEventListener("keydown", function (e) { if (e.key === "Escape" && !ok.disabled) close(); });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var value = input ? input.value.trim() : "";
        if (opts.field && opts.field.required && !value) {
          error.textContent = "請填寫" + opts.field.label + "。";
          error.hidden = false;
          input.focus();
          return;
        }
        error.hidden = true;
        setBusy(true);
        Promise.resolve(opts.submit(value)).catch(function (err) {
          setBusy(false);
          if (!err.handled) toast("error", "處理失敗", err.message);
        });
      });
      replace(actions, [form]);
      (input || ok).focus();
    });
    return button;
  }

  // 畫面底部的提示訊息，數秒後自動消失。
  var toastBox = null;
  function toast(kind, text, sub) {
    if (!toastBox) {
      toastBox = el("div", { class: "borrow-toasts", "aria-live": "polite" });
      document.body.appendChild(toastBox);
    }
    var box = el("div", { class: "collect-toast is-" + kind, role: kind === "error" ? "alert" : "status" });
    var close = el("button", { class: "collect-toast-close", type: "button", "aria-label": "關閉", text: "×" });
    function remove() { if (box.parentNode) box.parentNode.removeChild(box); }
    close.addEventListener("click", remove);
    replace(box, [
      el("div", { class: "collect-toast-body" }, [
        el("p", { class: "collect-toast-text", text: text }),
        sub ? el("p", { class: "collect-toast-sub", text: sub }) : null
      ]),
      el("span", { class: "collect-toast-timer", style: "animation-duration:6s" }),
      close
    ]);
    toastBox.appendChild(box);
    while (toastBox.children.length > 3) toastBox.removeChild(toastBox.firstChild);
    setTimeout(remove, 6000);
  }

  // ── 幹部：審核清單 ──

  function reviewSection() {
    var section = el("section", { class: "borrow-section" }, [el("h2", { text: "審核清單" })]);
    var filter = el("div", { class: "choices borrow-filter" });
    var listBox = el("div", { class: "borrow-list" }, [S.statusMessage("讀取中…")]);
    var mode = "mine";
    var items = [];
    var FILTERS = [["mine", "待我處理"], ["active", "進行中"], ["all", "全部"]];

    function mineToAct(r) {
      if (r.status === "待器材長審核") return who.roles.equip;
      if (r.status === "待會長審核") return who.roles.president;
      return r.status === "已核准" || r.status === "已借出";
    }

    function matches(r, m) {
      if (m === "mine") return mineToAct(r);
      if (m === "active") return ["已歸還", "已退回", "已取消"].indexOf(r.status) < 0;
      return true;
    }

    function drawFilter() {
      replace(filter, FILTERS.map(function (f) {
        var input = el("input", { type: "radio", name: "borrow-filter", value: f[0] });
        if (f[0] === mode) input.checked = true;
        input.addEventListener("change", function () { mode = f[0]; draw(); });
        var count = items.filter(function (r) { return matches(r, f[0]); }).length;
        return el("label", {}, [input, el("span", {}, [
          document.createTextNode(f[1]),
          el("b", { class: "borrow-count" + (f[0] === "mine" && count ? " is-alert" : ""), text: String(count) })
        ])]);
      }));
    }

    function draw() {
      drawFilter();
      var shown = items.filter(function (r) { return matches(r, mode); });
      replace(listBox, shown.length ? shown.map(function (r) { return requestCard(r, officerActions(r)); })
        : [S.statusMessage(mode === "mine" ? "目前無待處理之申請。" : "目前無申請紀錄。")]);
    }

    function load() {
      return post({ action: "borrowList" }).then(function (data) {
        items = data.items;
        draw();
      }).catch(function (err) {
        if (!err.handled) replace(listBox, [S.statusMessage("讀取失敗：" + err.message)]);
      });
    }

    // 完成後重新讀取清單，並提示結果；卡片可能因狀態改變而移出目前的篩選。
    function act(r, body, done) {
      body.action = "borrowAct";
      body.no = r.no;
      return post(body).then(function () {
        return load().then(function () {
          var now = items.filter(function (x) { return x.no === r.no; })[0];
          var where = "";
          if (now && !matches(now, mode)) where = "本申請已移至「" + (matches(now, "active") ? "進行中" : "全部") + "」清單。";
          toast("ok", done(r), where);
        });
      });
    }

    function officerActions(r) {
      var list = [];
      var canReview = (r.status === "待器材長審核" && who.roles.equip) || (r.status === "待會長審核" && who.roles.president);
      if (canReview) {
        list.push(actionButton("同意", "primary", "審核中…", function (begin) {
          begin();
          return act(r, { act: "approve" }, function () {
            return r.status === "待器材長審核" && !who.roles.president
              ? "已同意 " + r.no + "，已轉送會長核定"
              : "已核准 " + r.no + "，系統已通知申請人";
          });
        }));
        list.push(panelButton("退回", "text", {
          text: "退回後，系統將通知申請人，本申請即結案。",
          field: { label: "退回原因", placeholder: "例如：該期間器材已有其他活動使用", required: true },
          confirm: "確認退回", busy: "退回中…", danger: true,
          submit: function (reason) {
            return act(r, { act: "reject", reason: reason }, function () { return "已退回 " + r.no + "，系統已通知申請人"; });
          }
        }));
      }
      if (r.status === "已核准") {
        list.push(panelButton("登記借出", "primary", {
          text: "請確認已與 " + r.name + " 當面清點下列器材：" + r.items.split("\n").filter(Boolean).join("、"),
          confirm: "已完成點交", busy: "登記中…",
          submit: function () {
            return act(r, { act: "lend" }, function () { return "已登記借出 " + r.no; });
          }
        }));
      }
      if (r.status === "已借出") {
        list.push(panelButton("登記歸還", "primary", {
          text: "請當面清點歸還器材，確認數量與狀況。",
          field: { label: "驗收備註", placeholder: "器材如有損壞或短缺請註明" },
          confirm: "確認歸還", busy: "登記中…",
          submit: function (note) {
            return act(r, { act: "return", note: note }, function () { return "已登記歸還 " + r.no + "，系統已通知申請人"; });
          }
        }));
      }
      return list;
    }

    drawFilter();
    section.appendChild(filter);
    section.appendChild(listBox);
    load();
    return section;
  }

  // ── 學生：新申請 ──

  function applySection() {
    var minDay = isoDay(noticeDays);
    var form = el("form", { class: "borrow-form", novalidate: "" });
    var fields = {
      name: el("input", { type: "text", maxlength: "30", value: who.student.name || "", autocomplete: "name" }),
      unit: el("input", { type: "text", maxlength: "50", placeholder: "例如 應英科學會、3E1、英語話劇社" }),
      phone: el("input", { type: "tel", maxlength: "30", inputmode: "tel", placeholder: "例如 0912-345-678", autocomplete: "tel" }),
      start: el("input", { type: "date", min: minDay }),
      end: el("input", { type: "date", min: minDay }),
      purpose: el("textarea", { rows: "3", maxlength: "500" }),
      place: el("input", { type: "text", maxlength: "100", placeholder: "例如 A301 教室" })
    };
    var itemsBox = el("div", { class: "borrow-items" }, [el("p", { class: "borrow-hint", text: "選擇借用期間後，系統將顯示該期間各項器材之可借數量。" })]);
    var message = el("p", { class: "form-message", role: "status" });
    var submit = el("button", { class: "button button-navy", type: "submit", text: "送出申請" });
    var quantities = {};

    function field(label, input, required) {
      return el("div", { class: "field" }, [el("label", {}, [document.createTextNode(label), required ? el("span", { "aria-hidden": "true", text: " *" }) : null]), input]);
    }

    function loadItems() {
      var s = fields.start.value;
      var e = fields.end.value;
      if (!s || !e) return;
      if (e < s) {
        replace(itemsBox, [el("p", { class: "borrow-hint is-error", text: "結束日期不得早於開始日期。" })]);
        return;
      }
      replace(itemsBox, [S.statusMessage("正在查詢可借數量…")]);
      equipment(s, e).then(function (data) {
        if (!data.ok) throw new Error(data.error);
        quantities = {};
        replace(itemsBox, data.items.length ? data.items.map(function (item) {
          var left = Math.max(item.available, 0);
          var qty = el("input", { type: "number", min: "0", max: String(left), value: "0", inputmode: "numeric", "aria-label": item.name + " 數量" });
          if (!left) qty.disabled = true;
          qty.addEventListener("input", function () {
            var n = Math.max(0, Math.min(left, Math.floor(Number(qty.value) || 0)));
            quantities[item.name] = n;
          });
          return el("div", { class: "borrow-item" + (left ? "" : " is-out") }, [
            el("div", {}, [
              el("p", { class: "borrow-item-name", text: item.name }),
              el("p", { class: "borrow-item-meta", text: left ? "可借 " + left + " " + item.unit + (item.note ? "・" + item.note : "") : "本期間已無可借數量" })
            ]),
            qty
          ]);
        }) : [el("p", { class: "borrow-hint", text: "器材清單尚未建立，請洽器材長。" })]);
      }).catch(function (err) {
        replace(itemsBox, [el("p", { class: "borrow-hint is-error", text: "讀取失敗：" + err.message })]);
      });
    }

    fields.start.addEventListener("change", function () {
      if (fields.start.value && (!fields.end.value || fields.end.value < fields.start.value)) fields.end.value = fields.start.value;
      fields.end.min = fields.start.value || minDay;
      loadItems();
    });
    fields.end.addEventListener("change", loadItems);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var items = Object.keys(quantities).filter(function (k) { return quantities[k] > 0; })
        .map(function (k) { return { name: k, qty: quantities[k] }; });
      submit.disabled = true;
      submit.textContent = "送出中…";
      message.textContent = "";
      post({
        action: "borrowSubmit", name: fields.name.value, unit: fields.unit.value, phone: fields.phone.value,
        start: fields.start.value, end: fields.end.value, items: items,
        purpose: fields.purpose.value, place: fields.place.value
      }).then(function (res) {
        render();
        app.insertBefore(notice("申請已送出（申請編號 " + res.no + "），審核結果將寄至您的學校信箱。", "ok"), app.children[1]);
        window.scrollTo({ top: app.offsetTop - 80 });
      }).catch(function (err) {
        submit.disabled = false;
        submit.textContent = "送出申請";
        if (err.handled) return;
        message.className = "form-message is-error";
        message.textContent = err.message;
      });
    });

    replace(form, [
      el("div", { class: "borrow-grid" }, [
        field("借用人", fields.name, true),
        field("借用單位", fields.unit, true),
        field("聯絡電話", fields.phone, true),
        field("使用地點", fields.place, true),
        field("開始日期", fields.start, true),
        field("結束日期", fields.end, true)
      ]),
      el("div", { class: "field" }, [el("label", { text: "借用物品 *" }), itemsBox]),
      field("用途說明", fields.purpose, true),
      submit,
      message
    ]);
    return el("section", { class: "borrow-section" }, [
      el("h2", { text: "填寫借用申請" }),
      el("p", { class: "borrow-hint", text: "依規定須於借用日 3 天前提出申請，可申請 " + minDay.replace(/-/g, "/") + " 起之借用。" }),
      form
    ]);
  }

  // ── 學生：我的申請 ──

  function mineSection() {
    var box = el("div", { class: "borrow-list" }, [S.statusMessage("讀取中…")]);
    function load() {
      post({ action: "borrowMine" }).then(function (data) {
        replace(box, data.items.length ? data.items.map(function (r) {
          var actions = [];
          if (r.status === "待器材長審核" || r.status === "待會長審核") {
            actions.push(panelButton("取消申請", "text", {
              text: "確定取消申請 " + r.no + "？取消後無法復原，如需借用須重新申請。",
              confirm: "確認取消", busy: "取消中…", danger: true,
              submit: function () {
                return post({ action: "borrowCancel", no: r.no }).then(load).then(function () {
                  toast("ok", "已取消申請 " + r.no);
                });
              }
            }));
          }
          return requestCard(r, actions);
        }) : [S.statusMessage("目前無申請紀錄。")]);
      }).catch(function (err) {
        if (!err.handled) replace(box, [S.statusMessage("讀取失敗：" + err.message)]);
      });
    }
    load();
    return el("section", { class: "borrow-section" }, [el("h2", { text: "我的申請" }), box]);
  }

  if (!API) replace(app, [S.statusMessage("網站尚未設定 Apps Script 網址。")]);
  else if (S.auth.get()) {
    token = S.auth.get();
    start();
  } else showSignin("");
})();
