// Procedural canvas textures (no external image assets). Each generator produces a colour map and,
// where useful, a normal map derived from a height field so surfaces react to lighting.
import * as THREE from 'three';
import { Rng } from '../core/rng';

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Tileable value noise, octave-summed. */
class Noise {
  private p: Float32Array;
  constructor(private n: number, rng: Rng) {
    this.p = new Float32Array(n * n);
    for (let i = 0; i < this.p.length; i++) this.p[i] = rng.next();
  }
  private v(x: number, y: number, per: number): number {
    const n = this.n;
    x = ((x % per) + per) % per % n;
    y = ((y % per) + per) % per % n;
    return this.p[y * n + x];
  }
  sample(x: number, y: number, per = 4096): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.v(xi, yi, per), b = this.v(xi + 1, yi, per), c = this.v(xi, yi + 1, per), d = this.v(xi + 1, yi + 1, per);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /** fbm over a texture of `size` pixels, tileable at base frequency `freq`. */
  fbm(px: number, py: number, size: number, freq: number, oct = 4): number {
    let amp = 0.5, sum = 0, norm = 0, f = freq;
    for (let o = 0; o < oct; o++) {
      // Wrap coordinates to keep tiling: noise lattice size n must be multiple of freq.
      sum += amp * this.sample((px / size) * f, (py / size) * f, Math.max(1, Math.round(f)));
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

function heightToNormal(height: Float32Array, size: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y - 1 + size) % size) * size + x];
      const dn = height[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - dn) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function toTex(c: HTMLCanvasElement, color = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface TexSet { map: THREE.Texture; normal?: THREE.Texture; rough?: THREE.Texture }

/** Generic surface from a per-pixel function returning [r,g,b,height]. */
function surface(size: number, fn: (x: number, y: number) => [number, number, number, number], normalStrength: number,
  roughFn?: (x: number, y: number, h: number) => number): TexSet {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const height = new Float32Array(size * size);
  const rough = roughFn ? new Uint8ClampedArray(size * size * 4) : null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, h] = fn(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      height[y * size + x] = h;
      if (rough) {
        const v = roughFn!(x, y, h) * 255;
        rough[i] = v; rough[i + 1] = v; rough[i + 2] = v; rough[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const set: TexSet = { map: toTex(c) };
  if (normalStrength > 0) set.normal = toTex(heightToNormal(height, size, normalStrength), false);
  if (rough) {
    const [rc, rctx] = canvas(size);
    rctx.putImageData(new ImageData(rough, size, size), 0, 0);
    set.rough = toTex(rc, false);
  }
  return set;
}

export class TextureLib {
  asphalt!: TexSet;
  concrete!: TexSet;
  sidewalk!: TexSet;
  brick!: TexSet;
  corrugated!: TexSet;
  metalPanel!: TexSet;
  dirt!: TexSet;
  wood!: TexSet;
  plaster!: TexSet;
  grime!: THREE.Texture;
  fence!: THREE.Texture;
  lightPool!: THREE.Texture;
  glow!: THREE.Texture;
  flash!: THREE.Texture;
  smoke!: THREE.Texture;
  spark!: THREE.Texture;
  decal!: THREE.Texture;
  blood!: THREE.Texture;
  ring!: THREE.Texture;
  window!: TexSet;

  build(): void {
    const rng = new Rng(1337);
    const N = new Noise(64, rng);
    const N2 = new Noise(64, new Rng(99));
    const S = 512;

    this.asphalt = surface(S, (x, y) => {
      const n = N.fbm(x, y, S, 8, 5);
      const fine = N2.fbm(x, y, S, 64, 2);
      const speck = rng.next() < 0.04 ? 18 : 0;
      const crack = Math.abs(N.fbm(x + 300, y, S, 4, 3) - 0.5) < 0.006 ? -30 : 0;
      const v = 38 + n * 26 + fine * 16 + speck + crack;
      return [v * 0.95, v * 0.97, v * 1.02, n * 0.6 + fine * 0.4 + (crack ? -0.4 : 0)];
    }, 3.5, (x, y) => {
      // Wet patches: large-scale low roughness areas.
      const w = N2.fbm(x, y, S, 4, 3);
      return w > 0.55 ? 0.22 : 0.78 - w * 0.4;
    });

    this.concrete = surface(S, (x, y) => {
      const n = N.fbm(x, y, S, 6, 5);
      const stain = Math.max(0, N2.fbm(x, y + 100, S, 3, 4) - 0.55) * 160;
      const seam = (x % 256 < 2 || y % 256 < 2) ? -25 : 0;
      const v = 104 + n * 40 - stain + seam;
      return [v, v * 0.99, v * 0.96, n + (seam ? -0.3 : 0)];
    }, 2.2);

    this.sidewalk = surface(S, (x, y) => {
      const n = N.fbm(x, y, S, 10, 4);
      const seam = (x % 128 < 2 || y % 128 < 2) ? -30 : 0;
      const v = 96 + n * 34 + seam;
      return [v, v * 0.98, v * 0.95, n * 0.5 + (seam ? -0.5 : 0)];
    }, 3, (x, y) => (N2.fbm(x, y, S, 5, 2) > 0.6 ? 0.35 : 0.85));

    this.brick = surface(S, (x, y) => {
      const bh = 32, bw = 64;
      const row = Math.floor(y / bh);
      const off = row % 2 ? bw / 2 : 0;
      const bx = (x + off) % bw, by = y % bh;
      const mortar = bx < 4 || by < 4;
      const id = Math.floor((x + off) / bw) * 7 + row * 13;
      const tone = ((id * 9301 + 49297) % 233280) / 233280;
      const n = N.fbm(x, y, S, 16, 3);
      const soot = Math.max(0, N2.fbm(x, y, S, 2, 4) - 0.5) * 120;
      if (mortar) { const v = 92 + n * 20 - soot * 0.5; return [v, v * 0.97, v * 0.92, 0]; }
      const r = 110 + tone * 40 + n * 25 - soot, g = 64 + tone * 18 + n * 14 - soot * 0.8, b = 52 + n * 12 - soot * 0.7;
      return [r, g, b, 0.6 + n * 0.4];
    }, 4);

    this.corrugated = surface(S, (x, y) => {
      const wave = Math.sin((x / S) * Math.PI * 2 * 24) * 0.5 + 0.5;
      const n = N.fbm(x, y, S, 8, 4);
      const rust = Math.max(0, N2.fbm(x, y * 0.3, S, 6, 4) - 0.5) * 2.2;
      const streak = Math.max(0, N.fbm(x, 0, S, 32, 2) - 0.55) * (y / S) * 2;
      const v = 120 + wave * 50 + n * 30;
      const rr = rust + streak;
      return [v * (1 - rr * 0.2) + rr * 60, v * (1 - rr * 0.45) + rr * 20, v * (1 - rr * 0.65), wave];
    }, 2.5, (x) => 0.45 + (Math.sin((x / S) * Math.PI * 48) * 0.5 + 0.5) * 0.25);

    this.metalPanel = surface(S, (x, y) => {
      const px = x % 256, py = y % 256;
      const edge = px < 3 || py < 3;
      const rivet = ((px - 14) ** 2 + (py - 14) ** 2 < 18) || ((px - 242) ** 2 + (py - 14) ** 2 < 18) ||
        ((px - 14) ** 2 + (py - 242) ** 2 < 18) || ((px - 242) ** 2 + (py - 242) ** 2 < 18);
      const n = N.fbm(x, y, S, 12, 4);
      const scratch = N2.sample(x * 0.5, y * 0.02) > 0.8 ? 25 : 0;
      const v = 88 + n * 30 + scratch + (edge ? -30 : 0) + (rivet ? 30 : 0);
      return [v, v * 1.01, v * 1.04, (edge ? -0.5 : 0) + (rivet ? 1 : 0) + n * 0.3];
    }, 3, (x, y) => 0.4 + N.fbm(x, y, S, 8, 2) * 0.4);

    this.dirt = surface(S, (x, y) => {
      const n = N.fbm(x, y, S, 6, 5);
      const pebble = N2.fbm(x, y, S, 48, 2);
      const v = 58 + n * 40 + (pebble > 0.62 ? 30 : 0);
      return [v * 1.02, v * 0.95, v * 0.82, n * 0.6 + (pebble > 0.62 ? 0.5 : 0)];
    }, 3, (x, y) => (N.fbm(x, y, S, 3, 3) > 0.58 ? 0.3 : 0.92));

    this.wood = surface(S, (x, y) => {
      const plank = Math.floor(y / 64);
      const grain = Math.sin((x / S) * 40 + N.fbm(x, y, S, 8, 3) * 12 + plank * 3) * 0.5 + 0.5;
      const gap = y % 64 < 3;
      const v = gap ? 30 : 88 + grain * 30 + ((plank * 37) % 20);
      return [v * 1.05, v * 0.82, v * 0.6, gap ? 0 : 0.5 + grain * 0.3];
    }, 3);

    this.plaster = surface(S, (x, y) => {
      const n = N.fbm(x, y, S, 8, 5);
      const drip = Math.max(0, N2.fbm(x, y * 0.15, S, 10, 3) - 0.52) * 150 * (y / S);
      const v = 128 + n * 30 - drip;
      return [v * 0.98, v, v * 0.97, n];
    }, 1.5);

    // Facade windows: dark glass with frames, some boarded, some lit.
    this.window = surface(256, (x, y) => {
      const fx = x % 128, fy = y % 128;
      const frame = fx < 10 || fx > 118 || fy < 10 || fy > 118 || (fx > 60 && fx < 68);
      if (frame) { const v = 70 + N.sample(x * 0.1, y * 0.1) * 20; return [v, v, v * 1.05, 1]; }
      const refl = (fx + fy) / 256;
      const v = 18 + refl * 30;
      return [v * 0.9, v, v * 1.2, 0];
    }, 2);

    // Grime overlay (grey multiplier) used for zombies and props.
    {
      const [c, ctx] = canvas(256);
      const img = ctx.createImageData(256, 256);
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const n = N.fbm(x, y, 256, 8, 4);
        const blot = N2.fbm(x, y, 256, 4, 3) > 0.6 ? 0.55 : 1;
        const v = (0.62 + n * 0.45) * blot * 255;
        const i = (y * 256 + x) * 4;
        img.data[i] = v; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 0.94; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      this.grime = toTex(c);
    }

    // Chain-link fence with alpha.
    {
      const [c, ctx] = canvas(128);
      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(170,175,180,1)';
      ctx.lineWidth = 3;
      for (let i = -128; i < 256; i += 32) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i + 128, 0); ctx.lineTo(i, 128); ctx.stroke();
      }
      this.fence = toTex(c);
    }

    this.lightPool = radial(256, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
    this.glow = radial(128, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.6)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
    this.smoke = (() => {
      const [c, ctx] = canvas(128);
      const img = ctx.createImageData(128, 128);
      for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
        const d = Math.hypot(x - 64, y - 64) / 64;
        const n = N.fbm(x, y, 128, 4, 4);
        const a = Math.max(0, 1 - d) ** 1.5 * (0.4 + n * 0.8);
        const i = (y * 128 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.min(255, a * 255);
      }
      ctx.putImageData(img, 0, 0);
      return toTex(c);
    })();
    this.flash = (() => {
      const [c, ctx] = canvas(128);
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,250,230,1)');
      g.addColorStop(0.25, 'rgba(255,200,110,0.9)');
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g;
      ctx.translate(64, 64);
      for (let i = 0; i < 7; i++) {
        ctx.rotate((Math.PI * 2) / 7 + rng.range(-0.2, 0.2));
        ctx.beginPath();
        ctx.moveTo(0, -6); ctx.lineTo(64 * rng.range(0.6, 1), 0); ctx.lineTo(0, 6);
        ctx.fill();
      }
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
      return toTex(c);
    })();
    this.spark = radial(32, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,220,150,0.8)'], [1, 'rgba(255,150,50,0)']]);
    // Bullet hole decal
    this.decal = (() => {
      const [c, ctx] = canvas(64);
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.18, 'rgba(10,10,10,0.95)');
      g.addColorStop(0.3, 'rgba(40,38,35,0.6)');
      g.addColorStop(1, 'rgba(40,38,35,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return toTex(c);
    })();
    this.blood = (() => {
      const [c, ctx] = canvas(128);
      for (let i = 0; i < 26; i++) {
        const r = rng.range(3, 18) * (i === 0 ? 2.5 : 1);
        const a = rng.range(0, Math.PI * 2), d = i === 0 ? 0 : rng.range(10, 50);
        ctx.fillStyle = `rgba(${70 + rng.int(0, 30)},${6 + rng.int(0, 8)},${6},${rng.range(0.6, 0.95)})`;
        ctx.beginPath();
        ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, Math.PI * 2);
        ctx.fill();
      }
      return toTex(c);
    })();
    this.ring = (() => {
      const [c, ctx] = canvas(256);
      ctx.strokeStyle = 'rgba(255,255,255,1)';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 12]);
      ctx.beginPath(); ctx.arc(128, 128, 108, 0, Math.PI * 2); ctx.stroke();
      return toTex(c);
    })();
  }
}

