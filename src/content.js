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
      // "Continue in app" / open-in-app interstitials
      "xpromo-app-selector",
      ".XPromoPopup",
      "[bundlename='mweb_xpromo_interstitial_recommendations_ios']",
      "[bundlename='mweb_xpromo_interstitial_recommendations_android']",
      // login / signup walls and their dimming layer
      ".login-required",
      "shreddit-signup-drawer",
      "shreddit-async-loader[bundlename='desktop_signup_drawer']",
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
   * Removal helpers
   * --------------------------------------------------------------------- */
  function remove(el, reason) {
    if (!el || !el.parentNode) return;
    try {
      el.remove();
      removedCount++;
      report();
      // eslint-disable-next-line no-console
      console.debug("[Shut Up Popups] removed", reason, el);
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
    if (cs.position !== "fixed" && cs.position !== "absolute") return false;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw === 0 || vh === 0) return false;

    const coverage = (rect.width * rect.height) / (vw * vh);
    // Must cover at least ~85% of the viewport to count as a full blocker.
    if (coverage < 0.85) return false;

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
    const elText = (el.innerText || "").trim().length;
    const docText = (document.body && document.body.innerText
      ? document.body.innerText.trim().length
      : 1) || 1;
    if (elText / docText > 0.5) return false;

    return true;
  }

  function removeOverlays() {
    if (!settings.removeOverlays) return;
    if (!document.body) return;
    // Only scan reasonably shallow, high-z candidates to stay cheap.
    const candidates = document.body.querySelectorAll(
      "div, section, aside, dialog, ion-modal"
    );
    for (const el of candidates) {
      if (isBlockingOverlay(el)) {
        remove(el, "overlay-heuristic");
      }
    }
  }

  /* --------------------------------------------------------------------- *
   * Main sweep
   * --------------------------------------------------------------------- */
  function sweep() {
    if (!active) return;
    removeKnownPopups();
    removeOverlays();
    restoreScroll();
  }

  // Throttle sweeps triggered by the mutation observer.
  let scheduled = false;
  function scheduleSweep() {
    if (scheduled || !active) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sweep();
    });
  }

  let observer = null;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => scheduleSweep());
    const opts = { childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "class"] };
    if (document.documentElement) observer.observe(document.documentElement, opts);
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
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
    startObserver();
    sweep();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", sweep, { once: true });
    }
    window.addEventListener("load", sweep, { once: true });
  }

  function stop() {
    active = false;
    stopObserver();
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
        startObserver();
        sweep();
        sendResponse({ host, active, removedCount });
        break;
      case "settingsChanged":
        loadSettings().then(applySettings);
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
