// 各頁面依 body 的 data-page 繪製新聞內容。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var LOAD_ERROR = "資料暫時載不出來，請稍後再試，或到 Instagram 查看最新消息。";
  var NEWS_PAGE_SIZE = 9;

  function replace(target, nodes) {
    target.textContent = "";
    nodes.forEach(function (node) {
      if (node) target.appendChild(node);
    });
  }

  // 「不公開連結」的文章不出現在列表和上下篇，但知道網址仍可打開。
  function listed(news) {
    return news.filter(function (item) { return !item.unlisted; });
  }

  function leadStory(item, className) {
    return el("a", { class: className, href: S.articleUrl(item) }, [
      el("div", { class: "lead-image" }, [S.coverImage(item)]),
      el("div", { class: "lead-text" }, [
        el("time", { class: "date", datetime: item.date.replace(/\//g, "-"), text: item.date }),
        el("h3", { class: "lead-title", text: item.title }),
        el("p", { class: "excerpt", text: item.excerpt }),
        el("span", { class: "read-more", text: "閱讀全文 →" })
      ])
    ]);
  }

  function card(item) {
    return el("a", { class: "card", href: S.articleUrl(item) }, [
      el("div", { class: "card-image" }, [S.coverImage(item)]),
      el("time", { class: "date", datetime: item.date.replace(/\//g, "-"), text: item.date }),
      el("h3", { class: "card-title", text: item.title })
    ]);
  }

  function row(item) {
    return el("a", { class: "row", href: S.articleUrl(item) }, [
      el("div", { class: "row-image" }, [S.coverImage(item)]),
      el("div", {}, [
        el("time", { class: "date", datetime: item.date.replace(/\//g, "-"), text: item.date }),
        el("h3", { class: "row-title", text: item.title })
      ])
    ]);
  }

  function today() {
    var now = new Date();
    return now.getFullYear() + "/" + String(now.getMonth() + 1).padStart(2, "0") + "/" + String(now.getDate()).padStart(2, "0");
  }

  // 即將舉行的活動排最前面（最近的先），接著是剛結束的活動。
  function sortEvents(events) {
    var now = today();
    function isUpcoming(item) { return (item.endDate || item.date) >= now; }
    var upcoming = events.filter(isUpcoming).sort(function (a, b) { return a.date.localeCompare(b.date); });
    var past = events.filter(function (item) { return !isUpcoming(item); }).sort(function (a, b) { return b.date.localeCompare(a.date); });
    return upcoming.concat(past);
  }

  function eventItem(item) {
    var upcoming = (item.endDate || item.date) >= today();
    var parts = item.date.split("/");
    var content = [
      el("div", { class: "event-date" + (upcoming ? " is-upcoming" : "") }, [
        el("span", { class: "event-day", text: parts[1] + "." + parts[2] }),
        el("span", { class: "event-year", text: parts[0] })
      ]),
      el("div", { class: "event-body" }, [
        upcoming ? el("span", { class: "event-status", text: "即將舉行" }) : null,
        el("h3", { class: "event-title", text: item.title }),
        item.endDate ? el("p", { class: "event-place", text: "至 " + item.endDate }) : null,
        item.place ? el("p", { class: "event-place", text: item.place }) : null
      ])
    ];
    var box = item.link
      ? el("a", { class: "event", href: item.link }, content)
      : el("div", { class: "event" }, content);
    return el("li", {}, [box]);
  }

  function currentTerm(members) {
    return members.reduce(function (max, member) {
      return Math.max(max, Number(member.term) || 0);
    }, 0);
  }

  function renderHome() {
    var target = document.getElementById("latest-news");
    var eventsTarget = document.getElementById("recent-events");
    S.loadData(function (data) {
      var news = listed(data.news);
      var term = currentTerm(data.members);
      if (term) document.getElementById("hero-term").textContent = "第 " + term + " 屆";
      replace(eventsTarget, data.events.length
        ? [el("ul", { class: "event-list" }, sortEvents(data.events).slice(0, 4).map(eventItem))]
        : [S.statusMessage("目前沒有活動資訊。")]);
      if (!news.length) return replace(target, [S.statusMessage("目前還沒有新聞。")]);
      replace(target, [
        el("div", { class: "home-news" }, [
          leadStory(news[0], "lead"),
          el("div", {}, news.slice(1, 4).map(row))
        ])
      ]);
    }, function () {
      replace(eventsTarget, [S.statusMessage(LOAD_ERROR)]);
      replace(target, [S.statusMessage(LOAD_ERROR)]);
    });
  }

  function renderNews() {
    var target = document.getElementById("news-list");
    var filter = document.getElementById("year-filter");
    var all = [];
    var year = "全部";
    var shown = NEWS_PAGE_SIZE;

    function draw() {
      var items = all.filter(function (item) {
        return year === "全部" || item.date.slice(0, 4) === year;
      });
      var cards = items.slice(1, shown + 1);
      var remaining = items.length - 1 - cards.length;
      var more = null;
      if (remaining > 0) {
        more = el("button", { class: "load-more", type: "button", text: "載入更多（還有 " + remaining + " 篇）" });
        more.addEventListener("click", function () {
          shown += NEWS_PAGE_SIZE;
          draw();
        });
      }
      replace(target, items.length
        ? [leadStory(items[0], "lead lead-wide"), el("div", { class: "card-grid" }, cards.map(card)), more]
        : [S.statusMessage("目前還沒有新聞。")]);
    }

    function drawFilter() {
      var years = ["全部"];
      all.forEach(function (item) {
        var y = item.date.slice(0, 4);
        if (years.indexOf(y) < 0) years.push(y);
      });
      replace(filter, years.map(function (y) {
        var button = el("button", { type: "button", "aria-pressed": String(y === year), text: y });
        button.addEventListener("click", function () {
          year = y;
          shown = NEWS_PAGE_SIZE;
          drawFilter();
          draw();
        });
        return button;
      }));
    }

    S.loadData(function (data) {
      all = listed(data.news);
      drawFilter();
      draw();
    }, function () {
      replace(target, [S.statusMessage(LOAD_ERROR)]);
    });
  }

  // 內文是後台寫入的 Markdown；排版工具載入失敗時退回純文字段落。
  function bodyNodes(body) {
    if (window.marked && window.DOMPurify) {
      var box = el("div");
      box.innerHTML = window.DOMPurify.sanitize(window.marked.parse(body));
      box.querySelectorAll("img").forEach(function (img) { img.loading = "lazy"; });
      box.querySelectorAll("a[href^='http']").forEach(function (link) {
        link.target = "_blank";
        link.rel = "noopener";
      });
      return Array.prototype.slice.call(box.childNodes);
    }
    return body.split(/\n\s*\n/).map(function (block) {
      var text = block.trim();
      if (!text) return null;
      if (text.indexOf("## ") === 0) return el("h2", { text: text.slice(3) });
      return el("p", { text: text });
    }).filter(Boolean);
  }

  function renderArticle() {
    var target = document.getElementById("article");
    var id = new URLSearchParams(location.search).get("id");

    S.loadData(function (data) {
      var news = data.news;
      var index = news.findIndex(function (item) { return item.id === id; });
      if (index < 0) {
        return replace(target, [
          S.statusMessage("找不到這篇文章，可能已經移除。"),
          el("a", { class: "back-link", href: "news.html", text: "← 回應英月刊" })
        ]);
      }
      var item = news[index];
      var public_ = listed(news);
      var position = public_.indexOf(item);
      var newer = position > 0 ? public_[position - 1] : null;
      var older = position >= 0 ? public_[position + 1] : null;
      if (item.unlisted) {
        document.head.appendChild(el("meta", { name: "robots", content: "noindex" }));
      }
      document.title = item.title + "｜應用英語科學會";

      replace(target, [
        el("a", { class: "back-link", href: "news.html", text: "← 回應英月刊" }),
        el("header", { class: "article-head" }, [
          el("time", { class: "date", datetime: item.date.replace(/\//g, "-"), text: item.date }),
          el("h1", { text: item.title }),
          item.author ? el("p", { class: "byline", text: "文／" + item.author }) : null
        ]),
        item.cover ? el("img", { class: "article-cover", src: item.cover, alt: "" }) : null,
        el("div", { class: "article-body" }, item.body
          ? bodyNodes(item.body)
          : [el("p", { text: item.excerpt })]),
        item.sourceUrl ? el("p", { class: "source-note" }, [
          el("span", { text: "這篇尚未搬到新網站。" }),
          el("a", { href: item.sourceUrl, text: "到現有網站閱讀全文 →" })
        ]) : null,
        (item.photos || []).length ? el("div", { class: "gallery" }, item.photos.map(function (group) {
          return el("figure", { class: "photo-group" }, [
            el("div", { class: "photo-group-images" }, group.images.map(function (src) {
              return el("img", { src: src, alt: group.caption || "活動照片", loading: "lazy" });
            })),
            group.caption ? el("figcaption", { text: group.caption }) : null
          ]);
        })) : null,
        el("nav", { class: "article-pager", "aria-label": "其他文章" }, [
          newer ? el("a", { href: S.articleUrl(newer) }, [
            el("span", { class: "pager-label", text: "← 較新" }),
            el("span", { text: newer.title })
          ]) : el("span"),
          older ? el("a", { class: "pager-older", href: S.articleUrl(older) }, [
            el("span", { class: "pager-label", text: "較舊 →" }),
            el("span", { text: older.title })
          ]) : null
        ])
      ]);
    }, function () {
      replace(target, [S.statusMessage(LOAD_ERROR)]);
    });
  }

  function splitName(name) {
    var match = String(name).match(/^(\S+)\s+(.+)$/);
    return match ? { zh: match[1], en: match[2] } : { zh: name, en: "" };
  }

  function portrait(person) {
    return el("span", { class: "person-photo" }, [
      el("span", { class: "person-initial", text: person.name.charAt(0) }),
      person.photo ? el("img", { src: person.photo, alt: "", loading: "lazy" }) : null
    ]);
  }

  // 經歷每行拆成學期與內容；開頭不是學期或年份時整行顯示。
  function historyRow(line, tag) {
    var match = line.match(/^(\d{3}-\d|\d{4})\s*(.+)$/);
    if (!match) return el(tag, { class: "history-plain", text: line });
    return el(tag, {}, [
      el("span", { class: "history-term", text: match[1] }),
      el("span", { text: match[2] })
    ]);
  }

  function historyList(member) {
    var history = member.history || [];
    if (!history.length) return null;

    function rows(lines) {
      return el("ul", { class: "member-history" }, lines.map(function (line) {
        return historyRow(line, "li");
      }));
    }

    // 以 # 開頭的行是分類小標題，例如「# 學歷」。
    var groups = [];
    history.forEach(function (line) {
      var heading = line.match(/^#\s*(.+)$/);
      if (heading) groups.push({ title: heading[1], lines: [] });
      else if (groups.length) groups[groups.length - 1].lines.push(line);
      else groups.push({ title: "", lines: [line] });
    });
    if (groups.length === 1 && !groups[0].title) {
      return rows(history);
    }
    return el("div", { class: "history-groups" }, groups.map(function (group) {
      // 小標題可寫成「學歷 Education」，中文後面的英文另外排版。
      var title = group.title.match(/^(.*?)\s+([A-Za-z].*)$/);
      return el("section", { class: "history-group" }, [
        group.title ? el("h4", {}, title ? [
          document.createTextNode(title[1]),
          el("span", { class: "history-group-en", lang: "en", text: title[2] })
        ] : [document.createTextNode(group.title)]) : null,
        rows(group.lines)
      ]);
    }));
  }

  // 成員卡片：照片、職稱、姓名與經歷都直接顯示。
  function memberCard(member, large) {
    var name = splitName(member.name);
    return el("article", { class: "member" + (large ? " member-large" : "") }, [
      portrait(member),
      el("div", { class: "member-text" }, [
        el("h3", { class: "member-name" }, [
          document.createTextNode(name.zh),
          name.en ? el("span", { class: "member-en", lang: "en", text: name.en }) : null
        ]),
        el("p", { class: "member-title", text: member.title }),
        historyList(member)
      ])
    ]);
  }

  // 分頁：左邊選項目，右邊只顯示該項目的成員。領導團隊與部門共用。
  function renderTabs(target, items, panelId, large) {
    if (!items.length) return replace(target, []);
    var panel = el("div", { class: "dept-panel", id: panelId, role: "tabpanel", tabindex: "-1" });
    var tabs = items.map(function (item, index) {
      var tab = el("button", { class: "dept-tab", type: "button", role: "tab", "aria-controls": panelId }, [
        el("span", { class: "dept-tab-en", lang: "en", text: item.en }),
        el("span", { class: "dept-tab-zh", text: item.zh })
      ]);
      tab.addEventListener("click", function () { select(index); });
      tab.addEventListener("keydown", function (event) {
        var next = {
          ArrowDown: index + 1, ArrowRight: index + 1,
          ArrowUp: index - 1, ArrowLeft: index - 1,
          Home: 0, End: items.length - 1
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        select((next + items.length) % items.length, true);
      });
      return tab;
    });

    function select(index, focus) {
      tabs.forEach(function (tab, i) {
        tab.setAttribute("aria-selected", String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
      });
      // 手機版的清單可橫向捲動：把選中的項目捲到中間，但不移動整頁。
      var listBox = tablist.getBoundingClientRect();
      var tabBox = tabs[index].getBoundingClientRect();
      tablist.scrollBy({ left: tabBox.left - listBox.left - (listBox.width - tabBox.width) / 2, behavior: "smooth" });
      if (focus) tabs[index].focus({ preventScroll: true });
      panel.setAttribute("aria-label", items[index].zh);
      replace(panel, items[index].members.map(function (member) {
        return memberCard(member, large);
      }));
    }

    var tablist = el("div", { class: "dept-tablist", role: "tablist" }, tabs);
    replace(target, [el("div", { class: "dept-tabs" }, [tablist, panel])]);
    select(0);
  }

  // 頁內導覽：標示目前捲到的區塊。
  function setupSubNav() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".sub-nav a"));
    var sections = links.map(function (link) {
      return document.querySelector(link.getAttribute("href"));
    });

    function update() {
      var current = 0;
      sections.forEach(function (section, index) {
        if (section.getBoundingClientRect().top <= 170) current = index;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = sections.length - 1;
      }
      links.forEach(function (link, index) {
        if (index === current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return update;
  }

  function renderAbout() {
    var updateSubNav = setupSubNav();
    var leadership = document.getElementById("leadership-list");
    var departments = document.getElementById("department-list");
    var filter = document.getElementById("term-filter");
    var LEADERS = ["指導老師", "正副會長", "執行長", "顧問"];
    var LEADER_EN = {
      "指導老師": "Supervisor",
      "會長": "President",
      "副會長": "Vice President",
      "執行長": "CEO",
      "顧問": "Consultant"
    };
    var all = [];
    var term = 0;

    function draw() {
      var people = all.filter(function (member) { return Number(member.term) === term; });
      var groups = [];
      people.filter(function (member) {
        return LEADERS.indexOf(member.dept) < 0;
      }).forEach(function (member) {
        var group = groups.filter(function (item) { return item.zh === member.dept; })[0];
        if (!group) {
          group = { zh: member.dept, en: (member.deptEn || member.dept).replace(/ Department$/, ""), members: [] };
          groups.push(group);
        }
        group.members.push(member);
      });
      var leaders = people.filter(function (member) {
        return LEADERS.indexOf(member.dept) >= 0;
      }).map(function (member) {
        return { zh: member.title, en: LEADER_EN[member.title] || member.title, members: [member] };
      });

      if (people.length) renderTabs(leadership, leaders, "leader-panel", true);
      else replace(leadership, [S.statusMessage("目前還沒有幹部資料。")]);
      renderTabs(departments, groups, "dept-panel", false);
    }

    function drawFilter() {
      var terms = [];
      all.forEach(function (member) {
        var value = Number(member.term);
        if (value && terms.indexOf(value) < 0) terms.push(value);
      });
      terms.sort(function (a, b) { return b - a; });
      replace(filter, terms.length > 1 ? terms.map(function (value) {
        var button = el("button", { type: "button", "aria-pressed": String(value === term), text: "第 " + value + " 屆" });
        button.addEventListener("click", function () {
          term = value;
          drawFilter();
          draw();
        });
        return button;
      }) : []);
      filter.hidden = terms.length < 2;
    }

    S.loadData(function (data) {
      all = data.members;
      term = currentTerm(all);
      drawFilter();
      draw();
      updateSubNav();
    }, function () {
      replace(leadership, [S.statusMessage(LOAD_ERROR)]);
    });
  }

  function renderFeedback() {
    var form = document.getElementById("feedback-form");
    var message = document.getElementById("feedback-message");
    var submit = form.querySelector("button[type=submit]");
    var FIELDS = ["grade", "rating", "completed", "suggestion"];

    function value(name) {
      return form.elements[name].value.trim();
    }

    function showError(name, show) {
      var error = document.getElementById("error-" + name);
      error.hidden = !show;
    }

    FIELDS.forEach(function (name) {
      form.querySelectorAll("[name=" + name + "]").forEach(function (input) {
        input.addEventListener("input", function () { showError(name, !value(name)); });
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var invalid = FIELDS.filter(function (name) {
        var missing = !value(name);
        showError(name, missing);
        return missing;
      });
      if (invalid.length) {
        form.querySelector("[name=" + invalid[0] + "]").focus();
        message.className = "form-message is-error";
        message.textContent = "還有 " + invalid.length + " 題沒有填寫。";
        return;
      }
      // 機器人才會填這個隱藏欄位。
      if (value("website")) return;
      if (!S.config.feedbackUrl) {
        message.className = "form-message";
        message.textContent = "試作版尚未連接試算表，這次不會真的送出。";
        return;
      }

      submit.disabled = true;
      submit.textContent = "送出中…";
      message.textContent = "";
      fetch(S.config.feedbackUrl, {
        method: "POST",
        // 用 text/plain 才不會觸發 Apps Script 不支援的跨網域預檢。
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          grade: value("grade"),
          rating: value("rating"),
          completed: value("completed"),
          suggestion: value("suggestion"),
          website: value("website")
        })
      }).then(function (res) {
        return res.json();
      }).then(function (result) {
        if (!result.ok) throw new Error(result.error || "送出失敗");
        replace(form, [
          el("div", { class: "form-success", tabindex: "-1" }, [
            el("h3", { text: "謝謝你的意見！" }),
            el("p", { text: "我們已經收到，會作為改善網站的參考。" })
          ])
        ]);
        form.querySelector(".form-success").focus();
      }).catch(function (err) {
        console.error("意見送出失敗", err);
        submit.disabled = false;
        submit.textContent = "送出意見";
        message.className = "form-message is-error";
        message.textContent = "送出失敗，你填的內容還在，請稍後再試，或寄信到 " + S.config.email + "。";
      });
    });
  }

  function fileType(name) {
    var match = String(name).match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toUpperCase() : "檔案";
  }

  function renderDocuments() {
    var target = document.getElementById("documents");
    S.loadData(function (data) {
      var groups = [];
      data.documents.forEach(function (file) {
        var group = groups.filter(function (item) { return item.category === file.category; })[0];
        if (!group) {
          group = { category: file.category, files: [] };
          groups.push(group);
        }
        group.files.push(file);
      });
      replace(target, groups.length ? groups.map(function (group) {
        return el("section", { class: "doc-group" }, [
          el("h2", { text: group.category }),
          el("ul", { class: "doc-list" }, group.files.map(function (file) {
            return el("li", {}, [
              el("a", { class: "doc", href: file.url, target: "_blank", rel: "noopener" }, [
                el("span", { class: "doc-type", text: fileType(file.name) }),
                el("span", { class: "doc-name", text: file.name.replace(/\.[a-z0-9]+$/i, "") }),
                el("span", { class: "doc-arrow", "aria-hidden": "true", text: "↗" })
              ])
            ]);
          }))
        ]);
      }) : [S.statusMessage("目前還沒有文件。")]);
    }, function () {
      replace(target, [S.statusMessage(LOAD_ERROR)]);
    });
  }

  // 評鑑專區：把幹部、活動和文件整理在同一頁，資料和網站其他頁面共用。
  function renderEvaluation() {
    var updateSubNav = setupSubNav();
    var organization = document.getElementById("organization-list");
    var activities = document.getElementById("activity-list");

    S.loadData(function (data) {
      var term = currentTerm(data.members);
      if (term) document.getElementById("evaluation-term").textContent = "第 " + term + " 屆應用英語科學會 成果展示";

      var rows = data.members.filter(function (member) {
        return Number(member.term) === term;
      }).map(function (member) {
        return el("tr", {}, [
          el("td", { text: member.dept }),
          el("td", { text: member.title }),
          el("td", { text: member.name })
        ]);
      });
      replace(organization, rows.length ? [
        el("div", { class: "org-table-wrap" }, [
          el("table", { class: "org-table" }, [
            el("thead", {}, [el("tr", {}, [
              el("th", { scope: "col", text: "單位" }),
              el("th", { scope: "col", text: "職稱" }),
              el("th", { scope: "col", text: "姓名" })
            ])]),
            el("tbody", {}, rows)
          ])
        ])
      ] : [S.statusMessage("目前還沒有幹部資料。")]);

      var news = listed(data.news);
      replace(activities, news.length
        ? [el("div", { class: "card-grid evaluation-cards" }, news.map(card))]
        : [S.statusMessage("目前還沒有活動報導。")]);
      updateSubNav();
    }, function () {
      replace(organization, [S.statusMessage(LOAD_ERROR)]);
      replace(activities, [S.statusMessage(LOAD_ERROR)]);
    });
    renderDocuments();
  }

  var page = document.body.getAttribute("data-page");
  if (page === "home") renderHome();
  if (page === "about") renderAbout();
  if (page === "documents") renderDocuments();
  if (page === "evaluation") renderEvaluation();
  if (page === "contact") renderFeedback();
  if (page === "news") renderNews();
  if (page === "article") renderArticle();
})();
