// 意見進度查詢：學生用「案件編號＋Email」查進度、補充說明；幹部（?admin=1）登入後回覆與結案。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var API = S.config.paycheckUrl; // 和會費系統共用同一支 Apps Script
  var STEPS = ["已收到", "處理中", "已回覆", "已結案"];
  var CHIP = { "已收到": "upcoming", "處理中": "upcoming", "已回覆": "open", "已結案": "closed" };

  var app = document.getElementById("feedback-app");
  var params = new URLSearchParams(location.search);
  var token = null;

  function replace(target, nodes) {
    target.textContent = "";
    nodes.forEach(function (node) { if (node) target.appendChild(node); });
  }

  function post(body) {
    if (token) body.token = token;
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); });
  }

  function notice(text, kind) {
    return el("p", { class: "vote-notice" + (kind ? " is-" + kind : ""), text: text });
  }

  function chip(status) {
    return el("span", { class: "vote-chip is-" + (CHIP[status] || "closed"), text: status });
  }

  // 進度條：已收到 → 處理中 → 已回覆 → 已結案。
  function stepper(status) {
    var at = STEPS.indexOf(status);
    return el("ol", { class: "fb-steps", "aria-label": "處理進度：" + status }, STEPS.map(function (s, i) {
      var state = i < at ? "done" : i === at ? "current" : "todo";
      return el("li", { class: "fb-step is-" + state }, [
        el("span", { class: "fb-step-dot", "aria-hidden": "true" }),
        el("span", { class: "fb-step-label", text: s })
      ]);
    }));
  }

  // 對話紀錄：學生的意見放第一則，之後依時間排列。
  function conversation(first, thread, officerView) {
    var items = [{ role: "學生", who: first.name, time: first.created, text: first.message }].concat(thread || []);
    return el("ol", { class: "fb-thread" }, items.map(function (t) {
      var mine = t.role === "學生";
      var who = officerView && !mine ? t.name + (t.dept ? "（" + t.dept + "）" : "") : (t.who || (mine ? first.name : "應用英語科學會"));
      return el("li", { class: "fb-msg " + (mine ? "is-student" : "is-staff") }, [
        el("p", { class: "fb-msg-head" }, [
          el("span", { class: "fb-msg-who", text: mine ? who : who }),
          el("span", { class: "fb-msg-time", text: t.time })
        ]),
        el("p", { class: "fb-msg-text", text: t.text })
      ]);
    }));
  }

  function meta(rows) {
    return el("dl", { class: "borrow-details" }, rows.filter(function (r) { return r[1]; }).map(function (r) {
      return el("div", { class: "borrow-row" }, [el("dt", { text: r[0] }), el("dd", { text: r[1] })]);
    }));
  }

  // ── 學生：查詢 ──

  function showLookup(prefill, message) {
    var no = el("input", { id: "fb-no", name: "no", type: "text", autocomplete: "off", maxlength: "12", placeholder: "例如 F1115-01", value: prefill || "" });
    var email = el("input", { id: "fb-email", name: "email", type: "email", autocomplete: "email", maxlength: "100", placeholder: "送出意見時填寫的 Email" });
    var submit = el("button", { class: "button button-navy", type: "submit", text: "查詢" });
    var msg = el("p", { class: "form-message", role: "status" });
    var form = el("form", { class: "fb-lookup", novalidate: "" }, [
      el("p", { class: "eyebrow", lang: "en", text: "Check Status" }),
      el("h2", { text: "查詢處理進度" }),
      el("p", { class: "fb-lookup-intro", text: "請輸入案件編號及送出意見時填寫的 Email。案件編號可於受理通知信中找到。" }),
      el("div", { class: "fb-lookup-grid" }, [
        el("div", { class: "field" }, [el("label", { for: "fb-no", text: "案件編號" }), no]),
        el("div", { class: "field" }, [el("label", { for: "fb-email", text: "Email" }), email])
      ]),
      el("div", { class: "fb-lookup-actions" }, [submit, msg])
    ]);
    var result = el("div", { class: "fb-result", "aria-live": "polite" });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var n = no.value.trim().toUpperCase();
      var e = email.value.trim();
      if (!n || !e) {
        msg.className = "form-message is-error";
        msg.textContent = "請輸入案件編號及 Email。";
        return;
      }
      msg.textContent = "";
      submit.disabled = true;
      submit.textContent = "查詢中…";
      replace(result, [S.statusMessage("正在查詢…")]);
      post({ action: "feedbackLookup", no: n, email: e }).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        replace(result, [caseView(res.item, { no: n, email: e })]);
      }).catch(function (err) {
        replace(result, [notice(err.message || "系統連線失敗，請稍後再試。", "error")]);
      }).then(function () {
        submit.disabled = false;
        submit.textContent = "查詢";
      });
    });
    replace(app, [
      message ? notice(message, "error") : null,
      form,
      result,
      el("p", { class: "fb-admin-link" }, [el("a", { href: "?admin=1", text: "幹部登入處理意見 →" })])
    ]);
    (prefill ? email : no).focus({ preventScroll: true });
  }

  function caseView(c, cred) {
    var head = el("header", { class: "borrow-card-head" }, [
      el("div", {}, [el("p", { class: "borrow-no", text: "案件編號 " + c.no }), el("h3", { text: "意見反映" })]),
      chip(c.status)
    ]);
    if (c.hidden) {
      return el("article", { class: "borrow-card fb-case" }, [
        head, stepper(c.status),
        notice("本案件已於 " + c.updated + " 結案，為保護個人資料，結案逾 30 日之案件不再顯示內容。如需協助，請重新提出意見反映。")
      ]);
    }
    var parts = [
      head,
      stepper(c.status),
      meta([["提出時間", c.created], ["指定部門", c.dept], ["最後更新", c.updated]]),
      el("h4", { class: "fb-subhead", text: "處理紀錄" }),
      conversation(c, c.thread, false)
    ];
    if (c.status === "已結案") {
      parts.push(notice("本案件已結案。如有其他意見，歡迎重新提出意見反映。"));
    } else {
      parts.push(followupForm(c, cred));
    }
    return el("article", { class: "borrow-card fb-case" }, parts);
  }

  function followupForm(c, cred) {
    var box = el("textarea", { rows: "3", maxlength: "2000", placeholder: "如需補充說明，請在此輸入" });
    var send = el("button", { class: "button button-navy", type: "submit", text: "送出補充說明" });
    var msg = el("p", { class: "form-message", role: "status" });
    var form = el("form", { class: "fb-reply", novalidate: "" }, [
      el("label", { class: "fb-reply-label", text: "補充說明" }), box,
      el("div", { class: "fb-reply-actions" }, [send, msg])
    ]);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!box.value.trim()) {
        msg.className = "form-message is-error";
        msg.textContent = "請輸入補充內容。";
        return;
      }
      send.disabled = true;
      send.textContent = "送出中…";
      post({ action: "feedbackFollowup", no: cred.no, email: cred.email, message: box.value.trim() }).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        var article = form.closest(".fb-case");
        article.parentNode.replaceChild(caseView(res.item, cred), article);
      }).catch(function (err) {
        send.disabled = false;
        send.textContent = "送出補充說明";
        msg.className = "form-message is-error";
        msg.textContent = "送出失敗：" + err.message;
      });
    });
    return form;
  }

  // ── 幹部：處理意見 ──

  var admin = { items: [], officer: null, dept: "mine", status: "pending" };

  function showSignin(message, noPrompt) {
    var box = el("div", { class: "vote-signin" }, [
      el("h3", { text: "幹部登入" }),
      el("p", { text: "請以登記於幹部名單之 Google 帳號登入，以查看及回覆意見反映。" }),
      el("div", { class: "signin-button", id: "fb-signin-button" }),
      el("p", { class: "vote-signin-tip", text: "若無法登入，請改以 Chrome 或 Safari 開啟本頁面。" })
    ]);
    replace(app, [
      message ? notice(message, "error") : null,
      box,
      el("p", { class: "fb-admin-link" }, [el("a", { href: "feedback.html", text: "← 返回進度查詢" })])
    ]);
    setupGoogle(box.querySelector("#fb-signin-button"), noPrompt);
  }

  // 登入由 site.js 的 S.auth 統一處理，換頁或重新整理都會沿用同一個登入。
  function setupGoogle(target, noPrompt) {
    S.auth.button(target, function (credential) { token = credential; loadAdmin(); }, { prompt: !noPrompt });
  }

  function loadAdmin() {
    replace(app, [S.statusMessage("讀取中…")]);
    post({ action: "feedbackList" }).then(function (res) {
      if (res.auth || res.denied) {
        token = null;
        if (!res.denied) S.auth.forget(); // 登入過期：讓 Google 自動重新登入
        return showSignin(res.error, res.denied);
      }
      if (!res.ok) throw new Error(res.error);
      admin.items = res.items;
      admin.officer = res.officer;
      if (!admin.officer.dept) admin.dept = "all";
      renderAdmin();
    }).catch(function (err) {
      replace(app, [notice("讀取失敗：" + err.message, "error")]);
    });
  }

  function officerCard() {
    var o = admin.officer;
    var profile = S.googleProfile(token);
    var change = el("button", { class: "text-button borrow-switch", type: "button", text: "換帳號" });
    change.addEventListener("click", function () {
      token = null;
      S.auth.clear();
      showSignin("", true);
    });
    return el("div", { class: "borrow-who" }, [
      S.avatar(o.name, profile.picture),
      el("div", { class: "borrow-who-text" }, [
        el("p", { class: "borrow-who-name", text: o.name }),
        el("p", { class: "borrow-who-meta" }, [
          el("span", { class: "borrow-tag is-officer", text: o.title || "幹部" }),
          o.dept ? el("span", { class: "borrow-tag", text: o.dept }) : null,
          profile.email ? el("span", { class: "borrow-who-email", text: profile.email }) : null
        ])
      ]),
      change
    ]);
  }

  // 篩選用和器材借用頁一樣的單選按鈕。
  function filterBar(label, key, options) {
    return el("div", { class: "choices borrow-filter", role: "radiogroup", "aria-label": label }, options.map(function (o) {
      var input = el("input", { type: "radio", name: "fb-" + key, value: o[0] });
      if (admin[key] === o[0]) input.checked = true;
      input.addEventListener("change", function () { admin[key] = o[0]; renderAdmin(); });
      return el("label", {}, [input, el("span", { text: o[1] })]);
    }));
  }

  function visibleItems() {
    return admin.items.filter(function (c) {
      var deptOk = admin.dept === "all" || c.dept === admin.officer.dept ||
        (admin.officer.dept === "正副會長" && c.dept === "不指定");
      var statusOk = admin.status === "all" ||
        (admin.status === "pending" && (c.status === "已收到" || c.status === "處理中")) ||
        c.status === admin.status;
      return deptOk && statusOk;
    });
  }

  function renderAdmin() {
    var pendingCount = admin.items.filter(function (c) { return c.status === "已收到" || c.status === "處理中"; }).length;
    var items = visibleItems();
    var deptOptions = admin.officer.dept ? [["mine", "我的部門"], ["all", "全部部門"]] : [["all", "全部部門"]];
    replace(app, [
      officerCard(),
      el("section", { class: "borrow-section" }, [
        el("h2", { text: "意見處理（待處理 " + pendingCount + " 件）" }),
        deptOptions.length > 1 ? filterBar("部門", "dept", deptOptions) : null,
        filterBar("狀態", "status", [["pending", "待處理"], ["已回覆", "已回覆"], ["已結案", "已結案"], ["all", "全部"]]),
        el("div", { class: "borrow-list" }, items.length ? items.map(adminCard) : [S.statusMessage("目前無符合條件之案件。")])
      ])
    ]);
  }

  function adminCard(c) {
    var details = el("details", { class: "borrow-card fb-admin-card" });
    var summary = el("summary", { class: "fb-summary" }, [
      el("div", { class: "fb-summary-main" }, [
        el("p", { class: "borrow-no", text: c.no + "　" + c.created }),
        el("p", { class: "fb-summary-title", text: c.name }),
        el("p", { class: "fb-summary-text", text: c.message })
      ]),
      el("div", { class: "fb-summary-side" }, [chip(c.status), el("span", { class: "borrow-tag", text: c.dept })])
    ]);
    var box = el("textarea", { rows: "4", maxlength: "2000", placeholder: "輸入回覆內容，送出後將寄信通知反映人" });
    var msg = el("p", { class: "form-message", role: "status" });
    function act(body, button, label) {
      button.disabled = true;
      button.textContent = "處理中…";
      body.no = c.no;
      return post(body).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        return loadAdmin();
      }).catch(function (err) {
        button.disabled = false;
        button.textContent = label;
        msg.className = "form-message is-error";
        msg.textContent = err.message;
      });
    }
    function replyButton(label, status, primary) {
      var b = el("button", { class: primary ? "button button-navy" : "button button-white", type: "button", text: label });
      b.addEventListener("click", function () {
        if (!box.value.trim()) {
          msg.className = "form-message is-error";
          msg.textContent = "請輸入回覆內容。";
          box.focus();
          return;
        }
        act({ action: "feedbackReply", message: box.value.trim(), status: status }, b, label);
      });
      return b;
    }
    function statusButton(label, status, confirmText) {
      var b = el("button", { class: "text-button", type: "button", text: label });
      b.addEventListener("click", function () {
        if (confirmText && !confirm(confirmText)) return;
        act({ action: "feedbackStatus", status: status }, b, label);
      });
      return b;
    }
    var actions = [];
    if (c.status !== "已結案") {
      actions.push(replyButton("送出回覆", "已回覆", true), replyButton("回覆並結案", "已結案", false));
      if (c.status === "已收到") actions.push(statusButton("標記為處理中", "處理中"));
      actions.push(statusButton("不回覆直接結案", "已結案", "確定將 " + c.no + " 結案？結案後將不會寄信通知反映人。"));
    } else {
      actions.push(statusButton("重新開啟", "處理中"));
    }
    var body = [
      stepper(c.status),
      meta([["反映人", c.name], ["回覆 Email", c.email], ["指定部門", c.dept], ["處理人", c.handler], ["最後更新", c.updated]]),
      el("h4", { class: "fb-subhead", text: "處理紀錄" }),
      conversation(c, c.thread, true)
    ];
    if (c.status !== "已結案") {
      body.push(el("div", { class: "fb-reply" }, [el("label", { class: "fb-reply-label", text: "回覆內容" }), box]));
    }
    body.push(el("div", { class: "borrow-actions" }, actions), msg);
    details.appendChild(summary);
    details.appendChild(el("div", { class: "fb-admin-body" }, body));
    return details;
  }

  // ── 進入點 ──

  if (!API) replace(app, [notice("網站尚未設定 Apps Script 網址。", "error")]);
  else if (params.get("admin")) {
    if (S.auth.get()) {
      token = S.auth.get();
      loadAdmin();
    } else showSignin();
  }
  else showLookup(params.get("no") || "");
})();
