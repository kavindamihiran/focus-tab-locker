let focusMode = false;
let lockedTabId = null;
let lockedTabUrl = null;

// Helper function to check if a URL is accessible by the extension
function isAccessibleUrl(url) {
  if (!url) return false;
  // Block chrome://, edge://, about:, and other restricted protocols
  const restrictedProtocols = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'view-source:', 'devtools://'];
  return !restrictedProtocols.some(protocol => url.startsWith(protocol));
}

chrome.runtime.onStartup.addListener(() => {
  restoreFocusState();
});
chrome.runtime.onInstalled.addListener(() => {
  restoreFocusState();
});

async function restoreFocusState() {
  const { focusMode: storedMode, lockedTabUrl: storedUrl } = await chrome.storage.local.get(["focusMode", "lockedTabUrl"]);
  if (storedMode && storedUrl) {
    // Find the tab with the stored URL (tab IDs change on restart)
    const tabs = await chrome.tabs.query({});
    const matchingTab = tabs.find(tab => tab.url === storedUrl);
    if (matchingTab) {
      enableFocusMode(matchingTab.id, matchingTab.url);
    } else {
      // If tab doesn't exist anymore, disable focus mode
      disableFocusMode();
    }
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  focusMode = !focusMode;
  if (focusMode) {
    enableFocusMode(tab.id, tab.url);
  } else {
    disableFocusMode();
  }
});

async function enableFocusMode(tabId, url) {
  focusMode = true;
  lockedTabId = tabId;
  lockedTabUrl = url;
  chrome.action.setBadgeText({ text: "🔒" });
  chrome.storage.local.set({ focusMode: true, lockedTabId, lockedTabUrl: url });
  exitFullscreen(tabId);
}

function disableFocusMode() {
  focusMode = false;
  lockedTabId = null;
  lockedTabUrl = null;
  chrome.action.setBadgeText({ text: "" });
  chrome.storage.local.set({ focusMode: false, lockedTabId: null, lockedTabUrl: null });
}

function attemptRefocus(retries = 5) {
  if (!focusMode || !lockedTabId) return;
  chrome.tabs.update(lockedTabId, { active: true }).catch((err) => {
    console.log("Could not refocus tab:", err.message);
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
    chrome.tabs.remove(tab.id).catch((err) => {
      console.log("Could not remove tab:", err.message);
    });
  }
});

async function exitFullscreen(tabId) {
  try {
    // Get the tab info to check its URL before executing script
    const tab = await chrome.tabs.get(tabId);
    if (!isAccessibleUrl(tab.url)) {
      console.log("Cannot execute script on restricted URL:", tab.url);
      return;
    }
    
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        }
      }
    });
  } catch (err) {
    console.log("Could not exit fullscreen:", err.message);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "getCurrentTabId") {
    // Ensure sender.tab exists before accessing its id
    if (sender.tab && sender.tab.id) {
      sendResponse(sender.tab.id);
    } else {
      console.log("No tab information available for sender");
      sendResponse(null);
    }
    return true; // Keep the message channel open for async response
  }
});