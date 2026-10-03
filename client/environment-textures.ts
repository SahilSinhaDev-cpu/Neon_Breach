import * as T from 'three';

// Original small canvas textures. No downloaded art, font, or model assets.
function canvas(w = 512, h = 512) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { canvas: c, ctx: c.getContext('2d')! }; }
function texture(c: HTMLCanvasElement, repeat = false) { const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 2; if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping; return t; }
function random(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function bolts(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  for (const a of [x + 9, x + w - 9]) for (const b of [y + 9, y + h - 9]) { ctx.fillStyle = '#071015'; ctx.beginPath(); ctx.arc(a, b, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#8b999b66'; ctx.fillRect(a - 1, b - 2, 2, 3); }
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = '#081218'; ctx.fillRect(x, y, w, h); ctx.fillStyle = color; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  ctx.strokeStyle = '#869da337'; ctx.lineWidth = 2; ctx.strokeRect(x + 6, y + 6, w - 12, h - 12); bolts(ctx, x, y, w, h);
}
export function metalTexture(kind: 'floor' | 'wall' | 'cover' | 'pillar') {
  const { canvas: c, ctx } = canvas(), rand = random(kind.charCodeAt(0) * 129);
  ctx.fillStyle = '#17232b'; ctx.fillRect(0, 0, 512, 512);
  if (kind === 'floor') {
    for (let x = 0; x < 512; x += 256) for (let y = 0; y < 512; y += 128) {
      panel(ctx, x + 2, y + 2, 252, 124, rand() > 0.45 ? '#27333b' : '#222e36');
      ctx.fillStyle = '#9fada816'; for (let i = 0; i < 8; i++) ctx.fillRect(x + 21 + i * 28, y + 113, 17, 2);
    }
    for (let i = 0; i < 520; i++) { const x = rand() * 512, y = rand() * 512; ctx.strokeStyle = `rgba(168,180,177,${rand() * 0.11})`; ctx.lineWidth = rand() + 0.3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rand() * 43, y + rand() * 7); ctx.stroke(); }
  } else if (kind === 'wall') {
    panel(ctx, 4, 4, 504, 504, '#2c3a45'); panel(ctx, 33, 53, 446, 297, '#24313c');
    panel(ctx, 33, 373, 446, 111, '#1b2731');
    ctx.fillStyle = '#17242c'; for (let i = 0; i < 11; i++) { ctx.fillRect(58, 389 + i * 7, 396, 3); }
    ctx.fillStyle = '#7f959a40'; ctx.fillRect(36, 48, 440, 3); ctx.fillRect(61, 337, 70, 5);
    ctx.fillStyle = '#556b74'; ctx.font = '13px "Menlo", "Consolas", monospace'; ctx.fillText('PRESSURE SHELL / SR-07', 58, 81);
    ctx.fillStyle = '#0b141b'; ctx.fillRect(402, 144, 30, 80); ctx.strokeStyle = '#809298'; ctx.strokeRect(410, 159, 8, 49);
  } else if (kind === 'pillar') {
    panel(ctx, 2, 2, 508, 508, '#34454e'); panel(ctx, 57, 42, 398, 174, '#182832'); panel(ctx, 57, 244, 398, 224, '#22333d');
    for (let i = 0; i < 12; i++) { ctx.fillStyle = '#080f16'; ctx.fillRect(73, 59 + i * 12, 366, 6); ctx.fillStyle = '#7c92993b'; ctx.fillRect(73, 59 + i * 12, 366, 1); }
    for (let i = 0; i < 3; i++) { panel(ctx, 82 + i * 116, 267, 93, 170, '#30444d'); ctx.fillStyle = '#738783'; ctx.fillRect(104 + i * 116, 287, 48, 5); }
    ctx.fillStyle = '#939d86'; ctx.font = '12px "Menlo", "Consolas", monospace'; ctx.fillText('RELAY THERMAL EXCHANGER', 79, 236);
  } else {
    for (let x = 0; x < 512; x += 128) { panel(ctx, x + 2, 3, 124, 506, '#39474c'); panel(ctx, x + 15, 32, 98, 360, '#22333c'); ctx.fillStyle = '#a7ac9755'; ctx.fillRect(x + 24, 54, 75, 9); for (let y = 110; y < 345; y += 27) { ctx.fillStyle = '#0d1921'; ctx.fillRect(x + 23, y, 80, 11); ctx.fillStyle = '#7c989745'; ctx.fillRect(x + 23, y, 80, 2); } }
    ctx.fillStyle = '#101b22'; ctx.fillRect(0, 410, 512, 50); ctx.fillStyle = '#9ca999'; ctx.font = '21px "Menlo", "Consolas", monospace'; ctx.fillText('RELAY POWER / ISOLATED', 49, 444);
  }
  // Fine coating variation and wear, not randomly scattered physical debris.
  for (let i = 0; i < 1900; i++) { const n = rand(); ctx.fillStyle = n < 0.5 ? '#d5e1cf0a' : '#050a1218'; ctx.fillRect(rand() * 512, rand() * 512, 1 + rand() * 3, 1 + rand() * 2); }
  const t = texture(c, kind === 'floor'); if (kind === 'floor') t.repeat.set(10.5, 10.5); return t;
}
export function signTexture(title: string, subtitle: string, color = '#abc9c7') {
  const { canvas: c, ctx } = canvas(1024, 256);
  ctx.fillStyle = '#07131bed'; ctx.fillRect(0, 0, 1024, 256); ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 1018, 250);
  ctx.fillStyle = color; ctx.fillRect(27, 32, 12, 112); ctx.font = 'bold 66px "Menlo", "Consolas", monospace'; ctx.fillText(title, 62, 113, 900);
  ctx.fillStyle = '#92aaad'; ctx.font = '24px "Menlo", "Consolas", monospace'; ctx.fillText(subtitle, 65, 187, 880);
  for (let i = 0; i < 8; i++) ctx.fillRect(841 + i * 13, 213, i % 3 === 0 ? 7 : 3, 15);
  return texture(c);
}
export function floorLabel(title: string, color: string) {
  const { canvas: c, ctx } = canvas(1024, 256); ctx.fillStyle = color; ctx.font = 'bold 88px "Menlo", "Consolas", monospace'; ctx.textAlign = 'center'; ctx.fillText(title, 512, 143, 920);
  ctx.fillRect(180, 199, 664, 7); ctx.beginPath(); ctx.moveTo(435, 55); ctx.lineTo(512, 10); ctx.lineTo(589, 55); ctx.lineWidth = 9; ctx.strokeStyle = color; ctx.stroke();
  // Small chips in the stencil paint.
  ctx.globalCompositeOperation = 'destination-out'; const rand = random(817); for (let i = 0; i < 180; i++) ctx.fillRect(rand() * 1024, rand() * 256, 1 + rand() * 10, 1 + rand() * 3);
  return texture(c);
}
export function scorchTexture() {
  const { canvas: c, ctx } = canvas(), rand = random(1216);
  const g = ctx.createRadialGradient(256, 256, 14, 256, 256, 245); g.addColorStop(0, '#030609bc'); g.addColorStop(0.28, '#080c10a6'); g.addColorStop(0.64, '#0c111352'); g.addColorStop(1, '#00000000'); ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 35; i++) { const a = rand() * Math.PI * 2, r = 22 + rand() * 170; ctx.strokeStyle = '#070b0d55'; ctx.lineWidth = 1 + rand() * 9; ctx.beginPath(); ctx.moveTo(256 + Math.cos(a) * 22, 256 + Math.sin(a) * 22); ctx.lineTo(256 + Math.cos(a) * r, 256 + Math.sin(a) * r); ctx.stroke(); }
  for (const [x, y] of [[199, 210], [225, 268], [290, 245]]) { ctx.fillStyle = '#05090c'; ctx.beginPath(); ctx.ellipse(x, y, 6, 10, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#b5ada653'; ctx.lineWidth = 2; ctx.stroke(); }
  return texture(c);
}
export function hologramTexture() {
  const { canvas: c, ctx } = canvas(1024, 512); ctx.fillStyle = '#06131ae8'; ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = '#61999b25'; ctx.lineWidth = 1; for (let x = 0; x < 1024; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); } for (let y = 0; y < 512; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke(); }
  ctx.fillStyle = '#bed6d1'; ctx.font = 'bold 39px "Menlo", "Consolas", monospace'; ctx.fillText('RELAY / 07', 42, 64); ctx.font = '19px "Menlo", "Consolas", monospace'; ctx.fillStyle = '#cba275'; ctx.fillText('EARTH UPLINK — NO CARRIER', 43, 98);
  const nodes = [[224, 271], [371, 163], [535, 280], [699, 147], [800, 328], [358, 424]];
  ctx.strokeStyle = '#75bcbda0'; ctx.lineWidth = 3;
  for (let i = 1; i < nodes.length; i++) { ctx.setLineDash(i % 2 ? [8, 11] : []); ctx.beginPath(); ctx.moveTo(...nodes[0] as [number, number]); ctx.lineTo(...nodes[i] as [number, number]); ctx.stroke(); }
  ctx.setLineDash([]); for (const [i, [x, y]] of nodes.entries()) { ctx.strokeStyle = i === 0 ? '#ade4ca' : '#bb8656'; ctx.lineWidth = 3; ctx.strokeRect(x - 14, y - 14, 28, 28); ctx.font = '15px "Menlo", "Consolas", monospace'; ctx.fillStyle = '#99bcbb'; ctx.fillText(i === 0 ? 'LOCAL ARRAY' : `LINK ${i} / LOST`, x + 23, y + 5); }
  ctx.fillStyle = '#06131afa'; ctx.fillRect(430, 217, 530, 18); ctx.fillRect(40, 346, 352, 11); ctx.fillStyle = '#8cabaa'; ctx.font = '17px "Menlo", "Consolas", monospace'; ctx.fillText('2191.07 / EMERGENCY AUTONOMY', 45, 482);
  return texture(c);
}
// Smooth spatial noise samples a sphere, so coastlines/clouds have no UV seam
// or repeated sine-wave bands. This is baked once into a small canvas texture.
function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (a: number) => a * a * (3 - 2 * a), fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const hash = (a: number, b: number, c: number) => { let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1442695041); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295; };
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx), mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx), fy), mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx), mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx), fy), fz);
}
function terrain(x: number, y: number, z: number) { return noise3(x, y, z) * .57 + noise3(x * 2.03, y * 2.03, z * 2.03) * .28 + noise3(x * 4.09, y * 4.09, z * 4.09) * .1 + noise3(x * 8.17, y * 8.17, z * 8.17) * .05; }
export function planetTexture() {
  const { canvas: c, ctx } = canvas(512, 256); const pixels = ctx.createImageData(512, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) {
    const u = x / 512 * Math.PI * 2, v = y / 256 * Math.PI;
    const sx = Math.cos(u) * Math.sin(v), sy = Math.cos(v), sz = Math.sin(u) * Math.sin(v);
    const field = terrain(sx * 2.5 + 24, sy * 2.5 + 3, sz * 2.5 + 40);
    const clouds = terrain(sx * 8 + sy * 2 + 17, sy * 8 + 8, sz * 8 + 31);
    const haze = Math.min(.85, Math.max(0, clouds - .51) * 3.6 + Math.pow(Math.abs(sy), 20) * .46);
    const land = field > .51, coast = field > .50 && field <= .51;
    const color = land ? [46 + field * 12, 57 + field * 12, 53 + field * 8] : coast ? [34, 52, 61] : [12, 31, 51];
    const i = (y * 512 + x) * 4;
    pixels.data[i] = color[0] * (1 - haze) + 167 * haze; pixels.data[i + 1] = color[1] * (1 - haze) + 180 * haze; pixels.data[i + 2] = color[2] * (1 - haze) + 185 * haze; pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0); return texture(c);
}
