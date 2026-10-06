// Интерфейс поверх игры: что лежит в ведре, всплывающие сообщения и кнопки действий.

const UI = (() => {
  const $ = id => document.getElementById(id);
  const rows = {};
  let toastTimer = 0, actionsKey = '';

  // Значок рыбы: спрайт по центру холста 24×10, CSS растягивает его вдвое.
  function fishIcon(sp, silhouette) {
    const s = FISH.sprite(sp, silhouette), c = document.createElement('canvas');
    c.width = 24; c.height = 10; c.className = 'fish-icon';
    const tmp = document.createElement('canvas'); tmp.width = s.w; tmp.height = s.h;
    const tx = tmp.getContext('2d'), id = tx.createImageData(s.w, s.h); id.data.set(s.data); tx.putImageData(id, 0, 0);
    c.getContext('2d').drawImage(tmp, (24 - s.w) >> 1, (10 - s.h) >> 1);
    return c;
  }

  // handlers: { bucket(), fish(), stand() } — то же, что клавиши E, F и Esc.
  function init(handlers) {
    const list = $('catch-list');
    for (const sp of FISH.SPECIES) {
      const li = document.createElement('li'), name = document.createElement('span'), n = document.createElement('span');
      const lit = fishIcon(sp, false), dim = fishIcon(sp, true);
      lit.classList.add('lit'); dim.classList.add('dim');
      name.className = 'name'; name.textContent = sp.name; n.className = 'n';
      li.append(dim, lit, name, n); list.append(li);
      rows[sp.id] = { li, n };
    }
    const bind = (id, fn) => $(id).addEventListener('click', ev => { fn(); ev.currentTarget.blur(); });
    bind('act-bucket', handlers.bucket); bind('act-fish', handlers.fish); bind('act-stand', handlers.stand);
  }

  // bag: { counts: {id: штук}, best: {id: граммов}, total, grams }
  function showCatch(bag) {
    $('catch-total').textContent = bag.total ? `${bag.total} · ${FISH.weightText(bag.grams)}` : 'пусто';
    for (const sp of FISH.SPECIES) {
      const n = bag.counts[sp.id] || 0, row = rows[sp.id];
      row.li.classList.toggle('caught', n > 0);
      row.n.textContent = n ? '×' + n : '';
      row.li.title = n ? `${sp.name}: ${n} шт., самая крупная ${FISH.weightText(bag.best[sp.id])}` : `${sp.name}: ещё не поймана`;
    }
  }

  // tone: '' | 'good' | 'bad'; fishId — показать значок рыбы перед текстом.
  function toast(text, tone = '', fishId = null) {
    const el = $('toast');
    el.textContent = '';
    if (fishId) el.append(fishIcon(FISH.byId[fishId], false));
    el.append(text);
    el.className = 'show ' + tone;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = tone; }, 2600);
  }

  // a: { bucket: подпись | null, fish: подпись | null, hot: подсечка сейчас, stand: показать «Встать» }
  function actions(a) {
    const key = JSON.stringify(a); if (key === actionsKey) return; actionsKey = key;
    const set = (id, label) => { const b = $(id); b.hidden = !label; if (label) b.querySelector('span').textContent = label; };
    set('act-bucket', a.bucket); set('act-fish', a.fish); set('act-stand', a.stand ? 'Встать' : null);
    $('act-fish').classList.toggle('hot', !!a.hot);
  }

  return { init, showCatch, toast, actions };
})();