function radial(size: number, stops: [number, string][]): THREE.CanvasTexture {
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTex(c);
}

/** Text / symbol sign textures. */
export function signTexture(lines: string[], opts: { bg: string; fg: string; w?: number; h?: number; border?: string; hazard?: boolean; symbol?: 'bio' | 'skull' | 'arrow' | 'none'; font?: string }): THREE.CanvasTexture {
  const w = opts.w ?? 512, h = opts.h ?? 256;
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, w, h);
  if (opts.hazard) {
    ctx.save();
    ctx.fillStyle = '#111';
    for (let i = -h; i < w + h; i += 40) {
      ctx.beginPath();
      ctx.moveTo(i, 0); ctx.lineTo(i + 20, 0); ctx.lineTo(i + 20 - h * 0.1, h * 0.1); ctx.lineTo(i - h * 0.1, h * 0.1);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(i, h); ctx.lineTo(i + 20, h); ctx.lineTo(i + 20 + h * 0.1, h * 0.9); ctx.lineTo(i + h * 0.1, h * 0.9);
      ctx.fill();
    }
    ctx.restore();
  }
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 10;
    ctx.strokeRect(12, 12, w - 24, h - 24);
  }
  let textX = w / 2;
  if (opts.symbol === 'bio') {
    drawBiohazard(ctx, h * 0.5, h / 2, h * 0.3, opts.fg);
    textX = w / 2 + h * 0.3;
  }
  ctx.fillStyle = opts.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = (h * 0.62) / lines.length;
  lines.forEach((l, i) => {
    const size = i === 0 ? lh * 0.8 : lh * 0.55;
    ctx.font = `bold ${size}px ${opts.font ?? '"DIN Alternate","Arial Narrow",Arial,sans-serif'}`;
    const y = h / 2 + (i - (lines.length - 1) / 2) * lh;
    ctx.fillText(l, textX, y, w * 0.8 - (textX - w / 2));
  });
  // Weathering
  const rng = new Rng(lines.join('').length * 31);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(30,25,20,${rng.range(0.05, 0.25)})`;
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 30), rng.range(1, 6));
  }
  return toTex(c);
}

function drawBiohazard(ctx: Ctx, x: number, y: number, r: number, col: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = col;
  for (let i = 0; i < 3; i++) {
    ctx.rotate((Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.arc(0, -r * 0.5, r * 0.5, 0, Math.PI * 2);
    ctx.arc(0, -r * 0.62, r * 0.36, 0, Math.PI * 2, true);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = col;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
