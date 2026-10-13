# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Focus Tab Locker is a Chrome Manifest V3 extension (vanilla JS, no build step, no
dependencies, no tests). The loadable extension lives in `focus-tab-locker/`; the
repository root only holds docs (`README.md`, `PRIVACY.md` — the privacy policy
linked from the store listing) and store assets.

## Development workflow

There is nothing to build, lint, or test — the source is loaded directly:

1. `chrome://extensions/` → enable Developer Mode → **Load unpacked** →
   select the `focus-tab-locker/` directory.
2. After editing `background.js` or `manifest.json`, hit **Reload** on the
   extension card. After editing `content.js`, reload the extension *and*
   reload any page that already showed an overlay; the background injects the
   fresh copy the next time that page needs one.
3. Debug the service worker via the "service worker" link on the extension card;
   debug the overlay in the page's own DevTools console.
4. Bump `manifest.json`'s `version` for anything released to the store.

Verification is manual: lock a tab, switch away, and exercise the countdown,
"Return to locked tab", "Turn off", and the pause paths — including a browser
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
- **On-demand injection**: `content.js` is deliberately *not* a manifest
  content script, so it is never loaded into pages that don't need an overlay.
  `showCountdownOnTab` / `showPauseOnTab` first try `chrome.tabs.sendMessage`;
  if there is no receiver (the page hasn't needed an overlay yet, or was
  reloaded) they `executeScript` `content.js` and retry.
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

Messages content → background: `returnToLockedTab`, `disableFocusLock`,
`pauseFocusLock`, `resumeFocusLock`, `holdFocusCountdown`,
`resumeFocusCountdown`. Background → content: `showFocusCountdown`,
`hideFocusCountdown`, `showFocusPause`, `hideFocusPause` (each answered with
`{handled: true}`, which is how the background detects a live receiver).

The background never trusts the sender: `returnToLockedTab` is only honored when
the sender tab is the one with a live `pendingSwitch`, and `pauseFocusLock`
minutes are clamped to `MAX_PAUSE_MINUTES` (480). `MAX_PAUSE_MINUTES` is defined
in both files and must stay in sync.

## Constraints

- No popup page — `chrome.action.onClicked` toggles the lock directly, so the
  overlay is the only UI surface for controls.
- Only one tab in one window can be locked at a time.
- Store "recommended practices" (Featured badge) rules this code follows — keep
  them when editing:
  - Don't re-add a manifest `content_scripts` entry; inject on demand instead.
  - `minimum_chrome_version` is 99, the first version where
    `chrome.tabs.sendMessage` returns a promise. Raise it if you use a newer API.
  - Icons have transparent corners. `icon128.png` is 96×96 artwork with 16px of
    transparent padding on each side, per the Web Store image guidelines, so
    keep it out of the toolbar sets (`action.default_icon`, `DEFAULT_ICONS`) —
    padded, it would render shrunken on high-DPI toolbars.
  - `PRIVACY.md` and the README's Permissions table must describe exactly what
    is stored and why. Update them whenever storage or permissions change.
