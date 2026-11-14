// 各頁面依 body 的 data-page 繪製新聞內容。
(function () {
  var S = window.SZAE;
  var el = S.el;
  var LOAD_ERROR = "資料暫時載不出來，請稍後再試，或到 Instagram 查看最新消息。";

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

  // 已結束、而且在後台選了「相關報導」的活動，卡片連到那篇報導。
  // 報導是草稿或被刪掉時 report 找不到文章，就不顯示連結。
  function eventItem(item, news) {
    var upcoming = (item.endDate || item.date) >= today();
    var parts = item.date.split("/");
    var report = !upcoming && item.report ? news.filter(function (n) { return n.id === item.report; })[0] : null;
    var href = report ? S.articleUrl(report) : item.link;
    var content = [
      el("div", { class: "event-date" + (upcoming ? " is-upcoming" : "") }, [
        el("span", { class: "event-day", text: parts[1] + "." + parts[2] }),
        el("span", { class: "event-year", text: parts[0] })
      ]),
      el("div", { class: "event-body" }, [
        upcoming ? el("span", { class: "event-status", text: "即將舉行" }) : null,
        el("h3", { class: "event-title", text: item.title }),
        item.endDate ? el("p", { class: "event-place", text: "至 " + item.endDate }) : null,
        item.place ? el("p", { class: "event-place", text: item.place }) : null,
        report ? el("span", { class: "event-report", text: "查看報導 →" }) : null
      ])
    ];
    var box = href
      ? el("a", { class: "event", href: href }, content)
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
        ? [el("ul", { class: "event-list" }, sortEvents(data.events).slice(0, 4).map(function (item) { return eventItem(item, data.news); }))]
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

    function draw() {
      var items = all.filter(function (item) {
        return year === "全部" || item.date.slice(0, 4) === year;
      });
      replace(target, items.length
        ? [leadStory(items[0], "lead lead-wide"), el("div", { class: "card-grid" }, items.slice(1).map(card))]
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

  // 內文照片獨立成一塊，後台的「Alt Text」（沒填時用 Title）當作照片下方的說明。
  function captionImages(box) {
    box.querySelectorAll("p").forEach(function (p) {
      var imgs = p.querySelectorAll("img");
      if (!imgs.length) return;
      var figures = Array.prototype.map.call(imgs, function (img) {
        var caption = (img.getAttribute("alt") || img.getAttribute("title") || "").trim();
        img.loading = "lazy";
        img.removeAttribute("title");
        if (!caption) img.alt = "文章照片";
        var holder = img.parentNode.tagName === "A" ? img.parentNode : img;
        holder.remove();
        return el("figure", { class: "body-photo" }, [
          holder,
          caption ? el("figcaption", { text: caption }) : null
        ]);
      });
      var after = p.nextSibling;
      figures.forEach(function (figure) { p.parentNode.insertBefore(figure, after); });
      if (!p.textContent.trim()) p.remove();
    });
  }

  // 一段裡只有一個 YouTube 網址時，換成影片播放器。
  function youtubeId(url) {
    var m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url);
    return m ? m[1] : null;
  }

  function embedVideos(box) {
    box.querySelectorAll("p").forEach(function (p) {
      var links = p.querySelectorAll("a");
      var text = p.textContent.trim();
      var url = links.length === 1 ? links[0].href : (links.length === 0 ? text : "");
      var id = youtubeId(url);
      if (!id || (links.length === 1 && text !== links[0].textContent.trim())) return;
      p.replaceWith(el("div", { class: "video-embed" }, [
        el("iframe", {
          src: "https://www.youtube-nocookie.com/embed/" + id,
          title: "YouTube 影片",
          loading: "lazy",
          allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen",
          allowfullscreen: "",
          referrerpolicy: "strict-origin-when-cross-origin"
        })
      ]));
    });
  }

  // 內文是後台寫入的 Markdown；排版工具載入失敗時退回純文字段落。
  function bodyNodes(body) {
    if (window.marked && window.DOMPurify) {
      var box = el("div");
      box.innerHTML = window.DOMPurify.sanitize(window.marked.parse(body));
      captionImages(box);
      embedVideos(box);
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
    // 分享頁是 news/<id>/，舊連結是 article.html?id=<id>，兩種都支援。
    var pathId = /\/news\/([^/]+)\/?$/.exec(location.pathname);
    var id = new URLSearchParams(location.search).get("id") || (pathId && decodeURIComponent(pathId[1]));

    S.loadData(function (data) {
      var news = data.news;
      var index = news.findIndex(function (item) { return item.id === id; });
      if (index < 0) {
        return replace(target, [
          S.statusMessage("找不到這篇文章，可能已經移除。"),
          el("a", { class: "back-link", href: "news.html", text: "← 返回單元首頁" })
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
        el("a", { class: "back-link", href: "news.html", text: "← 返回單元首頁" }),
        el("header", { class: "article-head" }, [
          el("time", { class: "date", datetime: item.date.replace(/\//g, "-"), text: item.date }),
          el("h1", { text: item.title }),
          item.author ? el("p", { class: "byline", text: "文／" + item.author }) : null
        ]),
        item.cover ? el("img", { class: "article-cover", src: item.cover, alt: "" }) : null,
        el("div", { class: "article-body" }, item.body
          ? bodyNodes(item.body)
          : [el("p", { text: item.excerpt })]),
        (item.photos || []).length ? el("div", { class: "gallery" + (item.photoNumbers === false ? "" : " numbered") }, item.photos.map(function (group) {
          return el("figure", { class: "photo-group" }, [
            el("div", { class: "photo-group-images" }, group.images.map(function (src) {
              return el("div", { class: "photo-item" }, [
                el("img", { src: src, alt: group.caption || "活動照片", loading: "lazy" })
              ]);
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
        ]),
        // 讀完文章的人在頁面底部，這裡也放一個返回列表。
        el("a", { class: "back-bottom", href: "news.html", text: "← 返回單元首頁" })
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

  // 組織架構圖：結構很少變動，直接寫在這裡。新增或改名部門時改這裡。
  var ORG = {
    chain: ["首長室", "行政中心", "執行長"],
    departments: ["秘書處", "企劃部", "廣宣部", "器材部", "財務部", "公關部"],
    independent: { name: "選舉委員會", note: "獨立運作" },
    advisory: { name: "顧問團", note: "諮詢單位" }
  };

  function orgChart() {
    var chain = ORG.chain.map(function (name) {
      return el("li", { class: "org-node org-lead", text: name });
    });
    return el("figure", { class: "org-chart" }, [
      el("ol", { class: "org-chain", "aria-label": "指揮層級" }, chain),
      el("div", { class: "org-side" }, [
        el("p", { class: "org-node org-independent" }, [
          el("span", { text: ORG.independent.name }),
          el("small", { text: ORG.independent.note })
        ])
      ]),
      // 顧問團給會長建議，不在指揮線上：用虛線接到首長室。
      el("div", { class: "org-advise" }, [
        el("p", { class: "org-node org-advisory" }, [
          el("span", { text: ORG.advisory.name }),
          el("small", { text: ORG.advisory.note })
        ])
      ]),
      el("ul", { class: "org-depts", "aria-label": "執行部門" }, ORG.departments.map(function (name) {
        return el("li", { class: "org-node org-dept", text: name });
      })),
      el("figcaption", { class: "visually-hidden", text: "應用英語科學會組織架構：首長室、行政中心、執行長，下設六個部門；顧問團為首長室的諮詢單位；選舉委員會獨立運作。" })
    ]);
  }

  function renderOrgCharts() {
    document.querySelectorAll(".org-chart-slot").forEach(function (slot) {
      replace(slot, [orgChart()]);
    });
  }

  function renderAbout() {
    renderOrgCharts();
    var updateSubNav = setupSubNav();
    var leadership = document.getElementById("leadership-list");
    var departments = document.getElementById("department-list");
    var filter = document.getElementById("term-filter");
    var advisors = document.getElementById("advisor-list");
    var advisorSection = document.getElementById("advisors");
    // 顧問不在指揮線上，和組織架構圖一致，獨立成「顧問團」一段。
    var ADVISOR = "顧問";
    var LEADERS = ["指導老師", "正副會長", "執行長"];
    var LEADER_EN = {
      "指導老師": "Supervisor",
      "會長": "President",
      "副會長": "Vice President",
      "執行長": "CEO"
    };
    var all = [];
    var term = 0;

    function draw() {
      var people = all.filter(function (member) { return Number(member.term) === term; });
      var groups = [];
      people.filter(function (member) {
        return LEADERS.indexOf(member.dept) < 0 && member.dept !== ADVISOR;
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

      var advisorPeople = people.filter(function (member) { return member.dept === ADVISOR; });
      advisorSection.hidden = !advisorPeople.length;
      document.querySelector('.sub-nav a[href="#advisors"]').hidden = !advisorPeople.length;
      if (advisorPeople.length) {
        // 和領導團隊一樣，分頁顯示職稱；顧問不只一位時改顯示姓名，才分得出來。
        var several = advisorPeople.length > 1;
        renderTabs(advisors, advisorPeople.map(function (member) {
          return {
            zh: several ? member.name.replace(/\s+[A-Za-z].*$/, "") : (member.title || ADVISOR),
            en: "Consultant",
            members: [member]
          };
        }), "advisor-panel", true);
      }
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
    var FIELDS = ["name", "email", "suggestion"];
    var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function value(name) {
      return form.elements[name].value.trim();
    }

    function invalidField(name) {
      return !value(name) || (name === "email" && !EMAIL.test(value("email")));
    }

    function showError(name, show) {
      var error = document.getElementById("error-" + name);
      error.hidden = !show;
    }

    FIELDS.forEach(function (name) {
      form.querySelectorAll("[name=" + name + "]").forEach(function (input) {
        input.addEventListener("input", function () { showError(name, invalidField(name)); });
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var invalid = FIELDS.filter(function (name) {
        var bad = invalidField(name);
        showError(name, bad);
        return bad;
      });
      if (invalid.length) {
        form.querySelector("[name=" + invalid[0] + "]").focus();
        message.className = "form-message is-error";
        message.textContent = "還有 " + invalid.length + " 個欄位需要填寫或修正。";
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
          name: value("name"),
          email: value("email"),
          suggestion: value("suggestion"),
          dept: value("dept"),
          website: value("website")
        })
      }).then(function (res) {
        return res.json();
      }).then(function (result) {
        if (!result.ok) throw new Error(result.error || "送出失敗");
        replace(form, [
          el("div", { class: "form-success", tabindex: "-1" }, [
            el("h3", { text: "已收到你的意見，謝謝！" }),
            el("p", { text: "我們會盡快回覆到 " + value("email") + "。" })
          ])
        ]);
        form.querySelector(".form-success").focus();
      }).catch(function (err) {
        console.error("意見送出失敗", err);
        submit.disabled = false;
        submit.textContent = "送出";
        message.className = "form-message is-error";
        message.textContent = "送出失敗，你填的內容還在，請稍後再試，或寄信到 " + S.config.email + "。";
      });
    });
  }

  // 會費查詢：送學號到 Apps Script，只拿回這一位的結果。
  function renderPaycheck() {
    var form = document.getElementById("paycheck-form");
    var input = document.getElementById("student-id");
    var error = document.getElementById("error-id");
    var submit = form.querySelector("button[type=submit]");
    var target = document.getElementById("paycheck-result");

    function detail(label, value) {
      return value ? el("div", {}, [el("dt", { text: label }), el("dd", { text: value })]) : null;
    }

    function notice(title, text) {
      return el("div", { class: "paycheck-card is-empty" }, [
        el("p", { class: "paycheck-card-title", text: title }),
        el("p", { class: "paycheck-card-text", text: text })
      ]);
    }

    function statusChip(paid) {
      var chip = el("span", { class: "paycheck-status" });
      if (paid) chip.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
      chip.appendChild(document.createTextNode(paid ? "已繳費" : "未繳費"));
      return chip;
    }

    var lastQuery = "";

    function resultCard(id, result) {
      if (!result.found) {
        return notice("找不到學號 " + id + " 的資料", "請確認學號是否正確。如果已經繳費，請聯絡科學會幹部協助確認。");
      }
      return el("div", { class: "paycheck-card " + (result.paid ? "is-paid" : "is-unpaid") }, [
        el("div", { class: "paycheck-card-head" }, [
          el("div", {}, [
            el("p", { class: "paycheck-card-id", text: id }),
            el("p", { class: "paycheck-card-name", text: result.name || "（未登記姓名）" })
          ]),
          statusChip(result.paid)
        ]),
        el("dl", { class: "paycheck-details" }, [
          detail("收據編號", result.receipt),
          detail("繳費日期", result.paidAt),
          detail("經手人", result.handler)
        ]),
        result.paid ? null : el("p", { class: "paycheck-card-text", text: result.graduated
          ? "還沒有繳費紀錄。依學號推算你已經畢業，如有疑問請聯絡科學會幹部。"
          : "還沒有繳費紀錄。會費入會時繳一次，五年有效。請攜帶會費到科學會辦公室（A717）繳交，或洽詢收費的幹部。" })
      ]);
    }

    input.addEventListener("input", function () {
      // 全形數字轉半形，並去掉非數字。
      var clean = input.value.replace(/[０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      }).replace(/\D/g, "");
      if (clean !== input.value) input.value = clean;
      error.hidden = true;
      input.removeAttribute("aria-invalid");
      // 一般學號是 8 碼，打滿就直接查詢。
      if (clean.length === 8 && clean !== lastQuery) form.requestSubmit();
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var id = input.value.trim();
      if (!/^\d{5,10}$/.test(id)) {
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        replace(target, []);
        input.focus();
        return;
      }
      if (!S.config.paycheckUrl) {
        replace(target, [notice("尚未連接試算表", "試作版還沒有設定 paycheckUrl，暫時無法查詢。")]);
        return;
      }

      lastQuery = id;
      submit.disabled = true;
      submit.textContent = "查詢中…";
      target.setAttribute("aria-busy", "true");
      replace(target, [el("div", { class: "paycheck-card is-loading", "aria-hidden": "true" })]);
      var base = S.config.paycheckUrl;
      var url = base + (base.indexOf("?") < 0 ? "?" : "&") + "action=paycheck&id=" + encodeURIComponent(id);
      fetch(url).then(function (res) {
        return res.json();
      }).then(function (result) {
        if (!result.ok) throw new Error(result.error || "查詢失敗");
        replace(target, [resultCard(id, result)]);
        // 手機上收起鍵盤，讓結果完整出現在畫面上。
        if (window.matchMedia("(max-width: 640px)").matches) {
          input.blur();
          target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }).catch(function (err) {
        console.error("會費查詢失敗", err);
        replace(target, [notice("查詢時發生錯誤", "請稍後再試，或寄信到 " + S.config.email + "。")]);
      }).then(function () {
        submit.disabled = false;
        submit.textContent = "查詢";
        target.removeAttribute("aria-busy");
      });
    });
  }

  function fileType(name) {
    var match = String(name).match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toUpperCase() : "檔案";
  }

  // 可以在站內預覽的網址：Google 雲端單一檔案、Google 文件，以及網站上的 PDF。
  // 雲端「資料夾」沒辦法預覽，維持開新分頁。
  function previewUrl(url) {
    var drive = /^https:\/\/drive\.google\.com\/file\/d\/([\w-]+)/.exec(url);
    if (drive) return "https://drive.google.com/file/d/" + drive[1] + "/preview";
    var docs = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/.exec(url);
    if (docs) return "https://docs.google.com/" + docs[1] + "/d/" + docs[2] + "/preview";
    if (/^assets\/.+\.pdf$/i.test(url)) return url;
    return null;
  }

  // 手機上嵌入的文件很難捲動，只有寬螢幕才在站內展開。
  var wideScreen = window.matchMedia("(min-width: 768px)");
  var previewCount = 0;

  function docItem(file) {
    var preview = previewUrl(file.url);
    var link = el("a", { class: "doc", href: file.url, target: "_blank", rel: "noopener" }, [
      el("span", { class: "doc-type", text: fileType(file.name) }),
      el("span", { class: "doc-name", text: file.name.replace(/\.[a-z0-9]+$/i, "") }),
      el("span", { class: "doc-arrow", "aria-hidden": "true", text: "↗" })
    ]);
    var item = el("li", {}, [link]);
    if (!preview) return item;

    var panelId = "doc-preview-" + (++previewCount);
    var panel = null;
    item.classList.add("can-preview");
    link.addEventListener("click", function (event) {
      if (!wideScreen.matches) return;
      event.preventDefault();
      var open = link.getAttribute("aria-expanded") === "true";
      if (!panel) {
        panel = el("div", { class: "doc-preview", id: panelId }, [
          el("iframe", { src: preview, title: file.name + " 預覽", loading: "lazy", allow: "autoplay" }),
          el("div", { class: "doc-preview-bar" }, [
            el("a", { href: file.url, target: "_blank", rel: "noopener", text: "在新分頁開啟 ↗" })
          ])
        ]);
        item.appendChild(panel);
        link.setAttribute("aria-controls", panelId);
      }
      panel.hidden = open;
      link.setAttribute("aria-expanded", String(!open));
    });
    return item;
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
          el("ul", { class: "doc-list" }, group.files.map(docItem))
        ]);
      }) : [S.statusMessage("目前還沒有文件。")]);
    }, function () {
      replace(target, [S.statusMessage(LOAD_ERROR)]);
    });
  }

  // 大數字統計：數字本身就是重點，不需要圖表。
  function statRow(stats) {
    return el("dl", { class: "stat-row" }, stats.map(function (stat) {
      return el("div", { class: "stat" }, [
        el("dt", { class: "stat-label", lang: "en", text: stat.label }),
        el("dd", { class: "stat-value" }, [
          el("span", { class: "stat-number", text: String(stat.value) }),
          el("span", { class: "stat-unit", text: stat.unit })
        ]),
        el("dd", { class: "stat-note", text: stat.note })
      ]);
    }));
  }

  // 每年報導篇數：單一數列，用網站主色；滑過或聚焦顯示數值，另附表格給螢幕閱讀器。
  function yearChart(rows) {
    var max = Math.max.apply(null, rows.map(function (row) { return row.count; }));
    return el("figure", { class: "year-chart" }, [
      el("figcaption", { class: "year-chart-title", text: "每年活動報導篇數" }),
      el("div", { class: "year-bars", "aria-hidden": "true" }, rows.map(function (row) {
        return el("div", { class: "year-col", tabindex: "0" }, [
          el("span", { class: "year-value", text: String(row.count) }),
          el("span", { class: "year-bar", style: "height:" + Math.max(4, row.count / max * 100) + "%" }),
          el("span", { class: "year-tip", text: row.year + " 年：" + row.count + " 篇" }),
          el("span", { class: "year-label", text: row.year })
        ]);
      })),
      el("table", { class: "visually-hidden" }, [
        el("thead", {}, [el("tr", {}, [el("th", { text: "年份" }), el("th", { text: "篇數" })])]),
        el("tbody", {}, rows.map(function (row) {
          return el("tr", {}, [el("td", { text: row.year }), el("td", { text: String(row.count) })]);
        }))
      ])
    ]);
  }

  // 本屆幹部依部門分組，取代原本一行一人的表格。
  function peopleByDept(members) {
    var groups = [];
    members.forEach(function (member) {
      var group = groups[groups.length - 1];
      if (!group || group.dept !== member.dept) {
        group = { dept: member.dept, deptEn: member.deptEn, people: [] };
        groups.push(group);
      }
      group.people.push(member);
    });
    return el("div", { class: "people-grid" }, groups.map(function (group) {
      return el("section", { class: "people-card" }, [
        el("h3", {}, [
          el("span", { text: group.dept }),
          group.deptEn ? el("small", { lang: "en", text: group.deptEn }) : null
        ]),
        el("ul", {}, group.people.map(function (member) {
          return el("li", {}, [
            el("span", { class: "people-title", text: member.title }),
            el("span", { class: "people-name", text: member.name })
          ]);
        }))
      ]);
    }));
  }

  // 評鑑專區：把幹部、活動和文件整理在同一頁，資料和網站其他頁面共用。
  function renderEvaluation() {
    renderOrgCharts();
    var updateSubNav = setupSubNav();
    var organization = document.getElementById("organization-list");
    var activities = document.getElementById("activity-list");

    S.loadData(function (data) {
      var term = currentTerm(data.members);
      if (term) document.getElementById("evaluation-term").textContent = "第 " + term + " 屆應用英語科學會 成果展示";

      var current = data.members.filter(function (member) {
        return Number(member.term) === term;
      });
      var officers = current.filter(function (member) { return member.dept !== "指導老師"; });
      replace(document.getElementById("org-stats"), [statRow([
        { value: term, unit: "屆", label: "Term", note: "科學會傳承屆數" },
        { value: officers.length, unit: "位", label: "Officers", note: "本屆幹部" },
        { value: ORG.departments.length, unit: "個", label: "Departments", note: "執行部門" }
      ])]);
      replace(organization, current.length
        ? [peopleByDept(current)]
        : [S.statusMessage("目前還沒有幹部資料。")]);

      var news = listed(data.news);
      var years = {};
      var photos = 0;
      news.forEach(function (item) {
        var y = item.date.slice(0, 4);
        years[y] = (years[y] || 0) + 1;
        photos += (item.cover ? 1 : 0) + (item.body.match(/!\[/g) || []).length;
        (item.photos || []).forEach(function (group) { photos += group.images.length; });
      });
      var yearList = Object.keys(years).sort();
      replace(document.getElementById("activity-stats"), news.length ? [
        statRow([
          { value: news.length, unit: "篇", label: "Reports", note: "活動報導" },
          { value: photos, unit: "張", label: "Photos", note: "活動照片紀錄" },
          { value: yearList.length, unit: "年", label: "Years", note: yearList[0] + "–" + yearList[yearList.length - 1] + " 持續紀錄" }
        ]),
        yearChart(yearList.map(function (y) { return { year: y, count: years[y] }; }))
      ] : []);
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
  if (page === "paycheck") renderPaycheck();
  if (page === "news") renderNews();
  if (page === "article") renderArticle();
})();
