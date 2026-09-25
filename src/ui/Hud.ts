// DOM HUD. Values are cached so the DOM is only touched when something visibly changes.
import * as THREE from 'three';
import { REGIONS, type RegionId } from '../config';
import type { MapRenderer, MapState } from './MapRenderer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface ContractView {
  title: string;
  tag: string;
  sub: string;
  warn?: boolean;
  progress?: number;
  state: 'active' | 'done' | 'locked';
}

export interface StationItemView { key: string; name: string; desc: string; price: string; enabled: boolean }

export interface WaypointView { x: number; y: number; z: number; kind: 'contract' | 'lz' | 'elite' | 'buy' | 'upgrade'; icon: string; label: string }

export interface HudFrame {
  remaining: number;
  finalPhase: boolean;
  timerLabel: string;
  contracts: ContractView[];
  region: RegionId;
  health: number;
  armor: number;
  plates: number;
  grenades: number;
  cash: number;
  weaponName: string;
  tier: number;
  mag: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  secondary: string;
  stamina: number;
  exhausted: boolean;
  sprinting: boolean;
  plateProgress: number;
  adsT: number;
  spreadPx: number;
  eliteHp: number | null;
  prompt: string | null;
  toxic: boolean;
  fps: string | null;
  px: number;
  pz: number;
  yaw: number;
}

export class Hud {
  private cache = new Map<string, string>();
  private hitT = 0;
  private dmgDirs: { el: HTMLDivElement; x: number; z: number; t: number }[] = [];
  private cashShown = 0;
  private deltaT = 0;
  private hintT = 22;
  private mini: CanvasRenderingContext2D;
  private tac: HTMLCanvasElement;
  private wpEls = new Map<string, HTMLDivElement>();
  private tmp = new THREE.Vector3();
  private hitVignette = 0;
  private stationFlash: { idx: number; ok: boolean; t: number } | null = null;

  constructor(private map: MapRenderer) {
    this.mini = $<HTMLCanvasElement>('minimap').getContext('2d')!;
    this.tac = $<HTMLCanvasElement>('tacmap-canvas');
  }

  reset(): void {
    this.cache.clear();
    $('toasts').innerHTML = '';
    $('dmg-dirs').innerHTML = '';
    this.dmgDirs = [];
    this.hintT = 22;
    $('controls-hint').style.opacity = '1';
    this.cashShown = -1;
    this.hitVignette = 0;
    $('center-msg').classList.add('hidden');
    this.setStation(null, '');
  }

  show(v: boolean): void {
    $('hud').classList.toggle('hidden', !v);
  }

