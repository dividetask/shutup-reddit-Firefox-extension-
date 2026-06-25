# Shut Up Popups — Firefox extension

A lightweight Firefox extension that removes annoying popups, modal overlays,
login/signup walls, cookie banners and "open in app" interstitials that block
you from actually using a website. It also restores scrolling when a popup
freezes the page.

## What it does

1. **Restores scrolling** — many popups set `overflow: hidden` / `position: fixed`
   on the page to trap you. The extension undoes that so you can scroll again.
2. **Removes known popups** — a curated list of common patterns (cookie/GDPR
   walls, newsletter and signup modals, Reddit/Quora/Medium login walls and app
   prompts).
3. **Removes blocking overlays heuristically** — detects full-screen, high
   `z-index`, pointer-blocking dimming layers that cover the page and removes
   them, while being careful not to delete the real page content.

It keeps watching the page (via a `MutationObserver`), so popups injected after
load are removed too.

## Install (temporary, for development)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select the `manifest.json` file in this folder.

The extension icon appears in the toolbar. Temporary add-ons are removed when
Firefox restarts.

## Packaging

To build a distributable `.zip` / `.xpi`:

```sh
zip -r -FS shutup-popups.zip manifest.json icons src
```

You can then submit it to [addons.mozilla.org](https://addons.mozilla.org/) for
signing, or load the zip via `about:debugging`.

## Usage

- Click the toolbar icon for the quick panel:
  - **Block popups here** — toggle the extension for the current site.
  - **Extension enabled (all sites)** — global on/off.
  - **Remove popups now** — force an immediate sweep.
  - Shows how many elements were removed on the current page.
- Open **More settings** (or the add-on's options) to:
  - Toggle each removal strategy independently.
  - Manage the list of sites where the extension is disabled.

## Project layout

```
manifest.json        Extension manifest (Manifest V2, Firefox/Gecko)
icons/icon.svg       Toolbar / add-on icon
src/content.js       Core engine: detection + removal, runs on every page
src/popup.html/.css/.js   Toolbar quick panel
src/options.html/.css/.js Full settings page
```

## Notes & limitations

- The heuristic overlay remover is conservative (it skips elements that contain
  most of the page's visible text), but on some sites it may remove something
  you wanted. If a site misbehaves, disable the extension for that site from the
  toolbar panel, or turn off "Remove full-screen blocking overlays" in settings.
- This removes popups from the page DOM; it does not block network requests or
  trackers. Pair it with a content blocker (e.g. uBlock Origin) for that.
