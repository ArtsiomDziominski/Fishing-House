// Рюкзаки: тот же рюкзак с картинки в нескольких расцветках. Вид выбирает игрок, сервер его хранит и показывает другим.
// Расцветка — поворот оттенка, поэтому все тени оригинала остаются на месте. Ею tools/build-world.mjs красит рюкзак
// с картинки (assets/pack.png — кадры в порядке PACK_KINDS), а игра — рюкзак на спине героя.

export const PACK_KINDS = ['leather', 'canvas', 'sailor', 'berry'] as const;
export type PackKind = typeof PACK_KINDS[number];

export const PACKS = (() => {
  // turn — на сколько градусов повернуть оттенок, sat и lit — во сколько раз насыщеннее и светлее
  const BY_ID: Record<PackKind, { name: string; turn: number; sat: number; lit: number }> = {
    leather: { name: 'Кожаный', turn: 0, sat: 1, lit: 1 },          // как на картинке
    canvas: { name: 'Походный', turn: 62, sat: 0.8, lit: 0.95 },
    sailor: { name: 'Морской', turn: 182, sat: 0.85, lit: 1.1 },
    berry: { name: 'Ягодный', turn: -34, sat: 1.05, lit: 1 },
  };
  const TONES = ['b16f38', '975220', '7a3d20', '642d18', '432115'];   // пять тонов кожи с картинки, от света к тени
  const rgb = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];

  // Цвет [r, g, b] с картинки → тот же в расцветке вида. Контур остаётся тёмно-бурым, как у всего на картинке.
  function tint(kind: PackKind, c: ArrayLike<number>): number[] {
    const k = BY_ID[kind], r = c[0]!, g = c[1]!, b = c[2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if ((!k.turn && k.sat === 1 && k.lit === 1) || max < 56) return [r, g, b];
    const l0 = (max + min) / 510;
    const s0 = d ? d / (l0 > 0.5 ? 510 - max - min : max + min) : 0;
    const h0 = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const h = (((h0 * 60 + k.turn) % 360) + 360) % 360 / 360, s = Math.min(1, s0 * k.sat), l = Math.min(1, l0 * k.lit);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const ch = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [ch(h + 1 / 3), ch(h), ch(h - 1 / 3)].map(v => Math.round(v * 255));
  }
  // Пять тонов вида — ими нарисован рюкзак на спине героя.
  const tones = (kind: PackKind): number[][] => TONES.map(t => tint(kind, rgb(t)));
  const isKind = (v: unknown): v is PackKind => PACK_KINDS.includes(v as PackKind);

  return { DEFAULT: PACK_KINDS[0] as PackKind, name: (kind: PackKind) => BY_ID[kind].name, tint, tones, isKind };
})();
