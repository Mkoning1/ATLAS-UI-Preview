// Adaptive, supportive audio cues (WebAudio synthesis; no asset files, nothing constant).

/** Pure cue definitions so the mapping is testable without an AudioContext. */
export const CUES = Object.freeze({
  send: { freqs: [440, 660], dur: 0.12, gain: 0.04, type: "sine" },
  working: { freqs: [330], dur: 0.1, gain: 0.025, type: "sine" },
  agent: { freqs: [880], dur: 0.06, gain: 0.015, type: "sine" },
  complete: { freqs: [523, 784], dur: 0.18, gain: 0.05, type: "sine" },
  warning: { freqs: [392, 392], dur: 0.2, gain: 0.07, type: "triangle" },
  critical: { freqs: [220, 165, 220], dur: 0.25, gain: 0.1, type: "triangle" },
});

export function cueSpec(name, { muted = false } = {}) {
  if (muted) return null;
  return CUES[name] ?? null;
}

export class AudioCues {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  /** Must be called from a user gesture before first sound. */
  enable() {
    if (!this.ctx && typeof AudioContext !== "undefined") {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
      }
    }
  }

  setMuted(m) {
    this.muted = Boolean(m);
  }

  play(name) {
    const spec = cueSpec(name, { muted: this.muted });
    if (!spec || !this.ctx) return;
    const ctx = this.ctx;
    let t = ctx.currentTime;
    for (const f of spec.freqs) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = spec.type;
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(spec.gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + spec.dur + 0.02);
      t += spec.dur * 0.7;
    }
  }
}
