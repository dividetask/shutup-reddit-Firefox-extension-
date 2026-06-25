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
