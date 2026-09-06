const DEFAULT_ICONS = {
  16: "icons/icon16.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png",
};

const SWITCH_DELAY_MS = 3000;
const PAUSE_END_ALARM = "focusPauseEnd";
const PAUSE_TICK_ALARM = "focusPauseTick";
const MAX_PAUSE_MINUTES = 480;

let focusMode = false;
let lockedTabId = null;
let lockedTabUrl = null;
let pendingSwitch = null;
let switchSequence = 0;
let pauseUntil = 0;
let pausedTabId = null;
const pausePillTabs = new Set();

const stateReady = restoreFocusState();

function isAccessibleUrl(url) {
  return Boolean(url && /^(https?|file):/i.test(url));
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (_error) {
    return null;
  }
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - radius,
    y + height
  );
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createActiveIcon(size) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d");
  const red = "#e11d48";

  context.clearRect(0, 0, size, size);
  context.strokeStyle = red;
  context.lineWidth = size * 0.115;
  context.lineCap = "round";
  context.beginPath();
  context.arc(size / 2, size * 0.39, size * 0.22, Math.PI, 0);
  context.stroke();

  context.fillStyle = red;
  roundedRect(
    context,
    size * 0.18,
    size * 0.38,
    size * 0.64,
    size * 0.48,
    size * 0.09
  );
  context.fill();

  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(size / 2, size * 0.59, size * 0.055, 0, Math.PI * 2);
  context.fill();
  context.fillRect(size * 0.475, size * 0.62, size * 0.05, size * 0.1);

  return context.getImageData(0, 0, size, size);
}

function isPaused() {
  return focusMode && pauseUntil > Date.now();
}

function pauseBadgeText() {
  const remaining = pauseUntil - Date.now();
  if (remaining <= 0) return "";
  if (remaining < 60000) return `${Math.ceil(remaining / 1000)}s`;
  return `${Math.ceil(remaining / 60000)}m`;
}

async function setToolbarState(active, countdown = "") {
  const paused = active && isPaused();
  const badge = paused ? pauseBadgeText() : countdown;

  let title = "Lock this tab for focus";
  if (paused) {
    title = `Focus lock paused — ${badge} left (click to turn it off)`;
  } else if (active) {
    title = countdown
      ? `Returning to the locked tab in ${countdown}…`
      : "Focus mode active — click to unlock";
  }

  const badgeColor = paused ? "#d97706" : "#dc2626";

  try {
    if (active) {
      const imageData = {};
      for (const size of [16, 32, 48, 128]) {
        imageData[size] = createActiveIcon(size);
      }
      await chrome.action.setIcon({ imageData });
    } else {
      await chrome.action.setIcon({ path: DEFAULT_ICONS });
    }

    await Promise.all([
      chrome.action.setTitle({ title }),
      chrome.action.setBadgeBackgroundColor({ color: badgeColor }),
      chrome.action.setBadgeText({ text: badge }),
    ]);
  } catch (error) {
    // A red badge is a safe fallback on browsers without OffscreenCanvas support.
    console.log("Could not update the toolbar icon:", error.message);
    await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
    await chrome.action.setBadgeText({ text: badge || (active ? "●" : "") });
  }
}

async function restoreFocusState() {
  const stored = await chrome.storage.local.get([
    "focusMode",
    "lockedTabId",
    "lockedTabUrl",
    "pauseUntil",
    "pausedTabId",
  ]);

  if (!stored.focusMode) {
    await clearPauseState();
    await setToolbarState(false);
    return;
  }

  pauseUntil = Number(stored.pauseUntil) || 0;
  pausedTabId = stored.pausedTabId ?? null;
  if (pausedTabId !== null && pauseUntil > Date.now()) {
    pausePillTabs.add(pausedTabId);
  }

  let lockedTab = stored.lockedTabId
    ? await getTab(stored.lockedTabId)
    : null;

  // Tab IDs can change after a browser restart, so the URL is the fallback.
  if (
    lockedTab &&
    stored.lockedTabUrl &&
    lockedTab.url &&
    lockedTab.url !== stored.lockedTabUrl
  ) {
    lockedTab = null;
  }

  if (!lockedTab && stored.lockedTabUrl) {
    const tabs = await chrome.tabs.query({});
    lockedTab = tabs.find((tab) => tab.url === stored.lockedTabUrl) || null;
  }

  if (!lockedTab) {
    await disableFocusMode();
    return;
  }

  focusMode = true;
  lockedTabId = lockedTab.id;
  lockedTabUrl = lockedTab.url || stored.lockedTabUrl;
  await chrome.storage.local.set({
    focusMode: true,
    lockedTabId,
    lockedTabUrl,
  });

  if (pauseUntil > Date.now()) {
    await schedulePauseAlarms();
  } else {
    await clearPauseState();
  }
  await setToolbarState(true);
}

async function enableFocusMode(tabId, url) {
  const tab = await getTab(tabId);
  if (!tab) return false;

  cancelPendingSwitch(false);
  await clearPauseState();
  focusMode = true;
  lockedTabId = tabId;
  lockedTabUrl = url || tab.url || null;

  await chrome.storage.local.set({
    focusMode: true,
    lockedTabId,
    lockedTabUrl,
  });
  await setToolbarState(true);
  await exitFullscreen(tabId);
  return true;
}

