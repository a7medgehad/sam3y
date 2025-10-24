/* Service worker for سمعى Sam3y */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Process tab audio to remove music and output voice-only.'
  });
}

async function getState() {
  const { globalEnabled = false, tabEnabled = {}, profile = 'balanced' } = await chrome.storage.local.get({ globalEnabled: false, tabEnabled: {}, profile: 'balanced' });
  return { globalEnabled, tabEnabled, profile };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

async function startForTab(tabId) {
  await ensureOffscreenDocument();
  await chrome.tabs.update(tabId, { muted: true });
  await chrome.runtime.sendMessage({ type: 'sam3y:start', tabId });
}

async function stopForTab(tabId) {
  try {
    await chrome.runtime.sendMessage({ type: 'sam3y:stop', tabId });
  } catch (_) {
    // ignore if offscreen not alive
  }
  await chrome.tabs.update(tabId, { muted: false });
}

chrome.runtime.onInstalled.addListener(async () => {
  await setState({ globalEnabled: false, tabEnabled: {}, profile: 'balanced' });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { tabEnabled } = await getState();
  if (tabEnabled[tabId]) {
    delete tabEnabled[tabId];
    await setState({ tabEnabled });
    await stopForTab(tabId);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'sam3y:toggle-current-tab') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return sendResponse({ ok: false });
      const { tabEnabled } = await getState();
      const enabled = !tabEnabled[tab.id];
      tabEnabled[tab.id] = enabled;
      await setState({ tabEnabled });
      if (enabled) await startForTab(tab.id); else await stopForTab(tab.id);
      sendResponse({ ok: true, enabled });
    } else if (msg?.type === 'sam3y:toggle-global') {
      const { globalEnabled } = await getState();
      const newVal = !globalEnabled;
      await setState({ globalEnabled: newVal });
      if (!newVal) {
        // Stop all per-tab sessions
        const { tabEnabled } = await getState();
        for (const id of Object.keys(tabEnabled)) {
          if (tabEnabled[id]) await stopForTab(parseInt(id, 10));
        }
      }
      sendResponse({ ok: true, enabled: newVal });
    } else if (msg?.type === 'sam3y:set-profile') {
      const { profile } = msg;
      await setState({ profile });
      await chrome.runtime.sendMessage({ type: 'sam3y:profile', profile });
      sendResponse({ ok: true });
    }
  })();
  return true; // async
});

