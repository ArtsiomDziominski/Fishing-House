// Звук причала. Файлов нет: всё синтезируется в браузере (Web Audio) — шум реки, дождя и ветра из одного белого шума
// через фильтры, а сверчки, лягушки, сова, дневные птицы и рыбалка — короткими тонами, шаги и треск костра — щелчками шума.
// Что слышно, идёт за тем же, что видно: за темнотой кадра и силой погоды. У каждого игрока звуки свои, их никто не сверяет.
// Браузер даёт звучать только после первого нажатия — до wake() здесь тишина.

type Wave = OscillatorType;
// dark — насколько темно, 0..1; clouds, rain, wind — сила погоды, 0..1; walk — герой идёт (2 — бежит);
// fire — насколько близко костёр, 0..1
export interface SoundScene { dark: number; clouds: number; rain: number; wind: number; walk: 0 | 1 | 2; fire: number }
export type SoundCue = 'cast' | 'bite' | 'catch' | 'miss';

const VOL = { master: 0.8, river: 0.05, rain: 0.17, wind: 0.11, cricket: 0.022, frog: 0.03, owl: 0.035, bird: 0.016, step: 0.028, fire: 0.05, cue: 0.07 };
const DUSK = [0.3, 0.46];          // темнота, с которой начинается ночной хор и с которой он в полную силу (как у светлячков)

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function createSoundView() {
  let ctx: AudioContext | null = null, master: GainNode | null = null, on = true;
  let river: GainNode, rain: GainNode, wind: GainNode, windTone: BiquadFilterNode, noise: AudioBuffer;
  // через сколько секунд каждый голос подаст звук снова
  const next = { cricketA: 1, cricketB: 1.7, frog: 6, owl: 20, bird: 2, step: 0, crackle: 0.3, mix: 0 };

  function loop(filters: BiquadFilterNode[], out: GainNode) {   // белый шум по кругу через фильтры — в свой регулятор громкости
    const src = ctx!.createBufferSource(); src.buffer = noise; src.loop = true;
    let node: AudioNode = src;
    for (const f of filters) { node.connect(f); node = f; }
    node.connect(out); out.gain.value = 0; out.connect(master!); src.start();
  }
  const filter = (type: BiquadFilterType, freq: number, q = 0.7) => { const f = ctx!.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };

  // Первое нажатие игрока: заводим звук. Повторные вызовы — будят его, если браузер усыпил.
  function wake() {
    if (!on) return;
    if (ctx) { if (ctx.state === 'suspended' && !document.hidden) ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = VOL.master; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    river = ctx.createGain(); rain = ctx.createGain(); wind = ctx.createGain();
    loop([filter('lowpass', 520)], river);
    loop([filter('highpass', 1400), filter('lowpass', 7500)], rain);
    windTone = filter('bandpass', 420, 0.9); loop([windTone], wind);
    const gust = ctx.createOscillator(), depth = ctx.createGain();           // ветер гуляет: порывы то выше, то ниже
    gust.frequency.value = 0.13; depth.gain.value = 180; gust.connect(depth); depth.connect(windTone.frequency); gust.start();
  }

  // Один тон: от частоты f0 к f1 за dur секунд, с мягким началом и концом. pan — левее или правее, -1..1; cut — срезать верх.
  function tone(wave: Wave, f0: number, f1: number, at: number, dur: number, vol: number, pan = 0, cut = 0) {
    if (!ctx || vol <= 0.0005) return;
    const t = ctx.currentTime + at, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = wave; osc.frequency.setValueAtTime(f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (cut) { const f = filter('lowpass', cut); node.connect(f); node = f; }
    node.connect(g); out(g, pan);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  // Короткий шорох: шаг по траве, треск полена.
  function rustle(dur: number, vol: number, freq: number) {
    if (!ctx || vol <= 0.0005) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(), g = ctx.createGain(), f = filter('bandpass', freq, 1.2);
    src.buffer = noise; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); out(g, 0);
    src.start(t, Math.random() * 1.5, dur + 0.02);
  }
  function out(g: GainNode, pan: number) {
    if (pan) { const p = ctx!.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(master!); } else g.connect(master!);
  }

  const cricket = (pitch: number, pan: number, vol: number) => { for (let i = 0; i < 3; i++) tone('sine', pitch, pitch, i * 0.055, 0.035, vol, pan); };
  function frog(vol: number) {                          // два-три низких «ква» подряд
    const pan = rnd(-0.7, 0.7), n = Math.random() < 0.5 ? 2 : 3, f = rnd(150, 190);
    for (let i = 0; i < n; i++) tone('sawtooth', f, f * 0.72, i * 0.24, 0.14, vol, pan, 900);
  }
  function owl(vol: number) {                           // «у-ху, у-у»
    const pan = rnd(-0.6, 0.6);
    tone('sine', 370, 340, 0, 0.22, vol, pan); tone('sine', 350, 320, 0.3, 0.38, vol, pan); tone('sine', 350, 310, 1.0, 0.5, vol * 0.8, pan);
  }
  function bird(vol: number) {                          // трель из нескольких коротких свистов
    const pan = rnd(-0.8, 0.8), n = 2 + Math.floor(Math.random() * 4), base = rnd(2600, 4200), up = Math.random() < 0.5;
    for (let i = 0; i < n; i++) { const f = base * rnd(0.92, 1.1); tone('sine', up ? f : f * 1.25, up ? f * 1.25 : f, i * rnd(0.09, 0.13), 0.07, vol, pan); }
  }

  // Каждый кадр: громкость шумов догоняет погоду, голоса подают звук по своим срокам.
  function update(dt: number, s: SoundScene) {
    if (!ctx || !on || ctx.state !== 'running') return;
    const night = clamp((s.dark - DUSK[0]!) / (DUSK[1]! - DUSK[0]!), 0, 1), dry = 1 - s.rain, calm = dry * (1 - s.wind * 0.5);
    next.mix -= dt;
    if (next.mix <= 0) {                                // не каждый кадр: громкость плывёт плавно и так
      next.mix = 0.25;
      const t = ctx.currentTime;
      river.gain.setTargetAtTime(VOL.river * (1 + s.rain * 0.6), t, 0.8);
      rain.gain.setTargetAtTime(VOL.rain * s.rain, t, 0.8);
      wind.gain.setTargetAtTime(VOL.wind * s.wind, t, 1.2);
    }
    const due = (k: keyof typeof next, a: number, b: number) => { next[k] -= dt; if (next[k] > 0) return false; next[k] = rnd(a, b); return true; };
    if (due('cricketA', 0.55, 1.1)) cricket(4300, -0.5, VOL.cricket * night * calm);
    if (due('cricketB', 0.7, 1.6)) cricket(4750, 0.6, VOL.cricket * 0.8 * night * calm);
    if (due('frog', 5, 13)) frog(VOL.frog * night * (0.5 + 0.5 * dry));     // лягушкам дождь не мешает
    if (due('owl', 22, 50)) owl(VOL.owl * night * calm);
    if (due('bird', 1.5, 6)) bird(VOL.bird * (1 - night) * calm * (1 - s.clouds * 0.5));
    if (due('crackle', 0.04, 0.4)) rustle(rnd(0.015, 0.04), VOL.fire * s.fire * s.fire, rnd(1600, 4200));   // костёр потрескивает
    if (s.walk) { if (due('step', 0, 0)) { next.step = s.walk === 2 ? 0.21 : 0.31; rustle(0.05, VOL.step, rnd(700, 1100)); } } else next.step = 0;
  }

  // Рыбалка: заброс, поклёвка, улов, срыв.
  function cue(what: SoundCue) {
    if (!ctx || !on) return;
    const v = VOL.cue;
    if (what === 'cast') tone('sine', 520, 140, 0, 0.14, v);
    else if (what === 'bite') { tone('triangle', 880, 880, 0, 0.07, v); tone('triangle', 1320, 1320, 0.09, 0.1, v); }
    else if (what === 'catch') [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, i * 0.085, 0.16, v));
    else tone('sine', 240, 130, 0, 0.24, v);
  }

  function setOn(want: boolean) {
    on = want;
    if (!ctx) return;
    if (on) { if (!document.hidden) ctx.resume(); } else ctx.suspend();
  }
  // Вкладку спрятали — кадры не идут, и шуму незачем звучать одному.
  const hide = () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (on) ctx.resume(); };
  document.addEventListener('visibilitychange', hide);

  return { wake, update, cue, setOn, destroy() { document.removeEventListener('visibilitychange', hide); ctx?.close(); ctx = null; } };
}
