// 共用的頁首、頁尾與新聞資料載入。內容一律用 textContent 寫入，避免表單內容變成 HTML。
(function () {
  var CONFIG = window.SZAE_CONFIG;
  var LOGO = "assets/images/logo.webp";

  var NAV = [
    { label: "首頁", href: "index.html", page: "home" },
    { label: "應英月刊", href: "news.html", page: "news" },
    { label: "關於我們", href: "about.html", page: "about" },
    { label: "會費查詢", href: "https://lezhaia.github.io/paycheck/", external: true },
    { label: "文件專區", href: "documents.html", page: "documents" },
    { label: "友站連結", href: "links.html", page: "links", footerOnly: true },
    { label: "聯絡我們", href: "contact.html", page: "contact" }
  ];

  function icon(shapes) {
    return '<svg class="footer-icon" viewBox="0 0 24 24" aria-hidden="true">' + shapes + "</svg>";
  }

  var ICONS = {
    instagram: icon('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".6" fill="currentColor"/>'),
    facebook: icon('<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>'),
    youtube: icon('<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>'),
    mail: icon('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/>')
  };

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === "class") node.className = props[key];
      else if (key === "text") node.textContent = props[key];
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  function renderHeader() {
    var page = document.body.getAttribute("data-page");
    var list = el("ul", { class: "nav-list", id: "nav-list" }, NAV.filter(function (item) {
      return !item.footerOnly;
    }).map(function (item) {
      var props = { href: item.href, text: item.label };
      if (item.page === page) props["aria-current"] = "page";
      if (item.external) {
        props.target = "_blank";
        props.rel = "noopener";
      }
      return el("li", {}, [el("a", props)]);
    }));
    var toggle = el("button", {
      class: "nav-toggle", type: "button", "aria-expanded": "false", "aria-controls": "nav-list", "aria-label": "開啟選單"
    }, [el("span"), el("span"), el("span")]);
    function setMenu(open) {
      list.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "關閉選單" : "開啟選單");
    }

    // 往下捲時收起導覽列，往上捲時再出現，把畫面留給內容。
    var lastY = window.scrollY;
    window.addEventListener("scroll", function () {
      var y = window.scrollY;
      if (Math.abs(y - lastY) < 6) return;
      var hide = y > lastY && y > 160 && !list.classList.contains("is-open");
      document.body.classList.toggle("nav-hidden", hide);
      lastY = y;
    }, { passive: true });

    toggle.addEventListener("click", function () {
      setMenu(!list.classList.contains("is-open"));
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && list.classList.contains("is-open")) {
        setMenu(false);
        toggle.focus();
      }
    });
    document.addEventListener("click", function (event) {
      if (!list.contains(event.target) && !toggle.contains(event.target)) setMenu(false);
    });
    var header = el("header", { class: "site-header" }, [
      el("div", { class: "wrap site-header-inner" }, [
        el("a", { class: "brand", href: "index.html", "aria-label": "樹人醫專應用英語科學會首頁" }, [
          el("img", { src: LOGO, alt: "樹人醫專應用英語科學會標誌", width: "136", height: "40" })
        ]),
        el("nav", { "aria-label": "主要導覽" }, [toggle, list])
      ])
    ]);
    var skip = el("a", { class: "skip-link", href: "#main", text: "跳到主要內容" });
    document.body.insertBefore(header, document.body.firstChild);
    document.body.insertBefore(skip, header);
    document.querySelector("main").id = "main";
  }

  function renderFooter() {
    var social = [
      ["Instagram", CONFIG.links.instagram, "instagram"],
      ["Facebook", CONFIG.links.facebook, "facebook"],
      ["YouTube", CONFIG.links.youtube, "youtube"],
      ["寄信給我們", "mailto:" + CONFIG.email, "mail"]
    ];

    var footer = el("footer", { class: "site-footer" }, [
      el("div", { class: "wrap footer-main" }, [
        el("div", { class: "footer-brand" }, [
          el("img", { class: "footer-logo", src: LOGO, alt: "樹人醫專應用英語科學會", width: "190", height: "56" }),
          el("p", { class: "footer-motto", text: CONFIG.motto }),
          el("p", { text: CONFIG.address })
        ]),
        el("nav", { class: "footer-nav", "aria-label": "頁尾導覽" }, [
          el("ul", {}, NAV.map(function (item) {
            return el("li", {}, [el("a", { href: item.href, text: item.label })]);
          }))
        ]),
        el("div", { class: "footer-connect" }, [
          el("a", { class: "footer-feedback", href: "contact.html#feedback", text: "給我們意見 →" }),
          el("ul", { class: "footer-social" }, social.map(function (item) {
            var link = el("a", { href: item[1], "aria-label": item[0], title: item[0] });
            link.innerHTML = ICONS[item[2]];
            return el("li", {}, [link]);
          }))
        ])
      ]),
      el("div", { class: "footer-bar" }, [
        el("div", { class: "wrap footer-bar-inner" }, [
          el("p", { text: "© " + new Date().getFullYear() + " 樹人醫專應用英語科學會。轉載圖文請先來信徵求同意。" })
        ])
      ])
    ]);
    document.body.appendChild(footer);
  }

  // data/site.json 由 scripts/build_data.py 從 content/ 產生。
  function loadData(onData, onError) {
    // 每次都向伺服器確認，後台發布後訪客才不會看到快取的舊內容。
    fetch("data/site.json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(onData)
      .catch(function (err) {
        console.error("無法載入網站資料", err);
        onError();
      });
  }

  function articleUrl(item) {
    return "article.html?id=" + encodeURIComponent(item.id);
  }

  function coverImage(item) {
    if (!item.cover) return el("div", { class: "cover-empty", "aria-hidden": "true", text: "應英月刊" });
    return el("img", { src: item.cover, alt: "", loading: "lazy" });
  }

  function statusMessage(message) {
    return el("p", { class: "status", role: "status", text: message });
  }

  // 照片載入失敗時換成替代畫面，不顯示破圖圖示。
  function handleBrokenImage(img) {
    var parent = img.parentNode;
    if (!parent) return;
    if (parent.classList.contains("brand")) {
      parent.replaceChild(el("span", { class: "brand-text", text: "應用英語科學會" }), img);
    } else if (parent.matches(".lead-image, .card-image, .row-image")) {
      parent.replaceChild(coverImage({}), img);
    } else {
      parent.removeChild(img);
    }
  }

  document.addEventListener("error", function (event) {
    if (event.target.tagName === "IMG") handleBrokenImage(event.target);
  }, true);

  window.SZAE = {
    config: CONFIG,
    el: el,
    loadData: loadData,
    articleUrl: articleUrl,
    coverImage: coverImage,
    statusMessage: statusMessage
  };

  function setupBackToTop() {
    var button = el("button", { class: "back-to-top", type: "button", "aria-label": "回到頁面頂端", title: "回到頂端" });
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    button.addEventListener("click", function () {
      window.scrollTo({ top: 0 });
      button.blur();
    });
    document.body.appendChild(button);
    function update() {
      button.classList.toggle("is-visible", window.scrollY > 500);
    }
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  // 內容捲進畫面時淡入。資料是載入後才畫上去的，所以持續監看新增的元素。
  function setupReveal() {
    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;
    var SELECTOR = ".title-block, .event-list > li, .lead, .row, .card, .mosaic > li, .about-lead, .values-slogan, .member, .dept, .doc-group, .aside-card, .link-grid > li, .contact-item, .feedback, .article-head > *, .article-cover, .article-body > *, .source-note, .photo-group, .article-pager";
    var main = document.querySelector("main");
    var waiting = [];

    function show(node) {
      node.classList.add("is-in");
      // 動畫結束後移除，避免影響元素本身的互動效果。
      setTimeout(function () {
        node.classList.remove("reveal", "is-in");
        node.style.removeProperty("--reveal-delay");
      }, 1400);
    }

    // 已捲到或捲過的元素都顯示，跳到頁面中段時上方內容也不會留白。
    function check() {
      var edge = window.innerHeight * 0.94;
      waiting = waiting.filter(function (node) {
        if (!node.isConnected) return false;
        if (node.getBoundingClientRect().top >= edge) return true;
        show(node);
        return false;
      });
    }

    function scan() {
      main.querySelectorAll(SELECTOR).forEach(function (node) {
        if (node.hasAttribute("data-revealed") || node.parentElement.closest(".dept")) return;
        node.setAttribute("data-revealed", "");
        var index = Array.prototype.indexOf.call(node.parentElement.children, node);
        node.style.setProperty("--reveal-delay", (index % 4) * 70 + "ms");
        node.classList.add("reveal");
        waiting.push(node);
      });
      check();
    }
    new MutationObserver(scan).observe(main, { childList: true, subtree: true });
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    scan();
  }

  renderHeader();
  renderFooter();
  setupBackToTop();
  setupReveal();

  // 這段程式執行前就已經載入失敗的圖片不會再觸發 error 事件。
  Array.prototype.forEach.call(document.images, function (img) {
    if (img.complete && !img.naturalWidth) handleBrokenImage(img);
  });
})();
