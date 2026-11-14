// 幹部收費頁：用 Google 登入，把收款寫進試算表。權限由 Apps Script 比對「幹部」分頁決定。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var TOKEN_KEY = "szae-collect-token";
  var token = null;
  var state = { fee: 0, term: "" };

  var $ = function (id) { return document.getElementById(id); };
  var signin = $("collect-signin");
  var app = $("collect-app");
  var form = $("collect-form");
  var input = $("collect-id");
  var error = $("collect-error");
  var result = $("collect-result");

  function replace(target, nodes) {
    target.textContent = "";
    nodes.forEach(function (node) { if (node) target.appendChild(node); });
  }

  function money(n) { return "NT$" + Number(n || 0).toLocaleString("en-US"); }

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
    app.hidden = true;
    signin.hidden = false;
    $("collect-term").textContent = "登入後開始收費";
    $("signin-message").className = "form-message" + (message ? " is-error" : "");
    $("signin-message").textContent = message || "";
  }

  function setupGoogle() {
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
      state.fee = me.fee;
      state.term = me.term;
      $("officer-name").textContent = me.officer;
      $("collect-term").textContent = me.term + " 學期・會費 " + money(me.fee);
      signin.hidden = true;
      app.hidden = false;
      input.focus();
      loadToday();
    }).catch(function (err) {
      if (!err.handled) showSignin("登入失敗：" + err.message);
    });
  }

  $("signout").addEventListener("click", function () {
    if (window.google) google.accounts.id.disableAutoSelect();
    replace(result, []);
    showSignin("");
  });

  // ── 查詢與收款 ──

  function detail(label, value) {
    return value ? el("div", {}, [el("dt", { text: label }), el("dd", { text: value })]) : null;
  }

  function message(title, text, className) {
    return el("div", { class: "paycheck-card " + (className || "is-empty") }, [
      el("p", { class: "paycheck-card-title", text: title }),
      text ? el("p", { class: "paycheck-card-text", text: text }) : null
    ]);
  }

  function busy(button, label) {
    button.disabled = true;
    button.setAttribute("data-label", button.textContent);
    button.textContent = label;
  }

  function idle(button) {
    button.disabled = false;
    button.textContent = button.getAttribute("data-label");
  }

  function paidCard(id, name, payment, fresh) {
    return el("div", { class: "paycheck-card is-paid" + (fresh ? " is-fresh" : "") }, [
      el("div", { class: "paycheck-card-head" }, [
        el("div", {}, [
          el("p", { class: "paycheck-card-id", text: id }),
          el("p", { class: "paycheck-card-name", text: name })
        ]),
        el("span", { class: "paycheck-status", text: fresh ? "收款完成" : "本學期已繳" })
      ]),
      fresh ? el("p", { class: "collect-receipt" }, [
        el("span", { text: "收據編號" }),
        el("strong", { text: payment.receipt })
      ]) : null,
      el("dl", { class: "paycheck-details" }, [
        fresh ? null : detail("收據編號", payment.receipt),
        detail("經手人", payment.handler),
        detail("時間", (payment.date || "") + " " + (payment.time || ""))
      ]),
      fresh ? el("button", { class: "button button-navy collect-next", type: "button", text: "下一位" }) : null
    ]);
  }

  function unpaidCard(data) {
    var isNew = !data.member;
    var nameInput = isNew ? el("input", { id: "new-name", type: "text", maxlength: "30", autocomplete: "off", placeholder: "例如 王小明" }) : null;
    var classInput = isNew ? el("input", { id: "new-class", type: "text", maxlength: "30", autocomplete: "off", placeholder: "例如 應英一忠（可不填）" }) : null;
    var pay = el("button", { class: "button button-navy collect-pay", type: "button", text: (isNew ? "新增並收款 " : "收款 ") + money(data.fee) });
    var note = el("p", { class: "form-message", role: "status" });

    pay.addEventListener("click", function () {
      var name = isNew ? nameInput.value.trim() : data.member.name;
      if (isNew && !name) {
        note.className = "form-message is-error";
        note.textContent = "請填寫姓名。";
        nameInput.focus();
        return;
      }
      if (!confirm("確認向 " + name + "（" + data.id + "）收取 " + money(data.fee) + "？")) return;
      busy(pay, "登記中…");
      api({ action: "pay", id: data.id, name: name, className: isNew ? classInput.value.trim() : "" }).then(function (res) {
        if (!res.ok && res.payment) {
          replace(result, [paidCard(data.id, name, res.payment, false), message("剛剛已經有人登記過了", "請不要重複收費。", "is-other")]);
          return;
        }
        if (!res.ok) throw new Error(res.error);
        replace(result, [paidCard(res.id, res.name, { receipt: res.receipt, handler: $("officer-name").textContent, time: res.time }, true)]);
        result.querySelector(".collect-next").addEventListener("click", nextStudent);
        result.querySelector(".collect-next").focus();
        loadToday();
      }).catch(function (err) {
        if (err.handled) return;
        idle(pay);
        note.className = "form-message is-error";
        note.textContent = "登記失敗：" + err.message + "。這筆還沒有記錄，可以再按一次。";
      });
    });

    return el("div", { class: "paycheck-card " + (isNew ? "is-other" : "is-unpaid") }, [
      el("div", { class: "paycheck-card-head" }, [
        el("div", {}, [
          el("p", { class: "paycheck-card-id", text: data.id }),
          el("p", { class: "paycheck-card-name", text: isNew ? "新會員" : data.member.name }),
          !isNew && data.member.className ? el("p", { class: "paycheck-card-text", text: data.member.className }) : null
        ]),
        el("span", { class: "paycheck-status", text: isNew ? "名冊沒有" : "本學期未繳" })
      ]),
      isNew ? el("div", { class: "collect-new" }, [
        el("div", { class: "field" }, [el("label", { for: "new-name", text: "姓名" }), nameInput]),
        el("div", { class: "field" }, [el("label", { for: "new-class", text: "班級" }), classInput])
      ]) : null,
      pay,
      note
    ]);
  }

  function nextStudent() {
    input.value = "";
    replace(result, []);
    input.focus();
    window.scrollTo({ top: 0 });
  }

  input.addEventListener("input", function () {
    // 全形數字轉半形，並去掉非數字。
    var clean = input.value.replace(/[０-９]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/\D/g, "");
    if (clean !== input.value) input.value = clean;
    error.hidden = true;
    input.removeAttribute("aria-invalid");
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var id = input.value.trim();
    if (!/^\d{5,10}$/.test(id)) {
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      replace(result, []);
      input.focus();
      return;
    }
    var submit = form.querySelector("button[type=submit]");
    busy(submit, "查詢中…");
    replace(result, [el("div", { class: "paycheck-card is-loading", "aria-hidden": "true" })]);
    api({ action: "lookup", id: id }).then(function (data) {
      if (!data.ok) throw new Error(data.error);
      if (data.payment) {
        replace(result, [paidCard(id, data.member ? data.member.name : "", data.payment, false)]);
      } else {
        replace(result, [unpaidCard(data)]);
        var first = result.querySelector("#new-name") || result.querySelector(".collect-pay");
        if (first) first.focus();
      }
    }).catch(function (err) {
      if (!err.handled) replace(result, [message("查詢失敗", err.message + "，請再試一次。")]);
    }).then(function () {
      idle(submit);
    });
  });

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
        var reason = prompt("作廢收據 " + item.receipt + "（" + item.name + "）\n請輸入原因：");
        if (reason === null) return;
        if (!reason.trim()) { alert("要填寫原因才能作廢。"); return; }
        busy(voidButton, "處理中…");
        api({ action: "void", receipt: item.receipt, reason: reason.trim() }).then(function (res) {
          if (!res.ok) throw new Error(res.error);
          loadToday();
        }).catch(function (err) {
          if (err.handled) return;
          idle(voidButton);
          alert("作廢失敗：" + err.message);
        });
      });
    }
    return el("li", { class: item.void ? "is-void" : "" }, [
      el("span", { class: "collect-list-time", text: item.time }),
      el("div", { class: "collect-list-main" }, [
        el("p", { text: item.name + "　" + item.id }),
        el("p", { class: "collect-list-meta", text: item.receipt + "・" + item.handler + (item.void ? "・已作廢" : "") })
      ]),
      voidButton
    ]);
  }

  function loadToday() {
    var list = $("today-list");
    api({ action: "today" }).then(function (data) {
      if (!data.ok) throw new Error(data.error);
      replace($("today-stats"), [stat("全部幹部", data.total), stat("我經手", data.mine)]);
      replace(list, data.items.length ? data.items.map(todayRow) : [el("li", { class: "collect-list-empty", text: "今天還沒有收款紀錄。" })]);
    }).catch(function (err) {
      if (!err.handled) replace(list, [el("li", { class: "collect-list-empty", text: "讀取失敗：" + err.message })]);
    });
  }

  $("today-refresh").addEventListener("click", loadToday);

  token = loadToken();
  if (token) start(token);
  setupGoogle();
})();
