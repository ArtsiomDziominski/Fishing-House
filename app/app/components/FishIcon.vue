<!-- Значок рыбы: спрайт по центру холста 24×10, CSS растягивает его вдвое. dim — бледный силуэт ещё не пойманной. -->
<script setup lang="ts">
import { FISH } from '@fh/shared';

const props = defineProps<{ id: string; dim?: boolean }>();
const el = ref<HTMLCanvasElement>();

function draw() {
  const c = el.value, sp = FISH.byId[props.id];
  if (!c || !sp) return;
  const s = FISH.sprite(sp, props.dim), tmp = document.createElement('canvas');
  tmp.width = s.w; tmp.height = s.h;
  const tx = tmp.getContext('2d')!, img = tx.createImageData(s.w, s.h);
  img.data.set(s.data); tx.putImageData(img, 0, 0);
  const cx = c.getContext('2d')!;
  cx.clearRect(0, 0, 24, 10);
  cx.drawImage(tmp, (24 - s.w) >> 1, (10 - s.h) >> 1);
}
onMounted(draw);
watch(() => [props.id, props.dim], draw);
</script>

<template>
  <canvas ref="el" class="fish-icon" width="24" height="10" />
</template>

<style scoped>
.fish-icon { width: 48px; height: 20px; image-rendering: pixelated; flex: none; }
</style>
