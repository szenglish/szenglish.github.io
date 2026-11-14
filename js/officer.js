// 幹部專區：列出所有管理工具，登入後顯示待處理件數。
// 件數直接用各頁原本的後端功能（today、feedbackList、borrowList）計算，不需要另外的 Apps Script 功能。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var API = S.config.paycheckUrl;

  var who = document.getElementById("officer-who");
  var list = document.getElementById("officer-tools");
  var token = null;

  var ICONS = {
    pay: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    feedback: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    borrow: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>',
    cms: '<path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    sheet: '<path d="M4 4h16v16H4z"/><path d="M4 10h16M4 15h16M10 4v16"/>',
    guide: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h6"/>'
  };

  var TOOLS = [
    { key: "pay", href: "collect.html", title: "收會費", desc: "會費管理平台：查詢學號、收款與作廢" },
    { key: "feedback", href: "feedback.html?admin=1", title: "意見處理", desc: "回覆意見反映、更新處理狀態" },
    { key: "borrow", href: "borrow.html", title: "器材借用審核", desc: "審核申請、登記借出與歸還" },
    { key: "cms", href: "admin/", title: "網站內容後台", desc: "發布月刊、活動與文件" },
    { key: "sheet", href: "https://docs.google.com/spreadsheets/", title: "Google 試算表", desc: "開啟「會費繳費系統」查看原始資料", external: true },
    { key: "guide", href: "https://github.com/szenglish/szenglish.github.io/blob/main/%E7%B6%B2%E7%AB%99%E5%85%A7%E5%AE%B9%E6%93%8D%E4%BD%9C%E8%AA%AA%E6%98%8E.md", title: "操作說明", desc: "各項功能的使用方式與交接事項", external: true }
  ];

  var badges = {};

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
    }).then(function (res) { return res.json(); });
  }

  function icon(key) {
    var span = el("span", { class: "service-icon", "aria-hidden": "true" });
    span.innerHTML = '<svg viewBox="0 0 24 24">' + ICONS[key] + "</svg>";
    return span;
  }

  function renderTools() {
    replace(list, TOOLS.map(function (t) {
      var props = { class: "service-card officer-tool", href: t.href };
      if (t.external) {
        props.target = "_blank";
        props.rel = "noopener";
      }
      var badge = badges[t.key];
      return el("li", {}, [el("a", props, [
        icon(t.key),
        el("span", { class: "service-text" }, [
          el("b", { text: t.title }),
          el("span", { text: t.desc }),
          badge ? el("span", { class: "officer-badge" + (badge.alert ? " is-alert" : ""), text: badge.text }) : null
        ]),
        el("span", { class: "service-go", "aria-hidden": "true", text: t.external ? "↗" : "→" })
      ])]);
    }));
  }

  // ── 登入 ──

  function showSignin(message) {
    var box = el("div", { class: "vote-signin officer-signin" }, [
      el("h3", { text: "登入以查看待處理事項" }),
      el("p", { text: "請以登記於幹部名單之 Google 帳號登入。登入後，各項工具將顯示待處理件數。" }),
      el("div", { class: "signin-button", id: "officer-signin-button" })
    ]);
    replace(who, [message ? el("p", { class: "vote-notice is-error", text: message }) : null, box]);
    setupGoogle(box.querySelector("#officer-signin-button"));
  }

  function setupGoogle(target) {
    if (!window.google || !google.accounts) {
      setTimeout(function () { setupGoogle(target); }, 200);
      return;
    }
    google.accounts.id.initialize({
      client_id: S.config.googleClientId,
      callback: function (response) { token = response.credential; load(); },
      use_fedcm_for_prompt: true
    });
    google.accounts.id.renderButton(target, {
      theme: "filled_black", size: "large", shape: "rectangular", text: "signin_with", locale: "zh-TW", width: 280
    });
  }

  function load() {
    replace(who, [S.statusMessage("正在讀取待處理事項…")]);
    Promise.all([
      post({ action: "feedbackList" }),
      post({ action: "borrowList" }),
      post({ action: "today" })
    ]).then(function (res) {
      var fb = res[0], borrow = res[1], today = res[2];
      if (!fb.ok) {
        token = null;
        return showSignin(fb.error || "登入失敗");
      }
      var officer = fb.officer;

      var pending = fb.items.filter(function (c) { return c.status === "已收到" || c.status === "處理中"; });
      var mine = officer.dept ? pending.filter(function (c) {
        return c.dept === officer.dept || (officer.dept === "正副會長" && c.dept === "不指定");
      }) : pending;
      badges.feedback = mine.length
        ? { text: (officer.dept ? officer.dept + "待處理 " : "待處理 ") + mine.length + " 件", alert: true }
        : { text: "目前無待處理案件" };

      if (borrow.ok) {
        var roles = borrow.roles || {};
        var waiting = borrow.items.filter(function (r) {
          return (roles.equip && r.status === "待器材長審核") || (roles.president && r.status === "待會長審核");
        }).length;
        var ready = borrow.items.filter(function (r) { return r.status === "已核准" || r.status === "已借出"; }).length;
        badges.borrow = waiting
          ? { text: "待您審核 " + waiting + " 件", alert: true }
          : { text: ready ? "待借出／歸還 " + ready + " 件" : "目前無待審核申請" };
      }

      if (today.ok) {
        badges.pay = { text: "今日已收 " + today.total.count + " 筆（NT$ " + today.total.amount.toLocaleString() + "）" };
      }

      renderTools();
      renderWho(officer);
    }).catch(function () {
      showSignin("系統連線失敗，請稍後再試。");
    });
  }

  function renderWho(officer) {
    var profile = S.googleProfile(token);
    var change = el("button", { class: "text-button borrow-switch", type: "button", text: "換帳號" });
    change.addEventListener("click", function () {
      token = null;
      badges = {};
      if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
      renderTools();
      showSignin();
    });
    replace(who, [el("div", { class: "borrow-who" }, [
      S.avatar(officer.name, profile.picture),
      el("div", { class: "borrow-who-text" }, [
        el("p", { class: "borrow-who-name", text: officer.name }),
        el("p", { class: "borrow-who-meta" }, [
          el("span", { class: "borrow-tag is-officer", text: officer.title || "幹部" }),
          officer.dept ? el("span", { class: "borrow-tag", text: officer.dept }) : null,
          profile.email ? el("span", { class: "borrow-who-email", text: profile.email }) : null
        ])
      ]),
      change
    ])]);
  }

  renderTools();
  if (!API) replace(who, [el("p", { class: "vote-notice is-error", text: "網站尚未設定 Apps Script 網址。" })]);
  else showSignin();
})();
