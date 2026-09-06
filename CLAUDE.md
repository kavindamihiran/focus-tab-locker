# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Focus Tab Locker is a Chrome Manifest V3 extension (vanilla JS, no build step, no
dependencies, no tests). The loadable extension lives in `focus-tab-locker/`; the
repository root only holds `README.md` and store assets.

## Development workflow

There is nothing to build, lint, or test — the source is loaded directly:

1. `chrome://extensions/` → enable Developer Mode → **Load unpacked** →
   select the `focus-tab-locker/` directory.
2. After editing `background.js` or `manifest.json`, hit **Reload** on the
   extension card. After editing `content.js`, reload the extension *and*
   reload any page you want to test on (or let the background inject the fresh
   copy via `chrome.scripting.executeScript`).
3. Debug the service worker via the "service worker" link on the extension card;
   debug the overlay in the page's own DevTools console.
4. Bump `manifest.json`'s `version` for anything released to the store.

Verification is manual: lock a tab, switch away, and exercise the countdown,
"Use this tab instead", "Turn off", and the pause paths — including a browser
restart (state restore) and a locked tab that gets closed.

## Architecture

Two scripts talk over `chrome.runtime` messaging. **All authority lives in
`background.js`**; `content.js` is a pure view that renders overlays and relays
user intent back.

### `background.js` — service worker, single source of truth

Module-scope variables (`focusMode`, `lockedTabId`, `lockedTabUrl`, `pauseUntil`,
`pausedTabId`, `pendingSwitch`) hold live state, mirrored into
`chrome.storage.local` so it survives service-worker suspension. Two consequences
shape most code here:

- Every event listener must `await stateReady` (the promise from
  `restoreFocusState()`) before reading state, since the worker can be woken
  cold by any event.
- Anything that must outlive a suspension uses `chrome.alarms`
  (`PAUSE_END_ALARM`, `PAUSE_TICK_ALARM`), not `setTimeout`. `setTimeout` is only
  used for the 3-second countdown, which is short enough to survive in practice.

Key mechanisms:

- **Tab identity**: `lockedTabId` is unstable across restarts, so `lockedTabUrl`
  is the fallback used by `restoreFocusState()` to re-find the locked tab.
  `chrome.tabs.onUpdated` keeps the URL current; `onReplaced` re-points the lock.
- **Pending switch**: activating a non-locked tab calls `beginPendingSwitch()`,
  which mints a monotonic `token` from `switchSequence`. Every async continuation
  (badge ticks, `returnToLockedTab`, script injection) re-checks
  `pendingSwitch?.token === token` before acting — this is how stale callbacks
  from a superseded switch are discarded. The countdown can be *held* (frozen)
  while the user picks a pause duration, then re-armed by `armPendingSwitch()`.
- **Pause**: pausing keeps the lock remembered but stops the return-to-tab
  behavior. `pausePillTabs` tracks which tabs are currently showing the pause
  pill so they can all be cleaned up in `clearPauseState()`.
- **Toolbar icon**: the "locked" icon is drawn at runtime with `OffscreenCanvas`
  (`createActiveIcon`) rather than shipped as a file; `setToolbarState()` falls
  back to a plain colored badge if that throws. The badge doubles as the
  countdown ("3"/"2"/"1"), the hold indicator ("||"), and the pause clock.
- **Injection fallback**: `showCountdownOnTab` / `showPauseOnTab` first try
  `chrome.tabs.sendMessage`; if there is no receiver (the page loaded before the
  extension, or was just reloaded) they `executeScript` `content.js` and retry.
  Guard every injection with `isAccessibleUrl()` — `chrome://`, the Web Store,
  and other restricted pages cannot be scripted, and those failures are logged,
  never thrown.

### `content.js` — overlay renderer

An IIFE guarded by `globalThis.__focusTabLockerV20Loaded` so repeated injection
is a no-op. Both UI pieces (the full-screen countdown card and the small pause
pill) are host elements with **closed shadow roots** and `all: initial`, at
`z-index: 2147483647`, so page CSS cannot reach or hide them. It holds no
persistent state of its own and re-renders from whatever `deadline`/`until`
timestamp the background sends.

Messages content → background: `unlockAttemptedTab`, `disableFocusLock`,
`pauseFocusLock`, `resumeFocusLock`, `holdFocusCountdown`,
`resumeFocusCountdown`. Background → content: `showFocusCountdown`,
`hideFocusCountdown`, `showFocusPause`, `hideFocusPause` (each answered with
`{handled: true}`, which is how the background detects a live receiver).

The background never trusts the sender: `unlockAttemptedTab` is only honored when
the sender tab is the one with a live `pendingSwitch`, and `pauseFocusLock`
minutes are clamped to `MAX_PAUSE_MINUTES` (480). `MAX_PAUSE_MINUTES` is defined
in both files and must stay in sync.

## Constraints

- No popup page — `chrome.action.onClicked` toggles the lock directly, so the
  overlay is the only UI surface for controls.
- Only one tab in one window can be locked at a time.
