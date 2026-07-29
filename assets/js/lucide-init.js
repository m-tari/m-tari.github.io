(() => {
  const FA_TO_LUCIDE = {
    "fa-magnifying-glass": "search",
    "fa-search": "search",
    "fa-moon": "moon",
    "fa-sun": "sun",
    "fa-half-sun-moon": "sun-moon",
    "fa-calendar": "calendar",
    "fa-calendar-alt": "calendar",
    "fa-hashtag": "hash",
    "fa-tag": "tag",
    "fa-tags": "tags",
    "fa-envelope": "mail",
    "fa-square-rss": "rss",
    "fa-rss": "rss",
    "fa-github": "github",
    "fa-linkedin": "linkedin",
    "fa-linkedin-in": "linkedin",
    "fa-x-twitter": "twitter",
    "fa-twitter": "twitter",
    "fa-gitlab": "gitlab",
    "fa-youtube": "youtube",
    "fa-facebook": "facebook",
    "fa-instagram": "instagram",
    "fa-clipboard": "clipboard",
    "fa-clipboard-check": "clipboard-check",
    "fa-star": "star",
    "fa-star-half-stroke": "star-half",
    "fa-circle-info": "info",
    "fa-info-circle": "info",
    "fa-briefcase": "briefcase",
    "fa-barcode": "barcode",
    "fa-cart-shopping": "shopping-cart",
    "fa-play": "play",
    "fa-stop": "square",
    "fa-film": "clapperboard",
  };

  const lucideNameFromFa = (el) => {
    if (el.classList.contains("fa-half-sun-moon")) return "sun-moon";
    for (const cls of el.classList) {
      if (FA_TO_LUCIDE[cls]) return FA_TO_LUCIDE[cls];
    }
    return null;
  };

  const upgradeFontAwesomeIcons = (root = document) => {
    root.querySelectorAll("i").forEach((el) => {
      if (el.hasAttribute("data-lucide")) return;
      const name = lucideNameFromFa(el);
      if (!name) return;

      const keepClasses = [...el.classList].filter(
        (cls) => !cls.startsWith("fa") && cls !== "svg-inline--fa"
      );
      el.setAttribute("data-lucide", name);
      el.className = keepClasses.join(" ");
      el.setAttribute("aria-hidden", el.getAttribute("aria-hidden") || "true");
    });
  };

  const renderLucideIcons = () => {
    if (!window.lucide || typeof window.lucide.createIcons !== "function") return;

    upgradeFontAwesomeIcons();

    // Avoid re-processing already rendered SVGs on subsequent passes.
    document.querySelectorAll("svg[data-lucide]").forEach((svg) => {
      svg.setAttribute("data-icon", svg.getAttribute("data-lucide"));
      svg.removeAttribute("data-lucide");
    });

    const pending = document.querySelectorAll("[data-lucide]");
    if (!pending.length) return;

    window.lucide.createIcons({
      attrs: {
        class: "lucide-icon",
        width: "1em",
        height: "1em",
        "stroke-width": 1.75,
      },
    });

    document.querySelectorAll("svg[data-lucide]").forEach((svg) => {
      svg.setAttribute("data-icon", svg.getAttribute("data-lucide"));
      svg.removeAttribute("data-lucide");
    });
  };

  const scheduleRender = (() => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        renderLucideIcons();
      });
    };
  })();

  const boot = () => {
    scheduleRender();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length) {
          scheduleRender();
          return;
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
