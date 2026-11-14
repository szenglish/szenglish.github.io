// 器材借用：學生用學校帳號申請、查進度；幹部（器材長、會長）在同一頁審核、登記借出與歸還。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var API = S.config.paycheckUrl; // 和會費系統共用同一支 Apps Script
  var STATUS_CLASS = {
    "待器材長審核": "upcoming", "待會長審核": "upcoming", "已核准": "open",
    "已借出": "open", "已歸還": "closed", "已退回": "closed", "已取消": "closed"
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
        showSignin(data.error);
        throw Object.assign(new Error(data.error), { handled: true });
      }
      if (!data.ok) throw new Error(data.error || "操作失敗");
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

  function showSignin(message) {
    var box = el("div", { class: "vote-signin" }, [
      el("h3", { text: "登入申請或審核" }),
      el("p", { text: "申請借用請用學校信箱（s學號@student.szmc.edu.tw）登入；幹部請用登記在幹部名單的帳號登入審核。" }),
      el("div", { class: "signin-button", id: "borrow-signin-button" }),
      el("p", { class: "vote-signin-tip", text: "無法登入時，請改用 Chrome 或 Safari 開啟此頁面。" })
    ]);
    replace(app, [message ? notice(message, "error") : null, box]);
    setupGoogle(box.querySelector("#borrow-signin-button"));
  }

  function setupGoogle(target) {
    if (!window.google || !google.accounts) {
      setTimeout(function () { setupGoogle(target); }, 200);
      return;
    }
    google.accounts.id.initialize({
      client_id: S.config.googleClientId,
      callback: function (response) { token = response.credential; start(); },
      use_fedcm_for_prompt: true
    });
    google.accounts.id.renderButton(target, {
      theme: "filled_black", size: "large", shape: "rectangular", text: "signin_with", locale: "zh-TW", width: 280
    });
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
      if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
      showSignin();
    });
    return el("div", { class: "borrow-who" }, [
      el("span", { class: "borrow-avatar", "aria-hidden": "true", text: name.charAt(0) }),
      el("div", { class: "borrow-who-text" }, [
        el("p", { class: "borrow-who-name", text: name }),
        el("p", { class: "borrow-who-meta" }, tags.concat([el("span", { class: "borrow-who-email", text: who.email })]))
      ]),
      change
    ]);
  }

  function render() {
    var parts = [whoCard()];
    if (who.officer) parts.push(reviewSection());
    if (who.student) parts.push(applySection(), mineSection());
    replace(app, parts);
  }

  // ── 申請單卡片（學生和幹部共用） ──

  function requestCard(r, actions) {
    function row(label, value) {
      return value ? el("div", {}, [el("dt", { text: label }), el("dd", { text: value })]) : null;
    }
    return el("article", { class: "borrow-card" }, [
      el("div", { class: "vote-card-head" }, [
        el("h3", { text: r.no + "　" + r.unit }),
        el("span", { class: "vote-chip is-" + (STATUS_CLASS[r.status] || "closed"), text: r.status })
      ]),
      el("dl", { class: "borrow-details" }, [
        row("借用期間", r.start + " – " + r.end),
        row("借用人", r.name + "（" + r.id + "）"),
        row("聯絡電話", r.phone),
        row("借用物品", r.items),
        row("用途說明", r.purpose),
        row("使用地點", r.place),
        row("器材長審核", r.equip),
        row("會長審核", r.president),
        row("退回原因", r.reason),
        row("借出", r.lent),
        row("歸還驗收", r.returned + (r.returnNote ? "\n備註：" + r.returnNote : ""))
      ]),
      actions && actions.length ? el("div", { class: "borrow-actions" }, actions) : null
    ]);
  }

  function actionButton(label, kind, run) {
    var button = el("button", { class: kind === "primary" ? "button button-navy" : "text-button", type: "button", text: label });
    button.addEventListener("click", function () {
      button.disabled = true;
      run().catch(function (err) {
        button.disabled = false;
        if (!err.handled) alert(err.message);
      });
    });
    return button;
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

    function draw() {
      var shown = items.filter(function (r) {
        if (mode === "mine") return mineToAct(r);
        if (mode === "active") return ["已歸還", "已退回", "已取消"].indexOf(r.status) < 0;
        return true;
      });
      replace(listBox, shown.length ? shown.map(function (r) { return requestCard(r, officerActions(r)); })
        : [S.statusMessage(mode === "mine" ? "目前沒有待處理的申請。" : "沒有申請。")]);
    }

    function load() {
      return post({ action: "borrowList" }).then(function (data) {
        items = data.items;
        draw();
      }).catch(function (err) {
        if (!err.handled) replace(listBox, [S.statusMessage("讀取失敗：" + err.message)]);
      });
    }

    function act(r, body) {
      body.action = "borrowAct";
      body.no = r.no;
      return post(body).then(load);
    }

    function officerActions(r) {
      var list = [];
      var canReview = (r.status === "待器材長審核" && who.roles.equip) || (r.status === "待會長審核" && who.roles.president);
      if (canReview) {
        list.push(actionButton("同意", "primary", function () { return act(r, { act: "approve" }); }));
        list.push(actionButton("退回", "text", function () {
          var reason = prompt("退回 " + r.no + " 的原因：");
          if (!reason || !reason.trim()) return Promise.resolve();
          return act(r, { act: "reject", reason: reason.trim() });
        }));
      }
      if (r.status === "已核准") {
        list.push(actionButton("登記借出", "primary", function () {
          if (!confirm("確認已與 " + r.name + " 當面點交器材？")) return Promise.resolve();
          return act(r, { act: "lend" });
        }));
      }
      if (r.status === "已借出") {
        list.push(actionButton("登記歸還", "primary", function () {
          var note = prompt("歸還驗收備註（器材有損壞或短少時填寫，沒有就留空）：", "");
          if (note === null) return Promise.resolve();
          return act(r, { act: "return", note: note.trim() });
        }));
      }
      return list;
    }

    replace(filter, FILTERS.map(function (f) {
      var input = el("input", { type: "radio", name: "borrow-filter", value: f[0] });
      if (f[0] === mode) input.checked = true;
      input.addEventListener("change", function () { mode = f[0]; draw(); });
      return el("label", {}, [input, el("span", { text: f[1] })]);
    }));
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
    var itemsBox = el("div", { class: "borrow-items" }, [el("p", { class: "borrow-hint", text: "先選好借用期間，就會顯示那段時間還能借的數量。" })]);
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
        replace(itemsBox, [el("p", { class: "borrow-hint is-error", text: "結束日期不能早於開始日期。" })]);
        return;
      }
      replace(itemsBox, [S.statusMessage("查詢可借數量…")]);
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
              el("p", { class: "borrow-item-meta", text: left ? "可借 " + left + " " + item.unit + (item.note ? "・" + item.note : "") : "這段期間已借完" })
            ]),
            qty
          ]);
        }) : [el("p", { class: "borrow-hint", text: "器材清單還沒有建立，請聯絡器材長。" })]);
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
        app.insertBefore(notice("已送出申請（編號 " + res.no + "），審核結果會寄到你的學校信箱。", "ok"), app.children[1]);
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
      el("h2", { text: "新申請" }),
      el("p", { class: "borrow-hint", text: "最早可以借 " + minDay.replace(/-/g, "/") + " 以後的器材。" }),
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
            actions.push(actionButton("取消申請", "text", function () {
              if (!confirm("確定取消 " + r.no + "？")) return Promise.resolve();
              return post({ action: "borrowCancel", no: r.no }).then(load);
            }));
          }
          return requestCard(r, actions);
        }) : [S.statusMessage("還沒有申請紀錄。")]);
      }).catch(function (err) {
        if (!err.handled) replace(box, [S.statusMessage("讀取失敗：" + err.message)]);
      });
    }
    load();
    return el("section", { class: "borrow-section" }, [el("h2", { text: "我的申請" }), box]);
  }

  if (!API) replace(app, [S.statusMessage("網站還沒有設定 Apps Script 網址。")]);
  else showSignin("");
})();
