// Рыбалка с края причала.
// Фазы: off — герой не сидит; rest — сидит, леска в воде, как на картинке; cast — заброс;
// wait — ждём поклёвку; bite — клюёт, надо подсечь; pull — рыба идёт вверх по леске;
// fly — летит в ведро; pause — короткая передышка; scare — рыба ушла (рано дёрнул или прозевал).

const Fishing = (() => {
  const TIME = { cast: 0.55, waitMin: 2.2, waitMax: 6.5, pull: 0.5, fly: 0.7, pause: 0.6, scare: 0.9 };

  // hasBucket() — стоит ли ведро рядом; emit(событие, данные) — что случилось:
  // needBucket, cast, early, bite, miss, hook, caught.
  function create({ rnd = Math.random, hasBucket, emit }) {
    const st = { phase: 'off', t: 0, wait: 0, nibble: -1, fish: null };
    const set = phase => { st.phase = phase; st.t = 0; };
    function cast() {
      set('cast');
      st.wait = TIME.waitMin + rnd() * (TIME.waitMax - TIME.waitMin);
      st.nibble = st.wait > 3.4 && rnd() < 0.6 ? st.wait * (0.3 + rnd() * 0.35) : -1;   // ложный тычок перед настоящей поклёвкой
    }
    function sit() { st.fish = null; set('rest'); }
    function leave() {                                  // встал: рыба, уже снятая с крючка, всё равно попадает в ведро
      const fish = (st.phase === 'pull' || st.phase === 'fly') ? st.fish : null;
      st.fish = null; set('off');
      if (fish) emit('caught', fish);
    }
    function press() {
      if (st.phase === 'rest') {
        if (!hasBucket()) { emit('needBucket'); return; }
        cast(); emit('cast');
      } else if (st.phase === 'wait') { set('scare'); emit('early'); }
      else if (st.phase === 'bite') { set('pull'); emit('hook', st.fish); }
    }
    function update(dt) {
      st.t += dt;
      if (st.phase === 'cast' && st.t >= TIME.cast) set('wait');
      else if (st.phase === 'wait' && st.t >= st.wait) { st.fish = FISH.roll(rnd); set('bite'); emit('bite', st.fish); }
      else if (st.phase === 'bite' && st.t >= FISH.byId[st.fish.id].window) { st.fish = null; set('scare'); emit('miss'); }
      else if (st.phase === 'scare' && st.t >= TIME.scare) cast();
      else if (st.phase === 'pull' && st.t >= TIME.pull) set('fly');
      else if (st.phase === 'fly' && st.t >= TIME.fly) { const fish = st.fish; st.fish = null; set('pause'); emit('caught', fish); }
      else if (st.phase === 'pause' && st.t >= TIME.pause) { if (hasBucket()) cast(); else set('rest'); }
    }
    return { st, sit, leave, press, update };
  }

  // ---------- отрисовка ----------
  const LINE = '#d6f0fa', FOAM = '#94d6f1', INK = '#240702';
  const FLOAT = ['.o.', 'oRo', 'oRo', 'oWo', '.o.'], FLOAT_COL = { o: INK, R: '#c9412d', W: '#f4f0e6' };
  const BANG = ['.ooooo.', 'oWWWWWo', 'oWWRWWo', 'oWWRWWo', 'oWWRWWo', 'oWWWWWo', 'oWWRWWo', 'oWWWWWo', '.ooooo.', '...o...'];
  const BANG_COL = { o: INK, W: '#fff6d8', R: '#c9412d' };
  function stampMap(ctx, map, col, x, y, maxY) {
    for (let j = 0; j < map.length; j++) {
      if (maxY !== undefined && y + j > maxY) break;
      for (let i = 0; i < map[j].length; i++) { const ch = map[j][i]; if (ch === '.') continue; ctx.fillStyle = col[ch]; ctx.fillRect(x + i, y + j, 1, 1); }
    }
  }
  function ripple(ctx, x, y, r, alpha) {
    ctx.globalAlpha = alpha; ctx.fillStyle = FOAM;
    ctx.fillRect(x - r - 2, y, 2, 1); ctx.fillRect(x + r + 1, y, 2, 1);
    if (r > 1) { ctx.fillRect(x - r, y + 1, 2, 1); ctx.fillRect(x + r - 1, y + 1, 2, 1); }
    ctx.globalAlpha = 1;
  }

  // geo: { x, tipY, waterY } лески, head — макушка сидящего героя, bucket — край ведра (или null).
  // art: { line: {img, x, y}, fish: { id: { side, sideFlip, up } } } — готовые холсты.
  function draw(ctx, st, time, geo, art) {
    const { x, tipY, waterY } = geo, phase = st.phase;
    if (phase === 'off') return;
    if (phase === 'rest') { ctx.drawImage(art.line.img, art.line.x, art.line.y); return; }
    const line = (y0, y1) => { ctx.fillStyle = LINE; ctx.fillRect(x, y0, 1, Math.max(0, y1 - y0)); };
    const float = (dy) => stampMap(ctx, FLOAT, FLOAT_COL, x - 1, waterY - 3 + dy, waterY + 1);
    const splash = () => {                         // всплеск с картинки — нижняя часть её лески
      const top = waterY - 4 - art.line.y;
      ctx.drawImage(art.line.img, 0, top, art.line.img.width, art.line.img.height - top, art.line.x, waterY - 4, art.line.img.width, art.line.img.height - top);
    };

    if (phase === 'cast') {
      const k = Math.max(0, (st.t - 0.18) / (TIME.cast - 0.18));
      if (k > 0) line(tipY + 1, tipY + 1 + (waterY - 3 - tipY) * Math.min(1, k * 1.15));
      if (k > 0.8) { float(0); splash(); }
    } else if (phase === 'wait' || phase === 'scare') {
      const nib = phase === 'wait' && st.nibble > 0 && Math.abs(st.t - st.nibble) < 0.22;
      const dy = nib ? 1 + (Math.floor(st.t * 18) % 2) : (Math.sin(time * 3.1) > 0.35 ? 1 : 0);
      line(tipY + 1, waterY - 3 + dy); float(dy);
      const age = phase === 'scare' ? st.t * 1.6 : (time * 0.7) % 1.6;
      if (age < 1) ripple(ctx, x, waterY + 1, Math.floor(age * 5), 0.9 * (1 - age));
      if (nib) ripple(ctx, x, waterY + 1, 1, 0.9);
    } else if (phase === 'bite') {
      const jerk = Math.floor(st.t * 14) % 2;
      line(tipY + 1, waterY - 1 + jerk); float(2 + jerk);
      if (jerk) splash(); else ripple(ctx, x, waterY + 1, 3, 1);
      const bob = Math.floor(st.t * 8) % 2;
      stampMap(ctx, BANG, BANG_COL, geo.head.x - 3, geo.head.y - 13 - bob);
    } else if (phase === 'pull') {
      const k = Math.min(1, st.t / TIME.pull), e = 1 - (1 - k) * (1 - k);
      const s = art.fish[st.fish.id].up, fy = Math.round(waterY - 2 - (waterY - tipY - 10) * e);
      line(tipY + 1, fy);
      ctx.drawImage(s, x - (s.width >> 1), fy);
      if (k < 0.5) splash();
      ripple(ctx, x, waterY + 1, Math.floor(k * 5), 1 - k);
    } else if (phase === 'fly' && geo.bucket) {
      const k = Math.min(1, st.t / TIME.fly);
      const ax = x, ay = tipY + 8, bx = geo.bucket.x, by = geo.bucket.y, mx = (ax + bx) / 2, my = Math.min(ay, by) - 30;
      const px = (1 - k) * (1 - k) * ax + 2 * (1 - k) * k * mx + k * k * bx, py = (1 - k) * (1 - k) * ay + 2 * (1 - k) * k * my + k * k * by;
      const f = art.fish[st.fish.id], s = bx >= ax ? f.sideFlip : f.side;   // головой по ходу
      ctx.drawImage(s, Math.round(px - s.width / 2), Math.round(py - s.height / 2));
    } else if (phase === 'pause' && geo.bucket && st.t < 0.3) {                // брызги над ведром
      const k = st.t / 0.3, r = Math.round(2 + k * 4), up = Math.round(k * 5 - k * k * 4);
      ctx.fillStyle = FOAM; ctx.globalAlpha = 1 - k;
      ctx.fillRect(geo.bucket.x - r, geo.bucket.y - 2 - up, 1, 1); ctx.fillRect(geo.bucket.x + r, geo.bucket.y - 2 - up, 1, 1); ctx.fillRect(geo.bucket.x, geo.bucket.y - 4 - up, 1, 1);
      ctx.globalAlpha = 1;
    }
  }

  return { TIME, create, draw };
})();

if (typeof module !== 'undefined') module.exports = Fishing;
