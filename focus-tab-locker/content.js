(() => {
  if (globalThis.__focusTabLockerV20Loaded) return;
  globalThis.__focusTabLockerV20Loaded = true;

  const TIME_TEMPLATES = [1, 5, 10, 15, 30, 60];
  const MAX_PAUSE_MINUTES = 480;

  let overlay = null;
  let countdown = null;
  let countdownTimer = null;
  let countdownDeadline = 0;
  let countdownHeld = false;

  let pausePill = null;
  let pauseClock = null;
  let pauseTimer = null;

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(chrome.runtime.lastError ? null : response);
        });
      } catch (_error) {
        resolve(null);
      }
    });
  }

  function hideCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    countdownHeld = false;
    overlay?.remove();
    overlay = null;
    countdown = null;
  }

  function updateCountdown() {
    if (!countdown) return;

    if (countdownHeld) {
      countdown.textContent = "Paused";
      countdown.classList.add("returning");
      return;
    }

    const seconds = Math.max(0, Math.ceil((countdownDeadline - Date.now()) / 1000));
    countdown.textContent = seconds > 0 ? String(seconds) : "Returning…";
    countdown.classList.toggle("returning", seconds <= 0);
  }

  function startCountdownTimer() {
    clearInterval(countdownTimer);
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 100);
  }

  function showCountdown(deadline) {
    hideCountdown();
    countdownDeadline = deadline;

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

        button:hover { background: #be123c; }
        button:active { transform: translateY(1px); }
        button:focus-visible { outline: 3px solid #fda4af; outline-offset: 2px; }
        button:disabled { cursor: wait; opacity: 0.7; }

        .primary { width: 100%; }

        .hint {
          margin-top: 10px;
          color: #8490a8;
          font-size: 11px;
          line-height: 1.4;
        }

        .divider {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 16px 0 10px;
          color: #6f7c95;
          font-size: 10px;
          font-weight: 650;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .divider::before,
        .divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: rgba(148, 163, 184, 0.18);
        }

        .quick {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }

        .quick button {
          padding: 7px 4px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 8px;
          color: #dbe4f0;
          background: rgba(148, 163, 184, 0.1);
          font-size: 11.5px;
          font-weight: 620;
          white-space: nowrap;
        }

        .quick button:hover {
          color: #ffffff;
          background: rgba(148, 163, 184, 0.22);
          border-color: rgba(148, 163, 184, 0.45);
        }

        .custom { margin-top: 10px; text-align: left; }

        .custom-label {
          margin: 0 0 7px;
          color: #aeb8ce;
          font-size: 11.5px;
          font-weight: 600;
        }

        .templates {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 9px;
        }

        .templates button {
          padding: 5px 10px;
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 999px;
          color: #dbe4f0;
          background: transparent;
          font-size: 11.5px;
          font-weight: 600;
        }

        .templates button:hover {
          background: rgba(148, 163, 184, 0.18);
        }

        .templates button[aria-pressed="true"] {
          color: #ffffff;
          border-color: #fb7185;
          background: rgba(225, 29, 72, 0.28);
        }

        .custom-row { display: flex; gap: 6px; }

        input {
          flex: 1;
          min-width: 0;
          box-sizing: border-box;
          padding: 8px 10px;
          border: 1px solid rgba(148, 163, 184, 0.32);
          border-radius: 8px;
          color: #ffffff;
          background: rgba(2, 6, 23, 0.5);
          font: inherit;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
        }

        input:focus-visible { outline: 2px solid #fb7185; outline-offset: 1px; }

        .custom-row button { padding: 8px 12px; font-size: 12.5px; }

        .ghost {
          color: #dbe4f0;
          background: rgba(148, 163, 184, 0.12);
          border-color: rgba(148, 163, 184, 0.28);
        }

        .ghost:hover { background: rgba(148, 163, 184, 0.24); }

        .error {
          margin: 7px 0 0;
          color: #fda4af;
          font-size: 11px;
        }

        [hidden] { display: none !important; }
      </style>
      <section class="card">
        <div class="status">
          <span class="lock" aria-hidden="true"></span>
          <span>Focus lock active</span>
        </div>
        <h1>Returning to your focused tab</h1>
        <p>This tab will stay open.</p>
        <div class="countdown" aria-live="assertive"></div>
        <button type="button" class="primary" data-role="switch">Use this tab instead</button>
        <div class="hint">This replaces your current focused tab.</div>

        <div class="divider">Need this tab now?</div>
        <div class="quick">
          <button type="button" data-role="off" title="Turn the focus lock off completely">Turn off</button>
          <button type="button" data-role="five" title="Pause the focus lock for 5 minutes">Pause 5 min</button>
          <button type="button" data-role="custom" title="Pause the focus lock for a time you choose">Custom time</button>
        </div>

        <div class="custom" hidden>
          <p class="custom-label">Pause the lock for how long?</p>
          <div class="templates"></div>
          <div class="custom-row">
            <input type="number" min="1" max="${MAX_PAUSE_MINUTES}" step="1"
              inputmode="numeric" placeholder="Minutes" aria-label="Pause minutes" />
            <button type="button" data-role="start">Pause</button>
            <button type="button" class="ghost" data-role="cancel">Back</button>
          </div>
          <p class="error" hidden></p>
        </div>
      </section>
    `;

    countdown = shadow.querySelector(".countdown");
    const card = shadow.querySelector(".card");
    const switchButton = shadow.querySelector('[data-role="switch"]');
    const quick = shadow.querySelector(".quick");
    const custom = shadow.querySelector(".custom");
    const templates = shadow.querySelector(".templates");
    const input = shadow.querySelector("input");
    const error = shadow.querySelector(".error");

    for (const minutes of TIME_TEMPLATES) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.dataset.minutes = String(minutes);
      chip.setAttribute("aria-pressed", "false");
      chip.textContent = minutes < 60 ? `${minutes} min` : "1 hour";
      templates.appendChild(chip);
    }

    function syncTemplates() {
      const value = input.value.trim();
      for (const chip of templates.children) {
        chip.setAttribute("aria-pressed", String(chip.dataset.minutes === value));
      }
    }

    function showError(text) {
      error.textContent = text;
      error.hidden = !text;
    }

    function busy(text) {
      for (const button of card.querySelectorAll("button")) button.disabled = true;
      switchButton.textContent = text;
    }

    function idle() {
      for (const button of card.querySelectorAll("button")) button.disabled = false;
      switchButton.textContent = "Use this tab instead";
    }

    // Freezing the return countdown keeps the tab from switching away while the
    // user is still picking a time.
    async function holdCountdown() {
      if (countdownHeld) return;
      countdownHeld = true;
      updateCountdown();
      await send({ action: "holdFocusCountdown" });
    }

    async function releaseCountdown() {
      if (!countdownHeld) return;
      const response = await send({ action: "resumeFocusCountdown" });
      if (!response?.ok) {
        hideCountdown();
        return;
      }
      countdownHeld = false;
      countdownDeadline = response.deadline;
      startCountdownTimer();
    }

    async function pauseFor(minutes) {
      busy("Pausing focus lock…");
      const response = await send({ action: "pauseFocusLock", minutes });
      if (!response?.ok) {
        idle();
        showError("Could not pause the focus lock. Try again.");
        return;
      }
      hideCountdown();
      showPausePill(response.until);
    }

    switchButton.addEventListener("click", async () => {
      busy("Switching focus lock…");
      const response = await send({ action: "unlockAttemptedTab" });
      if (!response?.ok) {
        idle();
        return;
      }
      hideCountdown();
    });

    quick.addEventListener("click", async (event) => {
      const role = event.target.closest("button")?.dataset.role;
      if (!role) return;

      if (role === "off") {
        busy("Turning focus lock off…");
        const response = await send({ action: "disableFocusLock" });
        if (!response?.ok) {
          idle();
          showError("Could not turn the focus lock off. Try again.");
          return;
        }
        hideCountdown();
        return;
      }

      if (role === "five") {
        await holdCountdown();
        await pauseFor(5);
        return;
      }

      if (role === "custom") {
        custom.hidden = false;
        showError("");
        await holdCountdown();
        input.focus();
      }
    });

    templates.addEventListener("click", (event) => {
      const chip = event.target.closest("button");
      if (!chip) return;
      input.value = chip.dataset.minutes;
      showError("");
      syncTemplates();
    });

    input.addEventListener("input", () => {
      showError("");
      syncTemplates();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        custom.querySelector('[data-role="start"]').click();
      }
    });

    custom.querySelector('[data-role="start"]').addEventListener("click", () => {
      const minutes = Number(input.value);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_PAUSE_MINUTES) {
        showError(`Enter a number of minutes between 1 and ${MAX_PAUSE_MINUTES}.`);
        input.focus();
        return;
      }
      pauseFor(Math.round(minutes));
    });

    custom.querySelector('[data-role="cancel"]').addEventListener("click", () => {
      custom.hidden = true;
      showError("");
      releaseCountdown();
    });

    document.documentElement.appendChild(overlay);
    startCountdownTimer();
  }

  function hidePausePill() {
    clearInterval(pauseTimer);
    pauseTimer = null;
    pausePill?.remove();
    pausePill = null;
    pauseClock = null;
  }

  function showPausePill(until) {
    hidePausePill();
    if (!until || until <= Date.now()) return;

    pausePill = document.createElement("div");
    pausePill.id = "focus-tab-locker-pause";
    pausePill.setAttribute("aria-label", "Focus lock paused");

    const shadow = pausePill.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          right: 16px;
          bottom: 16px;
          z-index: 2147483647;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system,
            BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .pill {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 9px 7px 12px;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 999px;
          color: #f8fafc;
          background: rgba(21, 27, 47, 0.94);
          box-shadow: 0 10px 28px rgba(2, 6, 23, 0.42);
          font-size: 12px;
          font-weight: 600;
          opacity: 0.55;
          transition: opacity 140ms ease;
        }

        .pill:hover { opacity: 1; }

        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #fbbf24;
        }

        .clock {
          color: #fbbf24;
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }

        button {
          border: 1px solid rgba(148, 163, 184, 0.3);
          border-radius: 999px;
          padding: 4px 10px;
          color: #dbe4f0;
          background: rgba(148, 163, 184, 0.14);
          font: inherit;
          font-size: 11px;
          font-weight: 620;
          cursor: pointer;
        }

        button:hover { color: #ffffff; background: rgba(148, 163, 184, 0.28); }
        button:focus-visible { outline: 2px solid #fda4af; outline-offset: 2px; }
      </style>
      <div class="pill">
        <span class="dot" aria-hidden="true"></span>
        <span>Lock paused</span>
        <span class="clock" aria-live="off"></span>
        <button type="button">Lock now</button>
      </div>
    `;

    pauseClock = shadow.querySelector(".clock");
    shadow.querySelector("button").addEventListener("click", async () => {
      hidePausePill();
      await send({ action: "resumeFocusLock" });
    });

    const tick = () => {
      const remaining = until - Date.now();
      if (remaining <= 0) {
        hidePausePill();
        return;
      }
      if (pauseClock) pauseClock.textContent = formatClock(remaining);
    };

    document.documentElement.appendChild(pausePill);
    tick();
    pauseTimer = setInterval(tick, 1000);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "showFocusCountdown") {
      hidePausePill();
      showCountdown(message.deadline);
      sendResponse({ handled: true });
      return false;
    }

    if (message.action === "hideFocusCountdown") {
      hideCountdown();
      sendResponse({ handled: true });
      return false;
    }

    if (message.action === "showFocusPause") {
      hideCountdown();
      showPausePill(message.until);
      sendResponse({ handled: true });
      return false;
    }

    if (message.action === "hideFocusPause") {
      hidePausePill();
      sendResponse({ handled: true });
    }
    return false;
  });

  // A tab restored from cache should not keep showing a stale pause pill.
  window.addEventListener("pagehide", hidePausePill);
})();
