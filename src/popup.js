"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;

const DEFAULTS = {
  enabled: true,
  removeKnownPopups: true,
  removeOverlays: true,
  restoreScroll: true,
  disabledSites: []
};

const els = {
  site: document.getElementById("site"),
  siteEnabled: document.getElementById("siteEnabled"),
  globalEnabled: document.getElementById("globalEnabled"),
  sweepNow: document.getElementById("sweepNow"),
  count: document.getElementById("count"),
  captureDom: document.getElementById("captureDom"),
  captureHint: document.getElementById("captureHint"),
  reportOut: document.getElementById("reportOut"),
  openOptions: document.getElementById("openOptions")
};

let settings = Object.assign({}, DEFAULTS);
let currentHost = "";

function loadSettings() {
  return api.storage.local.get("settings").then((data) => {
    settings = Object.assign({}, DEFAULTS, (data && data.settings) || {});
    return settings;
  });
}

function saveSettings() {
  return api.storage.local.set({ settings });
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

function activeTab() {
  return api.tabs
    .query({ active: true, currentWindow: true })
    .then((tabs) => tabs && tabs[0]);
}

function isSiteEnabled() {
  if (!settings.enabled) return false;
  return !settings.disabledSites.some(
    (s) => currentHost === s || currentHost.endsWith("." + s)
  );
}

function renderToggles() {
  els.globalEnabled.checked = !!settings.enabled;
  els.siteEnabled.checked = isSiteEnabled();
  els.siteEnabled.disabled = !settings.enabled;
}

function notifyTab(type) {
  return activeTab().then((tab) => {
    if (!tab) return null;
    return api.tabs.sendMessage(tab.id, { type }).catch(() => null);
  });
}

function refreshStats() {
  notifyTab("getStats").then((res) => {
    if (res && typeof res.removedCount === "number") {
      els.count.textContent = res.removedCount;
    }
  });
}

els.globalEnabled.addEventListener("change", () => {
  settings.enabled = els.globalEnabled.checked;
  saveSettings().then(() => {
    renderToggles();
    notifyTab("settingsChanged");
  });
});

els.siteEnabled.addEventListener("change", () => {
  const list = new Set(settings.disabledSites);
  if (els.siteEnabled.checked) {
    list.delete(currentHost);
  } else {
    list.add(currentHost);
  }
  settings.disabledSites = Array.from(list);
  saveSettings().then(() => notifyTab("settingsChanged"));
});

els.sweepNow.addEventListener("click", () => {
  notifyTab("sweepNow").then((res) => {
    if (res && typeof res.removedCount === "number") {
      els.count.textContent = res.removedCount;
    }
  });
});

els.captureDom.addEventListener("click", () => {
  // Always keep the text box visible and write every state into it, so the
  // result can never be "nothing on screen".
  els.reportOut.hidden = false;
  els.reportOut.value = "reading storage…";
  els.captureHint.textContent = "Reading…";

  // Read ALL storage so we can also report what's there if lastCapture is
  // missing (useful for diagnosing whether the content script wrote anything).
  api.storage.local
    .get(null)
    .then((all) => {
      const report = all && all.lastCapture;
      if (!report) {
        els.reportOut.value =
          "No capture stored yet.\n\nStorage keys present: [" +
          Object.keys(all || {}).join(", ") +
          "]\n\nOpen a reddit.com tab and wait ~10s (the first scan runs 5s " +
          "after the page settles), then tap Capture again.";
        els.captureHint.textContent = "No capture yet.";
        return;
      }

      let json;
      try {
        json = JSON.stringify(report, null, 2);
      } catch (e) {
        els.reportOut.value = "Could not stringify report: " + e;
        els.captureHint.textContent = "Error.";
        return;
      }

      els.reportOut.value = json;
      els.captureHint.textContent =
        "Captured " + json.length + " chars. Long-press the box to copy.";

      // Best-effort clipboard copy — never allowed to break the display above.
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(json).then(
            () => {
              els.captureHint.textContent =
                "Copied " + json.length + " chars to clipboard — paste to share.";
            },
            () => {}
          );
        }
      } catch (e) {
        /* clipboard unavailable — the text box already has it */
      }
    })
    .catch((err) => {
      els.reportOut.value = "Storage read failed: " + err;
      els.captureHint.textContent = "Read error.";
    });
});

els.openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  if (api.runtime.openOptionsPage) api.runtime.openOptionsPage();
});

// Live stat updates pushed from the content script.
api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "stats" && msg.host === currentHost) {
    els.count.textContent = msg.removedCount;
  }
});

(function init() {
  Promise.all([loadSettings(), activeTab()]).then(([, tab]) => {
    currentHost = tab ? hostFromUrl(tab.url) : "";
    els.site.textContent = currentHost || "this site";
    renderToggles();
    refreshStats();
  });
})();
