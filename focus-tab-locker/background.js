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
    chrome.tabs.update(lockedTabId, { active: true });
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (focusMode && tab.id !== lockedTabId) {
    chrome.tabs.remove(tab.id);
  }
});

