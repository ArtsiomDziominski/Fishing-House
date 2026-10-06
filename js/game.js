// Игра: рыбак ходит по миру с картинки, носит ведро и ловит рыбу с края причала.
// Кадр собирается в буфере 240×320 («арт-пиксели») и выводится на экран целым множителем,
// поэтому пиксели остаются ровными при любом размере окна.

(() => {
  const W = World.W, H = World.H, FW = HERO.FW, FH = HERO.FH;
  const SPEED = 44, CARRY_SPEED = 38;   // арт-пикселей в секунду: налегке и с ведром
  const ANCHOR = 9;                     // столбец кадра героя над точкой опоры
  const STEP_FPS = 8;                   // кадров шага в секунду
  const REACH = 18;                     // с какого расстояния можно взять ведро
  const NEAR_PIER = 62;                 // ближе этого к месту рыбака ведро считается «рядом» (весь причал и край берега)
  const seat = World.seat, fisher = World.fisher, B = World.bucket, rod = World.rod;

  const canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  const hint = document.getElementById('hint'), hintHtml = hint.innerHTML;
  const btnIn = document.getElementById('zoom-in'), btnOut = document.getElementById('zoom-out');
  const params = new URLSearchParams(location.search);

  const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const fromPixels = s => { const c = makeCanvas(s.w, s.h), x = c.getContext('2d'), id = x.createImageData(s.w, s.h); id.data.set(s.data); x.putImageData(id, 0, 0); return c; };
  const flipped = src => { const c = makeCanvas(src.width, src.height), x = c.getContext('2d'); x.translate(src.width, 0); x.scale(-1, 1); x.drawImage(src, 0, 0); return c; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const frame = makeCanvas(W, H), fctx = frame.getContext('2d');             // кадр мира целиком
  const CW = 41, CX = (CW - FW) >> 1, CH = FH + 6;                            // клетка героя: кадр по центру, по бокам место под ведро
  const cell = makeCanvas(CW, CH), cctx = cell.getContext('2d');
  const TOP = 3;                                                             // запас над ведром под хвосты рыб
  const pail = makeCanvas(B.w, B.h + TOP), pctx = pail.getContext('2d');     // клетка ведра на земле

  const hero = { x: seat.x, y: seat.y, dir: 'down', sitting: true, moving: false, anim: 0, path: null, then: null, stuck: 0 };
  const bucket = { x: B.baseX, y: B.baseY, carried: false, home: true, blocked: null, pointed: false };
  const bag = { counts: {}, best: {}, total: 0, grams: 0, recent: [] };       // что лежит в ведре
  const view = { k: 1, zoom: 0, w: W, h: H, camX: 0, camY: 0 };
  const keys = new Set();
  let marker = null, moved = false, debug = params.has('debug'), debugLayer = null, debugFor = 0, pointer = null, dirty = false, saveIn = 0;

  // ---------- картинки ----------
  const loadImage = src => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error('не загрузилось: ' + src)); im.src = src; });
  const img = {}, heroFrames = {}, carryFrames = {}, rigs = {}, fishArt = {};
  let pailBody;                                                              // ведро без тени — для любого места, кроме исходного
  function bake() {
    const plain = HERO.build(false), busy = HERO.build(true);
    for (const dir in plain) {
      heroFrames[dir] = plain[dir].map(buf => fromPixels({ w: FW, h: FH, data: buf }));
      carryFrames[dir] = busy[dir].map(buf => fromPixels({ w: FW, h: FH, data: buf }));
      const rig = HERO.carryRig(dir); rigs[dir] = { arm: fromPixels(rig), x: rig.x, y: rig.y, bucket: rig.bucket };
    }
    for (const sp of FISH.SPECIES) {
      const s = FISH.sprite(sp), side = fromPixels(s);
      fishArt[sp.id] = { side, sideFlip: flipped(side), up: fromPixels(FISH.upright(s)), tail: sp.tail };
    }
    pailBody = makeCanvas(B.w, B.h);
    const px = pailBody.getContext('2d'); px.drawImage(img.bucket, 0, 0);
    for (const [dx, dy] of B.shadow) px.clearRect(dx, dy, 1, 1);
  }

  // ---------- размер и камера ----------
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const aw = Math.max(1, Math.floor(window.innerWidth * dpr)), ah = Math.max(1, Math.floor(window.innerHeight * dpr));
    const auto = Math.max(1, Math.floor(Math.min(aw / W, ah / H) + 0.35));   // крупнейший целый множитель, при котором мир почти весь в окне
    view.k = clamp(auto + view.zoom, 1, Math.max(auto, 12));
    view.zoom = view.k - auto;
    view.w = Math.min(W, Math.floor(aw / view.k));
    view.h = Math.min(H, Math.floor(ah / view.k));
    canvas.width = view.w * view.k; canvas.height = view.h * view.k;
    canvas.style.width = canvas.width / dpr + 'px'; canvas.style.height = canvas.height / dpr + 'px';
    ctx.imageSmoothingEnabled = false;
    btnOut.disabled = view.k <= 1; btnIn.disabled = view.k >= Math.max(auto, 12);
    const t = cameraTarget(); view.camX = t.x; view.camY = t.y;
  }
  function cameraTarget() {
    return { x: clamp(hero.x - view.w / 2, 0, W - view.w), y: clamp(hero.y - FH / 2 - view.h / 2, 0, H - view.h) };
  }
  function zoom(step) { view.zoom += step; layout(); }

  // ---------- ведро ----------
  const bucketNear = () => !bucket.carried && dist(bucket, seat) <= NEAR_PIER;
  const canPick = () => !hero.sitting && !bucket.carried && dist(hero, bucket) <= REACH;
  // Можно ли поставить ведро дном в точку: под ним земля, место рыбака свободно, и герой не окажется внутри.
  function fits(x, y) {
    if (!World.canWalk(x, y) || !World.canWalk(x - 5, y) || !World.canWalk(x + 5, y) || !World.canWalk(x, y - 2)) return false;
    if (x >= seat.x - 12 && x <= seat.x + 14 && y >= seat.y - 12 && y <= seat.y + 8) return false;
    const dx = (hero.x - x) / 8.5, dy = (hero.y - (y - 1)) / 4.5;
    return hero.sitting || dx * dx + dy * dy > 1;
  }
  function settle(x, y) {                               // ведро встаёт на землю и становится препятствием
    bucket.x = Math.round(x); bucket.y = Math.round(y); bucket.carried = false;
    bucket.blocked = World.block(bucket.x, bucket.y - 1, 7, 3);
  }
  function pickUp() {
    if (!canPick()) return false;
    if (bucket.blocked) World.unblock(bucket.blocked);
    bucket.blocked = null; bucket.carried = true; bucket.home = false; bucket.pointed = false;
    hero.path = null; hero.then = null; marker = null; touch();
    return true;
  }
  function putDown() {
    if (!bucket.carried) return false;
    const side = hero.dir === 'left' ? -1 : hero.dir === 'right' ? 1 : hero.dir === 'down' ? -1 : 1;   // с той стороны, где оно в руке
    const spots = [[13 * side, 1], [-13 * side, 1], [0, 9], [0, -8], [13 * side, 6], [13 * side, -5], [-13 * side, 6], [-13 * side, -5], [18 * side, 1], [-18 * side, 1]];
    for (const [dx, dy] of spots) {
      const x = Math.round(hero.x + dx), y = Math.round(hero.y + dy);
      if (fits(x, y)) { settle(x, y); touch(); return true; }
    }
    UI.toast('Здесь ведро не поставить — тесно', 'bad');
    return false;
  }
  function putBySeat() {                                // садясь рыбачить с ведром в руке, герой ставит его рядом
    for (const [x, y] of [[96, 241], [101, 244], [92, 238], [106, 242], [111, 244], [100, 236], [114, 240]]) if (fits(x, y)) { settle(x, y); return true; }
    return false;
  }
  function bucketAction() {
    if (hero.sitting) return;
    if (bucket.carried) putDown(); else pickUp();
  }

  // ---------- герой ----------
  const nearSeat = () => !hero.sitting && dist(hero, seat) <= seat.r;
  const onFishingSpot = (x, y) => x >= seat.x - 10 && x <= seat.x + 14 && y >= seat.y - 31 && y <= seat.y + 12;
  const onBucket = (x, y) => !bucket.carried && x >= bucket.x - 9 && x <= bucket.x + 9 && y >= bucket.y - 19 && y <= bucket.y + 2;
  const onHero = (x, y) => Math.abs(x - hero.x) <= 10 && y <= hero.y + 2 && y >= hero.y - FH;
  const inWater = (x, y) => !World.canWalk(x, y) && y >= (x < 60 ? 226 : x < 132 ? 232 : 250);   // река и причал с его сваями

  function standUp() {
    if (!hero.sitting) return;
    fishing.leave();
    const p = World.nearestWalkable(seat.x, seat.y) || seat;
    hero.sitting = false; hero.x = p.x; hero.y = p.y; hero.dir = 'down'; touch();
  }
  function sitDown() {
    if (hero.sitting) return;
    if (bucket.carried && !putBySeat()) { UI.toast('Сначала поставь ведро', 'bad'); return; }
    hero.sitting = true; hero.path = null; hero.then = null; hero.moving = false; hero.x = seat.x; hero.y = seat.y; marker = null;
    fishing.sit(); touch();
  }
  function fishAction() {                               // F, пробел: сесть, забросить, подсечь
    if (hero.sitting) fishing.press(); else if (nearSeat()) sitDown();
  }
  function walkTo(x, y, then) {
    if (hero.sitting) standUp();
    const path = World.findPath(hero, { x, y });
    if (!path || !path.length) { hero.path = null; marker = null; return; }
    hero.path = path; hero.then = then || null; hero.stuck = 0;
    const end = path[path.length - 1]; marker = then ? null : { x: end.x, y: end.y, t: 0 };
    noteMoved();
  }
  function arrive() {
    const then = hero.then; hero.path = null; hero.then = null; marker = null;
    if (then === 'sit' && nearSeat()) sitDown();
    else if (then === 'pick') pickUp();
  }
  function noteMoved() { if (!moved) { moved = true; if (!debug) hint.classList.add('quiet'); } }
  function touch() { dirty = true; }

  // Шаг со скольжением вдоль стен: сначала как есть, потом по осям, потом наискосок вдоль пологой кромки.
  function tryMove(mx, my) {
    const tries = [[mx, my], [mx, 0], [0, my]];
    if (mx && !my) tries.push([mx, Math.abs(mx)], [mx, -Math.abs(mx)]);
    if (my && !mx) tries.push([Math.abs(my), my], [-Math.abs(my), my]);
    for (const [ax, ay] of tries) {
      if (!ax && !ay) continue;
      if (World.canWalk(hero.x + ax, hero.y + ay)) { hero.x += ax; hero.y += ay; return true; }
    }
    return false;
  }

  // ---------- рыбалка ----------
  const fishing = Fishing.create({
    hasBucket: bucketNear,
    emit(what, fish) {
      if (what === 'needBucket') {
        if (bucket.home) { UI.toast('Рыбу некуда класть. Принеси ведро — оно стоит у дома'); bucket.pointed = true; }
        else UI.toast('Ведро далеко. Поставь его у причала');
      } else if (what === 'early') UI.toast('Рано дёрнул — рыба ушла', 'bad');
      else if (what === 'miss') UI.toast('Сорвалась…', 'bad');
      else if (what === 'caught') {
        const sp = FISH.byId[fish.id], first = !bag.counts[fish.id], record = !first && fish.grams > bag.best[fish.id];
        bag.counts[fish.id] = (bag.counts[fish.id] || 0) + 1;
        bag.best[fish.id] = Math.max(bag.best[fish.id] || 0, fish.grams);
        bag.total++; bag.grams += fish.grams;
        bag.recent.push(fish.id); if (bag.recent.length > 3) bag.recent.shift();
        UI.toast(`${sp.name} · ${FISH.weightText(fish.grams)}${first ? ' — новый вид!' : record ? ' — крупнее прежних!' : ''}`, 'good', fish.id);
        UI.showCatch(bag); touch();
      }
    },
  });

  // ---------- сохранение ----------
  const SAVE_KEY = 'fishing-house.save.v1' + (params.get('save') ? '.' + params.get('save') : '');
  function save() {
    dirty = false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        hero: { x: Math.round(hero.x), y: Math.round(hero.y), dir: hero.dir, sitting: hero.sitting },
        bucket: { x: bucket.x, y: bucket.y, carried: bucket.carried, home: bucket.home },
        bag,
      }));
    } catch (e) { /* хранилище недоступно — играем без сохранения */ }
  }
  function load() {
    let s = null;
    try {
      if (params.has('reset')) {                       // ?reset — начать заново; убираем его из адреса, чтобы не сбрасывать при каждой перезагрузке
        localStorage.removeItem(SAVE_KEY); params.delete('reset');
        history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
      }
      s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    } catch (e) { s = null; }
    const ok = s && s.hero && s.bucket && s.bag && typeof s.hero.x === 'number' && typeof s.bucket.x === 'number';
    if (ok) {
      for (const sp of FISH.SPECIES) {
        const n = Math.max(0, s.bag.counts && s.bag.counts[sp.id] | 0);
        if (n) { bag.counts[sp.id] = n; bag.best[sp.id] = Math.max(0, s.bag.best && s.bag.best[sp.id] | 0); bag.total += n; }
      }
      bag.grams = Math.max(0, s.bag.grams | 0);
      bag.recent = (Array.isArray(s.bag.recent) ? s.bag.recent : []).filter(id => FISH.byId[id]).slice(-3);
      hero.sitting = !!s.hero.sitting;
      if (!hero.sitting) {
        const p = World.nearestWalkable(s.hero.x, s.hero.y) || seat;
        hero.x = p.x; hero.y = p.y; hero.dir = heroFrames[s.hero.dir] ? s.hero.dir : 'down';
      }
      if (s.bucket.carried && !hero.sitting) { bucket.carried = true; bucket.home = false; }
      else if (!s.bucket.home && fits(s.bucket.x, s.bucket.y)) { bucket.home = false; settle(s.bucket.x, s.bucket.y); }
    }
    if (!bucket.carried && !bucket.blocked) settle(B.baseX, B.baseY);
    if (hero.sitting) fishing.sit();
    UI.showCatch(bag);
  }

  // ---------- обновление ----------
  const DIRS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  function update(dt) {
    let dx = 0, dy = 0, passed = false;
    const step = (bucket.carried ? CARRY_SPEED : SPEED) * dt;
    for (const code of keys) { dx += DIRS[code][0]; dy += DIRS[code][1]; }
    if (dx || dy) {                                   // клавиши важнее пути
      if (hero.sitting) standUp();
      hero.path = null; hero.then = null; marker = null; noteMoved();
    } else if (hero.path && hero.path.length) {
      const t = hero.path[0], vx = t.x - hero.x, vy = t.y - hero.y, d = Math.hypot(vx, vy);
      if (d <= Math.max(0.5, step)) {
        hero.x = t.x; hero.y = t.y; hero.path.shift();
        if (hero.path.length) passed = true; else arrive();
      } else { dx = vx / d; dy = vy / d; }
    }
    hero.moving = passed;
    if ((dx || dy) && !hero.sitting) {
      const len = Math.hypot(dx, dy); dx /= len; dy /= len;
      if (Math.abs(dx) >= Math.abs(dy) * 0.95) hero.dir = dx < 0 ? 'left' : 'right'; else hero.dir = dy < 0 ? 'up' : 'down';
      hero.moving = tryMove(dx * step, dy * step);
      if (hero.moving) touch();
      if (hero.path) {                                // упёрлись на пути — бросаем его
        hero.stuck = hero.moving ? 0 : hero.stuck + dt;
        if (hero.stuck > 0.35) { hero.path = null; marker = null; hero.then = null; }
      }
    }
    hero.anim = hero.moving ? hero.anim + dt * STEP_FPS : 0;
    if (marker) marker.t += dt;
    fishing.update(dt);

    const tgt = cameraTarget(), ease = 1 - Math.exp(-dt * 7);
    view.camX += (tgt.x - view.camX) * ease; view.camY += (tgt.y - view.camY) * ease;

    saveIn -= dt;
    if (dirty && saveIn <= 0) { save(); saveIn = 2; }
    refreshActions();
  }
  function refreshActions() {
    const ph = fishing.st.phase;
    UI.actions({
      bucket: hero.sitting ? null : bucket.carried ? 'Поставить ведро' : canPick() ? 'Взять ведро' : null,
      fish: hero.sitting
        ? (ph === 'rest' ? 'Забросить' : ph === 'bite' ? 'Подсекай!' : ph === 'wait' || ph === 'cast' || ph === 'scare' ? 'Подсечь' : 'Есть!')
        : nearSeat() ? 'Сесть рыбачить' : null,
      hot: hero.sitting && ph === 'bite',
      stand: hero.sitting,
    });
  }

  // ---------- отрисовка ----------
  // Из клетки стираются пиксели, закрытые предметами, которые стоят ближе к зрителю
  // (их строка-опора ниже base), потом клетка кладётся в кадр.
  function blit(c, cx2, ox, oy, base) {
    for (let j = 0; j < c.height; j++) {
      let run = -1;
      for (let i = 0; i <= c.width; i++) {
        const hidden = i < c.width && World.depthAt(ox + i, oy + j) > base;
        if (hidden && run < 0) run = i;
        else if (!hidden && run >= 0) { cx2.clearRect(run, j, i - run, 1); run = -1; }
      }
    }
    fctx.drawImage(c, ox, oy);
  }
  // Хвосты последних пойманных рыб над краем ведра; (ox, oy) — левый верх ведра в холсте.
  const TAIL_SLOTS = [[4, -1], [9, 0], [7, -2]];
  function drawTails(c, ox, oy) {
    bag.recent.forEach((id, i) => {
      const [tx, ty] = TAIL_SLOTS[i], [fin, body] = fishArt[id].tail, x = ox + tx, y = oy + ty;
      c.fillStyle = '#' + fin; c.fillRect(x - 1, y, 1, 1); c.fillRect(x + 1, y, 1, 1); c.fillRect(x, y + 1, 1, 1);
      c.fillStyle = '#' + body; c.fillRect(x, y + 2, 1, 2);
    });
  }
  function drawBucket() {                              // ведро на земле
    const ox = bucket.x - (B.baseX - B.x), oy = bucket.y - (B.baseY - B.y) - TOP;
    pctx.clearRect(0, 0, pail.width, pail.height);
    if (bucket.home) pctx.drawImage(img.bucket, 0, TOP);          // на своём месте — в точности как на картинке, с её тенью
    else {
      for (const [dx, dy, a] of B.shadow) { pctx.fillStyle = `rgba(14, 26, 12, ${a / 100})`; pctx.fillRect(dx, dy + TOP, 1, 1); }
      pctx.drawImage(pailBody, 0, TOP);
    }
    drawTails(pctx, 0, TOP);
    blit(pail, pctx, ox, oy, bucket.y);
  }
  function drawHero(t) {
    const hx = Math.round(hero.x), hy = Math.round(hero.y);
    const f = hero.moving ? 1 + (Math.floor(hero.anim) % 4) : (t % 3.7 < 0.14 ? 5 : 0);   // стоя иногда моргает
    cctx.clearRect(0, 0, CW, CH);
    cctx.fillStyle = 'rgba(18, 22, 10, 0.3)';         // тень под ногами
    cctx.fillRect(CX + 4, FH - 2, 11, 1); cctx.fillRect(CX + 2, FH - 1, 15, 2); cctx.fillRect(CX + 4, FH + 1, 11, 1);
    cctx.drawImage((bucket.carried ? carryFrames : heroFrames)[hero.dir][f], CX, 0);
    if (bucket.carried) {                             // ведро в руке качается вместе с плечом
      const rig = rigs[hero.dir], side = hero.dir === 'left' || hero.dir === 'right';
      const sway = side ? (f === 2 || f === 4 ? -1 : 0) : (f === 1 || f === 3 ? 1 : 0);
      const bx = CX + ANCHOR + rig.bucket[0] - (img.carry.width >> 1), by = FH - 1 + rig.bucket[1] - (img.carry.height - 1) + sway;
      cctx.drawImage(img.carry, bx, by);
      drawTails(cctx, bx, by + B.handle);
      cctx.drawImage(rig.arm, CX + rig.x, rig.y + sway);
    }
    blit(cell, cctx, hx - ANCHOR - CX, hy - (FH - 1), hy);
  }

  const SPARK = ['#8abdd0', '#94d6f1'];
  function drawSparkles(t) {                           // блики на воде — мерцают, как штрихи волн на картинке
    for (const [x, y, len, ph] of World.sparkles) {
      const a = Math.sin(t * 0.9 + ph * 6.283);
      if (a < 0.72) continue;
      fctx.globalAlpha = (a - 0.72) / 0.28 * 0.85;
      fctx.fillStyle = SPARK[len & 1];
      fctx.fillRect(x, y, len, 1);
    }
    fctx.globalAlpha = 1;
  }
  function drawMarker() {                              // куда идём
    if (!marker) return;
    const p = Math.floor(marker.t * 5) % 2, x = marker.x, y = marker.y;
    fctx.fillStyle = 'rgba(244, 227, 193, 0.9)';
    for (const [dx, dy] of [[-3 - p, 0], [2 + p, 0], [0, -2 - p], [0, 1 + p]]) fctx.fillRect(x + dx, y + dy, dx ? 2 : 1, dx ? 1 : 2);
  }
  const GLYPH = { E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'] };
  function drawKeycap(letter, cx2, top) {              // клавиша-подсказка над предметом
    const x0 = cx2 - 4;
    fctx.fillStyle = '#240702'; fctx.fillRect(x0 + 1, top, 7, 9); fctx.fillRect(x0, top + 1, 9, 7);
    fctx.fillStyle = '#f4e3c1'; fctx.fillRect(x0 + 1, top + 1, 7, 7);
    fctx.fillStyle = '#240702';
    GLYPH[letter].forEach((row, j) => { for (let i = 0; i < 3; i++) if (row[i] === '#') fctx.fillRect(x0 + 3 + i, top + 2 + j, 1, 1); });
  }
  function drawPrompts(t) {
    const bob = Math.floor(t * 2.5) % 2;
    if (canPick() && !hero.moving) drawKeycap('E', bucket.x, bucket.y - 30 - bob);
    else if (bucket.pointed && !bucket.carried) {      // стрелка «ведро здесь»
      fctx.fillStyle = '#240702'; fctx.fillRect(bucket.x - 3, bucket.y - 28 - bob, 7, 3); fctx.fillRect(bucket.x - 2, bucket.y - 25 - bob, 5, 1); fctx.fillRect(bucket.x - 1, bucket.y - 24 - bob, 3, 1);
      fctx.fillStyle = '#f4e3c1'; fctx.fillRect(bucket.x - 2, bucket.y - 27 - bob, 5, 1); fctx.fillRect(bucket.x - 1, bucket.y - 26 - bob, 3, 1); fctx.fillRect(bucket.x, bucket.y - 25 - bob, 1, 1);
    }
    if (nearSeat() && !hero.moving) drawKeycap('F', Math.round(hero.x), Math.round(hero.y) - FH - 11 - bob);
  }

  function buildDebugLayer() {
    const c = makeCanvas(W, H), x = c.getContext('2d'), id = x.createImageData(W, H);
    const pal = [[255, 0, 0], [0, 200, 255], [255, 0, 255], [255, 255, 0], [0, 255, 120], [255, 140, 0], [140, 90, 255]];
    for (let i = 0; i < W * H; i++) {
      const o = i * 4, d = World.depth[i];
      if (d) { const p = pal[d % pal.length]; id.data[o] = p[0]; id.data[o + 1] = p[1]; id.data[o + 2] = p[2]; id.data[o + 3] = 130; }
      else if (World.walk[i]) { id.data[o] = id.data[o + 1] = id.data[o + 2] = 255; id.data[o + 3] = 90; }
    }
    x.putImageData(id, 0, 0); return c;
  }
  function drawDebug() {
    if (debugFor !== bucket.blocked) { debugLayer = buildDebugLayer(); debugFor = bucket.blocked; }   // проходимость меняется, когда ведро переставляют
    fctx.drawImage(debugLayer, 0, 0);
    fctx.fillStyle = '#f0f'; fctx.fillRect(Math.round(hero.x), Math.round(hero.y), 1, 1);
    if (hero.path) { fctx.fillStyle = '#0ff'; for (const p of hero.path) fctx.fillRect(p.x, p.y, 1, 1); }
    const px = pointer ? `  курсор ${pointer.x},${pointer.y}  ходить ${World.canWalk(pointer.x, pointer.y) ? 'да' : 'нет'}  опора ${World.depthAt(pointer.x, pointer.y)}` : '';
    hint.textContent = `герой ${hero.x.toFixed(1)},${hero.y.toFixed(1)} ${hero.dir}${hero.sitting ? ' сидит' : ''}  рыбалка ${fishing.st.phase}  ведро ${bucket.carried ? 'в руке' : bucket.x + ',' + bucket.y}  масштаб ×${view.k}${px}`;
  }

  function render(t) {
    fctx.drawImage(img.world, 0, 0);
    drawSparkles(t);
    // кто дальше от зрителя, тот рисуется раньше
    const actor = hero.sitting ? () => fctx.drawImage(img.fisher, fisher.x, fisher.y) : () => drawHero(t);
    if (bucket.carried) actor();
    else if (bucket.y <= hero.y) { drawBucket(); actor(); } else { actor(); drawBucket(); }
    Fishing.draw(fctx, fishing.st, t, {
      x: rod.x, tipY: rod.tipY, waterY: rod.waterY, head: { x: seat.x + 2, y: fisher.y },
      bucket: bucket.carried ? null : { x: bucket.x, y: bucket.y - B.bodyH + 4 },
    }, { line: { img: img.line, x: World.line.x, y: World.line.y }, fish: fishArt });
    drawMarker(); drawPrompts(t);
    if (debug) drawDebug();
    const cx = Math.round(clamp(view.camX, 0, W - view.w)), cy = Math.round(clamp(view.camY, 0, H - view.h));
    ctx.drawImage(frame, cx, cy, view.w, view.h, 0, 0, canvas.width, canvas.height);
  }

  // ---------- управление ----------
  function toWorld(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.floor(clamp(view.camX, 0, W - view.w) + (ev.clientX - r.left) / r.width * view.w),
      y: Math.floor(clamp(view.camY, 0, H - view.h) + (ev.clientY - r.top) / r.height * view.h),
    };
  }
  window.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (DIRS[ev.code]) { keys.add(ev.code); ev.preventDefault(); return; }
    if (ev.repeat) return;
    if (ev.code === 'KeyF' || ev.code === 'Space' || ev.code === 'Enter') { fishAction(); ev.preventDefault(); }
    else if (ev.code === 'KeyE') bucketAction();
    else if (ev.code === 'Escape') standUp();
    else if (ev.code === 'Equal' || ev.code === 'NumpadAdd') zoom(1);
    else if (ev.code === 'Minus' || ev.code === 'NumpadSubtract') zoom(-1);
    else if (ev.code === 'F2') { debug = !debug; hint.classList.toggle('debug', debug); if (!debug) hint.innerHTML = hintHtml; ev.preventDefault(); }
  });
  window.addEventListener('keyup', ev => keys.delete(ev.code));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('pointerdown', ev => {
    if (ev.button > 0) return;
    ev.preventDefault();
    const p = toWorld(ev);
    if (hero.sitting && (onFishingSpot(p.x, p.y) || inWater(p.x, p.y))) fishing.press();   // сидя: клик по рыбаку или воде — рыбалка
    else if (bucket.carried && onHero(p.x, p.y)) putDown();
    else if (onBucket(p.x, p.y)) { if (canPick()) pickUp(); else walkTo(bucket.x, bucket.y + 5, 'pick'); }
    else if (onFishingSpot(p.x, p.y)) { if (nearSeat()) sitDown(); else walkTo(seat.x, seat.y, 'sit'); }
    else walkTo(p.x, p.y);
  });
  canvas.addEventListener('pointermove', ev => { pointer = toWorld(ev); });
  let wheelAt = 0;
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    if (ev.timeStamp - wheelAt < 160 || !ev.deltaY) return;
    wheelAt = ev.timeStamp; zoom(ev.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  canvas.addEventListener('contextmenu', ev => ev.preventDefault());
  // после клика снимаем фокус с кнопки, иначе пробел и Enter будут нажимать её, а не подсекать
  btnIn.addEventListener('click', () => { zoom(1); btnIn.blur(); });
  btnOut.addEventListener('click', () => { zoom(-1); btnOut.blur(); });
  window.addEventListener('resize', layout);
  window.addEventListener('pagehide', () => { if (dirty) save(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) save(); });

  // ---------- запуск ----------
  let last = 0;
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0); last = now;
    update(dt); render(now / 1000);
    requestAnimationFrame(tick);
  }
  const files = { world: 'world.png', fisher: 'fisher.png', line: 'line.png', bucket: 'bucket.png', carry: 'bucket-carry.png' };
  Promise.all(Object.keys(files).map(k => loadImage('assets/' + files[k]).then(im => { img[k] = im; }))).then(() => {
    bake();
    UI.init({ bucket: bucketAction, fish: fishAction, stand: standUp });
    load(); layout();
    if (debug) hint.classList.add('debug');
    // для отладки из консоли; step(dt, n) прокручивает игру вручную
    window.FH_GAME = {
      hero, bucket, bag, view, keys, World, fishing, frame, img, sitDown, standUp, walkTo, zoom, pickUp, putDown, fishAction, bucketAction, save,
      step: (dt, n = 1) => { for (let i = 0; i < n; i++) update(dt); render(performance.now() / 1000); },
    };
    requestAnimationFrame(tick);
  }).catch(err => { hint.textContent = 'Не удалось загрузить мир: ' + err.message; hint.classList.add('debug'); });
})();
