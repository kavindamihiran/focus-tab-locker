const DEFAULT_ICONS = {
  16: "icons/icon16.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png",
};

const SWITCH_DELAY_MS = 3000;

let focusMode = false;
let lockedTabId = null;
let lockedTabUrl = null;
let pendingSwitch = null;
let switchSequence = 0;

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

async function setToolbarState(active, countdown = "") {
  const title = active
    ? countdown
      ? `Returning to the locked tab in ${countdown}…`
      : "Focus mode active — click to unlock"
    : "Lock this tab for focus";

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
      chrome.action.setBadgeBackgroundColor({ color: "#dc2626" }),
      chrome.action.setBadgeText({ text: countdown }),
    ]);
  } catch (error) {
    // A red badge is a safe fallback on browsers without OffscreenCanvas support.
    console.log("Could not update the toolbar icon:", error.message);
    await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
    await chrome.action.setBadgeText({ text: countdown || (active ? "●" : "") });
  }
}

async function restoreFocusState() {
  const stored = await chrome.storage.local.get([
    "focusMode",
    "lockedTabId",
    "lockedTabUrl",
  ]);

  if (!stored.focusMode) {
    await setToolbarState(false);
    return;
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
  await setToolbarState(true);
}

async function enableFocusMode(tabId, url) {
  const tab = await getTab(tabId);
  if (!tab) return false;

  cancelPendingSwitch(false);
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

function beginPendingSwitch(tabId, windowId) {
  cancelPendingSwitch(false);

  const token = ++switchSequence;
  const deadline = Date.now() + SWITCH_DELAY_MS;
  pendingSwitch = {
    token,
    tabId,
    windowId,
    deadline,
    badgeTimers: [],
    returnTimer: null,
  };

  setToolbarState(true, "3");
  showCountdownOnTab(tabId, token, deadline);

  pendingSwitch.badgeTimers.push(
    setTimeout(() => {
      if (pendingSwitch?.token === token) setToolbarState(true, "2");
    }, 1000),
    setTimeout(() => {
      if (pendingSwitch?.token === token) setToolbarState(true, "1");
    }, 2000)
  );
  pendingSwitch.returnTimer = setTimeout(
    () => returnToLockedTab(token),
    SWITCH_DELAY_MS
  );
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

  beginPendingSwitch(activeInfo.tabId, activeInfo.windowId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await stateReady;

  if (pendingSwitch?.tabId === tabId) cancelPendingSwitch();
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "unlockAttemptedTab") return false;

  (async () => {
    await stateReady;
    const senderTab = sender.tab;
    const isCurrentAttempt =
      focusMode &&
      senderTab?.id &&
      pendingSwitch?.tabId === senderTab.id &&
      Date.now() < pendingSwitch.deadline;

    if (!isCurrentAttempt) {
      sendResponse({ ok: false });
      return;
    }

    const changed = await enableFocusMode(senderTab.id, senderTab.url);
    sendResponse({ ok: changed });
  })().catch((error) => {
    console.log("Could not change the locked tab:", error.message);
    sendResponse({ ok: false });
  });

  return true;
});