async function disableFocusMode() {
  cancelPendingSwitch(false);
  await clearPauseState();
  focusMode = false;
  lockedTabId = null;
  lockedTabUrl = null;

  await chrome.storage.local.set({
    focusMode: false,
    lockedTabId: null,
    lockedTabUrl: null,
  });
  await setToolbarState(false);
}

async function schedulePauseAlarms() {
  await chrome.alarms.clear(PAUSE_END_ALARM);
  await chrome.alarms.clear(PAUSE_TICK_ALARM);
  await chrome.alarms.create(PAUSE_END_ALARM, { when: pauseUntil });
  // The service worker can be suspended, so the badge is refreshed on a tick.
  await chrome.alarms.create(PAUSE_TICK_ALARM, { periodInMinutes: 1 });
}

async function clearPauseState() {
  const shownOn = [...pausePillTabs];
  pausePillTabs.clear();
  pauseUntil = 0;
  pausedTabId = null;

  await chrome.storage.local.set({ pauseUntil: 0, pausedTabId: null });
  await chrome.alarms.clear(PAUSE_END_ALARM);
  await chrome.alarms.clear(PAUSE_TICK_ALARM);

  for (const tabId of shownOn) hidePauseOnTab(tabId);
}

// Pausing keeps the locked tab remembered but stops sending the user back to it.
async function pauseFocusMode(minutes, tabId) {
  if (!focusMode) return 0;

  cancelPendingSwitch(false);
  pauseUntil = Date.now() + minutes * 60000;
  pausedTabId = tabId ?? null;

  if (pausedTabId !== null) pausePillTabs.add(pausedTabId);

  await chrome.storage.local.set({ pauseUntil, pausedTabId });
  await schedulePauseAlarms();
  await setToolbarState(true);
  return pauseUntil;
}

async function resumeFocusMode() {
  await clearPauseState();
  if (!focusMode) return;

  await setToolbarState(true);

  const [active] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (active?.id && active.id !== lockedTabId) {
    beginPendingSwitch(active.id, active.windowId);
  }
}

// The remaining pause time follows the user to whichever tab they open next.
async function showPauseOnTab(tabId, until) {
  const message = { action: "showFocusPause", until };

  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (response?.handled) {
      pausePillTabs.add(tabId);
      return;
    }
  } catch (_error) {
    // Inject the current content script below when no receiver is available.
  }

  const tab = await getTab(tabId);
  if (!tab || !isAccessibleUrl(tab.url)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    if (!isPaused()) return;
    await chrome.tabs.sendMessage(tabId, message);
    pausePillTabs.add(tabId);
  } catch (error) {
    console.log("Could not show the pause timer on this page:", error.message);
  }
}

async function hidePauseOnTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "hideFocusPause" });
  } catch (_error) {
    // Restricted and unloaded pages do not have a content script.
  }
}

function clearPendingTimers(pending) {
  if (!pending) return;
  for (const timer of pending.badgeTimers) clearTimeout(timer);
  clearTimeout(pending.returnTimer);
}

function cancelPendingSwitch(resetToolbar = true) {
  if (!pendingSwitch) return;

  const oldPending = pendingSwitch;
  pendingSwitch = null;
  clearPendingTimers(oldPending);
  hideCountdownOnTab(oldPending.tabId);

  if (focusMode && resetToolbar) setToolbarState(true);
}

async function showCountdownOnTab(tabId, token, deadline) {
  const message = {
    action: "showFocusCountdown",
    deadline,
  };

  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (response?.handled) return;
  } catch (_error) {
    // Inject the current content script below when no receiver is available.
  }

  const tab = await getTab(tabId);
  if (!tab || !isAccessibleUrl(tab.url)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    if (pendingSwitch?.token !== token) {
      await hideCountdownOnTab(tabId);
      return;
    }
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    console.log("Could not show the countdown on this page:", error.message);
  }
}

async function hideCountdownOnTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "hideFocusCountdown" });
  } catch (_error) {
    // Restricted and unloaded pages do not have a content script.
  }
}

function armPendingSwitch() {
  const { token } = pendingSwitch;
  pendingSwitch.held = false;
  pendingSwitch.deadline = Date.now() + SWITCH_DELAY_MS;

  setToolbarState(true, "3");
  pendingSwitch.badgeTimers = [
    setTimeout(() => {
      if (pendingSwitch?.token === token) setToolbarState(true, "2");
    }, 1000),
    setTimeout(() => {
      if (pendingSwitch?.token === token) setToolbarState(true, "1");
    }, 2000),
  ];
  pendingSwitch.returnTimer = setTimeout(
    () => returnToLockedTab(token),
    SWITCH_DELAY_MS
  );
  return pendingSwitch.deadline;
}

function beginPendingSwitch(tabId, windowId) {
  cancelPendingSwitch(false);

  const token = ++switchSequence;
  pendingSwitch = {
    token,
    tabId,
    windowId,
    deadline: 0,
    held: false,
    badgeTimers: [],
    returnTimer: null,
  };

  const deadline = armPendingSwitch();
  showCountdownOnTab(tabId, token, deadline);
}

