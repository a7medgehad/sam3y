// Inference Worker for Sam3y
// Hosts ONNX Runtime Web (WebAssembly preferred) to run a compact vocal model.
// Lazy downloads the model from a CDN and caches in IndexedDB.

let session = null;
let ready = false;
let backend = 'none';
let info = { modelUrl: null };

function importLocalScript(path) {
  try { importScripts(path); return true; } catch (e) { return false; }
}

async function ensureOrt() {
  if (self.ort) return true;
  // Attempt local vendor copy if present
  if (importLocalScript('assets/ort.min.js')) return true;
  // As a fallback, try to fetch the library from CDN and eval (may be blocked by CSP)
  try {
    const resp = await fetch('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');
    const code = await resp.text();
    // eslint-disable-next-line no-new-func
    (new Function(code))();
    return !!self.ort;
  } catch (e) {
    console.warn('ORT load failed:', e);
    return false;
  }
}

async function ensureSession(modelUrl) {
  info.modelUrl = modelUrl;
  const haveOrt = await ensureOrt();
  if (!haveOrt) return false;
  backend = 'wasm';
  try {
    importScripts('assets/model-loader.js');
    const buffer = await self.ModelCache.getOrFetch(modelUrl);
    const bytes = new Uint8Array(buffer);
    const ep = 'wasm';
    const options = { executionProviders: [ep] };
    session = await ort.InferenceSession.create(bytes, options);
    return true;
  } catch (e) {
    console.warn('Session init failed:', e);
    session = null;
    return false;
  }
}

self.onmessage = async (e) => {
  const { type, payload, modelUrl } = e.data || {};
  if (type === 'init') {
    const ok = await ensureSession(modelUrl);
    ready = ok;
    self.postMessage({ type: 'ready', backend: ok ? backend : 'none', ok, info });
  } else if (type === 'process') {
    // Expect payload: { channels: Float32Array[], sampleRate }
    if (!session) {
      // Fallback: pass-through
      self.postMessage({ type: 'result', payload });
      return;
    }
    try {
      // TODO: implement STFT -> model mask -> iSTFT
      // For now, pass-through to keep audio continuous.
      self.postMessage({ type: 'result', payload });
    } catch (err) {
      console.warn('Inference failed:', err);
      self.postMessage({ type: 'result', payload });
    }
  }
};
