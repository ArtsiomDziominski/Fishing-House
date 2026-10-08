// Свет огня ночью — походной лампы и костра: круг, в котором темнота отступает, ступенями, как пиксельный ореол.
// Только картинка. Где что горит, решает движок (лампы — по состоянию комнаты, костёр — всегда); здесь — сам ореол
// и то, как он кладётся: сначала проедает дыру в слое темноты, потом ложится на кадр тёплой добавкой.

type Ctx = CanvasRenderingContext2D;
// k — во сколько раз круг шире лампового (у костра он больше)
export interface LightSpot { x: number; y: number; k?: number }

// r — радиус круга лампы; hole — насколько он проедает темноту, warm — доля тёплой добавки; flicker — как сильно огонь дрожит.
export const LIGHT = { r: 46, hole: 0.85, warm: 0.2, flicker: 0.06, steps: 6, color: [255, 196, 110] };

export function createLightView() {
  const size = LIGHT.r * 2, glow = document.createElement('canvas'); glow.width = size; glow.height = size;
  const g = glow.getContext('2d')!, px = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - LIGHT.r, (y + 0.5 - LIGHT.r) * 1.15) / LIGHT.r, o = (y * size + x) * 4;   // чуть сплюснут: свет лежит на земле
    const a = d >= 1 ? 0 : Math.ceil((1 - d) ** 1.3 * LIGHT.steps) / LIGHT.steps;
    px.data[o] = LIGHT.color[0]!; px.data[o + 1] = LIGHT.color[1]!; px.data[o + 2] = LIGHT.color[2]!; px.data[o + 3] = Math.round(a * 255);
  }
  g.putImageData(px, 0, 0);

  // Кладёт ореолы всех огней в силу power (0..1); t — секунды: каждый огонь дрожит по-своему.
  // Как именно — решает тот, кто зовёт: режим наложения на ctx он выставляет сам.
  function beam(ctx: Ctx, spots: LightSpot[], power: number, t: number) {
    spots.forEach((p, i) => {
      ctx.globalAlpha = power * (1 - LIGHT.flicker * (0.5 + 0.5 * Math.sin(t * 9 + i * 2.1) * Math.sin(t * 3.7 + i)));
      const r = Math.round(LIGHT.r * (p.k ?? 1));
      ctx.drawImage(glow, Math.round(p.x) - r, Math.round(p.y) - r, r * 2, r * 2);
    });
  }
  return { beam };
}