// Freezing the countdown gives the user time to pick a pause length without
// being pulled back to the locked tab mid-choice.
function holdPendingSwitch(tabId) {
  if (!pendingSwitch || pendingSwitch.tabId !== tabId) return false;
  if (pendingSwitch.held) return true;

  clearPendingTimers(pendingSwitch);
  pendingSwitch.held = true;
  pendingSwitch.badgeTimers = [];
  pendingSwitch.returnTimer = null;
  setToolbarState(true, "||");
  return true;
}

function releasePendingSwitch(tabId) {
  if (!pendingSwitch?.held || pendingSwitch.tabId !== tabId) return 0;
  return armPendingSwitch();
}

async function returnToLockedTab(token) {
  if (!focusMode || pendingSwitch?.token !== token) return;

  cancelPendingSwitch();
  const tab = await getTab(lockedTabId);
  if (!tab) {
    await disableFocusMode();
    return;
  }

  try {
    await chrome.tabs.update(lockedTabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    console.log("Could not return to the locked tab:", error.message);
    if (!(await getTab(lockedTabId))) await disableFocusMode();
  }
}

async function exitFullscreen(tabId) {
  const tab = await getTab(tabId);
  if (!tab || !isAccessibleUrl(tab.url)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (document.fullscreenElement) document.exitFullscreen();
      },
    });
  } catch (error) {
    console.log("Could not exit fullscreen:", error.message);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  await stateReady;

  if (focusMode) {
    await disableFocusMode();
  } else if (tab.id) {
    await enableFocusMode(tab.id, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await stateReady;
  if (!focusMode) return;

  if (activeInfo.tabId === lockedTabId) {
    cancelPendingSwitch();
    return;
  }

  if (isPaused()) {
    showPauseOnTab(activeInfo.tabId, pauseUntil);
    return;
  }

  beginPendingSwitch(activeInfo.tabId, activeInfo.windowId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await stateReady;

  if (pendingSwitch?.tabId === tabId) cancelPendingSwitch();
  pausePillTabs.delete(tabId);
  if (pausedTabId === tabId) pausedTabId = null;
  if (focusMode && tabId === lockedTabId) await disableFocusMode();
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  await stateReady;
  if (!focusMode || removedTabId !== lockedTabId) return;

  const replacement = await getTab(addedTabId);
  if (replacement) {
    await enableFocusMode(addedTabId, replacement.url);
  } else {
    await disableFocusMode();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  await stateReady;
  if (!focusMode || tabId !== lockedTabId || !changeInfo.url) return;

  lockedTabUrl = changeInfo.url;
  await chrome.storage.local.set({ lockedTabUrl });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== PAUSE_END_ALARM && alarm.name !== PAUSE_TICK_ALARM) return;

  await stateReady;
  if (isPaused()) {
    await setToolbarState(true);
    return;
  }
  await resumeFocusMode();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handled = [
    "unlockAttemptedTab",
    "disableFocusLock",
    "pauseFocusLock",
    "resumeFocusLock",
    "holdFocusCountdown",
    "resumeFocusCountdown",
  ].includes(message.action);
  if (!handled) return false;

  (async () => {
    await stateReady;
    const senderTabId = sender.tab?.id ?? null;

    // The overlay only ever asks about the tab it is drawn on.
    const isLiveAttempt =
      focusMode &&
      senderTabId !== null &&
      pendingSwitch?.tabId === senderTabId &&
      (pendingSwitch.held || Date.now() < pendingSwitch.deadline);

    if (message.action === "unlockAttemptedTab") {
      if (!isLiveAttempt) {
        sendResponse({ ok: false });
        return;
      }
      const changed = await enableFocusMode(senderTabId, sender.tab.url);
      sendResponse({ ok: changed });
      return;
    }

    if (message.action === "holdFocusCountdown") {
      sendResponse({ ok: holdPendingSwitch(senderTabId) });
      return;
    }

    if (message.action === "resumeFocusCountdown") {
      const deadline = releasePendingSwitch(senderTabId);
      sendResponse({ ok: deadline > 0, deadline });
      return;
    }

    if (message.action === "disableFocusLock") {
      if (!focusMode) {
        sendResponse({ ok: true });
        return;
      }
      await disableFocusMode();
      sendResponse({ ok: true });
      return;
    }

    if (message.action === "pauseFocusLock") {
      const minutes = Math.round(Number(message.minutes));
      if (!focusMode || !Number.isFinite(minutes) || minutes < 1) {
        sendResponse({ ok: false });
        return;
      }

      const until = await pauseFocusMode(
        Math.min(minutes, MAX_PAUSE_MINUTES),
        senderTabId
      );
      sendResponse({ ok: until > 0, until });
      return;
    }

    if (message.action === "resumeFocusLock") {
      await resumeFocusMode();
      sendResponse({ ok: true });
    }
  })().catch((error) => {
    console.log("Could not handle the focus lock request:", error.message);
    sendResponse({ ok: false });
  });

  return true;
});
