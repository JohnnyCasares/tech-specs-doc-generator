// Intentionally minimal: all real logic lives in the side panel page, which
// (unlike this service worker) doesn't get killed after ~30s idle.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
