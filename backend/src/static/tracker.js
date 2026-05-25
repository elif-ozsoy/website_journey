// ─────────────────────────────────────────────────────────────────────────────
// UX Tracker — injected client-side script
// Captures: pageviews, clicks, scroll depth, mouse movement, rage clicks,
//           dead clicks, navigation, visibility changes, form interactions
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  "use strict";

  // __UX_SITE_ID__ and __UX_API_BASE__ are replaced at injection time
  const SITE_ID = "__UX_SITE_ID__";
  const API_BASE = "__UX_API_BASE__";

  // ── html2canvas loader ──────────────────────────────────────────────────
  var _h2cReady = false;
  var _h2cQueue = [];
  (function () {
    var s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = function () {
      _h2cReady = true;
      _h2cQueue.forEach(function (fn) { fn(); });
      _h2cQueue = [];
    };
    (document.head || document.documentElement).appendChild(s);
  })();

  var _OUR_IDS = ["__ux_task_overlay", "__ux_tracker_banner", "__ux_rating_widget", "__ux_click_highlight"];

  function _isOurElement(el) {
    while (el && el !== document.body) {
      if (el.id && _OUR_IDS.indexOf(el.id) !== -1) return true;
      if (el.hasAttribute && el.hasAttribute("data-ux-interceptor")) return true;
      if (el.hasAttribute && el.hasAttribute("data-ux-tracker")) return true;
      el = el.parentElement;
    }
    return false;
  }

  var _lastCapturedPath = null;
  var _lastCaptureTime = 0;
  var _CAPTURE_COOLDOWN = 8000; // ms — min time between captures on the same path

  function captureScreenshot(trigger) {
    var capturePath = location.pathname + location.search;
    var now = Date.now();
    var bypassCooldown = trigger === "dropdown" || trigger === "scroll_end" || trigger === "navigation";
    if (!bypassCooldown && capturePath === _lastCapturedPath && (now - _lastCaptureTime) < _CAPTURE_COOLDOWN) return;
    _lastCapturedPath = capturePath;
    _lastCaptureTime = now;

    function doCapture() {
      window.html2canvas(document.documentElement, {
        useCORS: true,
        allowTaint: true,
        scale: 1,
        logging: false,
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        ignoreElements: function (el) {
          if (el.id === "__ux_click_highlight") return true; // always exclude highlight from dom_change shots
          return _isOurElement(el);
        },
      }).then(function (canvas) {
        canvas.toBlob(function (blob) {
          if (!blob) return;
          var fd = new FormData();
          fd.append("session_id", sessionId);
          fd.append("site_id", SITE_ID);
          fd.append("path", capturePath);
          fd.append("trigger", trigger);
          fd.append("image", blob, "screenshot.png");
          (window.__ux_fetch || window.fetch)(API_BASE + "/api/screenshot", { method: "POST", body: fd }).catch(function () {});
        }, "image/png");
      }).catch(function () {});
    }
    if (_h2cReady) {
      doCapture();
    } else {
      _h2cQueue.push(doCapture);
    }
  }

  // ── Per-click viewport screenshot with element highlight ─────────────────
  // Captures the current viewport with a red border drawn around the clicked
  // element, so the screenshot is tied to the specific action via action_id.
  function captureClickScreenshot(actionId, rect) {
    var capturePath = location.pathname + location.search;
    var pad = 3;
    var highlight = document.createElement("div");
    highlight.id = "__ux_click_highlight";
    highlight.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "z-index:2147483646",
      "border:3px solid rgba(255,64,64,0.9)",
      "background:rgba(255,64,64,0.18)",
      "border-radius:3px",
      "box-sizing:border-box",
      "left:" + Math.max(0, rect.left - pad) + "px",
      "top:" + Math.max(0, rect.top - pad) + "px",
      "width:" + Math.max(10, rect.width + pad * 2) + "px",
      "height:" + Math.max(10, rect.height + pad * 2) + "px",
    ].join(";");

    function doClickCapture() {
      if (document.body) document.body.appendChild(highlight);
      requestAnimationFrame(function () {
        window.html2canvas(document.documentElement, {
          useCORS: true,
          allowTaint: true,
          scale: 1,
          logging: false,
          x: window.scrollX,
          y: window.scrollY,
          width: window.innerWidth,
          height: window.innerHeight,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          ignoreElements: function (el) {
            if (el.id === "__ux_click_highlight") return false; // include highlight
            return _isOurElement(el);
          },
        }).then(function (canvas) {
          if (highlight.parentNode) highlight.parentNode.removeChild(highlight);
          canvas.toBlob(function (blob) {
            if (!blob) return;
            var fd = new FormData();
            fd.append("session_id", sessionId);
            fd.append("site_id", SITE_ID);
            fd.append("path", capturePath);
            fd.append("trigger", "click");
            fd.append("action_id", actionId);
            fd.append("image", blob, "screenshot.png");
            (window.__ux_fetch || window.fetch)(API_BASE + "/api/screenshot", { method: "POST", body: fd }).catch(function () {});
          }, "image/png");
        }).catch(function () {
          if (highlight.parentNode) highlight.parentNode.removeChild(highlight);
        });
      });
    }

    if (_h2cReady) {
      doClickCapture();
    } else {
      _h2cQueue.push(doClickCapture);
    }
  }

  // ── DOM-change screenshot trigger ────────────────────────────────────────
  // Captures once per path after DOM settles (1s debounce on childList mutations).
  // Ignores attribute-only changes (scroll/animation) and our own injected elements.
  (function setupDomChangeScreenshots() {
    var _domTimer = null;

    function scheduleDomScreenshot() {
      clearTimeout(_domTimer);
      _domTimer = setTimeout(function () { captureScreenshot("dom_change"); }, 1000);
    }

    var _domObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type !== "childList") continue;
        if (_isOurElement(m.target)) continue;
        // Skip if only our own tracker nodes were added/removed (e.g. click highlight)
        var hasRealNode = false;
        for (var j = 0; j < m.addedNodes.length; j++) {
          if (m.addedNodes[j].nodeType === 1 && !_isOurElement(m.addedNodes[j])) { hasRealNode = true; break; }
        }
        if (!hasRealNode) {
          for (var j = 0; j < m.removedNodes.length; j++) {
            if (m.removedNodes[j].nodeType === 1 && !_isOurElement(m.removedNodes[j])) { hasRealNode = true; break; }
          }
        }
        if (!hasRealNode) continue;
        scheduleDomScreenshot();
        break;
      }
    });

    function attachObserver() {
      _domObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) {
      attachObserver();
    } else {
      document.addEventListener("DOMContentLoaded", attachObserver);
    }
  })();
  const TARGET_ORIGIN = "__UX_TARGET_ORIGIN__";
  const PROXY_BASE = "__UX_PROXY_BASE__";
  const TASKS = __UX_TASKS__;
  const NOTASKS_MODE = __UX_NOTASKS__;
  const FLUSH_INTERVAL = 3000; // ms
  const MOUSE_SAMPLE_INTERVAL = 150; // ms
  const SCROLL_DEBOUNCE = 300; // ms
  const RAGE_CLICK_THRESHOLD = 3; // clicks
  const RAGE_CLICK_WINDOW = 800; // ms
  const RAGE_CLICK_RADIUS = 50; // px

  // Derive host variants for same-site detection
  var targetHost = "";
  try { targetHost = new URL(TARGET_ORIGIN).host; } catch(e) {}
  var targetHostBare = targetHost.replace(/^www\./, "");
  function isSameSite(href) {
    try {
      var u = new URL(href, location.href);
      var h = u.host;
      var hBare = h.replace(/^www\./, "");
      return hBare === targetHostBare;
    } catch(e) { return false; }
  }

  // ── Session management ──────────────────────────────────────────────────

  let sessionId = sessionStorage.getItem("__ux_session_id");
  if (!sessionId) {
    sessionId = generateId();
    sessionStorage.setItem("__ux_session_id", sessionId);
    // Register session with server
    fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        site_id: SITE_ID,
        user_agent: navigator.userAgent,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        referrer: document.referrer,
        device_type: getDeviceType(),
      }),
    }).catch(() => {});
  }

  // ── Event buffer ────────────────────────────────────────────────────────

  let buffer = [];

  function pushEvent(type, data, path) {
    buffer.push({
      session_id: sessionId,
      site_id: SITE_ID,
      type: type,
      timestamp: Date.now(),
      path: path || location.pathname + location.search,
      data: data || {},
    });
  }

  function flush() {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0);
    const payload = JSON.stringify({ events: batch });

    // Prefer sendBeacon (works on page unload), fallback to fetch
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(`${API_BASE}/api/events`, blob);
    } else {
      fetch(`${API_BASE}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }

  setInterval(flush, FLUSH_INTERVAL);

  // ── Pageview ────────────────────────────────────────────────────────────

  pushEvent("pageview", {
    title: document.title,
    url: location.href,
  });

  // ── Click tracking (with rage click & dead click detection) ─────────────

  const recentClicks = [];

  document.addEventListener(
    "click",
    function (e) {
      if (_isOurElement(e.target)) return;
      const target = e.target;
      const selector = getSelector(target);
      const rect = target.getBoundingClientRect();
      const now = Date.now();
      const actionId = "a_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

      const clickData = {
        x: e.clientX,
        y: e.clientY,
        pageX: e.pageX,
        pageY: e.pageY,
        selector: selector,
        tag: target.tagName.toLowerCase(),
        text: (target.textContent || "").trim().slice(0, 120),
        href: target.closest("a")?.href || null,
        element_w: Math.round(rect.width),
        element_h: Math.round(rect.height),
        // Element bounding-rect fields used by the flow map
        elem_x: Math.round(rect.left),
        elem_y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        action_id: actionId,
      };

      pushEvent("click", clickData);

      // Capture a viewport screenshot with the clicked element highlighted
      captureClickScreenshot(actionId, rect);

      // Dead click detection: clicked on non-interactive element
      const interactive = ["a", "button", "input", "select", "textarea"];
      const isInteractive =
        interactive.includes(target.tagName.toLowerCase()) ||
        target.closest("a, button") ||
        target.getAttribute("role") === "button" ||
        target.onclick ||
        window.getComputedStyle(target).cursor === "pointer";

      if (!isInteractive) {
        pushEvent("dead_click", clickData);
      }

      // Rage click detection
      recentClicks.push({ x: e.clientX, y: e.clientY, t: now });
      // Remove old clicks
      while (
        recentClicks.length > 0 &&
        now - recentClicks[0].t > RAGE_CLICK_WINDOW
      ) {
        recentClicks.shift();
      }
      // Check cluster
      if (recentClicks.length >= RAGE_CLICK_THRESHOLD) {
        const last = recentClicks[recentClicks.length - 1];
        const clustered = recentClicks.filter(
          (c) =>
            Math.hypot(c.x - last.x, c.y - last.y) < RAGE_CLICK_RADIUS
        );
        if (clustered.length >= RAGE_CLICK_THRESHOLD) {
          pushEvent("rage_click", {
            ...clickData,
            click_count: clustered.length,
          });
          recentClicks.length = 0; // reset to avoid duplicate rage events
        }
      }
    },
    true
  );

  // ── Scroll depth ────────────────────────────────────────────────────────

  let maxScrollDepth = 0;
  let scrollTimeout;

  var _scrollScreenshotTimer = null;

  window.addEventListener(
    "scroll",
    function () {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const scrollTop =
          window.pageYOffset || document.documentElement.scrollTop;
        const docHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );
        const winHeight = window.innerHeight;
        const depth = Math.min(
          100,
          Math.round(((scrollTop + winHeight) / docHeight) * 100)
        );

        if (depth > maxScrollDepth) {
          maxScrollDepth = depth;
          pushEvent("scroll_depth", { depth: maxScrollDepth });
        }
      }, SCROLL_DEBOUNCE);

      // Screenshot at the final scroll destination (debounced)
      clearTimeout(_scrollScreenshotTimer);
      _scrollScreenshotTimer = setTimeout(function () {
        captureScreenshot("scroll_end");
      }, 800);
    },
    { passive: true }
  );

  // ── Mouse movement (sampled for heatmaps) ──────────────────────────────

  let lastMouseSample = 0;

  document.addEventListener(
    "mousemove",
    function (e) {
      const now = Date.now();
      if (now - lastMouseSample < MOUSE_SAMPLE_INTERVAL) return;
      lastMouseSample = now;
      pushEvent("mousemove", {
        x: e.clientX,
        y: e.clientY,
        pageX: e.pageX,
        pageY: e.pageY,
      });
    },
    { passive: true }
  );

  // ── SPA navigation (pushState / popstate) ──────────────────────────────

  const originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    onNavigation();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    onNavigation();
  };

  window.addEventListener("popstate", onNavigation);

  function onNavigation() {
    maxScrollDepth = 0; // reset scroll tracking for new page
    pushEvent("pageview", {
      title: document.title,
      url: location.href,
    });
    // Screenshot after the new view has had time to render
    setTimeout(function () { captureScreenshot("navigation"); }, 600);
  }

  // ── Dropdown / disclosure screenshot trigger ────────────────────────────

  (function setupDropdownScreenshots() {
    var _dropdownTimer = null;

    function scheduleDropdownScreenshot() {
      clearTimeout(_dropdownTimer);
      _dropdownTimer = setTimeout(function () {
        captureScreenshot("dropdown");
      }, 300);
    }

    var _observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type !== "attributes") continue;
        var el = m.target;
        var attr = m.attributeName;
        if (
          (attr === "aria-expanded" && el.getAttribute("aria-expanded") === "true") ||
          (attr === "open" && el.tagName === "DETAILS" && el.open) ||
          (attr === "class" &&
            el.classList &&
            (el.classList.contains("open") || el.classList.contains("show") || el.classList.contains("active")) &&
            getComputedStyle(el).display !== "none")
        ) {
          scheduleDropdownScreenshot();
          break;
        }
      }
    });

    if (document.body) {
      _observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["aria-expanded", "open", "class"],
        subtree: true,
      });
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        _observer.observe(document.body, {
          attributes: true,
          attributeFilter: ["aria-expanded", "open", "class"],
          subtree: true,
        });
      });
    }
  })();

  // ── Visibility / focus tracking ─────────────────────────────────────────

  document.addEventListener("visibilitychange", function () {
    pushEvent("visibility", { state: document.visibilityState });
  });

  window.addEventListener("blur", function () {
    pushEvent("focus", { state: "blur" });
  });

  window.addEventListener("focus", function () {
    pushEvent("focus", { state: "focus" });
  });

  // ── Form interaction tracking ───────────────────────────────────────────

  document.addEventListener(
    "focus",
    function (e) {
      const t = e.target;
      if (t.tagName && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) {
        pushEvent("form_focus", {
          selector: getSelector(t),
          field_type: t.type || t.tagName.toLowerCase(),
          field_name: t.name || t.id || null,
        });
      }
    },
    true
  );

  // ── Form input changes (value tracking without capturing actual values) ─

  document.addEventListener("change", function (e) {
    const t = e.target;
    if (!t.tagName) return;
    const tag = t.tagName.toUpperCase();
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) {
      pushEvent("form_change", {
        selector: getSelector(t),
        field_type: t.type || tag.toLowerCase(),
        field_name: t.name || t.id || null,
        has_value: !!t.value,
        value_length: (t.value || "").length,
        // For select: which option index
        selected_index: tag === "SELECT" ? t.selectedIndex : undefined,
      });
    }
  }, true);

  // ── Form submission ────────────────────────────────────────────────────

  document.addEventListener("submit", function (e) {
    const form = e.target;
    if (!form || form.tagName !== "FORM") return;
    const fields = form.querySelectorAll("input, select, textarea");
    const filledCount = Array.from(fields).filter(f => f.value && f.value.trim()).length;
    pushEvent("form_submit", {
      selector: getSelector(form),
      action: form.action || null,
      method: form.method || "get",
      field_count: fields.length,
      filled_count: filledCount,
    });
  }, true);

  // ── Text selection & copy ──────────────────────────────────────────────

  document.addEventListener("copy", function () {
    const sel = window.getSelection();
    const text = (sel ? sel.toString() : "").trim();
    if (text.length > 0) {
      pushEvent("copy", {
        text_length: text.length,
        text_preview: text.slice(0, 80),
        selector: sel.anchorNode && sel.anchorNode.parentElement
          ? getSelector(sel.anchorNode.parentElement) : null,
      });
    }
  });

  let selectionTimeout;
  document.addEventListener("selectionchange", function () {
    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(function () {
      const sel = window.getSelection();
      const text = (sel ? sel.toString() : "").trim();
      if (text.length > 5) {
        pushEvent("text_select", {
          text_length: text.length,
          text_preview: text.slice(0, 80),
        });
      }
    }, 600);
  });

  // ── Hover intent (element hovered for > 1s) ───────────────────────────

  let hoverTimer = null;
  let hoverTarget = null;

  document.addEventListener("mouseover", function (e) {
    const t = e.target;
    if (t === hoverTarget) return;
    clearTimeout(hoverTimer);
    hoverTarget = t;
    hoverTimer = setTimeout(function () {
      if (!hoverTarget) return;
      // Only track meaningful elements, not body/html/div wrappers
      const tag = hoverTarget.tagName ? hoverTarget.tagName.toLowerCase() : "";
      const interactive = ["a", "button", "input", "select", "textarea", "img", "video", "label"];
      const hasText = (hoverTarget.textContent || "").trim().length > 0;
      if (interactive.includes(tag) || hoverTarget.getAttribute("role") || hasText) {
        pushEvent("hover_intent", {
          selector: getSelector(hoverTarget),
          tag: tag,
          text: (hoverTarget.textContent || "").trim().slice(0, 80),
          href: hoverTarget.closest("a") ? hoverTarget.closest("a").href : null,
        });
      }
    }, 1000);
  }, { passive: true });

  document.addEventListener("mouseout", function (e) {
    if (e.target === hoverTarget) {
      clearTimeout(hoverTimer);
      hoverTarget = null;
    }
  }, { passive: true });

  // ── Double click ───────────────────────────────────────────────────────

  document.addEventListener("dblclick", function (e) {
    pushEvent("double_click", {
      x: e.clientX,
      y: e.clientY,
      selector: getSelector(e.target),
      tag: e.target.tagName ? e.target.tagName.toLowerCase() : "",
      text: (e.target.textContent || "").trim().slice(0, 80),
    });
  }, true);

  // ── Right click / context menu ─────────────────────────────────────────

  document.addEventListener("contextmenu", function (e) {
    pushEvent("right_click", {
      x: e.clientX,
      y: e.clientY,
      selector: getSelector(e.target),
      tag: e.target.tagName ? e.target.tagName.toLowerCase() : "",
      text: (e.target.textContent || "").trim().slice(0, 60),
    });
  });

  // ── Media events (video/audio play, pause, ended) ─────────────────────

  document.addEventListener("play", function (e) {
    if (e.target.tagName === "VIDEO" || e.target.tagName === "AUDIO") {
      pushEvent("media_play", {
        tag: e.target.tagName.toLowerCase(),
        src: (e.target.currentSrc || "").slice(0, 200),
        current_time: Math.round(e.target.currentTime),
        duration: Math.round(e.target.duration || 0),
        selector: getSelector(e.target),
      });
    }
  }, true);

  document.addEventListener("pause", function (e) {
    if (e.target.tagName === "VIDEO" || e.target.tagName === "AUDIO") {
      pushEvent("media_pause", {
        tag: e.target.tagName.toLowerCase(),
        current_time: Math.round(e.target.currentTime),
        duration: Math.round(e.target.duration || 0),
        percent_watched: e.target.duration
          ? Math.round((e.target.currentTime / e.target.duration) * 100) : 0,
        selector: getSelector(e.target),
      });
    }
  }, true);

  document.addEventListener("ended", function (e) {
    if (e.target.tagName === "VIDEO" || e.target.tagName === "AUDIO") {
      pushEvent("media_ended", {
        tag: e.target.tagName.toLowerCase(),
        duration: Math.round(e.target.duration || 0),
        selector: getSelector(e.target),
      });
    }
  }, true);

  // ── Scroll direction tracking (up vs down) ────────────────────────────

  let lastScrollY = window.pageYOffset;
  let scrollDirTimeout;
  let scrollUpCount = 0;
  let scrollDownCount = 0;

  window.addEventListener("scroll", function () {
    const y = window.pageYOffset;
    if (y > lastScrollY) scrollDownCount++;
    else if (y < lastScrollY) scrollUpCount++;
    lastScrollY = y;

    clearTimeout(scrollDirTimeout);
    scrollDirTimeout = setTimeout(function () {
      if (scrollUpCount > 3 || scrollDownCount > 3) {
        pushEvent("scroll_activity", {
          up_count: scrollUpCount,
          down_count: scrollDownCount,
          direction: scrollDownCount >= scrollUpCount ? "mostly_down" : "mostly_up",
          final_y: y,
        });
      }
      scrollUpCount = 0;
      scrollDownCount = 0;
    }, 2000);
  }, { passive: true });

  // ── Touch gestures (mobile) ────────────────────────────────────────────

  let touchStartX = 0, touchStartY = 0, touchStartTime = 0;

  document.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }
  }, { passive: true });

  document.addEventListener("touchend", function (e) {
    if (e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const dt = Date.now() - touchStartTime;
    const dist = Math.hypot(dx, dy);

    if (dist > 60 && dt < 500) {
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      let direction = "right";
      if (angle > 45 && angle < 135) direction = "down";
      else if (angle < -45 && angle > -135) direction = "up";
      else if (Math.abs(angle) > 135) direction = "left";

      pushEvent("swipe", {
        direction: direction,
        distance: Math.round(dist),
        duration_ms: dt,
      });
    } else if (dist < 10 && dt > 500) {
      pushEvent("long_press", {
        x: touchStartX,
        y: touchStartY,
        duration_ms: dt,
        selector: getSelector(document.elementFromPoint(touchStartX, touchStartY) || document.body),
      });
    }
  }, { passive: true });

  // ── Pinch zoom detection ───────────────────────────────────────────────

  let lastPinchDist = null;
  document.addEventListener("touchmove", function (e) {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastPinchDist !== null) {
        const delta = dist - lastPinchDist;
        if (Math.abs(delta) > 30) {
          pushEvent("pinch_zoom", {
            direction: delta > 0 ? "zoom_in" : "zoom_out",
            delta: Math.round(delta),
          });
          lastPinchDist = dist;
        }
      } else {
        lastPinchDist = dist;
      }
    }
  }, { passive: true });

  document.addEventListener("touchend", function () { lastPinchDist = null; }, { passive: true });

  // ── Performance timing (sent once after load) ──────────────────────────

  window.addEventListener("load", function () {
    // Capture initial pageview screenshot
    if (_h2cReady) {
      captureScreenshot("pageview");
    } else {
      _h2cQueue.push(function() { captureScreenshot("pageview"); });
    }

    setTimeout(function () {
      try {
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav) {
          pushEvent("performance", {
            dns_ms: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
            connect_ms: Math.round(nav.connectEnd - nav.connectStart),
            ttfb_ms: Math.round(nav.responseStart - nav.requestStart),
            dom_load_ms: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
            full_load_ms: Math.round(nav.loadEventEnd - nav.startTime),
            transfer_size: nav.transferSize || 0,
          });
        }
        // Largest Contentful Paint
        if (PerformanceObserver) {
          new PerformanceObserver(function (list) {
            const entries = list.getEntries();
            if (entries.length > 0) {
              const lcp = entries[entries.length - 1];
              pushEvent("lcp", {
                lcp_ms: Math.round(lcp.startTime),
                element: lcp.element ? getSelector(lcp.element) : null,
                size: lcp.size || 0,
              });
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }
        // Cumulative Layout Shift
        if (PerformanceObserver) {
          let clsValue = 0;
          new PerformanceObserver(function (list) {
            for (var entry of list.getEntries()) {
              if (!entry.hadRecentInput) clsValue += entry.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
          // Report CLS after 5s
          setTimeout(function () {
            if (clsValue > 0) {
              pushEvent("cls", { cls_score: Math.round(clsValue * 10000) / 10000 });
            }
          }, 5000);
        }
      } catch (e) {}
    }, 100);
  });

  // ── Unhandled promise rejection ────────────────────────────────────────

  window.addEventListener("unhandledrejection", function (e) {
    pushEvent("promise_error", {
      message: (e.reason ? (e.reason.message || String(e.reason)) : "unknown").slice(0, 200),
    });
  });

  // ── Window resize ───────────────────────────────────────────────────────

  let resizeTimeout;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      pushEvent("resize", {
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
      });
    }, 500);
  });

  // ── Error tracking ──────────────────────────────────────────────────────

  window.addEventListener("error", function (e) {
    pushEvent("js_error", {
      message: e.message,
      source: e.filename,
      line: e.lineno,
      col: e.colno,
    });
  });

  // ── Page unload — final flush ───────────────────────────────────────────

  window.addEventListener("beforeunload", function () {
    pushEvent("page_leave", {
      scroll_depth: maxScrollDepth,
      time_on_page: Date.now() - performance.timing.navigationStart,
    });
    flush();
  });

  // ── Utilities ───────────────────────────────────────────────────────────

  function generateId() {
    return "s_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
  }

  function getDeviceType() {
    const w = window.innerWidth;
    if (w < 768) return "mobile";
    if (w < 1024) return "tablet";
    return "desktop";
  }

  function getSelector(el) {
    if (el.id) return "#" + el.id;
    const parts = [];
    let current = el;
    for (let i = 0; i < 4 && current && current !== document.body; i++) {
      let part = current.tagName.toLowerCase();
      if (current.className && typeof current.className === "string") {
        const cls = current.className.trim().split(/\s+/).slice(0, 2).join(".");
        if (cls) part += "." + cls;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  // ── Link interception — keep navigation inside proxy ─────────────────────
  // When a user clicks a link that goes to the REAL site (e.g. ethz.ch instead
  // of /site/slug/...), rewrite it to stay inside the proxy. This catches:
  // - Links the HTML rewriter missed (dynamic JS-generated links)
  // - Google search results linking to the real domain
  // - Any anchor href pointing at the target domain directly

  document.addEventListener("click", function (e) {
    var anchor = e.target.closest ? e.target.closest("a") : null;
    if (!anchor || !anchor.href) return;

    var href = anchor.href;
    // Skip # links, javascript:, mailto:, tel:
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) return;
    // Skip links already going through our proxy
    if (href.indexOf(PROXY_BASE) !== -1) return;
    // Skip links to the API
    if (href.indexOf(API_BASE) !== -1) return;

    if (isSameSite(href)) {
      e.preventDefault();
      e.stopPropagation();
      try {
        var u = new URL(href);
        var newPath = PROXY_BASE + u.pathname + u.search + u.hash;
        pushEvent("link_rewrite", { original: href, rewritten: newPath });
        flush();
        window.location.href = newPath;
      } catch(ex) {}
    } else {
      // External link — track it but let it go
      pushEvent("external_link", {
        href: href,
        text: (anchor.textContent || "").trim().slice(0, 80),
      });
    }
  }, true);

  // Also intercept window.open calls (JS popups / target=_blank)
  var origOpen = window.open;
  window.open = function(url) {
    if (url && isSameSite(url)) {
      try {
        var u = new URL(url, location.href);
        arguments[0] = PROXY_BASE + u.pathname + u.search + u.hash;
      } catch(ex) {}
    }
    return origOpen.apply(this, arguments);
  };

  // Intercept form submissions to same domain
  document.addEventListener("submit", function(e) {
    var form = e.target;
    if (!form || !form.action) return;
    if (isSameSite(form.action) && form.action.indexOf(PROXY_BASE) === -1) {
      try {
        var u = new URL(form.action);
        form.action = PROXY_BASE + u.pathname + u.search;
      } catch(ex) {}
    }
  }, true);

  // ── Rating widget ─────────────────────────────────────────────────────────

  var hasRated = sessionStorage.getItem("__ux_rated_" + SITE_ID);

  function buildRatingWidget() {
    if (hasRated) return;

    var widget = document.createElement("div");
    widget.id = "__ux_rating_widget";
    widget.innerHTML = '\
<div id="__ux_rating_toggle" style="\
  position:fixed;bottom:70px;right:20px;z-index:999998;\
  width:48px;height:48px;border-radius:50%;background:#185FA5;\
  color:#fff;display:flex;align-items:center;justify-content:center;\
  cursor:pointer;box-shadow:0 4px 16px rgba(24,95,165,0.35);\
  font-size:22px;transition:transform .2s;\
" title="Rate this website">★</div>\
<div id="__ux_rating_panel" style="\
  display:none;position:fixed;bottom:130px;right:20px;z-index:999998;\
  background:#ffffff;border:1px solid #E1E8F0;border-radius:12px;\
  padding:20px;width:300px;box-shadow:0 8px 32px rgba(26,43,66,0.12);\
  font:14px/1.5 \'DM Sans\',-apple-system,system-ui,sans-serif;color:#5C6B82;\
">\
  <div style="font-weight:700;font-size:15px;margin-bottom:14px;color:#1A2B42">Rate this website</div>\
  <div id="__ux_r_overall" style="margin-bottom:12px">\
    <div style="font-size:12px;color:#94A0B5;margin-bottom:4px">Overall Experience</div>\
    <div class="__ux_stars" data-field="overall" style="display:flex;gap:4px"></div>\
  </div>\
  <div id="__ux_r_nav" style="margin-bottom:12px">\
    <div style="font-size:12px;color:#94A0B5;margin-bottom:4px">Easy to Navigate</div>\
    <div class="__ux_stars" data-field="navigation" style="display:flex;gap:4px"></div>\
  </div>\
  <div id="__ux_r_design" style="margin-bottom:12px">\
    <div style="font-size:12px;color:#94A0B5;margin-bottom:4px">Visual Design</div>\
    <div class="__ux_stars" data-field="design" style="display:flex;gap:4px"></div>\
  </div>\
  <textarea id="__ux_r_comment" placeholder="Any comments? (optional)" style="\
    width:100%;height:50px;background:#F7F9FC;border:1px solid #E1E8F0;\
    border-radius:6px;color:#1A2B42;padding:8px;font:13px \'DM Sans\',-apple-system,system-ui,sans-serif;\
    resize:vertical;margin-bottom:10px;\
  "></textarea>\
  <button id="__ux_r_submit" style="\
    width:100%;padding:8px;background:#185FA5;color:#fff;border:none;\
    border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;\
  ">Submit Rating</button>\
  <div id="__ux_r_thanks" style="display:none;text-align:center;padding:16px 0;color:#0D7A5F;font-weight:600">Thanks for your feedback!</div>\
</div>';

    function attachWidget() {
      document.body.appendChild(widget);

      var ratings = { overall: 0, navigation: 0, design: 0 };

      // Build star buttons
      widget.querySelectorAll(".__ux_stars").forEach(function(container) {
        var field = container.getAttribute("data-field");
        for (var i = 1; i <= 5; i++) {
          var star = document.createElement("span");
          star.textContent = "☆";
          star.setAttribute("data-value", i);
          star.style.cssText = "cursor:pointer;font-size:24px;color:#185FA5;transition:transform .1s;user-select:none;";
          star.addEventListener("mouseenter", function() { this.style.transform = "scale(1.2)"; });
          star.addEventListener("mouseleave", function() { this.style.transform = "scale(1)"; });
          star.addEventListener("click", function() {
            var val = parseInt(this.getAttribute("data-value"));
            ratings[field] = val;
            // Update display
            var siblings = this.parentElement.children;
            for (var j = 0; j < siblings.length; j++) {
              siblings[j].textContent = j < val ? "★" : "☆";
            }
          });
          container.appendChild(star);
        }
      });

      // Toggle panel
      document.getElementById("__ux_rating_toggle").addEventListener("click", function() {
        var panel = document.getElementById("__ux_rating_panel");
        panel.style.display = panel.style.display === "none" ? "block" : "none";
      });

      // Submit
      document.getElementById("__ux_r_submit").addEventListener("click", function() {
        if (!ratings.overall || !ratings.navigation || !ratings.design) {
          this.textContent = "Please rate all 3 categories";
          this.style.background = "#ef4444";
          setTimeout(function() {
            var btn = document.getElementById("__ux_r_submit");
            if (btn) { btn.textContent = "Submit Rating"; btn.style.background = "#185FA5"; }
          }, 2000);
          return;
        }

        var comment = (document.getElementById("__ux_r_comment").value || "").trim();

        fetch(API_BASE + "/api/ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            site_id: SITE_ID,
            overall: ratings.overall,
            navigation: ratings.navigation,
            design: ratings.design,
            comment: comment,
          }),
        }).catch(function() {});

        pushEvent("rating_submitted", {
          overall: ratings.overall,
          navigation: ratings.navigation,
          design: ratings.design,
          has_comment: comment.length > 0,
        });

        sessionStorage.setItem("__ux_rated_" + SITE_ID, "1");

        document.getElementById("__ux_r_submit").style.display = "none";
        document.getElementById("__ux_r_comment").style.display = "none";
        document.getElementById("__ux_r_thanks").style.display = "block";
        setTimeout(function() {
          var w = document.getElementById("__ux_rating_widget");
          if (w) w.remove();
        }, 2000);
      });
    }

    if (document.body) attachWidget();
    else document.addEventListener("DOMContentLoaded", attachWidget);
  }

  // Show floating rating widget only in free-browse mode (no tasks configured, not heatmap preview)
  if (!NOTASKS_MODE && (!TASKS || TASKS.length === 0)) buildRatingWidget();

  // ── Task overlay ──────────────────────────────────────────────────────────

  (function initTaskOverlay() {
    if (NOTASKS_MODE || !TASKS || TASKS.length === 0) return;

    var taskKey = "__ux_task_idx_" + SITE_ID;
    var currentIdx = parseInt(sessionStorage.getItem(taskKey) || "0", 10);

    if (currentIdx >= TASKS.length) return; // already all done this session

    var overlay = document.createElement("div");
    overlay.id = "__ux_task_overlay";

    var minimizedKey = "__ux_task_min_" + SITE_ID;

    function render() {
      var task = TASKS[currentIdx];
      var num = currentIdx + 1;
      var total = TASKS.length;
      var isMin = sessionStorage.getItem(minimizedKey) === "1";

      overlay.innerHTML = isMin
        ? ('\
<div id="__ux_task_tab" style="\
  position:fixed;bottom:80px;right:0;z-index:999997;\
  background:#185FA5;color:#fff;\
  padding:10px 14px 10px 16px;border-radius:8px 0 0 8px;\
  font:600 13px -apple-system,system-ui,sans-serif;\
  cursor:pointer;box-shadow:-2px 2px 12px rgba(24,95,165,.35);\
  display:flex;align-items:center;gap:8px;\
" title="Show current task" onclick="document.getElementById(\'__ux_task_overlay\').querySelector(\'[data-expand]\').click()">\
  📋 Task ' + num + '/' + total + ' <span style="font-size:10px;opacity:.8">▶</span>\
  <span data-expand style="display:none"></span>\
</div>')
        : ('\
<div id="__ux_task_panel" style="\
  position:fixed;bottom:80px;right:20px;z-index:999997;\
  background:#ffffff;border:1px solid #E1E8F0;\
  border-radius:14px;padding:20px 22px;width:320px;\
  box-shadow:0 8px 32px rgba(26,43,66,.12);\
  font-family:-apple-system,system-ui,sans-serif;\
">\
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">\
    <span style="font-size:11px;font-weight:600;letter-spacing:.06em;color:#94A0B5;text-transform:uppercase">Task ' + num + ' of ' + total + '</span>\
    <button onclick="(function(){sessionStorage.setItem(\'__ux_task_min_' + SITE_ID + '\',\'1\');window.__uxTaskRender && window.__uxTaskRender();})()" style="\
      background:none;border:none;color:#94A0B5;cursor:pointer;\
      font-size:18px;line-height:1;padding:0 2px;\
    " title="Minimise">−</button>\
  </div>\
  <div style="font-size:16px;font-weight:700;color:#1A2B42;margin-bottom:' + (task.description ? "8px" : "18px") + ';line-height:1.4">' + escOverlay(task.title) + '</div>\
  ' + (task.description ? '<div style="font-size:13px;color:#5C6B82;margin-bottom:18px;line-height:1.5">' + escOverlay(task.description) + "</div>" : "") + '\
  <div style="background:#E1E8F0;border-radius:6px;height:4px;margin-bottom:16px;overflow:hidden">\
    <div style="height:100%;width:' + Math.round((currentIdx / TASKS.length) * 100) + '%;background:#185FA5;transition:width .4s"></div>\
  </div>\
  <button id="__ux_task_done_btn" style="\
    width:100%;padding:10px;background:#185FA5;color:#fff;\
    border:none;border-radius:8px;font:600 14px -apple-system,system-ui,sans-serif;\
    cursor:pointer;transition:opacity .15s;\
  ">Task done ✓</button>\
</div>');

      // Expand handler for minimised tab
      var expandEl = overlay.querySelector("[data-expand]");
      if (expandEl) {
        expandEl.parentElement.addEventListener("click", function() {
          sessionStorage.removeItem(minimizedKey);
          render();
        });
      }

      // Done button handler
      var doneBtn = overlay.querySelector("#__ux_task_done_btn");
      if (doneBtn) {
        doneBtn.addEventListener("mouseenter", function() { this.style.opacity = ".8"; });
        doneBtn.addEventListener("mouseleave", function() { this.style.opacity = "1"; });
        doneBtn.addEventListener("click", function() {
          pushEvent("task_complete", {
            task_id: TASKS[currentIdx].id,
            task_title: TASKS[currentIdx].title,
            task_index: currentIdx,
            tasks_total: TASKS.length,
          });
          flush();
          currentIdx++;
          sessionStorage.setItem(taskKey, currentIdx);
          sessionStorage.removeItem(minimizedKey);

          if (currentIdx >= TASKS.length) {
            // All done — go to finished page
            window.location.href = API_BASE + "/finished?site_id=" + encodeURIComponent(SITE_ID) + "&session_id=" + encodeURIComponent(sessionId);
          } else {
            // Navigate back to the site home page for the next task
            window.location.href = PROXY_BASE + "/";
          }
        });
      }
    }

    function escOverlay(str) {
      return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    }

    window.__uxTaskRender = render;
    render();

    if (document.body) document.body.appendChild(overlay);
    else document.addEventListener("DOMContentLoaded", function() { document.body.appendChild(overlay); });
  })();

  // ── Tracking consent banner (hidden in heatmap preview / notasks mode) ─────

  (function showBanner() {
    if (NOTASKS_MODE) return;
    var banner = document.createElement("div");
    banner.id = "__ux_tracker_banner";
    banner.innerHTML = '\
      <div style="\
        position:fixed;bottom:0;left:0;right:0;z-index:999999;\
        background:#ffffff;color:#5C6B82;padding:12px 20px;\
        font:14px/1.5 -apple-system,system-ui,sans-serif;\
        display:flex;align-items:center;justify-content:space-between;\
        box-shadow:0 -2px 20px rgba(26,43,66,0.12);\
        border-top:2px solid #185FA5;\
      ">\
        <span style="color:#1A2B42">This is a <strong>UX test preview</strong>. Interactions are being recorded anonymously for usability analysis.</span>\
        <button onclick="this.parentElement.parentElement.remove()" style="\
          background:#185FA5;color:#ffffff;border:none;padding:6px 16px;\
          border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;margin-left:16px;\
          white-space:nowrap;\
        ">Got it</button>\
      </div>';
    if (document.body) document.body.appendChild(banner);
    else document.addEventListener("DOMContentLoaded", function() { document.body.appendChild(banner); });
  })();
})();
