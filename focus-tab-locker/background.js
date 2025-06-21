let focusMode = false;
let lockedTabId = null;

chrome.runtime.onStartup.addListener(() => {
  restoreFocusState();
});
chrome.runtime.onInstalled.addListener(() => {
  restoreFocusState();
});

async function restoreFocusState() {
  const { focusMode: storedMode, lockedTabId: storedTab } = await chrome.storage.local.get(["focusMode", "lockedTabId"]);
  if (storedMode && storedTab) {
    enableFocusMode(storedTab);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  focusMode = !focusMode;
  if (focusMode) {
    enableFocusMode(tab.id);
  } else {
    disableFocusMode();
  }
});

function enableFocusMode(tabId) {
  focusMode = true;
  lockedTabId = tabId;
  chrome.action.setBadgeText({ text: "🔒" });
  chrome.storage.local.set({ focusMode: true, lockedTabId });
  exitFullscreen(tabId);
}

function disableFocusMode() {
  focusMode = false;
  lockedTabId = null;
  chrome.action.setBadgeText({ text: "" });
  chrome.storage.local.set({ focusMode: false, lockedTabId: null });
}

function attemptRefocus(retries = 5) {
  if (!focusMode || !lockedTabId) return;
  chrome.tabs.update(lockedTabId, { active: true }).catch((err) => {
    if (retries > 0) {
      setTimeout(() => attemptRefocus(retries - 1), 500);
    }
  });
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (focusMode && activeInfo.tabId !== lockedTabId) {
    attemptRefocus();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (focusMode && tab.id !== lockedTabId) {
    chrome.tabs.remove(tab.id);
  }
});

function exitFullscreen(tabId) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      }
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "getCurrentTabId") {
    sendResponse(sender.tab.id);
  }
});