// Keyboard / mouse input with pointer lock. Listeners are registered exactly once.
// Edge-triggered presses are queued and consumed by the simulation.

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'crouch' | 'reload' | 'interact'
  | 'weapon1' | 'weapon2' | 'grenade' | 'plate' | 'map' | 'buy3' | 'buy4' | 'buy5' | 'buy6' | 'buy7';

const KEYMAP: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump', KeyC: 'crouch', ControlLeft: 'crouch', KeyR: 'reload', KeyE: 'interact', KeyF: 'interact',
  Digit1: 'weapon1', Digit2: 'weapon2', KeyG: 'grenade', KeyQ: 'plate', KeyM: 'map', Tab: 'map',
  Digit3: 'buy3', Digit4: 'buy4', Digit5: 'buy5', Digit6: 'buy6', Digit7: 'buy7',
};

export class Input {
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  fireHeld = false;
  firePressed = false;
  aimHeld = false;
  /** After resuming, the trigger must be released before firing is allowed again. */
  private fireBlocked = false;
  /** Physical left-button state tracked regardless of lock, used to decide trigger blocking on resume. */
  private leftDown = false;
  locked = false;
  /** Development automation: behave as if pointer-locked (no real lock available). */
  virtualLock = false;
  /** Touch controls active (mobile): no pointer lock required. */
  touchMode = false;
  /** Analog move vector from the virtual joystick: x = strafe (-1..1), y = forward (-1..1). */
  touchMove = { x: 0, y: 0 };
  onLockChange: (locked: boolean) => void = () => {};
  onFocusLost: () => void = () => {};
  onEscape: () => void = () => {};

