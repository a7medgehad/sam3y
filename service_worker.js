/* Service worker for سمعى Sam3y */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
let globalActiveTabId = null;

async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Process tab audio to remove music and output voice-only.'
  });
}

function getStreamIdForTab(tabId) {
  return new Promise((resolve, reject) => {
    // getMediaStreamId works from extension contexts and allows targeting a tabId
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const err = chrome.runtime.lastError;
      if (err || !streamId) return reject(err || new Error('No streamId'));
      resolve(streamId);
    });
  });
}

async function getState() {
  const { globalEnabled = false, tabEnabled = {}, profile = 'balanced', mutedBySam3y = {} } = await chrome.storage.local.get({ globalEnabled: false, tabEnabled: {}, profile: 'balanced', mutedBySam3y: {} });
  return { globalEnabled, tabEnabled, profile, mutedBySam3y };
}

async function setState(patch) {
  await chrome.storage.local.set(patch);
}

async function startForTab(tabId) {
  await ensureOffscreenDocument();
  let streamId;
  try {
    streamId = await getStreamIdForTab(tabId);
  } catch (err) {
    console.warn('Sam3y: failed to get streamId', err);
    return;
  }
  // Mute original immediately to avoid double audio; keep track so we can unmute later
  await chrome.tabs.update(tabId, { muted: true });
  const { mutedBySam3y } = await getState();
  mutedBySam3y[tabId] = true;
  await setState({ mutedBySam3y });
  try {
    await chrome.runtime.sendMessage({ type: 'sam3y:start', tabId, streamId });
  } catch (err) {
    console.warn('Sam3y: startForTab message failed', err);
  }
}

async function stopForTab(tabId) {
  try {
    await chrome.runtime.sendMessage({ type: 'sam3y:stop', tabId });
  } catch (_) {
    // ignore if offscreen not alive
  }
  const { mutedBySam3y } = await getState();
  if (mutedBySam3y[tabId]) {
    await chrome.tabs.update(tabId, { muted: false });
    delete mutedBySam3y[tabId];
    await setState({ mutedBySam3y });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await setState({ globalEnabled: false, tabEnabled: {}, profile: 'balanced' });
  await setActionIcon(false);
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
      await setActionIcon(await anySessionEnabled());
      sendResponse({ ok: true, enabled });
    } else if (msg?.type === 'sam3y:toggle-global') {
      const { globalEnabled } = await getState();
      const newVal = !globalEnabled;
      await setState({ globalEnabled: newVal });
      if (newVal) {
        // Start processing for the currently active tab immediately
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          await startForTab(tab.id);
          globalActiveTabId = tab.id;
        }
      } else {
        // Stop all sessions and unmute tabs
        try { await chrome.runtime.sendMessage({ type: 'sam3y:stop-all' }); } catch (_) {}
        const { mutedBySam3y } = await getState();
        for (const id of Object.keys(mutedBySam3y)) {
          await chrome.tabs.update(parseInt(id, 10), { muted: false });
          delete mutedBySam3y[id];
        }
        await setState({ mutedBySam3y });
        globalActiveTabId = null;
      }
      await setActionIcon(await anySessionEnabled());
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

// Auto-attach on tab activation when global is enabled
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { globalEnabled } = await getState();
  if (globalEnabled && activeInfo?.tabId) {
    if (globalActiveTabId && globalActiveTabId !== activeInfo.tabId) {
      try { await stopForTab(globalActiveTabId); } catch (_) {}
    }
    await startForTab(activeInfo.tabId);
    globalActiveTabId = activeInfo.tabId;
    await setActionIcon(true);
  }
});

async function anySessionEnabled() {
  const { globalEnabled, tabEnabled } = await getState();
  if (globalEnabled) return true;
  return Object.values(tabEnabled).some(Boolean);
}

async function setActionIcon(enabled) {
  try {
    const sizes = [16, 32, 48, 128];
    const imageData = {};
    for (const s of sizes) {
      const c = new OffscreenCanvas(s, s);
      const ctx = c.getContext('2d');
      const radius = s / 2;
      const grad = ctx.createLinearGradient(0, 0, s, s);
      if (enabled) {
        grad.addColorStop(0, '#22c55e');
        grad.addColorStop(1, '#0ea5e9');
      } else {
        grad.addColorStop(0, '#9ca3af');
        grad.addColorStop(1, '#6b7280');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2);
      ctx.fill();
      // sound bars
      const barW = Math.max(1, Math.floor(s / 8));
      const gap = Math.max(1, Math.floor(s / 14));
      const baseX = Math.floor(s / 2) - barW - gap;
      const heights = enabled ? [s * 0.55, s * 0.75, s * 0.6] : [s * 0.35, s * 0.45, s * 0.4];
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      for (let i = 0; i < 3; i++) {
        const x = baseX + i * (barW + gap);
        const h = Math.floor(heights[i]);
        ctx.fillRect(x, s - h - Math.floor(s * 0.18), barW, h);
      }
      imageData[s] = ctx.getImageData(0, 0, s, s);
    }
    await chrome.action.setIcon({ imageData });
  } catch (err) {
    // ignore if OffscreenCanvas not supported
    console.debug('Sam3y: setActionIcon failed', err);
  }
}

// Test hooks: explicit start/stop by URL (used by automation)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'sam3y:start-for-url' && (msg.url || msg.title)) {
      const tabs = await chrome.tabs.query({});
      let target = null;
      if (msg.title) target = tabs.find(t => t.title === msg.title);
      if (!target && msg.url) target = tabs.find(t => t.url === msg.url);
      if (!target?.id) return sendResponse({ ok: false });
      await startForTab(target.id);
      await setActionIcon(await anySessionEnabled());
      const { mutedBySam3y = {} } = await getState();
      return sendResponse({ ok: true, tabId: target.id, trackedMuted: !!mutedBySam3y[target.id] });
    }
    if (msg?.type === 'sam3y:stop-for-url' && (msg.url || msg.title)) {
      const tabs = await chrome.tabs.query({});
      let target = null;
      if (msg.title) target = tabs.find(t => t.title === msg.title);
      if (!target && msg.url) target = tabs.find(t => t.url === msg.url);
      if (!target?.id) return sendResponse({ ok: false });
      await stopForTab(target.id);
      await setActionIcon(await anySessionEnabled());
      const { mutedBySam3y = {} } = await getState();
      return sendResponse({ ok: true, tabId: target.id, trackedMuted: !!mutedBySam3y[target.id] });
    }
  })();
  return true;
});
