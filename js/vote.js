// 線上投票：活動和題目來自試算表，學生用學校 Google 帳號登入後投票。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var API = S.config.paycheckUrl; // 和會費系統共用同一支 Apps Script
  var STATUS = { open: "投票中", upcoming: "尚未開始", closed: "已結束" };

  var list = document.getElementById("vote-list");
  var view = document.getElementById("vote-event");
  var token = null;
  var current = null;

  function replace(target, nodes) {
    target.textContent = "";
    nodes.forEach(function (node) { if (node) target.appendChild(node); });
  }

  function get(params) {
    var query = Object.keys(params).map(function (k) { return k + "=" + encodeURIComponent(params[k]); }).join("&");
    return fetch(API + "?" + query).then(function (res) { return res.json(); }).then(function (data) {
      if (!data.ok) throw new Error(data.error || "讀取失敗");
      return data;
    });
  }

  function post(body) {
    body.token = token;
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (res) { return res.json(); });
  }

  function chip(status) {
    return el("span", { class: "vote-chip is-" + status, text: STATUS[status] });
  }

  function period(e) {
    return (e.start || "未定") + " – " + (e.end || "未定");
  }

  function notice(text, kind) {
    return el("p", { class: "vote-notice" + (kind ? " is-" + kind : ""), text: text });
  }

  // ── 活動列表 ──

  function showList() {
    view.hidden = true;
    list.hidden = false;
    replace(list, [S.statusMessage("讀取中…")]);
    get({ action: "votes" }).then(function (data) {
      if (!data.events.length) return replace(list, [S.statusMessage("目前沒有投票活動。")]);
      var order = { open: 0, upcoming: 1, closed: 2 };
      var events = data.events.slice().sort(function (a, b) { return order[a.status] - order[b.status]; });
      replace(list, events.map(function (e) {
        var card = el("a", { class: "vote-card is-" + e.status, href: "?event=" + encodeURIComponent(e.id) }, [
          el("div", { class: "vote-card-head" }, [el("h2", { text: e.name }), chip(e.status)]),
          e.description ? el("p", { class: "vote-card-desc", text: e.description }) : null,
          el("p", { class: "vote-card-meta", text: period(e) })
        ]);
        card.addEventListener("click", function (event) {
          event.preventDefault();
          history.pushState(null, "", "?event=" + encodeURIComponent(e.id));
          showEvent(e.id);
        });
        return card;
      }));
    }).catch(function (err) {
      replace(list, [S.statusMessage("讀取失敗：" + err.message)]);
    });
  }

  // ── 單一活動 ──

  function showEvent(id) {
    list.hidden = true;
    view.hidden = false;
    window.scrollTo({ top: 0 });
    replace(view, [S.statusMessage("讀取中…")]);
    get({ action: "vote", event: id }).then(function (data) {
      current = data.event;
      render();
    }).catch(function (err) {
      replace(view, [backLink(), S.statusMessage(err.message)]);
    });
  }

  function backLink() {
    var link = el("a", { class: "back-link", href: "vote.html", text: "← 所有投票" });
    link.addEventListener("click", function (event) {
      event.preventDefault();
      history.pushState(null, "", "vote.html");
      showList();
    });
    return link;
  }

  function render() {
    var e = current;
    var body = el("div", { class: "vote-body" });
    replace(view, [
      backLink(),
      el("header", { class: "vote-head" }, [
        el("div", { class: "vote-card-head" }, [el("h2", { text: e.name }), chip(e.status)]),
        e.description ? el("p", { class: "vote-card-desc", text: e.description }) : null,
        el("p", { class: "vote-card-meta", text: "投票期間：" + period(e) })
      ]),
      body
    ]);
    if (e.status === "upcoming") return replace(body, [notice("投票將於 " + e.start + " 開始。")]);
    if (e.status === "closed") {
      return replace(body, e.results ? [results(e)] : [notice("投票已結束，結果尚未公布。")]);
    }
    replace(body, [signIn()]);
  }

  // ── 登入 ──

  function signIn() {
    var box = el("div", { class: "vote-signin" }, [
      el("h3", { text: "以學校 Google 帳號登入投票" }),
      el("p", { text: "請使用 s學號@student.szmc.edu.tw 登入，系統會依學號確認投票資格，每人限投一次。" }),
      el("p", { class: "vote-privacy", text: "投票內容會連同學號記錄，僅供選舉委員會查核；對外公布的結果只有各選項的票數。" }),
      el("div", { class: "signin-button", id: "vote-signin-button" }),
      el("p", { class: "vote-signin-tip", text: "無法登入時，請改用 Chrome 或 Safari 開啟此頁面。" })
    ]);
    setTimeout(function () { setupGoogle(box.querySelector("#vote-signin-button")); }, 0);
    return box;
  }

  function setupGoogle(target) {
    if (!window.google || !google.accounts) {
      setTimeout(function () { setupGoogle(target); }, 200);
      return;
    }
    google.accounts.id.initialize({
      client_id: S.config.googleClientId,
      callback: function (response) { token = response.credential; checkStatus(); },
      use_fedcm_for_prompt: true
    });
    google.accounts.id.renderButton(target, {
      theme: "filled_black", size: "large", shape: "rectangular", text: "signin_with", locale: "zh-TW", width: 280
    });
  }

  function checkStatus() {
    var body = view.querySelector(".vote-body");
    replace(body, [S.statusMessage("確認投票資格中…")]);
    post({ action: "voteStatus", event: current.id }).then(function (res) {
      if (!res.ok) {
        token = null;
        return replace(body, [notice(res.error, "error"), signIn()]);
      }
      if (!res.eligible) return replace(body, [notice("學號 " + res.id + " 沒有這次投票的資格。如有疑問，請聯絡科學會。", "error")]);
      if (res.voted) return replace(body, [notice("學號 " + res.id + " 已經投過票了，謝謝你的參與。", "ok")]);
      replace(body, [ballot(res)]);
    }).catch(function () {
      replace(body, [notice("連線失敗，請稍後再試。", "error"), signIn()]);
    });
  }

  // ── 選票 ──

  function ballot(voter) {
    var questions = current.questions;
    var answers = {};
    var form = el("form", { class: "vote-ballot", novalidate: "" });
    var progress = el("p", { class: "vote-progress-text" });
    var bar = el("span", { class: "vote-progress-fill" });
    var submit = el("button", { class: "button button-navy", type: "submit", text: "送出投票" });
    var message = el("p", { class: "form-message", role: "status" });

    function update() {
      var done = questions.filter(function (q) { return answers[q.no]; }).length;
      progress.textContent = "已完成 " + done + " / " + questions.length + " 題";
      bar.style.width = (done / questions.length * 100) + "%";
      submit.disabled = done < questions.length;
    }

    var agreeAll = null;
    if (questions.some(function (q) { return q.type === "agree"; })) {
      agreeAll = el("button", { class: "text-button vote-agree-all", type: "button", text: "全部選「同意」" });
      agreeAll.addEventListener("click", function () {
        if (!confirm("把所有「同意／反對」的題目都選成同意？送出前仍可以逐題修改。")) return;
        questions.forEach(function (q) {
          if (q.type !== "agree") return;
          answers[q.no] = "同意";
          var input = form.querySelector("input[name='q" + q.no + "'][value='同意']");
          if (input) input.checked = true;
        });
        update();
      });
    }

    var cards = questions.map(function (q) {
      var texts = [
        q.original ? el("div", { class: "vote-text" }, [el("p", { class: "vote-text-label", text: "原條文" }), el("p", { text: q.original })]) : null,
        q.revised ? el("div", { class: "vote-text is-revised" }, [el("p", { class: "vote-text-label", text: "修訂後條文" }), el("p", { text: q.revised })]) : null,
        q.note ? el("div", { class: "vote-text" }, [el("p", { class: "vote-text-label", text: "說明" }), el("p", { text: q.note })]) : null
      ];
      var options = el("div", { class: "choices vote-options" }, q.options.map(function (option) {
        var input = el("input", { type: "radio", name: "q" + q.no, value: option });
        input.addEventListener("change", function () { answers[q.no] = option; update(); });
        return el("label", {}, [input, el("span", { text: option })]);
      }));
      return el("fieldset", { class: "vote-question" }, [
        el("legend", {}, [el("span", { class: "vote-no", text: q.no }), document.createTextNode(q.title)])
      ].concat(texts, [options]));
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!confirm("送出後就不能修改，確定送出？")) return;
      submit.disabled = true;
      submit.textContent = "送出中…";
      post({ action: "voteSubmit", event: current.id, answers: answers }).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        replace(view.querySelector(".vote-body"), [notice("投票完成，謝謝你的參與！", "ok")]);
        window.scrollTo({ top: 0 });
      }).catch(function (err) {
        submit.disabled = false;
        submit.textContent = "送出投票";
        message.className = "form-message is-error";
        message.textContent = "送出失敗：" + err.message;
      });
    });

    replace(form, [
      el("div", { class: "vote-voter" }, [
        el("p", { text: "學號 " + voter.id + (voter.name ? "　" + voter.name : "") }),
        agreeAll
      ])
    ].concat(cards, [
      el("div", { class: "vote-submit-bar" }, [
        el("div", { class: "vote-progress" }, [progress, el("span", { class: "vote-progress-track" }, [bar])]),
        submit
      ]),
      message
    ]));
    update();
    return form;
  }

  // ── 結果 ──

  function results(e) {
    var r = e.results;
    return el("div", { class: "vote-results" }, [
      el("p", { class: "vote-results-total", text: "共 " + r.ballots + " 人投票" })
    ].concat(e.questions.map(function (q) {
      var counts = r.counts[q.no] || {};
      var total = Object.keys(counts).reduce(function (sum, k) { return sum + counts[k]; }, 0);
      return el("section", { class: "vote-question" }, [
        el("h3", {}, [el("span", { class: "vote-no", text: q.no }), document.createTextNode(q.title)]),
        el("ul", { class: "vote-bars" }, q.options.map(function (option) {
          var n = counts[option] || 0;
          var pct = total ? Math.round(n / total * 1000) / 10 : 0;
          return el("li", {}, [
            el("div", { class: "vote-bar-label" }, [el("span", { text: option }), el("span", { text: n + " 票（" + pct + "%）" })]),
            el("span", { class: "vote-progress-track" }, [el("span", { class: "vote-progress-fill", style: "width:" + pct + "%" })])
          ]);
        }))
      ]);
    })));
  }

  // ── 進入點 ──

  function route() {
    var id = new URLSearchParams(location.search).get("event");
    if (id) showEvent(id);
    else showList();
  }

  window.addEventListener("popstate", route);
  if (!API) replace(list, [S.statusMessage("網站還沒有設定 Apps Script 網址。")]);
  else route();
})();
