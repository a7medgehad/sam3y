// Offscreen audio processing document for سمعى Sam3y

let audioCtx;
const sessions = new Map(); // tabId -> { stream, source, worklet, gain, dest }
let currentProfile = 'balanced';

async function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  audioCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  await audioCtx.audioWorklet.addModule('audio-worklet.js');
  return audioCtx;
}

async function startForTab(tabId) {
  await ensureAudioContext();
  if (sessions.has(tabId)) return;
  // Capture the currently active tab's audio
  const stream = await chrome.tabCapture.capture({
    audio: true,
    video: false,
    audioConstraints: {
      mandatory: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    }
  });
  if (!stream) return;

  const source = audioCtx.createMediaStreamSource(stream);

  const worklet = new AudioWorkletNode(audioCtx, 'sam3y-pass');
  worklet.port.postMessage({ type: 'setProfile', profile: currentProfile });

  // Optional: output gain control (stub)
  const gain = audioCtx.createGain();
  gain.gain.value = 1.0;

  source.connect(worklet).connect(gain).connect(audioCtx.destination);

  sessions.set(tabId, { stream, source, worklet, gain });
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
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'sam3y:start') {
      await startForTab(msg.tabId);
      sendResponse({ ok: true });
    } else if (msg?.type === 'sam3y:stop') {
      await stopForTab(msg.tabId);
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

