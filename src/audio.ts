/**
 * All of Shadowkin's sound, synthesized with Web Audio so there are no asset
 * files: a crackling lantern, a hum that rises as your shadow nears the target
 * (the feedback a hands-only player gets instead of haptics), and little
 * creature voices placed in the room with HRTF panning.
 */

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];

type Vec = { x: number; y: number; z: number };

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private humOsc!: OscillatorNode;
  private humOsc2!: OscillatorNode;
  private humGain!: GainNode;
  private crackleGain!: GainNode;
  private crackleTimer = 0;
  enabled = true;

  /** Must be called from a user gesture (the start button, a tap). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    this.master.connect(ctx.destination);

    const length = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    // Match hum: two detuned sines whose pitch and level follow progress.
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.master);
    this.humOsc = ctx.createOscillator();
    this.humOsc.type = 'sine';
    this.humOsc2 = ctx.createOscillator();
    this.humOsc2.type = 'triangle';
    this.humOsc.connect(this.humGain);
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    this.humOsc2.connect(g2).connect(this.humGain);
    this.humOsc.start();
    this.humOsc2.start();

    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.crackleGain.connect(this.master);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  setListener(pos: Vec, forward: Vec): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(forward.x, t);
      l.forwardY.setValueAtTime(forward.y, t);
      l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    }
  }

  /**
   * Per-frame: lantern crackle (more while you hold a match) and the match hum.
   * `level` is 0..1 progress toward bringing a shadow to life.
   */
  tick(dt: number, active: boolean, score: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const hum = active ? Math.max(0, (score - 0.35) / 0.65) * 0.05 + level * 0.09 : 0;
    this.humGain.gain.setTargetAtTime(hum, t, 0.08);
    const f = 196 * Math.pow(2, (score * 7 + level * 12) / 12);
    this.humOsc.frequency.setTargetAtTime(f, t, 0.1);
    this.humOsc2.frequency.setTargetAtTime(f * 1.5, t, 0.1);

    this.crackleTimer -= dt;
    if (active && this.crackleTimer <= 0) {
      this.crackleTimer = 0.04 + Math.random() * (0.35 - level * 0.25);
      this.pop(0.012 + Math.random() * 0.02, 1800 + Math.random() * 2500, 0.004 + Math.random() * 0.01);
    }
  }

  private pop(gain: number, freq: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 1.5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.crackleGain);
    this.crackleGain.gain.value = 1;
    src.start(t, Math.random() * 0.9, dur + 0.02);
  }

  private out(at?: Vec): AudioNode {
    const ctx = this.ctx!;
    if (!at) return this.master;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.4;
    p.rolloffFactor = 1;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    } else {
      p.setPosition(at.x, at.y, at.z);
    }
    p.connect(this.master);
    return p;
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    gain: number,
    type: OscillatorType,
    dest: AudioNode,
    glideTo?: number,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(dest);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  private whoosh(start: number, dur: number, gain: number, from: number, to: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(from, start);
    f.frequency.exponentialRampToValueAtTime(to, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(start);
    src.stop(start + dur + 0.05);
  }

  private ready(): boolean {
    return this.ctx != null && this.ctx.state === 'running' && this.enabled;
  }

  /** The lantern catching. */
  ignite(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.whoosh(t, 0.6, 0.25, 300, 2400, this.master);
    this.tone(196, t + 0.15, 1.4, 0.05, 'sine', this.master);
    this.tone(294, t + 0.25, 1.3, 0.035, 'sine', this.master);
  }

  /** A shadow comes alive: ink whoosh, then a rising arpeggio in the creature's voice. */
  birth(voice: number, at: Vec, special: boolean): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(at);
    this.whoosh(t, 0.5, 0.3, 4000, 400, dest);
    const notes = special ? [0, 4, 7, 12, 16] : [0, 4, 7, 12];
    notes.forEach((n, i) => {
      this.tone(voice * Math.pow(2, n / 12), t + 0.18 + i * 0.075, 0.5, 0.09, 'triangle', dest);
    });
    this.tone(voice * 2, t + 0.5, 0.9, 0.04, 'sine', dest);
  }

  chirp(voice: number, at: Vec): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(at);
    const n = PENTATONIC[(Math.random() * 5) | 0];
    const f = voice * Math.pow(2, n / 12);
    this.tone(f, t, 0.09, 0.06, 'sine', dest, f * 1.35);
    if (Math.random() < 0.5) this.tone(f * 1.2, t + 0.1, 0.08, 0.05, 'sine', dest, f * 1.6);
  }

  /** Petted: a happy two-note trill. */
  happy(voice: number, at: Vec): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(at);
    for (let i = 0; i < 3; i++) {
      this.tone(voice * 1.5, t + i * 0.09, 0.08, 0.07, 'sine', dest, voice * 2);
    }
  }

  startle(voice: number, at: Vec): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(voice * 2.2, t, 0.16, 0.06, 'square', this.out(at), voice);
  }

  howl(at: Vec): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(at);
    this.tone(220, t, 0.9, 0.06, 'sawtooth', dest, 330);
    this.tone(330, t + 0.6, 0.7, 0.04, 'sine', dest, 247);
  }

  /** New shape unlocked or today's shadow done. */
  fanfare(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    [0, 4, 7, 11, 14].forEach((n, i) => this.tone(392 * Math.pow(2, n / 12), t + i * 0.06, 1.2, 0.04, 'sine', this.master));
  }

  click(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(1200, t, 0.04, 0.05, 'square', this.master, 900);
  }

  wake(voice: number, at: Vec): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(at);
    this.tone(voice * 0.75, t, 0.25, 0.05, 'sine', dest, voice * 1.2);
  }
}

export const sfx = new Sfx();
