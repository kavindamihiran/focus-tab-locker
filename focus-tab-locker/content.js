chrome.storage.local.get(["focusMode", "lockedTabId"], ({ focusMode, lockedTabId }) => {
  chrome.runtime.sendMessage({ action: "getCurrentTabId" }, (currentTabId) => {
    if (focusMode && currentTabId !== lockedTabId) {
      const blocker = document.createElement("div");
      blocker.style = `
        position: fixed; z-index: 999999; top: 0; left: 0;
        width: 100vw; height: 100vh; background: rgba(0,0,0,0.95);
        color: white; display: flex; align-items: center;
        justify-content: center; font-size: 2rem;
      `;
      blocker.innerText = "🔒 Focus Mode Active\nGo back to your locked tab.";
      document.body.appendChild(blocker);
    }
  });
});