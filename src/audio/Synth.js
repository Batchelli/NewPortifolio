/**
 * Áudio 100% sintetizado (Web Audio API): trilha synthwave em loop + efeitos.
 * Nenhum arquivo de áudio é necessário.
 */
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Progressão Am - F - C - G (notas MIDI)
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const ARP = [0, 1, 2, 1, 2, 0, 2, 1, 0, 1, 2, 1, 2, 0, 1, 2];

export class Synth {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.sfxOn = true;
    this.playing = false;
    this.seqStep = 0;
    this.nextTime = 0;
    this.bpm = 96;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? 0.5 : 0;
    this.sfxBus.connect(this.master);

    // Delay com feedback para o arpejo (eco típico de synthwave)
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    this.delay.connect(this.musicBus);

    // Buffer de ruído (caixa / hi-hat)
    const len = ctx.sampleRate * 0.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.2);
    if (on) this.startMusic();
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
  }

  startMusic() {
    if (!this.ctx || this.playing) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  schedule() {
    const ctx = this.ctx;
    const sixteenth = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.seqStep, this.nextTime, sixteenth);
      this.nextTime += sixteenth;
      this.seqStep = (this.seqStep + 1) % 64;
    }
  }

  playStep(step, t, dur) {
    if (!this.musicOn) return;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = CHORDS[bar];

    // Baixo em colcheias
    if (s % 2 === 0) this.bass(NOTE(chord[0] - 24), t, dur * 1.8);
    // Arpejo
    const n = chord[ARP[s]] + (s >= 8 ? 12 : 0);
    this.arp(NOTE(n), t, dur * 0.9);
    // Pad no começo de cada compasso
    if (s === 0) chord.forEach((c) => this.pad(NOTE(c), t, dur * 16));
    // Bateria
    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 1) this.hat(t);
  }

  osc(type, freq, t, dur, gain, dest, { attack = 0.005, release = 0.1, filter = null } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0, t + dur, release / 3);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      f.Q.value = 4;
      node = node.connect(f);
    }
    node.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + release * 2);
    return o;
  }

  bass(f, t, dur) {
    this.osc('sawtooth', f, t, dur, 0.32, this.musicBus, { filter: 420, release: 0.06 });
  }

  arp(f, t, dur) {
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.musicBus);
    g.connect(this.delay);
    this.osc('square', f, t, dur, 0.07, g, { filter: 2600, release: 0.08 });
  }

  pad(f, t, dur) {
    for (const det of [-7, 7]) {
      const o = this.osc('sawtooth', f, t, dur, 0.035, this.musicBus, { attack: 0.6, release: 0.8, filter: 1100 });
      o.detune.value = det;
    }
  }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.32);
  }

  noiseHit(t, dur, gain, freq, type, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  snare(t) {
    this.noiseHit(t, 0.22, 0.35, 1800, 'bandpass', this.musicBus);
  }

  hat(t) {
    this.noiseHit(t, 0.04, 0.08, 8000, 'highpass', this.musicBus);
  }

  /* ---------------- Efeitos ---------------- */
  ready() {
    return this.ctx && this.ctx.state === 'running';
  }

  blip() {
    if (!this.ready()) return;
    this.osc('square', 880, this.ctx.currentTime, 0.04, 0.12, this.sfxBus, { release: 0.04 });
  }

  select() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.osc('square', 660, t, 0.06, 0.14, this.sfxBus);
    this.osc('square', 1320, t + 0.07, 0.1, 0.12, this.sfxBus);
  }

  back() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.osc('square', 520, t, 0.06, 0.12, this.sfxBus);
    this.osc('square', 330, t + 0.06, 0.08, 0.12, this.sfxBus);
  }

  powerUp() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.osc('sawtooth', 200, t, 0.35, 0.08, this.sfxBus, { filter: 1800, release: 0.2 });
    o.frequency.exponentialRampToValueAtTime(900, t + 0.35);
  }

  discover() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => this.osc('square', NOTE(n), t + i * 0.08, 0.12, 0.12, this.sfxBus));
  }

  achievement() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.1, 0.16, 0.2, this.sfxBus));
  }

  open() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.osc('sine', 300, t, 0.3, 0.2, this.sfxBus, { release: 0.2 });
    o.frequency.exponentialRampToValueAtTime(1600, t + 0.3);
  }

  step(land = false) {
    if (!this.ready()) return;
    this.noiseHit(this.ctx.currentTime, land ? 0.12 : 0.05, land ? 0.25 : 0.06, land ? 400 : 900, 'lowpass', this.sfxBus);
  }

  jump() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.osc('square', 300, t, 0.12, 0.06, this.sfxBus, { release: 0.05 });
    o.frequency.exponentialRampToValueAtTime(700, t + 0.12);
  }

  /** Buzina de carro (duas notas desafinadas, "bi-bi"). */
  horn() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    for (const [start, dur] of [[0, 0.12], [0.18, 0.28]]) {
      this.osc('sawtooth', 392, t + start, dur, 0.05, this.sfxBus, { filter: 1400, release: 0.05 });
      this.osc('sawtooth', 494, t + start, dur, 0.05, this.sfxBus, { filter: 1400, release: 0.05 });
    }
  }

  /** Pulso de radar: "ping" de sonar com eco. */
  scan() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    for (const [start, gain] of [[0, 0.16], [0.32, 0.06], [0.64, 0.025]]) {
      const o = this.osc('sine', 1480, t + start, 0.5, gain, this.sfxBus, { attack: 0.004, release: 0.45 });
      o.frequency.setValueAtTime(1480, t + start);
      o.frequency.exponentialRampToValueAtTime(820, t + start + 0.5);
    }
    const sweep = this.osc('sawtooth', 90, t, 0.7, 0.05, this.sfxBus, { filter: 600, attack: 0.05, release: 0.4 });
    sweep.frequency.exponentialRampToValueAtTime(260, t + 0.7);
  }

  /** Chegada num bairro novo: acorde curto e suave. */
  district() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [64, 71, 76].forEach((n, i) => this.osc('triangle', NOTE(n), t + i * 0.06, 0.5, 0.06, this.sfxBus, { attack: 0.03, release: 0.4 }));
  }
}
