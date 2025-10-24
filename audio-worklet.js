/*
  AudioWorkletProcessor stub for Sam3y.
  For now, this is a pass-through that will later be replaced with
  STFT -> model mask -> iSTFT processing coordinated with a Worker.
*/

class Sam3yPassThrough extends AudioWorkletProcessor {
  constructor() {
    super();
    this.profile = 'balanced';
    this.port.onmessage = (e) => {
      const { type, profile } = e.data || {};
      if (type === 'setProfile' && profile) this.profile = profile;
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output) return true;
    // Pass-through copy
    for (let ch = 0; ch < output.length; ch++) {
      const inCh = input[ch] || input[0];
      const outCh = output[ch];
      if (inCh && outCh) outCh.set(inCh);
    }
    return true; // keep alive
  }
}

registerProcessor('sam3y-pass', Sam3yPassThrough);

