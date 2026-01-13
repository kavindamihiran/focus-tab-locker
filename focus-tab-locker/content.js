let blocker = null;
let currentTabId = null;
let isInitialized = false;

// Get current tab ID once
chrome.runtime.sendMessage({ action: "getCurrentTabId" }, (tabId) => {
  if (chrome.runtime.lastError) {
    console.log("Error getting tab ID:", chrome.runtime.lastError.message);
    return;
  }
  currentTabId = tabId;
  isInitialized = true;
  checkAndApplyBlocker();
});

function checkAndApplyBlocker() {
  // Don't apply blocker until we have a valid tab ID
  if (!isInitialized || currentTabId === null) {
    return;
  }
  
  chrome.storage.local.get(
    ["focusMode", "lockedTabId"],
    ({ focusMode, lockedTabId }) => {
      if (focusMode && lockedTabId && currentTabId !== lockedTabId) {
        showBlocker();
      } else {
        hideBlocker();
      }
    }
  );
}

function showBlocker() {
  if (blocker) return; // Already showing

  blocker = document.createElement("div");
  blocker.id = "focus-tab-locker-blocker";
  blocker.style = `
    position: fixed; z-index: 999999; top: 0; left: 0;
    width: 100vw; height: 100vh; background: rgba(0,0,0,0.95);
    color: white; display: flex; align-items: center;
    justify-content: center; font-size: 2rem;
  `;
  blocker.innerText = "🔒 Focus Mode Active\nGo back to your locked tab.";
  document.body.appendChild(blocker);
}

function hideBlocker() {
  if (blocker && blocker.parentNode) {
    blocker.parentNode.removeChild(blocker);
    blocker = null;
  }
}

// Listen for storage changes to react to focus mode changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && (changes.focusMode || changes.lockedTabId)) {
    checkAndApplyBlocker();
  }
});

// Periodically check in case blocker is removed or state changes
setInterval(checkAndApplyBlocker, 1000);