  private set(id: string, key: 'text' | 'html' | 'class' | 'width' | 'display', value: string): void {
    const k = id + ':' + key;
    if (this.cache.get(k) === value) return;
    this.cache.set(k, value);
    const el = $(id);
    if (!el) return;
    if (key === 'text') el.textContent = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'class') el.className = value;
    else if (key === 'width') el.style.width = value;
    else if (key === 'display') el.classList.toggle('hidden', value === 'none');
  }

  toast(text: string, kind: '' | 'big' | 'good' | 'bad' = '', small = '', dur = 2.8): void {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    if (small) {
      const s = document.createElement('span');
      s.className = 'small';
      s.textContent = small;
      el.appendChild(s);
    }
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild!);
    window.setTimeout(() => el.remove(), dur * 1000);
  }

  centerMessage(text: string | null): void {
    if (text === null) this.set('center-msg', 'display', 'none');
    else { this.set('center-msg', 'display', 'block'); this.set('center-msg', 'text', text); }
  }

  hit(kind: 'body' | 'head' | 'kill' | 'armor'): void {
    const el = $('hitmarker');
    el.className = kind;
    el.style.opacity = '1';
    this.hitT = kind === 'kill' ? 0.28 : 0.16;
  }

  /** Registers damage from a world position; the indicator tracks it as the player turns. */
  damageFrom(x: number, z: number, heavy: boolean): void {
    const el = document.createElement('div');
    el.className = 'dmg-dir';
    $('dmg-dirs').appendChild(el);
    this.dmgDirs.push({ el, x, z, t: heavy ? 1.4 : 1.0 });
    this.hitVignette = Math.min(1, this.hitVignette + (heavy ? 0.6 : 0.35));
  }

  get damageVignette(): number {
    return this.hitVignette;
  }

  setStation(items: StationItemView[] | null, title: string): void {
    if (!items) { this.set('station', 'display', 'none'); return; }
    this.set('station', 'display', 'block');
    this.set('station-title', 'text', title);
    const html = items.map((it, i) => `<div class="station-item ${it.enabled ? '' : 'off'} ${this.stationFlash && this.stationFlash.idx === i ? (this.stationFlash.ok ? 'flash' : 'deny') : ''}">
      <kbd>${it.key}</kbd><div><div class="nm">${it.name}</div><div class="ds">${it.desc}</div></div><div class="pr">${it.price}</div></div>`).join('');
    this.set('station-items', 'html', html);
  }

  flashStation(idx: number, ok: boolean): void {
    this.stationFlash = { idx, ok, t: 0.35 };
  }

  updateWaypoints(list: WaypointView[], cam: THREE.PerspectiveCamera, px: number, pz: number): void {
    const root = $('waypoints');
    const seen = new Set<string>();
    const w = window.innerWidth, h = window.innerHeight;
    for (const wp of list) {
      const key = wp.kind + wp.label;
      seen.add(key);
      let el = this.wpEls.get(key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'wp ' + wp.kind;
        el.innerHTML = `<div class="ico"><span>${wp.icon}</span></div><div class="dist"></div><div class="lbl">${wp.label}</div>`;
        root.appendChild(el);
        this.wpEls.set(key, el);
      }
      this.tmp.set(wp.x, wp.y, wp.z).project(cam);
      const behind = this.tmp.z > 1;
      let sx = (this.tmp.x * 0.5 + 0.5) * w, sy = (-this.tmp.y * 0.5 + 0.5) * h;
      // Behind the camera: pin to the nearer side edge at mid height (clear of HUD panels).
      if (behind) { sx = this.tmp.x > 0 ? 40 : w - 40; sy = h * 0.5; }
      sx = Math.max(40, Math.min(w - 40, sx));
      sy = Math.max(sx < 380 || sx > w - 260 ? 330 : 90, Math.min(h - 170, sy));
      el.style.left = sx + 'px';
      el.style.top = sy + 'px';
      const d = Math.round(Math.hypot(wp.x - px, wp.z - pz));
      (el.children[1] as HTMLElement).textContent = d + 'm';
      // Fade markers near the crosshair so they never obscure aiming.
      const cd = Math.hypot(sx - w / 2, sy - h / 2);
      el.style.opacity = String(Math.max(0.25, Math.min(1, cd / 180)));
    }
    for (const [k, el] of this.wpEls) if (!seen.has(k)) { el.remove(); this.wpEls.delete(k); }
  }

  drawMaps(st: MapState, tacOpen: boolean): void {
    this.map.drawMini(this.mini, 200, st);
    if (tacOpen) {
      const r = this.tac.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(1, Math.floor(r.width * dpr)), ch = Math.max(1, Math.floor(r.height * dpr));
      if (this.tac.width !== cw || this.tac.height !== ch) { this.tac.width = cw; this.tac.height = ch; }
      this.map.drawFull(this.tac.getContext('2d')!, cw, ch, st);
    }
  }

  update(dt: number, f: HudFrame): void {
    const t = Math.ceil(f.remaining);
    const mm = Math.floor(t / 60), ss = t % 60;
    this.set('timer', 'text', `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`);
    this.set('timer', 'class', f.finalPhase || f.remaining < 90 ? 'urgent' : '');
    this.set('timer-label', 'text', f.timerLabel);
    this.set('phase-banner', 'display', f.finalPhase ? 'block' : 'none');
    this.set('phase-banner', 'text', f.toxic ? 'CONTAMINATED · GET OUT' : 'CONTAMINATION SPREADING');
    this.set('contracts', 'html', f.contracts.map((c) => `<div class="contract ${c.state === 'done' ? 'done' : c.state === 'locked' ? 'locked' : ''}">
      <div class="c-title"><span>${c.title}</span><span class="tag">${c.tag}</span></div>
      <div class="c-sub ${c.warn ? 'warn' : ''}">${c.sub}</div>
      ${c.progress !== undefined ? `<div class="c-bar"><i style="width:${Math.round(c.progress * 100)}%"></i></div>` : ''}</div>`).join(''));
    const reg = REGIONS[f.region];
    this.set('region-name', 'text', reg.label);
    this.set('region-threat', 'text', reg.threat);
    this.set('region-threat', 'class', 'threat ' + f.region);
    // Vitals
    this.set('health-fill', 'width', `${Math.max(0, f.health)}%`);
    this.set('health-fill', 'class', f.health < 35 ? 'low' : '');
    this.set('health-num', 'text', String(Math.ceil(f.health)));
    const segs = $('armor-row').children;
    for (let i = 0; i < 3; i++) {
      const fill = Math.max(0, Math.min(1, (f.armor - i * 50) / 50));
      const inner = segs[i].firstElementChild as HTMLElement;
      const v = `${Math.round(fill * 100)}%`;
      if (inner.style.width !== v) inner.style.width = v;
    }
    this.set('plates', 'text', String(f.plates));
    this.set('grenades', 'text', String(f.grenades));
    // Cash with delta flash
    if (this.cashShown < 0) this.cashShown = f.cash;
    if (f.cash !== this.cashShown) {
      const d = f.cash - this.cashShown;
      const el = $('cash-delta');
      el.textContent = (d > 0 ? '+' : '') + d;
      el.style.color = d > 0 ? 'var(--green)' : 'var(--red)';
      el.style.opacity = '1';
      this.deltaT = 1.2;
      this.cashShown = f.cash;
    }
    if (this.deltaT > 0) { this.deltaT -= dt; if (this.deltaT <= 0) $('cash-delta').style.opacity = '0'; }
    this.set('cash', 'text', f.cash.toLocaleString('en-US'));
    // Weapon
    this.set('weapon-name', 'text', f.weaponName);
    this.set('weapon-tier', 'text', f.tier === 0 ? '' : f.tier === 1 ? 'TIER I' : 'TIER II');
    this.set('weapon-tier', 'class', f.tier === 0 ? 'tier hidden' : `tier t${f.tier}`);
    this.set('ammo-mag', 'text', String(f.mag));
    this.set('ammo-mag', 'class', f.mag <= Math.ceil(f.magSize * 0.25) ? 'low' : '');
    this.set('ammo-res', 'text', String(f.reserve));
    this.set('weapon-secondary', 'text', f.secondary);
    this.set('reload-hint', 'display', !f.reloading && f.mag <= Math.ceil(f.magSize * 0.25) && f.reserve > 0 ? 'block' : 'none');
    this.set('reload-hint', 'text', f.mag === 0 ? 'RELOAD  [R]' : 'LOW AMMO  [R]');
    // Crosshair: hidden while aiming, gap follows spread
    const ch = $('crosshair');
    const op = String(Math.max(0, 1 - f.adsT * 2.5) * (f.sprinting ? 0.25 : 1));
    if (ch.style.opacity !== op) ch.style.opacity = op;
    const gap = Math.round(4 + f.spreadPx);
    const gk = String(gap);
    if (this.cache.get('gap') !== gk) {
      this.cache.set('gap', gk);
      (ch.children[0] as HTMLElement).style.top = `${-gap - 9}px`;
      (ch.children[1] as HTMLElement).style.top = `${gap}px`;
      (ch.children[2] as HTMLElement).style.left = `${-gap - 9}px`;
      (ch.children[3] as HTMLElement).style.left = `${gap}px`;
    }
    // Stamina
    const st = $('stamina');
    const showSt = f.stamina < 99;
    st.style.opacity = showSt ? '1' : '0';
    st.classList.toggle('exhausted', f.exhausted);
    this.set('stamina-fill', 'width', `${Math.round(f.stamina)}%`);
    // Plate
    this.set('plate-bar', 'display', f.plateProgress > 0 ? 'block' : 'none');
    this.set('plate-fill', 'width', `${Math.round(f.plateProgress * 100)}%`);
    // Boss
    this.set('boss', 'display', f.eliteHp !== null ? 'block' : 'none');
    if (f.eliteHp !== null) this.set('boss-fill', 'width', `${Math.max(0, f.eliteHp * 100).toFixed(1)}%`);
    // Prompt
    this.set('prompt', 'display', f.prompt ? 'block' : 'none');
    if (f.prompt) this.set('prompt', 'html', f.prompt);
    // FPS
    this.set('fps', 'display', f.fps ? 'block' : 'none');
    if (f.fps) this.set('fps', 'text', f.fps);
    // Hitmarker fade
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) $('hitmarker').style.opacity = '0';
    }
    // Damage direction arcs
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      const d = this.dmgDirs[i];
      d.t -= dt;
      if (d.t <= 0) { d.el.remove(); this.dmgDirs.splice(i, 1); continue; }
      const dx = d.x - f.px, dz = d.z - f.pz;
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      d.el.style.transform = `rotate(${ang}rad)`;
      d.el.style.opacity = String(Math.min(1, d.t));
    }
    this.hitVignette = Math.max(0, this.hitVignette - dt * 0.9);
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) $('controls-hint').style.opacity = '0';
    }
    if (this.stationFlash) {
      this.stationFlash.t -= dt;
      if (this.stationFlash.t <= 0) this.stationFlash = null;
    }
  }

}
