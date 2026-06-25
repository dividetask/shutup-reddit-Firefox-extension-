"use strict";

const api = typeof browser !== "undefined" ? browser : chrome;

const DEFAULTS = {
  enabled: true,
  removeKnownPopups: true,
  removeOverlays: true,
  restoreScroll: true,
  disabledSites: []
};

const BOOL_KEYS = ["enabled", "removeKnownPopups", "removeOverlays", "restoreScroll"];

let settings = Object.assign({}, DEFAULTS);

const statusEl = document.getElementById("status");
const siteListEl = document.getElementById("siteList");
const newSiteEl = document.getElementById("newSite");

function load() {
  return api.storage.local.get("settings").then((data) => {
    settings = Object.assign({}, DEFAULTS, (data && data.settings) || {});
  });
}

function save() {
  return api.storage.local.set({ settings }).then(() => {
    statusEl.textContent = "Saved.";
    setTimeout(() => (statusEl.textContent = ""), 1200);
  });
}

function normalizeHost(value) {
  let v = (value || "").trim().toLowerCase();
  if (!v) return "";
  // Allow pasting a full URL.
  try {
    if (v.includes("://")) v = new URL(v).hostname;
  } catch (e) {
    /* keep raw */
  }
  return v.replace(/^www\./, "").replace(/\/.*$/, "");
}

function renderBools() {
  BOOL_KEYS.forEach((key) => {
    const el = document.getElementById(key);
    if (el) el.checked = !!settings[key];
  });
}

function renderSites() {
  siteListEl.textContent = "";
  if (!settings.disabledSites.length) {
    const li = document.createElement("li");
    li.textContent = "No disabled sites.";
    li.style.color = "#6b6b6b";
    siteListEl.appendChild(li);
    return;
  }
  settings.disabledSites.forEach((site) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = site;
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      settings.disabledSites = settings.disabledSites.filter((s) => s !== site);
      save().then(renderSites);
    });
    li.appendChild(span);
    li.appendChild(btn);
    siteListEl.appendChild(li);
  });
}

BOOL_KEYS.forEach((key) => {
  const el = document.getElementById(key);
  if (!el) return;
  el.addEventListener("change", () => {
    settings[key] = el.checked;
    save();
  });
});

document.getElementById("addSite").addEventListener("click", () => {
  const host = normalizeHost(newSiteEl.value);
  if (!host) return;
  if (!settings.disabledSites.includes(host)) {
    settings.disabledSites.push(host);
    settings.disabledSites.sort();
    save().then(renderSites);
  }
  newSiteEl.value = "";
});

newSiteEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("addSite").click();
});

load().then(() => {
  renderBools();
  renderSites();
});
