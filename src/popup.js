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
  els.captureHint.textContent = "Loading capture…";
  els.reportOut.hidden = true;

  // Read the snapshot the content script writes to storage on every scan.
  // No live messaging / tabs.query, so this can never hang.
  api.storage.local
    .get("lastCapture")
    .then((data) => {
      const report = data && data.lastCapture;
      if (!report) {
        els.captureHint.textContent =
          "No capture yet — open a reddit.com tab, wait ~5s, then tap again.";
        return;
      }
      const json = JSON.stringify(report, null, 2);

      // Show it AND copy to clipboard so it can be pasted straight into chat.
      els.reportOut.hidden = false;
      els.reportOut.value = json;
      els.reportOut.focus();
      els.reportOut.select();

      const age = report.generatedAt ? " (as of " + report.generatedAt + ")" : "";
      const msg = "Captured " + json.length + " chars" + age + ". ";
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(json).then(
            () => {
              els.captureHint.textContent =
                msg + "Copied to clipboard — paste it to share.";
            },
            () => {
              els.captureHint.textContent =
                msg + "Select the text below and copy it.";
            }
          );
        } else {
          els.captureHint.textContent = msg + "Select the text below and copy it.";
        }
      } catch (e) {
        els.captureHint.textContent = msg + "Select the text below and copy it.";
      }

      // Best-effort file download too — non-blocking.
      try {
        const url = URL.createObjectURL(
          new Blob([json], { type: "application/json" })
        );
        if (api.downloads && api.downloads.download) {
          api.downloads
            .download({ url, filename: "shutup-reddit-dom.json", saveAs: false })
            .catch(() => {});
        }
      } catch (e) {
        /* ignore — the textarea/clipboard is the real deliverable */
      }
    })
    .catch((err) => {
      els.captureHint.textContent = "Could not read capture: " + err;
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
