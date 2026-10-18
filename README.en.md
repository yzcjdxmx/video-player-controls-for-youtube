# 🎬 Video Player Controls for YouTube

**English** ｜ [中文](README.md)

> Make YouTube's web player behave like **Bilibili** — hold an arrow key to temporarily speed up,
> `Shift` + arrows to step frame by frame, an always-visible progress bar, and a lockable default quality.
> Pure Chromium extension (Manifest V3), **no network access, no data collection, `storage` as the only permission**.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](extension/manifest.json)
[![No network](https://img.shields.io/badge/network-none-success.svg)](PRIVACY.md)
[![Tests](https://img.shields.io/badge/tests-217%20passing-brightgreen.svg)](#-tests)

![Video Player Controls for YouTube](screenshots/00-banner.png)

## 📸 Screenshots

<p align="center">
  <img src="screenshots/01-player-hint-and-progress-bar.png" width="49%" alt="Hold an arrow key for temporary 3x speed, plus the always-visible progress bar">
  <img src="screenshots/02-settings-top.png" width="49%" alt="Settings page: 23 options">
</p>
<p align="center">
  <img src="screenshots/03-cap-knob-shapes.png" width="49%" alt="Five cap and playhead shapes">
  <img src="screenshots/04-settings-backup.png" width="49%" alt="Settings backup and restore (export / import .json)">
</p>

> Screenshots are rendered with the extension's **real stylesheet** (the player background in the first
> image is a mock placeholder, marked in the image). Click an image to open it full size.

---

## ✨ What it does

| Input | Behaviour |
|---|---|
| **Hold `→` / `←`** | Temporary **3×** fast-forward / rewind, snaps back on release (250 ms threshold, speed configurable) |
| `→` / `←` | Seek **5 seconds** |
| **`Shift` + `←` / `→`** | **Frame-by-frame** stepping (real frame rate auto-detected; pauses first while playing) |
| **`Ctrl` + `←` / `→`** | Jump **10 seconds** (alias of YouTube's native `J` / `L`; seconds configurable) |
| **Wheel while hovering the video** | **Volume** (works outside fullscreen too, 2% per notch) |
| `[` / `]` | Previous / next video in a playlist |
| **Always-visible progress bar at the bottom edge** | Stays visible after the mouse leaves and the native control bar fades. End caps + playhead; colour, height, on/off and shape (bar, dot, triangle, filled square, hollow square) are all configurable |
| **Default quality** | Keep auto / **highest available** / a fixed resolution (1080p, 720p, …) applied to every video |
| **💾 Backup & restore** | Export all 23 settings to a **.json** file and restore them on another machine (or another copy of the extension) with one click — no re-configuring when you move to a new PC, reinstall the browser, or switch from the unpacked version to the store version |
| On-screen overlay | Bilibili-style hints: `▶▶ 3.0X` (gold), volume, seek, frame step |

YouTube's own shortcuts — space to pause, `↑↓` volume, `M` mute, `F` fullscreen, `0–9` seek to percentage,
click to pause, double-click for fullscreen — are all left untouched.

## 📥 Install

**Option 1 · Store (recommended, auto-updates)** ✅ **live**
Microsoft Edge Add-ons: <https://microsoftedge.microsoft.com/addons/detail/lipeaalamcjacgahnjgjfafgekfegnmd>

**Option 2 · Load from source (developer mode)**
1. Download this repository (green `Code` → `Download ZIP`, or `git clone`)
2. Open `edge://extensions` (Chrome: `chrome://extensions`)
3. Enable **Developer mode** → click **Load unpacked**
4. Select the **`extension`** folder inside this repository (selecting its parent gives *Manifest file is missing or unreadable*)

> ⚠️ The store copy and the unpacked copy are **two different extension IDs** — keep only one installed
> (otherwise key presses are handled twice and two progress bars are drawn).
> To carry your settings across: **export a backup** in the old one and **import** it in the new one.
> After changing code: **reload the extension first (🔄 on the card), then refresh the YouTube tab.**

## ⚙️ Settings

Click the **toolbar icon**, or the extensions page → *Extension options*. **23 settings**, applied instantly — no page refresh needed:

- **Hold-to-speed**: multiplier (3.0×), hold threshold (250 ms), tap step (5 s)
- **Shift / Ctrl**: frame stepping on/off, pause-before-step, fallback frame rate (30), jump on/off and its seconds (10 s)
- **Progress bar**: enabled, colour (YouTube red `#ff0000` by default), bar height (3 px)
- **Caps / playhead**: two independent switches, each with its own shape, decoration height (8 px), auto-hide on hover
- **Quality**: keep auto / highest available / 144p–2160p
- **Master switches**: whole extension, speed-up on hold `←` too, centre overlay, wheel volume, `[` `]` navigation
- **💾 Backup & restore**: export / import the whole configuration (see below)

### 💾 How backup & restore works

1. In the old copy: settings page, bottom → **"导出备份文件 / Export backup"** → a `.json` is downloaded
2. In the new copy: **"选择备份文件… / Choose backup file"** → pick that `.json` → all 23 settings restored

The importer is deliberately strict: it only restores keys the extension knows **and** whose values are valid.
Wrong types, colours that aren't `#rrggbb`, out-of-range numbers and unknown keys are **skipped and listed**,
so a bad file can never corrupt your settings. That validation is a pure function (`extension/backup.js`)
covered by **48 dedicated tests**. Backup files stay on your own disk — the extension never uploads them.

## 🔒 Privacy

**No data is collected, no network request is ever made, and `storage` is the only permission requested**
(used solely to remember your own settings). See [PRIVACY.md](PRIVACY.md). All code lives in this repository — audit away.

## 🗂 Repository layout

```
extension/             ← the extension itself (this is the folder you load / package)
├─ manifest.json       ← MV3: content/progress/quality + css in the isolated world; quality-main in the main world; name & description via i18n
├─ _locales/           ← localisation: en (default) + zh_CN — the store reads these to list available languages
├─ content.js          ← keys / playback speed (isolated world)
├─ progress.js         ← always-visible progress bar (isolated world)
├─ quality.js          ← default quality: reads settings, postMessage (isolated world)
├─ quality-main.js     ← default quality: calls the player API (★ main world, world:"MAIN")
├─ backup.js           ← export/import logic as pure functions (no chrome API, no DOM — so it is testable)
├─ background.js       ← toolbar icon click → open the options page
├─ content.css         ← overlay + progress bar styling
├─ options.html / .js  ← settings page (including backup & restore)
└─ icons/              ← 16 / 32 / 48 / 128 / 300 icons
test/                  ← dependency-free browser test pages (just open them)
```

## ✅ Tests

Four self-testing pages, **217 assertions** in total — no Node, no dependencies: open any `test/*.html` and it runs itself, printing `PASS` / `FAIL`.

| Page | Count | Coverage |
|---|---|---|
| `test/smoke.html` | 72 | Every key / speed / frame-step / seek behaviour + manifest checks (permissions, injected scripts, icons, store requirements) + i18n checks (description ≤132 chars, …) |
| `test/smoke-progress.html` | 70 | Progress bar: the two switches are independent, five shapes, height, 0%/100% edge alignment, same-frame repositioning on scroll, fullscreen branch |
| `test/smoke-quality.html` | 27 | Default quality: cross-world plumbing, skipping when already at target, fallback when the target isn't available, safe exit when the API is missing |
| `test/smoke-backup.html` | 48 | Backup/restore: round-trip equality, broken JSON, wrong types, clamping, invalid colours, enum whitelist, prototype-pollution guard, flat-format compatibility |

`test/bench-cpu.html` is a reproducible performance benchmark: about **0.33% of one core** while playing (conservative upper bound), zero overhead when idle.

## 🛠 Packaging

```powershell
# ZIP the extension (manifest.json at the root — ready to submit to a store)
Compress-Archive -Path extension\* -DestinationPath video-player-controls-for-youtube.zip -Force
```

## ⚠️ Known limitations

- Works only on players inside `www.youtube.com` / `m.youtube.com` pages — YouTube iframes embedded on other sites do not work; the mobile app does not work
- The progress bar is a page-level overlay and hides itself when scrolled out of view; in fullscreen it is attached inside the fullscreen element
- "Default quality" uses an internal player API (YouTube publishes none) — **a YouTube rewrite can break this one feature**
- Choosing "highest available" or 4K gives up adaptive streaming; it may stutter on a slow connection

## 📄 Licence & disclaimer

[MIT](LICENSE).

This project is **not affiliated with, sponsored by or endorsed by** YouTube, Google, or Bilibili; the word
"YouTube" in the name only describes compatibility. You remain responsible for complying with the platforms' terms of service.

## 💬 Feedback

Bugs and feature requests → [open an issue](https://github.com/yzcjdxmx/video-player-controls-for-youtube/issues).
