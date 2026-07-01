/*
 * Shut Up Popups — content script
 *
 * Runs at document_start on every page. It does three things:
 *   1. Restores the ability to scroll/interact (popups often lock the body).
 *   2. Removes elements that match a curated list of known popup patterns.
 *   3. Heuristically detects full-screen blocking overlays and removes them.
 *
 * Everything is gated behind per-site settings loaded from browser.storage so
 * the user can disable it on sites where they don't want it running.
 */
(function () {
  "use strict";

  // Firefox exposes `browser`; fall back to `chrome` just in case.
  const api = typeof browser !== "undefined" ? browser : chrome;

  const host = location.hostname.replace(/^www\./, "");

  // Default configuration. Overridden by stored settings below.
  let settings = {
    enabled: true,
    removeKnownPopups: true,
    removeOverlays: true,
    restoreScroll: true,
    disabledSites: []
  };

  let active = false;
  let removedCount = 0;

  /* --------------------------------------------------------------------- *
   * Known popup selectors
   *
   * Conservative, widely-applicable patterns. Site-specific entries are
   * keyed by hostname suffix so we only run them where relevant.
   * --------------------------------------------------------------------- */
  const GENERIC_SELECTORS = [
    // Cookie / consent / GDPR walls
    "#onetrust-consent-sdk",
    ".onetrust-pc-dark-filter",
    "#CybotCookiebotDialog",
    "#CybotCookiebotDialogBodyUnderlay",
    ".qc-cmp2-container",
    ".cookie-consent",
    ".cookie-banner",
    ".gdpr-banner",
    "[id*='cookie-consent']",
    // Generic newsletter / subscribe / paywall modals
    ".newsletter-modal",
    ".subscribe-modal",
    ".paywall",
    ".modal-paywall",
    "[class*='newsletter-popup']",
    "[class*='signup-modal']",
    // Generic backdrops
    ".modal-backdrop",
    ".overlay-backdrop"
  ];

  // hostname suffix -> selectors that only apply there.
  const SITE_SELECTORS = {
    "reddit.com": [
      // "Get the app to keep using Reddit" / "Continue in app" XPromo nags.
      // Reddit uses many XPromo* class variants plus mweb_xpromo bundles;
      // match them broadly by prefix/substring.
      "xpromo-app-selector",
      "xpromo-nsfw-blocking-container",
      "[class^='XPromo']",
      "[class*=' XPromo']",
      "[bundlename^='mweb_xpromo']",
      "shreddit-async-loader[bundlename*='xpromo']",
      "shreddit-app-promo",
      // login / signup walls and their dimming layer
      ".login-required",
      "shreddit-signup-drawer",
      "shreddit-async-loader[bundlename*='signup']",
      "shreddit-async-loader[bundlename*='login']",
      "faceplate-dialog",
      // generic blurred wrapper reddit drops over content
      ".PromotedPostCTA"
    ],
    "quora.com": [
      ".signup_wall_wrapper",
      ".signup_wall_prevent_scroll"
    ],
    "medium.com": [
      ".overlay",
      ".meteredContent"
    ]
  };

  function selectorsForHost() {
    let list = GENERIC_SELECTORS.slice();
    for (const suffix in SITE_SELECTORS) {
      if (host === suffix || host.endsWith("." + suffix)) {
        list = list.concat(SITE_SELECTORS[suffix]);
      }
    }
    return list;
  }

  /* --------------------------------------------------------------------- *
   * Scroll-lock restoration
   * --------------------------------------------------------------------- */
  function restoreScroll() {
    if (!settings.restoreScroll) return;
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.overflow === "hidden" || cs.overflowY === "hidden") {
        el.style.setProperty("overflow", "auto", "important");
      }
      if (cs.position === "fixed") {
        el.style.setProperty("position", "static", "important");
      }
      // Some sites set a negative top to "freeze" the scroll position.
      if (el === document.body && el.style.top && el.style.top.startsWith("-")) {
        el.style.removeProperty("top");
      }
    }
    document.documentElement.style.setProperty("scroll-behavior", "auto");
  }

  /* --------------------------------------------------------------------- *
   * Removal helpers + diagnostics log
   * --------------------------------------------------------------------- */
  // Rolling log of what we removed, captured BEFORE removal so the DOM dump
  // still shows the popup even after it's gone. Read via the "captureDom"
  // message from the popup's debug button.
  const removalLog = [];

  function snapshot(el, reason) {
    try {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const cls =
        el.className && el.className.toString ? el.className.toString() : "";
      return {
        reason,
        tag: el.tagName ? el.tagName.toLowerCase() : "?",
        id: el.id || "",
        class: cls,
        bundlename: (el.getAttribute && el.getAttribute("bundlename")) || "",
        position: cs.position,
        zIndex: cs.zIndex,
        rect: { w: Math.round(r.width), h: Math.round(r.height) },
        html: (el.outerHTML || "").slice(0, 1200)
      };
    } catch (e) {
      return { reason, error: String(e) };
    }
  }

  function remove(el, reason) {
    if (!el || !el.parentNode) return;
    try {
      if (removalLog.length < 200) removalLog.push(snapshot(el, reason));
      el.remove();
      removedCount++;
      report();
      // eslint-disable-next-line no-console
      console.debug("[Shut Up Popups] removed", reason, el);
    } catch (e) {
      /* ignore */
    }
  }

  // Build a full diagnostic report of the current page state.
  function buildDiagnostics() {
    const survivingNagButtons = [];
    try {
      const clickable = document.querySelectorAll("button, a, [role='button']");
      for (const el of clickable) {
        if (survivingNagButtons.length >= 15) break; // bound the work
        const t = (el.textContent || "").trim();
        if (t.length > 80 || !NAG_TEXT.test(t)) continue;
        const chain = [];
        let n = el;
        for (let i = 0; n && i < 8; i++, n = n.parentElement) {
          const cs = getComputedStyle(n);
          const cls =
            n.className && n.className.toString ? n.className.toString() : "";
          chain.push({
            tag: n.tagName.toLowerCase(),
            id: n.id || "",
            class: cls,
            position: cs.position,
            zIndex: cs.zIndex
          });
        }
        // Record only the button's own HTML (small). The ancestor chain above
        // already carries the class/id info needed to build a selector; we
        // deliberately avoid serializing the wrapper's whole subtree, which
        // can be huge and is what made capture hang.
        survivingNagButtons.push({
          buttonText: t,
          chain,
          html: (el.outerHTML || "").slice(0, 600)
        });
      }
    } catch (e) {
      /* ignore */
    }

    const xpromoHints = [];
    try {
      const hinted = document.querySelectorAll(
        "[class*='XPromo'], [class*='xpromo'], xpromo-app-selector, [bundlename], faceplate-dialog, shreddit-signup-drawer"
      );
      let i = 0;
      for (const el of hinted) {
        if (i++ >= 30) break;
        xpromoHints.push(snapshot(el, "hint"));
      }
    } catch (e) {
      /* ignore */
    }

    return {
      generatedAt: new Date().toISOString(),
      url: location.href,
      userAgent: navigator.userAgent,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      active,
      removedCount,
      removed: removalLog.slice(-40),
      survivingNagButtons,
      xpromoHints
    };
  }

  // Persist the latest diagnostics to storage so the popup can read them
  // directly. This avoids a live popup->content message at capture time, which
  // is unreliable in Firefox for Android's popup context.
  function storeDiagnostics() {
    try {
      api.storage.local.set({ lastCapture: buildDiagnostics() });
    } catch (e) {
      /* ignore */
    }
  }

  function removeKnownPopups() {
    if (!settings.removeKnownPopups) return;
    for (const sel of selectorsForHost()) {
      let nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (e) {
        continue; // invalid selector for this DOM, skip
      }
      nodes.forEach((n) => remove(n, "known:" + sel));
    }
  }

  /* --------------------------------------------------------------------- *
   * Reddit-specific cleanup
   *
   * The mobile "Get the app to keep using Reddit" nag sometimes ships with
   * obfuscated class names, so selectors alone can miss it. As a fallback we
   * match by the button/link text it always contains and remove the nag's
   * banner/overlay ancestor. Reddit also blurs the content behind the nag —
   * we clear that so the page is readable once the nag is gone.
   * --------------------------------------------------------------------- */
  const isReddit = host === "reddit.com" || host.endsWith(".reddit.com");

  const NAG_TEXT = /(keep using reddit|get the app|continue in (the )?(app|browser)|open in app|use the reddit app)/i;

  function redditCleanup() {
    if (!isReddit || !document.body) return;

    // 1) Text-based nag removal. Look at small interactive elements only
    //    (buttons/links) so we never match a whole article by its body text.
    const clickable = document.querySelectorAll(
      "button, a, [role='button']"
    );
    for (const el of clickable) {
      if (seen.has(el)) continue; // inspected on an earlier scan
      const label = (el.textContent || "").trim();
      if (label.length > 60 || !NAG_TEXT.test(label)) {
        seen.add(el); // not a nag — skip it next time
        continue;
      }
      // Walk up to the enclosing banner/overlay: a fixed/sticky/absolute
      // ancestor, or a known XPromo wrapper. Cap the climb so we don't delete
      // the whole page.
      let node = el;
      let target = null;
      for (let i = 0; node && node !== document.body && i < 8; i++) {
        const cs = getComputedStyle(node);
        const cls = node.className && node.className.toString
          ? node.className.toString()
          : "";
        if (
          cs.position === "fixed" ||
          cs.position === "sticky" ||
          /XPromo|xpromo|app-?promo|nag|banner|drawer|bottom-?sheet/i.test(cls) ||
          /xpromo|app-selector|bottom-sheet/i.test(node.tagName.toLowerCase())
        ) {
          target = node;
        }
        node = node.parentElement;
      }
      remove(target || el.closest("div") || el, "reddit-nag-text");
    }

    // 2) Un-blur content Reddit dims behind the nag.
    const blurred = document.querySelectorAll(
      "[style*='blur'], .XPromoNsfwBlockingContainer, [class*='blur']"
    );
    for (const el of blurred) {
      const cs = getComputedStyle(el);
      if (cs.filter && cs.filter.indexOf("blur") !== -1) {
        el.style.setProperty("filter", "none", "important");
      }
      if (cs.webkitFilter && cs.webkitFilter.indexOf("blur") !== -1) {
        el.style.setProperty("-webkit-filter", "none", "important");
      }
    }
  }

  /* --------------------------------------------------------------------- *
   * Heuristic overlay detection
   *
   * A "blocking overlay" is an element that:
   *   - is position fixed or absolute,
   *   - covers most of the viewport,
   *   - has a high z-index,
   *   - and is not the page's main content root.
   *
   * We avoid removing huge elements that contain a lot of the page's text
   * (likely the real content), and we never touch <html>/<body>.
   * --------------------------------------------------------------------- */
  function isBlockingOverlay(el) {
    if (!(el instanceof Element)) return false;
    if (el === document.body || el === document.documentElement) return false;

    const cs = getComputedStyle(el);
    const pos = cs.position;
    if (pos !== "fixed" && pos !== "absolute" && pos !== "sticky") return false;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw === 0 || vh === 0) return false;

    const coverage = (rect.width * rect.height) / (vw * vh);
    // A full-screen blocker covers ~85%+ of the viewport.
    const fullBlocker = coverage >= 0.85;
    // Reddit's "Get the app" nag is a sheet pinned to the BOTTOM that covers
    // the lower part of the screen rather than the whole viewport — the case
    // that was slipping through on subpages.
    const bottomSheet =
      (pos === "fixed" || pos === "sticky") &&
      rect.bottom >= vh - 8 &&
      rect.top > vh * 0.1 &&
      rect.height >= vh * 0.2 &&
      rect.width >= vw * 0.6;
    if (!fullBlocker && !bottomSheet) return false;

    const z = parseInt(cs.zIndex, 10);
    const highZ = !isNaN(z) && z >= 100;
    // A see-through dimming layer is also a strong signal.
    const dimming =
      cs.backgroundColor &&
      cs.backgroundColor.startsWith("rgba") &&
      !cs.backgroundColor.endsWith(", 0)");
    const blocksPointer = cs.pointerEvents !== "none";

    if (!highZ && !dimming) return false;
    if (!blocksPointer) return false;

    // Guard: don't nuke the primary content container. If the element holds a
    // large amount of the document's visible text, treat it as content.
    const txt = (el.innerText || "").trim();
    const docText = (document.body && document.body.innerText
      ? document.body.innerText.trim().length
      : 1) || 1;
    if (txt.length / docText > 0.5) return false;

    // A partial (bottom-sheet) element is only removed if it actually looks
    // like an app/login nag, so we never strip legitimate sticky bottom bars.
    if (bottomSheet && !fullBlocker) {
      const cls =
        el.className && el.className.toString ? el.className.toString() : "";
      const appish =
        NAG_TEXT.test(txt) ||
        /xpromo/i.test(cls) ||
        /xpromo/i.test(el.tagName.toLowerCase());
      if (!appish) return false;
    }

    return true;
  }

  /* --------------------------------------------------------------------- *
   * Main sweep
   *
   * The popups we target (login walls, "Get the app" nags) appear several
   * seconds AFTER load, not at load — so we deliberately do nothing heavy up
   * front and instead run a cheap scan on a fixed interval. No MutationObserver:
   * observing Reddit's constantly-mutating DOM is what saturated the main
   * thread and made both the extension and the debug capture feel frozen.
   *
   *  - lightScan():  cheap selectors + Reddit nag text + scroll unlock + a
   *                  budgeted overlay heuristic. Runs every SCAN_INTERVAL ms,
   *                  starting only after START_DELAY so page load is untouched.
   *  - fullSweep():  one thorough pass, for the manual "Remove popups now".
   * --------------------------------------------------------------------- */
  const SCAN_INTERVAL = 5000; // ms between periodic scans
  const START_DELAY = 5000; // do NOTHING for the first 5s so the page loads freely
  const OVERLAY_TAGS = "div, section, aside, dialog, ion-modal";

  // Elements we've already inspected. On each scan we skip these so we only
  // pay the cost of examining elements that appeared since last time. A
  // WeakSet holds elements weakly, so removed nodes are garbage-collected and
  // this never leaks. Reset by fullSweep() when a fresh full check is wanted.
  let seen = new WeakSet();

  function collectCandidates(roots, cap) {
    const set = new Set();
    for (const root of roots) {
      if (!(root instanceof Element)) continue;
      if (root.matches && root.matches(OVERLAY_TAGS) && !seen.has(root)) {
        set.add(root);
      }
      let nodes;
      try {
        nodes = root.querySelectorAll(OVERLAY_TAGS);
      } catch (e) {
        continue;
      }
      for (const n of nodes) {
        if (seen.has(n)) continue; // already inspected on an earlier scan
        set.add(n);
        if (set.size >= cap) return Array.from(set);
      }
    }
    return Array.from(set);
  }

  function removeOverlaysIn(roots, cap) {
    if (!settings.removeOverlays || !document.body) return;
    const cands = collectCandidates(roots, cap);
    for (const el of cands) {
      seen.add(el); // don't re-examine this element next scan
      if (el.isConnected && isBlockingOverlay(el)) {
        remove(el, "overlay-heuristic");
      }
    }
  }

  function fullSweep() {
    if (!active) return;
    seen = new WeakSet(); // force a fresh look at every element
    removeKnownPopups(); // fast, index-backed selectors
    redditCleanup();
    removeOverlaysIn([document.body], 1200);
    restoreScroll();
    storeDiagnostics();
  }

  function lightScan() {
    if (!active) return;
    removeKnownPopups(); // native selectors — cheap
    redditCleanup(); // reddit nag text scan + un-blur
    restoreScroll(); // only touches <html>/<body>
    // Safe to run every tick now: the `seen` WeakSet means the overlay
    // heuristic only pays getComputedStyle cost for elements new since the
    // last scan, so it stays cheap while catching nags within one interval.
    removeOverlaysIn([document.body], 800);
    storeDiagnostics(); // keep the debug snapshot fresh for the popup
  }

  let scanTimer = null;
  let startTimer = null;
  function startScanning() {
    if (scanTimer || startTimer) return;
    // Do absolutely nothing for the first START_DELAY ms so the page can load
    // unimpeded; only then begin the periodic scan.
    startTimer = setTimeout(() => {
      startTimer = null;
      if (!active) return;
      lightScan();
      scanTimer = setInterval(lightScan, SCAN_INTERVAL);
    }, START_DELAY);
  }

  function stopScanning() {
    if (scanTimer) {
      clearInterval(scanTimer);
      scanTimer = null;
    }
    if (startTimer) {
      clearTimeout(startTimer);
      startTimer = null;
    }
  }

  /* --------------------------------------------------------------------- *
   * Reporting to the toolbar popup
   * --------------------------------------------------------------------- */
  function report() {
    try {
      api.runtime.sendMessage({
        type: "stats",
        host,
        active,
        removedCount
      });
    } catch (e) {
      /* popup not open / no receiver — fine */
    }
  }

  /* --------------------------------------------------------------------- *
   * Lifecycle
   * --------------------------------------------------------------------- */
  function siteEnabled() {
    if (!settings.enabled) return false;
    return !settings.disabledSites.some(
      (s) => host === s || host.endsWith("." + s)
    );
  }

  function start() {
    if (active) return;
    active = true;
    // Nothing heavy at load — just kick off the periodic scanner.
    startScanning();
  }

  function stop() {
    active = false;
    stopScanning();
  }

  function applySettings() {
    if (siteEnabled()) {
      start();
    } else {
      stop();
    }
    report();
  }

  // Listen for live messages from the popup (toggle, manual sweep, etc.)
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "getStats":
        sendResponse({ host, active, removedCount });
        break;
      case "sweepNow":
        active = true;
        startScanning();
        fullSweep();
        sendResponse({ host, active, removedCount });
        break;
      case "settingsChanged":
        loadSettings().then(applySettings);
        break;
      case "captureDom":
        try {
          sendResponse(buildDiagnostics());
        } catch (e) {
          sendResponse({ error: String(e) });
        }
        break;
    }
    return true;
  });

  function loadSettings() {
    return api.storage.local
      .get("settings")
      .then((data) => {
        if (data && data.settings) {
          settings = Object.assign(settings, data.settings);
        }
        return settings;
      })
      .catch(() => settings);
  }

  // React to settings changes from the options page in real time.
  if (api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) {
        settings = Object.assign(settings, changes.settings.newValue || {});
        applySettings();
      }
    });
  }

  loadSettings().then(applySettings);
})();
