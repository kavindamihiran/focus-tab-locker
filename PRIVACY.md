# Privacy Policy — Focus Tab Locker

**Last updated:** October 14, 2026

Focus Tab Locker is a Chrome extension that keeps you on one tab. This policy
explains what data the extension handles and why.

## Summary

- Nothing leaves your device. The extension makes no network requests.
- There are no accounts, analytics, ads, or tracking.
- No data is sold, shared, or transferred to anyone.

## Data stored on your device

To remember the lock while Chrome is running and after a restart, the extension
saves the following in Chrome's local extension storage (`chrome.storage.local`)
on your device:

| Data | Why it is stored |
| --- | --- |
| Whether the focus lock is on | To restore the lock after Chrome or the extension restarts |
| The locked tab's ID and web address (URL) | To find the locked tab again, because tab IDs can change after a restart |
| When an active pause ends, and the tab where it started | To end the pause on time and show the time left |

The locked tab's ID and address are cleared when you turn the lock off or close
the locked tab. The pause details are cleared when the pause ends. Uninstalling
the extension deletes all of this data.

## Data the extension reads

- **Tab addresses (URLs):** used only to recognize the locked tab and to check
  whether Chrome allows the extension to show its overlay on a page. Apart from
  the locked tab's address described above, they are not stored.
- **Page content:** never read. On the tab you switch to, the extension only
  draws its own countdown or pause timer on top of the page. When you lock a
  tab, it exits fullscreen on that tab if the page is fullscreen.

## Permissions

For why each permission is needed, see
[Permissions](README.md#-permissions) in the README.

## Changes to this policy

If this policy changes, the updated version will be posted here with a new date.

## Contact

Questions or concerns: open an issue at
<https://github.com/kavindamihiran/focus-tab-locker/issues>.
