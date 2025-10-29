const path = require('path');
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

async function run() {
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

  // Create an audio page with WebAudio oscillator so tab has audio
  const audioUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!doctype html>
    <html><head><title>Audio Test</title></head><body>
    <script>
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const gain = ctx.createGain();
      gain.gain.value = 0.05; // quiet
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      window.__audio__ = { ctx, osc, gain };
      document.body.innerText = 'Audio playing (WebAudio oscillator)';
    </script>
    </body></html>
  `);
  await page.goto(audioUrl);

  const extId = await getExtensionId(browser);
  const extUrl = `chrome-extension://${extId}/popup.html`;
  const extPage = await browser.newPage();
  await extPage.goto(extUrl);

  // Start processing for specific URL via test hook
  const startResp = await extPage.evaluate(async (url) => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:start-for-url', url });
  }, audioUrl);
  console.log('Start response:', startResp);
  if (!startResp?.ok) throw new Error('Failed to start processing for audio page');
  await new Promise(r => setTimeout(r, 1000));

  // Verify tracking in storage marks tab as muted by Sam3y
  const mutedCheck = await extPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(tt => tt.url === url);
    const { mutedBySam3y = {} } = await chrome.storage.local.get({ mutedBySam3y: {} });
    return { trackedMuted: !!(t && mutedBySam3y[t.id]), id: t?.id };
  }, audioUrl);
  console.log('Muted check:', mutedCheck);
  if (!mutedCheck.trackedMuted) throw new Error('Tab was not tracked muted after start');

  // Stop processing
  const stopResp = await extPage.evaluate(async (url) => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:stop-for-url', url });
  }, audioUrl);
  if (!stopResp?.ok) throw new Error('Failed to stop processing for audio page');

  // Verify tracking entry removed
  const unmutedCheck = await extPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(tt => tt.url === url);
    const { mutedBySam3y = {} } = await chrome.storage.local.get({ mutedBySam3y: {} });
    return { trackedMuted: !!(t && mutedBySam3y[t.id]), id: t?.id };
  }, audioUrl);
  console.log('Unmuted check:', unmutedCheck);
  if (unmutedCheck.trackedMuted) throw new Error('Tab was still tracked muted after stop');

  console.log('Extension test passed');
  await browser.close();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
