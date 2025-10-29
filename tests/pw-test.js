const path = require('path');
const os = require('os');
const fs = require('fs');
const { chromium } = require('playwright');

async function getExtensionId(context) {
  // Derive extension ID by inspecting chrome://extensions under dev mode
  const page = await context.newPage();
  await page.goto('chrome://extensions/');
  // Enable dev mode to show IDs
  try {
    await page.evaluate(() => {
      const mgr = document.querySelector('extensions-manager');
      const toolbar = mgr.shadowRoot.querySelector('extensions-toolbar');
      const toggle = toolbar.shadowRoot.querySelector('#dev-mode');
      toggle.click();
    });
  } catch (_) {}
  await page.waitForTimeout(500);
  const extId = await page.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const list = mgr.shadowRoot.querySelector('extensions-item-list');
    const items = list.shadowRoot.querySelectorAll('extensions-item');
    for (const item of items) {
      const root = item.shadowRoot;
      const nameEl = root.querySelector('#name');
      const name = nameEl?.textContent || '';
      if (name.includes('Sam3y') || name.includes('سمعى')) {
        const idEl = root.querySelector('#extension-id');
        if (idEl) return idEl.textContent.trim();
      }
    }
    return null;
  });
  if (!extId) throw new Error('Extension ID not found on chrome://extensions');
  await page.close();
  return extId;
}

async function run() {
  const extensionPath = path.resolve(__dirname, '..');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam3y-pw-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
    viewport: { width: 1200, height: 800 },
  });

  const page = await context.newPage();
  // Host audio pages via data urls (simple; for robust use HTTP server)
  const audioA = 'data:text/html,' + encodeURIComponent(`<!doctype html><html><head><title>Audio Test</title></head><body>
    <script>
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440; const gain = ctx.createGain(); gain.gain.value = 0.05;
      osc.connect(gain).connect(ctx.destination); osc.start();
      document.body.innerText = 'Audio A playing';
    </script>
  </body></html>`);
  await page.goto(audioA);

  const extId = await getExtensionId(context);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);

  // Use test hooks for start/stop
  const startResp = await popup.evaluate(async (url) => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:start-for-url', url, title: 'Audio Test' });
  }, audioA);
  console.log('Start (PW):', startResp);

  const stopResp = await popup.evaluate(async (url) => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:stop-for-url', url, title: 'Audio Test' });
  }, audioA);
  console.log('Stop (PW):', stopResp);

  // Toggle current tab enable/disable
  const toggleTabResp1 = await popup.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:toggle-current-tab' });
  });
  console.log('PW toggle current enable:', toggleTabResp1);
  const toggleTabResp2 = await popup.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:toggle-current-tab' });
  });
  console.log('PW toggle current disable:', toggleTabResp2);

  // Global toggle
  const toggleGlobalResp1 = await popup.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:toggle-global' });
  });
  console.log('PW toggle global enable:', toggleGlobalResp1);
  const toggleGlobalResp2 = await popup.evaluate(async () => {
    return await chrome.runtime.sendMessage({ type: 'sam3y:toggle-global' });
  });
  console.log('PW toggle global disable:', toggleGlobalResp2);

  // Profile change
  const profileResp = await popup.evaluate(async () => {
    await chrome.runtime.sendMessage({ type: 'sam3y:set-profile', profile: 'best' });
    const { profile } = await chrome.storage.local.get({ profile: 'balanced' });
    return { profile };
  });
  console.log('PW profile set:', profileResp);

  await context.close();
}

run().catch(err => { console.error(err); process.exit(1); });
