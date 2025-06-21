let focusMode = false;
let lockedTabId = null;

chrome.action.onClicked.addListener(async (tab) => {
  focusMode = !focusMode;

  if (focusMode) {
    lockedTabId = tab.id;
    chrome.action.setBadgeText({ text: "🔒" });
    console.log(`Focus mode ON. Locked to tab ${lockedTabId}`);
  } else {
    lockedTabId = null;
    chrome.action.setBadgeText({ text: "" });
    console.log("Focus mode OFF.");
  }
});

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

// 🔁 Refocus with retry logic
function attemptRefocus(retries = 5) {
  if (!focusMode || !lockedTabId) return;

  chrome.tabs.update(lockedTabId, { active: true }).catch((err) => {
    if (retries > 0) {
      console.warn("Refocus failed, retrying...", err);
      setTimeout(() => attemptRefocus(retries - 1), 500); // retry in 0.5 sec
    } else {
      console.error("Failed to refocus after multiple attempts:", err);
    }
  });
}
