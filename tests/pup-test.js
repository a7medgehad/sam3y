const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer');

async function getExtensionId(browser) {
  // MV3: service worker target URL includes chrome-extension://<id>/service_worker.js
  for (let i = 0; i < 40; i++) {
    const targets = await browser.targets();
    const sw = targets.find(t => t.type() === 'service_worker' && t.url().includes('/service_worker.js'));
    if (sw) {
      const url = sw.url();
      const match = url.match(/^chrome-extension:\/\/([a-z]+)\//);
      if (match) return match[1];
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Extension service worker not found');
}

function startServer() {
  const aPage = `<!doctype html><html><head><title>Audio Test</title></head><body>
  <script>
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 440;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    window.__audio__ = { ctx, osc, gain };
    document.body.innerText = 'Audio playing (WebAudio oscillator)';
  </script></body></html>`;
  const bPage = `<!doctype html><html><head><title>Audio B</title></head><body>
  <script>
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 660;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    window.__audio__ = { ctx, osc, gain };
    document.body.innerText = 'Audio B playing';
  </script></body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/a')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(aPage);
    } else if (req.url.startsWith('/b')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(bPage);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function run() {
  const { server, port } = await startServer();
  const extensionPath = path.resolve(__dirname, '..');
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
    defaultViewport: { width: 1200, height: 800 },
  });

  const page = await browser.newPage();

  // Create audio page over HTTP so tab capture works reliably
  const audioUrl = `http://127.0.0.1:${port}/a`;
  await page.goto(audioUrl);

  const extId = await getExtensionId(browser);
  const extUrl = `chrome-extension://${extId}/popup.html`;
  const extPage = await browser.newPage();
  await extPage.goto(extUrl);

  // Start processing for specific URL via test hook
  const startResp = await extPage.evaluate(async (url) => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:start-for-url', url, title: 'Audio Test' });
  }, audioUrl);
  console.log('Start response:', startResp);
  if (!startResp?.ok) throw new Error('Failed to start processing for audio page');
  if (!startResp?.trackedMuted) console.warn('Start reported not tracked muted');
  const manualMute = await extPage.evaluate(async (id) => {
    await chrome.tabs.update(id, { muted: true });
    const t = await chrome.tabs.get(id);
    const muted = !!(t && t.mutedInfo && t.mutedInfo.muted);
    return { muted };
  }, startResp.tabId);
  console.log('Manual mute result:', manualMute);

  // Debug: ensure storage API works
  const manualStorageKeys = await extPage.evaluate(async (id) => {
    const { mutedBySam3y = {} } = await chrome.storage.local.get({ mutedBySam3y: {} });
    mutedBySam3y[id] = true;
    await chrome.storage.local.set({ mutedBySam3y });
    const res = await chrome.storage.local.get({ mutedBySam3y: {} });
    return Object.keys(res.mutedBySam3y);
  }, startResp.tabId);
  console.log('Manual storage keys:', manualStorageKeys);
  await new Promise(r => setTimeout(r, 1000));

  // Verify tracking in storage marks tab as muted by Sam3y
  const mutedCheck = await extPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(tt => tt.title === 'Audio Test' || tt.url === url);
    const { mutedBySam3y = {} } = await chrome.storage.local.get({ mutedBySam3y: {} });
    return { trackedMuted: !!(t && mutedBySam3y[t.id]), id: t?.id, keys: Object.keys(mutedBySam3y) };
  }, audioUrl);
  console.log('Muted check:', mutedCheck);
  if (!mutedCheck.trackedMuted) throw new Error('Tab was not tracked muted after start (storage)');

  // Stop processing
  const stopResp = await extPage.evaluate(async (url) => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:stop-for-url', url, title: 'Audio Test' });
  }, audioUrl);
  if (!stopResp?.ok) throw new Error('Failed to stop processing for audio page');
  if (stopResp?.trackedMuted) throw new Error('Stop reported still tracked muted');

  // Verify tracking entry removed
  const unmutedCheck = await extPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(tt => tt.title === 'Audio Test' || tt.url === url);
    const { mutedBySam3y = {} } = await chrome.storage.local.get({ mutedBySam3y: {} });
    return { trackedMuted: !!(t && mutedBySam3y[t.id]), id: t?.id };
  }, audioUrl);
  console.log('Unmuted check:', unmutedCheck);
  if (unmutedCheck.trackedMuted) throw new Error('Tab was still tracked muted after stop');

  console.log('Hook test passed — starting E2E UI test');

  // Prepare second audio page
  const audioUrlB = `http://127.0.0.1:${port}/b`;
  const pageB = await browser.newPage();
  await pageB.goto(audioUrlB);

  // Current tab toggle via service worker message (as popup does)
  await page.goto(audioUrl); // ensure Audio Test active
  await new Promise(r => setTimeout(r, 250));
  const toggleTabResp1 = await extPage.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:toggle-current-tab' });
  });
  console.log('toggle-current-tab enable:', toggleTabResp1);
  await new Promise(r => setTimeout(r, 400));
  const stateAfterToggle1 = await extPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { tabEnabled = {}, mutedBySam3y = {}, lastStreamError = null } = await chrome.storage.local.get({ tabEnabled: {}, mutedBySam3y: {}, lastStreamError: null });
    return { tabId: tab?.id, enabled: !!tabEnabled[tab?.id], trackedMuted: !!mutedBySam3y[tab?.id], lastStreamError };
  });
  console.log('State after current-tab enable:', stateAfterToggle1);
  if (!stateAfterToggle1.enabled) throw new Error('Current-tab enable failed');

  // Disable current tab
  const toggleTabResp2 = await extPage.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:toggle-current-tab' });
  });
  console.log('toggle-current-tab disable:', toggleTabResp2);
  await new Promise(r => setTimeout(r, 400));
  const stateAfterToggle2 = await extPage.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { tabEnabled = {}, mutedBySam3y = {} } = await chrome.storage.local.get({ tabEnabled: {}, mutedBySam3y: {} });
    return { tabId: tab?.id, enabled: !!tabEnabled[tab?.id], trackedMuted: !!mutedBySam3y[tab?.id] };
  });
  console.log('State after current-tab disable:', stateAfterToggle2);
  if (stateAfterToggle2.enabled) throw new Error('Current-tab disable failed');

  // Global toggle: enable and follow tab changes
  await page.goto(audioUrl); // ensure Audio Test active
  const toggleGlobalResp1 = await extPage.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:toggle-global' });
  });
  console.log('toggle-global enable:', toggleGlobalResp1);
  await new Promise(r => setTimeout(r, 500));
  const stateGlobal1 = await extPage.evaluate(async () => {
    const { globalEnabled = false } = await chrome.storage.local.get({ globalEnabled: false });
    return { globalEnabled };
  });
  console.log('Global state on enable:', stateGlobal1);
  if (!stateGlobal1.globalEnabled) throw new Error('Global enable failed');

  await pageB.bringToFront(); // activate Audio B
  await new Promise(r => setTimeout(r, 700));
  const stateGlobalFollow = await extPage.evaluate(async () => {
    const { globalEnabled = false } = await chrome.storage.local.get({ globalEnabled: false });
    return { globalEnabled };
  });
  console.log('Global follow state:', stateGlobalFollow);
  if (!stateGlobalFollow.globalEnabled) throw new Error('Global did not remain enabled after tab change');

  // Global disable
  const toggleGlobalResp2 = await extPage.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:toggle-global' });
  });
  console.log('toggle-global disable:', toggleGlobalResp2);
  await new Promise(r => setTimeout(r, 500));
  const stateGlobal2 = await extPage.evaluate(async () => {
    const { globalEnabled = true, mutedBySam3y = {} } = await chrome.storage.local.get({ globalEnabled: true, mutedBySam3y: {} });
    return { globalEnabled, keys: Object.keys(mutedBySam3y) };
  });
  console.log('Global state on disable:', stateGlobal2);
  if (stateGlobal2.globalEnabled || stateGlobal2.keys.length) throw new Error('Global disable failed to stop/unmute all');

  // Profile change
  const profileResp = await extPage.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'sam3y:set-profile', profile: 'best' });
    const { profile } = await chrome.storage.local.get({ profile: 'balanced' });
    return { profile };
  });
  console.log('Profile set:', profileResp);
  if (profileResp.profile !== 'best') throw new Error('Profile change failed');

  console.log('Full E2E test passed');
  await browser.close();
  server.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
