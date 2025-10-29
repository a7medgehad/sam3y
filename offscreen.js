// Offscreen audio processing document for سمعى Sam3y

let audioCtx;
const sessions = new Map(); // tabId -> { stream, source, worklet, filters, gain }
let currentProfile = 'balanced';

async function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  await audioCtx.audioWorklet.addModule('audio-worklet.js');
  return audioCtx;
}

async function startForTab(tabId, streamId) {
  await ensureAudioContext();
  if (sessions.has(tabId)) return;
  // Use getUserMedia with provided streamId (from tabCapture.getMediaStreamId)
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      },
      video: false
    });
  } catch (err) {
    console.error('Sam3y offscreen: getUserMedia failed', err);
    return;
  }
  if (!stream) return;

  const source = audioCtx.createMediaStreamSource(stream);

  const worklet = new AudioWorkletNode(audioCtx, 'sam3y-pass');
  worklet.port.postMessage({ type: 'setProfile', profile: currentProfile });

  // Balanced voice emphasis filter chain (DSP-based, lightweight)
  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 220; // cut low bass
  hp.Q.value = 0.7;

  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400; // emphasize mid voice band
  bp.Q.value = 0.9;

  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4200; // reduce high-frequency music/hi-hats
  lp.Q.value = 0.7;

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 24;
  compressor.ratio.value = 4.0;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  // Output gain to normalize after filtering
  const gain = audioCtx.createGain();
  gain.gain.value = 1.1;

  // Connect chain: source -> worklet(pass) -> hp -> bp -> lp -> compressor -> gain -> destination
  source.connect(worklet).connect(hp).connect(bp).connect(lp).connect(compressor).connect(gain).connect(audioCtx.destination);

  sessions.set(tabId, { stream, source, worklet, filters: { hp, bp, lp, compressor }, gain });
}

async function stopForTab(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  try {
    s.source.disconnect();
    s.worklet.disconnect();
    s.gain.disconnect();
  } catch (_) {}
  try {
    s.stream.getTracks().forEach(t => t.stop());
  } catch (_) {}
  sessions.delete(tabId);
}

function setProfile(profile) {
  currentProfile = profile;
  for (const s of sessions.values()) {
    s.worklet.port.postMessage({ type: 'setProfile', profile });
    const { hp, bp, lp, compressor } = s.filters || {};
    if (profile === 'fast') {
      if (hp) { hp.frequency.value = 200; hp.Q.value = 0.6; }
      if (bp) { bp.frequency.value = 1300; bp.Q.value = 0.7; }
      if (lp) { lp.frequency.value = 4800; lp.Q.value = 0.6; }
      if (compressor) { compressor.threshold.value = -18; compressor.ratio.value = 3.0; }
    } else if (profile === 'balanced') {
      if (hp) { hp.frequency.value = 220; hp.Q.value = 0.7; }
      if (bp) { bp.frequency.value = 1400; bp.Q.value = 0.9; }
      if (lp) { lp.frequency.value = 4200; lp.Q.value = 0.7; }
      if (compressor) { compressor.threshold.value = -22; compressor.ratio.value = 4.0; }
    } else if (profile === 'best') {
      if (hp) { hp.frequency.value = 260; hp.Q.value = 0.9; }
      if (bp) { bp.frequency.value = 1600; bp.Q.value = 1.1; }
      if (lp) { lp.frequency.value = 3800; lp.Q.value = 0.9; }
      if (compressor) { compressor.threshold.value = -26; compressor.ratio.value = 5.0; compressor.knee.value = 30; }
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'sam3y:start') {
      await startForTab(msg.tabId, msg.streamId);
      sendResponse({ ok: true });
    } else if (msg?.type === 'sam3y:stop') {
      await stopForTab(msg.tabId);
      sendResponse({ ok: true });
    } else if (msg?.type === 'sam3y:stop-all') {
      for (const [id] of sessions.entries()) {
        try { await stopForTab(id); } catch (_) {}
      }
      sendResponse({ ok: true });
    } else if (msg?.type === 'sam3y:profile') {
      setProfile(msg.profile);
      sendResponse({ ok: true });
    }
  })();
  return true;
});

// Keep audio context alive
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // no-op: offscreen is always hidden
  }
});
