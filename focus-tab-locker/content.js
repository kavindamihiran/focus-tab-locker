(() => {
  if (globalThis.__focusTabLockerV15Loaded) return;
  globalThis.__focusTabLockerV15Loaded = true;

  let overlay = null;
  let countdown = null;
  let countdownTimer = null;

  function hideCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    overlay?.remove();
    overlay = null;
    countdown = null;
  }

  function updateCountdown(deadline) {
    if (!countdown) return;
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    countdown.textContent = seconds > 0 ? String(seconds) : "Returning…";
  }

  function showCountdown(deadline) {
    hideCountdown();

    overlay = document.createElement("div");
    overlay.id = "focus-tab-locker-countdown";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Focus mode tab switch warning");

    const shadow = overlay.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          display: grid;
          place-items: center;
          padding: 24px;
          box-sizing: border-box;
          background: rgba(10, 15, 30, 0.62);
          backdrop-filter: blur(4px);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system,
            BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .card {
          width: min(360px, calc(100vw - 48px));
          box-sizing: border-box;
          padding: 24px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 16px;
          color: #f8fafc;
          background: #151b2f;
          box-shadow: 0 22px 60px rgba(2, 6, 23, 0.48);
          text-align: center;
        }

        .status {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          color: #dbe4f0;
          font-size: 13px;
          font-weight: 650;
          letter-spacing: 0.01em;
        }

        .lock {
          position: relative;
          width: 15px;
          height: 12px;
          border-radius: 3px;
          background: #fb7185;
        }

        .lock::before {
          content: "";
          position: absolute;
          left: 3px;
          top: -7px;
          width: 7px;
          height: 8px;
          box-sizing: border-box;
          border: 2px solid #fb7185;
          border-bottom: 0;
          border-radius: 7px 7px 0 0;
        }

        h1 {
          margin: 18px 0 0;
          color: #ffffff;
          font-size: 19px;
          font-weight: 700;
          line-height: 1.35;
        }

        p {
          margin: 7px 0 0;
          color: #aeb8ce;
          font-size: 14px;
          line-height: 1.5;
        }

        .countdown {
          min-height: 66px;
          margin: 16px 0;
          color: #fb7185;
          font-size: 52px;
          font-weight: 720;
          line-height: 66px;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.04em;
        }

        .countdown.returning {
          color: #cbd5e1;
          font-size: 16px;
          letter-spacing: 0;
        }

        button {
          width: 100%;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 11px 16px;
          color: #ffffff;
          background: #e11d48;
          font: inherit;
          font-size: 14px;
          font-weight: 650;
          cursor: pointer;
          transition: background 120ms ease, transform 120ms ease;
        }

        button:hover {
          background: #be123c;
        }

        button:active { transform: translateY(1px); }
        button:focus-visible { outline: 3px solid #fda4af; outline-offset: 2px; }
        button:disabled { cursor: wait; opacity: 0.7; }

        .hint {
          margin-top: 10px;
          color: #8490a8;
          font-size: 11px;
          line-height: 1.4;
        }
      </style>
      <section class="card">
        <div class="status">
          <span class="lock" aria-hidden="true"></span>
          <span>Focus lock active</span>
        </div>
        <h1>Returning to your focused tab</h1>
        <p>This tab will stay open.</p>
        <div class="countdown" aria-live="assertive"></div>
        <button type="button">Use this tab instead</button>
        <div class="hint">This replaces your current focused tab.</div>
      </section>
    `;

    countdown = shadow.querySelector(".countdown");
    const button = shadow.querySelector("button");
    button.addEventListener("click", () => {
      button.disabled = true;
      button.textContent = "Switching focus lock…";

      chrome.runtime.sendMessage({ action: "unlockAttemptedTab" }, (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          button.disabled = false;
          button.textContent = "Use this tab instead";
          return;
        }
        hideCountdown();
      });
    });

    document.documentElement.appendChild(overlay);
    updateCountdown(deadline);
    countdownTimer = setInterval(() => {
      updateCountdown(deadline);
      countdown?.classList.toggle("returning", Date.now() >= deadline);
    }, 100);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "showFocusCountdown") {
      showCountdown(message.deadline);
      sendResponse({ handled: true });
      return false;
    }

    if (message.action === "hideFocusCountdown") {
      hideCountdown();
      sendResponse({ handled: true });
    }
    return false;
  });
})();
