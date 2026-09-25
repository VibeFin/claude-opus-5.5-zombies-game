// On-screen touch controls: left virtual joystick, right-side look area and
// hold/tap action buttons. Feeds the same Input paths as keyboard + mouse.
import type { Input } from '../core/Input';
import { dragLookDelta, normalizeJoystick, touchLookGain } from './touchUtils';

export interface TouchCallbacks {
  onPause(): void;
  onBuy(idx: number): void;
}

const BTN = 'touch-btn';

function el(cls: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.innerHTML = label;
  b.setAttribute('aria-label', label.replace(/<[^>]*>/g, ''));
  return b;
}

export class TouchControls {
  readonly root: HTMLElement;
  readonly isTouch: boolean;
  private input: Input;
  private cb: TouchCallbacks;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private stickId: number | null = null;
  private stickCx = 0;
  private stickCy = 0;
  private knob: HTMLElement;
  private base: HTMLElement;
  private interactBtn: HTMLButtonElement;
  private adsBtn: HTMLButtonElement;
  private sprintBtn: HTMLButtonElement;
  private visible = false;

  constructor(input: Input, cb: TouchCallbacks) {
    this.input = input;
    this.cb = cb;
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.root = document.getElementById('touch-ui')!;
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.id = 'touch-ui';
      document.body.appendChild(this.root);
    }
    this.root.classList.toggle('hidden', true);
    this.root.innerHTML = '';

    // Look layer (covers the screen, sits below buttons/joystick).
    const look = document.createElement('div');
    look.id = 'touch-look';
    this.root.appendChild(look);
    look.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      try { look.setPointerCapture(e.pointerId); } catch { /* noop */ }
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = (e.clientX - this.lookX) * touchLookGain();
      const dy = (e.clientY - this.lookY) * touchLookGain();
      this.lookX = e.clientX;
      this.lookY = e.clientY;
      this.input.addTouchLook(dx, dy);
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    // Joystick.
    const stick = document.createElement('div');
    stick.id = 'touch-stick';
    this.base = document.createElement('div');
    this.base.id = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.id = 'stick-knob';
    this.base.appendChild(this.knob);
    stick.appendChild(this.base);
    const zone = document.createElement('div');
    zone.id = 'stick-zone';
    zone.appendChild(stick);
    this.root.appendChild(zone);

    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      const r = this.base.getBoundingClientRect();
      this.stickCx = r.left + r.width / 2;
      this.stickCy = r.top + r.height / 2;
      try { zone.setPointerCapture(e.pointerId); } catch { /* noop */ }
      this.moveStick(e.clientX, e.clientY);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      this.moveStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.setTouchMove(0, 0);
      this.knob.style.transform = 'translate(0px, 0px)';
      this.base.classList.remove('sprint');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    // Buttons.
    const right = document.createElement('div');
    right.id = 'touch-right';
    const fire = el(`${BTN} fire`, 'FIRE');
    this.adsBtn = el(`${BTN} ads`, 'ADS');
    const reload = el(`${BTN} small`, 'R');
    const jump = el(`${BTN} small`, 'JUMP');
    const crouch = el(`${BTN} small`, 'CRCH');
    this.interactBtn = el(`${BTN} interact hidden`, 'USE');
    right.append(fire, this.adsBtn, reload, jump, crouch, this.interactBtn);
    this.root.appendChild(right);

    const left = document.createElement('div');
    left.id = 'touch-left';
    const grenade = el(`${BTN} small`, 'FRAG');
    const plate = el(`${BTN} small`, 'PLATE');
    const weapon = el(`${BTN} small`, 'WPN');
    this.sprintBtn = el(`${BTN} small`, 'SPRINT');
    left.append(grenade, plate, weapon, this.sprintBtn);
    this.root.appendChild(left);

    const top = document.createElement('div');
    top.id = 'touch-top';
    const map = el(`${BTN} tiny`, 'MAP');
    const pause = el(`${BTN} tiny`, 'II');
    top.append(map, pause);
    this.root.appendChild(top);

