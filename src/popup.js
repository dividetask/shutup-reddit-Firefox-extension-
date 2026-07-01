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

// Show a step marker and yield so the popup actually REPAINTS before the next
// (possibly blocking) operation. Whichever letter is left on screen when it
// freezes is the step that hung.
function step(label) {
  els.captureHint.textContent = label;
  return new Promise((resolve) => setTimeout(resolve, 40));
}

els.captureDom.addEventListener("click", async () => {
  els.reportOut.hidden = true;
  try {
    await step("A: reading storage…");
    const data = await api.storage.local.get("lastCapture");

    await step("B: got storage");
    const report = data && data.lastCapture;
    if (!report) {
      els.captureHint.textContent =
        "No capture yet — open reddit.com, wait ~5s, then tap again.";
      return;
    }

    await step("C: stringifying…");
    const json = JSON.stringify(report, null, 2);

    await step("D: json = " + json.length + " chars");
    els.reportOut.hidden = false;

    await step("E: writing to box…");
    els.reportOut.value = json;

    await step("F: selecting text…");
    try {
      els.reportOut.focus();
      els.reportOut.select();
    } catch (e) {
      /* selection is optional */
    }

    await step("G: copying to clipboard…");
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(json);
        copied = true;
      }
    } catch (e) {
      copied = false;
    }

    els.captureHint.textContent =
      "H: done — " +
      json.length +
      " chars" +
      (copied ? ", copied to clipboard." : ". Copy the text in the box below.");
  } catch (err) {
    els.captureHint.textContent =
      "Froze/failed right after the last letter shown: " + err;
  }
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