  constructor(private el: HTMLElement) {
    document.addEventListener('keydown', this.keyDown);
    document.addEventListener('keyup', this.keyUp);
    document.addEventListener('mousemove', this.mouseMove);
    document.addEventListener('mousedown', this.mouseDown);
    document.addEventListener('mouseup', this.mouseUp);
    document.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    document.addEventListener('pointerlockchange', this.lockChange);
    document.addEventListener('pointerlockerror', () => this.onLockChange(false));
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.blur(); });
  }

  get active(): boolean {
    return this.locked || this.virtualLock || this.touchMode;
  }

  /** Touch device drives the game without pointer lock. */
  setTouchMode(on: boolean): void {
    this.touchMode = on;
    if (on) this.fireBlocked = false;
  }

  /** Analog joystick state, clamped to unit length. */
  setTouchMove(x: number, y: number): void {
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.touchMove.x = x;
    this.touchMove.y = y;
  }

  /** Combined keyboard + joystick axis: x = strafe, y = forward. */
  moveAxis(): { x: number; y: number } {
    let fwd = 0, strafe = 0;
    if (this.held.has('forward')) fwd += 1;
    if (this.held.has('back')) fwd -= 1;
    if (this.held.has('right')) strafe += 1;
    if (this.held.has('left')) strafe -= 1;
    fwd += this.touchMove.y;
    strafe += this.touchMove.x;
    return { x: Math.max(-1, Math.min(1, strafe)), y: Math.max(-1, Math.min(1, fwd)) };
  }

  /** Touch look feeds the same per-frame deltas as the mouse. */
  addTouchLook(dx: number, dy: number): void {
    if (!this.active) return;
    this.mouseDX += Math.max(-300, Math.min(300, dx));
    this.mouseDY += Math.max(-300, Math.min(300, dy));
  }

  setTouchFire(down: boolean): void {
    if (down) {
      if (!this.active) return;
      this.fireHeld = true;
      if (!this.fireBlocked) this.firePressed = true;
    } else {
      this.fireHeld = false;
      this.fireBlocked = false;
    }
  }

  setTouchAim(down: boolean): void {
    this.aimHeld = down && this.active;
  }

  /** Edge-triggered press from a touch button. */
  press(a: Action): void {
    if (!this.active) return;
    if (!this.held.has(a)) this.pressed.add(a);
    this.held.add(a);
  }

  release(a: Action): void {
    this.held.delete(a);
  }

  /** Toggle a held action (sprint lock, crouch handled via press). */
  toggleHold(a: Action): boolean {
    if (!this.active) return false;
    if (this.held.has(a)) { this.held.delete(a); return false; }
    this.pressed.add(a);
    this.held.add(a);
    return true;
  }

  async requestLock(): Promise<boolean> {
    if (this.virtualLock || this.touchMode) return true;
    try {
      const r = this.el.requestPointerLock({ unadjustedMovement: true } as never) as unknown as Promise<void> | undefined;
      if (r && typeof (r as Promise<void>).then === 'function') await r;
      return true;
    } catch {
      // Some platforms reject unadjustedMovement; retry without options.
      try {
        const r2 = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
        if (r2 && typeof (r2 as Promise<void>).then === 'function') await r2;
        return true;
      } catch {
        return false;
      }
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** Consumes an edge-triggered press. */
  consume(a: Action): boolean {
    if (this.pressed.has(a)) {
      this.pressed.delete(a);
      return true;
    }
    return false;
  }

  consumeFire(): boolean {
    const p = this.firePressed;
    this.firePressed = false;
    return p;
  }

  get canFire(): boolean {
    return this.fireHeld && !this.fireBlocked;
  }

  /** Clears all held and queued input (focus loss, pause, restart). */
  clear(blockFire = true): void {
    this.held.clear();
    this.pressed.clear();
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.mouseDX = this.mouseDY = this.wheel = 0;
    this.fireHeld = this.firePressed = this.aimHeld = false;
    this.fireBlocked = blockFire;
  }

  /** Mouse look is consumed every rendered frame. */
  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** Edge-triggered presses are only cleared once a simulation step has had the chance to read them. */
  endStep(): void {
    this.wheel = 0;
    this.pressed.clear();
    this.firePressed = false;
  }

  // Dev automation helpers: feed synthetic events through the same paths.
  simulateKey(code: string, down: boolean): void {
    const a = KEYMAP[code];
    if (!a) return;
    if (down) { if (!this.held.has(a)) this.pressed.add(a); this.held.add(a); } else this.held.delete(a);
  }
  simulateMouse(button: number, down: boolean): void {
    this.handleButton(button, down);
  }
  simulateLook(dx: number, dy: number): void {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  private keyDown = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { this.onEscape(); return; }
    const a = KEYMAP[e.code];
    if (!a) return;
    if (this.active) e.preventDefault();
    if (!this.active && a !== 'map') return;
    if (!e.repeat && !this.held.has(a)) this.pressed.add(a);
    this.held.add(a);
  };

  private keyUp = (e: KeyboardEvent) => {
    const a = KEYMAP[e.code];
    if (a) this.held.delete(a);
  };

  private mouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    // Clamp spikes that some browsers emit right after locking.
    const dx = Math.max(-300, Math.min(300, e.movementX));
    const dy = Math.max(-300, Math.min(300, e.movementY));
    this.mouseDX += dx;
    this.mouseDY += dy;
  };

  private handleButton(button: number, down: boolean) {
    if (button === 0) {
      if (down) {
        if (!this.active) return;
        this.fireHeld = true;
        if (!this.fireBlocked) this.firePressed = true;
      } else {
        this.fireHeld = false;
        this.fireBlocked = false;
      }
    } else if (button === 2) {
      this.aimHeld = down && this.active;
    }
  }

  private mouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.leftDown = true;
    if (!this.active) return;
    this.handleButton(e.button, true);
  };

  private mouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.leftDown = false;
    this.handleButton(e.button, false);
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.active) return;
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  private lockChange = () => {
    const was = this.locked;
    this.locked = document.pointerLockElement === this.el;
    if (this.locked !== was) {
      // On resume only block the trigger if the resume click is still being held.
      this.clear(this.locked ? this.leftDown : true);
      this.onLockChange(this.locked);
    }
  };

  private blur = () => {
    this.clear();
    this.onFocusLost();
  };
}
