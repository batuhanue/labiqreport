/** Adanın ortam sesi (Web Audio, dosyasız): dalga, yağmur, rüzgâr ve gündüz ara sıra kuş cıvıltısı. */
export class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rain: GainNode | null = null;
  private wind: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state = { rain: 0, wind: 0, day: true };

  private noise(ctx: AudioContext, brown: boolean) {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.5);
    master.connect(ctx.destination);
    this.master = master;

    // dalgalar: kahverengi gürültü + yavaş kabarma
    const waves = this.noise(ctx, true);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const wg = ctx.createGain();
    wg.gain.value = 0.18;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.12;
    lfo.connect(lfoG).connect(wg.gain);
    waves.connect(lp).connect(wg).connect(master);
    waves.start();
    lfo.start();

    // yağmur: beyaz gürültü, tiz
    const rn = this.noise(ctx, false);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    rn.connect(hp).connect(this.rain).connect(master);
    rn.start();

    // rüzgâr: bant geçiren uğultu
    const wn = this.noise(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    wn.connect(bp).connect(this.wind).connect(master);
    wn.start();

    this.apply();
    this.chirpLoop();
  }

  set(s: { rain: number; wind: number; day: boolean }) {
    this.state = s;
    this.apply();
  }

  private apply() {
    const ctx = this.ctx;
    if (!ctx || !this.rain || !this.wind) return;
    this.rain.gain.linearRampToValueAtTime(this.state.rain * 0.08, ctx.currentTime + 1);
    this.wind.gain.linearRampToValueAtTime(this.state.wind * 0.12, ctx.currentTime + 1);
  }

  private chirpLoop() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (this.state.day && this.state.rain < 0.3) {
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const t = ctx.currentTime + i * 0.14;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const f = 2600 + Math.random() * 1400;
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.08);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.025, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.12);
      }
    }
    this.timer = setTimeout(() => this.chirpLoop(), 4000 + Math.random() * 7000);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 700);
    this.ctx = null;
  }
}
