# Shut Up Reddit Popups — Firefox for Android extension

A lightweight extension for **Firefox on Android** that removes Reddit's
annoying login/signup walls, "open in app" interstitials and modal overlays
that block you from reading the site. It also restores scrolling when a popup
freezes the page.

It **only runs on `reddit.com`** (and its subdomains). It does nothing on any
other site.

## What it does

1. **Restores scrolling** — Reddit sets `overflow: hidden` / `position: fixed`
   on the page to trap you behind a wall. The extension undoes that.
2. **Removes known Reddit popups** — login/signup drawers, "continue in app"
   prompts, and generic cookie/consent banners.
3. **Removes blocking overlays heuristically** — detects full-screen, high
   `z-index`, pointer-blocking dimming layers and removes them, while being
   careful not to delete the real page content.

It keeps watching the page (via a `MutationObserver`), so popups injected after
load are removed too.

## Install on Firefox for Android

Firefox for Android only installs extensions that are **signed by Mozilla**, so
you first get the add-on signed, then install the resulting `.xpi` on your
phone. (There is no "load temporary add-on" on Android like there is on
desktop.)

### Step 1 — Package the extension

On any computer, from inside this project folder:

```sh
zip -r -FS shutup-reddit-popups.zip manifest.json icons src
```

### Step 2 — Get it signed by Mozilla (free)

1. Create a developer account at
   [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. **Submit a New Add-on** → choose **"On your own"** (self/unlisted
   distribution) if you just want it for yourself.
3. Upload `shutup-reddit-popups.zip`. Mozilla validates and signs it, then lets
   you **download the signed `.xpi`**.

### Step 3 — Install on your phone

1. Put the signed `.xpi` somewhere you can reach from the phone (email it to
   yourself, a cloud drive, or open the AMO download link directly in Firefox
   on the phone).
2. In Firefox for Android, open the `.xpi` link/file — Firefox will prompt to
   **Add** the extension. Tap **Add**.
3. Open `reddit.com`. Tap the **⋮ menu → Extensions** (or **Add-ons**) to open
   the panel, toggle, or run **Remove popups now**.

> Tip for faster testing: **Firefox Nightly for Android** lets you install your
> own unsigned add-on through a custom add-on collection
> (Settings → "Install extension from file" / custom collection), which skips
> the signing wait. For day-to-day use on regular Firefox, the signed `.xpi`
> route above is the reliable one.

## Usage

- Open the extension's panel from Firefox's menu while on Reddit:
  - **Block popups here** — toggle the extension for Reddit.
  - **Extension enabled** — master on/off.
  - **Remove popups now** — force an immediate sweep.
  - Shows how many elements were removed on the current page.
- The options page lets you toggle each removal strategy independently.

## Project layout

```
manifest.json        Extension manifest (Manifest V2, Gecko/Android)
icons/icon.svg       Add-on icon
src/content.js       Core engine: detection + removal, runs only on reddit.com
src/popup.html/.css/.js   Extension panel
src/options.html/.css/.js Settings page
```

## Notes & limitations

- The heuristic overlay remover is conservative (it skips elements that contain
  most of the page's visible text). If something looks off, turn off
  "Remove full-screen blocking overlays" in the settings page.
- This removes popups from the page DOM; it does not block network requests or
  trackers. Pair it with a content blocker (e.g. uBlock Origin, which also runs
  on Firefox for Android) for that.
