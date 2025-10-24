// Inference Worker (stub) for Sam3y
// Intended to host ONNX Runtime Web (WebGPU/WASM) for Demucs/UMX/MDX models.

let ready = false;
let backend = 'none';

self.onmessage = async (e) => {
  const { type, payload } = e.data || {};
  if (type === 'init') {
    // TODO: load ONNX Runtime Web locally (no external network in MV3 by default)
    // and initialize selected model.
    ready = true;
    backend = 'stub';
    self.postMessage({ type: 'ready', backend });
  } else if (type === 'process') {
    // Expect payload: { channels: Float32Array[], sampleRate }
    // For now, pass-through; later return vocal-only separated audio.
    self.postMessage({ type: 'result', payload });
  }
};

