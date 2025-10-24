# سمعى — Sam3y (Voice-only)

Remove background music from any tab and output clear speech only. Arabic-first identity: سمعى (Sam3y). On-device by default using open-source ML models.

Status: MVP scaffold (audio capture + pass-through). Model integration (UMX/MDX/Demucs via ONNX Runtime Web) to follow.

Load in Chrome
- Go to `chrome://extensions` and enable Developer mode.
- Click “Load unpacked” and select this folder.
- Pin the extension. Open a tab with audio, click the extension, and toggle Current Tab.

Architecture
- Manifest V3 service worker orchestrates capture, mutes tab, and manages settings.
- Offscreen document hosts `AudioContext`, `AudioWorklet` (stream pipeline), and future model worker.
- Popup provides per-tab and global toggles and quality profile.

Files
- `manifest.json`
- `service_worker.js`
- `offscreen.html`, `offscreen.js`
- `audio-worklet.js` (pass-through, placeholder for separation)
- `inference-worker.js` (stub for ONNX Runtime Web)
- `popup.html`, `popup.css`, `popup.js`
- `options.html`, `options.css`, `options.js`
- `_locales/` Arabic default + English

Planned Model Integration
- Fast: UMX/MDX-small (ONNX, WebGPU/WebAssembly).
- Balanced: MDX-B.
- Best: HTDemucs v4 (chunked streaming).
- Post-filter: RNNoise.

Privacy
- Default mode processes audio on-device. No audio leaves your computer.

License
- To be defined. Model checkpoints will follow their original licenses (MIT/BSD where possible).