    // Hold bindings. FIRE doubles as a look pad while held: with the left
    // thumb on the stick and the right thumb firing, no finger is free for
    // the look area, so dragging the firing thumb steers aim (standard
    // mobile-FPS behaviour). The button holds pointer capture, so drags
    // keep steering even after sliding off its bounds.
    this.hold(fire, (d) => this.input.setTouchFire(d), true);
    this.tap(reload, () => this.input.press('reload'));
    this.tap(jump, () => this.input.press('jump'));
    this.tap(crouch, () => this.input.press('crouch'));
    this.tap(this.interactBtn, () => this.input.press('interact'));
    this.tap(grenade, () => this.input.press('grenade'));
    this.tap(plate, () => this.input.press('plate'));
    this.tap(map, () => this.input.press('map'));
    pause.addEventListener('pointerdown', (e) => { e.preventDefault(); this.cb.onPause(); });
    weapon.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // Cycle to the other slot; WeaponSystem treats wheel input as "switch".
      this.input.wheel += 1;
      weapon.classList.add('on');
      window.setTimeout(() => weapon.classList.remove('on'), 120);
    });
    // ADS toggle (hold-to-aim is awkward while firing with the same thumb).
    this.adsBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const on = !this.input.aimHeld;
      this.input.setTouchAim(on);
      this.adsBtn.classList.toggle('on', on);
    });
    this.sprintBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const on = this.input.toggleHold('sprint');
      this.sprintBtn.classList.toggle('on', on);
    });

    // Station purchases via tap (delegated; station list re-renders).
    // Document-level capture so taps reach here even though the station
    // panel lives in the HUD layer above the touch look surface.
    document.addEventListener('pointerdown', (e) => {
      const item = (e.target as HTMLElement).closest?.('.station-item');
      if (!item) return;
      const items = [...document.querySelectorAll('#station-items .station-item')];
      const idx = items.indexOf(item);
      if (idx >= 0) { e.preventDefault(); this.cb.onBuy(idx); }
    });
    // Tapping the open tactical map closes it (the MAP button sits below it).
    document.getElementById('tacmap')?.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      this.input.press('map');
    });

    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private moveStick(cx: number, cy: number): void {
    const R = 52;
    const v = normalizeJoystick(cx - this.stickCx, cy - this.stickCy, R);
    this.input.setTouchMove(v.x, v.y);
    this.knob.style.transform = `translate(${v.x * R * 0.6}px, ${-v.y * R * 0.6}px)`;
    this.base.classList.toggle('sprint', v.y > 0.85);
  }

  private hold(btn: HTMLButtonElement, fn: (down: boolean) => void, steerAim = false): void {
    let pid: number | null = null;
    let lx = 0, ly = 0;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pid = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      try { btn.setPointerCapture(e.pointerId); } catch { /* noop */ }
      fn(true);
      btn.classList.add('on');
    });
    btn.addEventListener('pointermove', (e) => {
      if (!steerAim || e.pointerId !== pid) return;
      const d = dragLookDelta(lx, ly, e.clientX, e.clientY);
      lx = e.clientX;
      ly = e.clientY;
      if (d.dx !== 0 || d.dy !== 0) this.input.addTouchLook(d.dx, d.dy);
    });
    // Guarded by pointer id so a second finger tapping the same button
    // (or capture loss for another pointer) cannot release the held one.
    const off = (e: PointerEvent) => {
      if (pid !== null && e.pointerId !== pid) return;
      pid = null;
      fn(false);
      btn.classList.remove('on');
    };
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('lostpointercapture', off);
  }

  private tap(btn: HTMLButtonElement, fn: () => void): void {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
      btn.classList.add('on');
      window.setTimeout(() => btn.classList.remove('on'), 120);
    });
  }

  /** Show only on touch devices while playing. */
  setVisible(v: boolean): void {
    this.visible = v && this.isTouch;
    this.root.classList.toggle('hidden', !this.visible);
    document.body.classList.toggle('touch', this.isTouch && v);
    if (!this.visible) {
      this.input.setTouchMove(0, 0);
      this.input.setTouchFire(false);
      this.input.setTouchAim(false);
      this.adsBtn?.classList.remove('on');
    } else {
      this.input.setTouchMode(true);
    }
  }

  setInteractAvailable(has: boolean, label = 'USE'): void {
    this.interactBtn.classList.toggle('hidden', !this.visible || !has);
    if (has) this.interactBtn.textContent = label;
  }

  syncAim(): void {
    if (!this.input.aimHeld) this.adsBtn?.classList.remove('on');
  }

  get shown(): boolean {
    return this.visible;
  }
}
