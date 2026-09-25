// Pure, testable helpers for mobile controls and mobile performance defaults.
// No DOM access here except through guarded feature detection so unit tests can import safely.

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if ('ontouchstart' in window) return true;
  if (navigator.maxTouchPoints > 0) return true;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Normalise a joystick deflection (px) into a -1..1 analog vector. Screen-up is forward (+y). */
export function normalizeJoystick(dx: number, dy: number, radius: number): { x: number; y: number } {
  if (!(radius > 0)) return { x: 0, y: 0 };
  let x = dx / radius;
  let y = -dy / radius;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  if (!isFinite(x) || !isFinite(y)) return { x: 0, y: 0 };
  // Small dead zone so resting thumbs do not drift.
  if (Math.hypot(x, y) < 0.12) return { x: 0, y: 0 };
  // Normalise -0 to +0 for clean equality.
  if (x === 0) x = 0;
  if (y === 0) y = 0;
  return { x, y };
}

export interface MobileQuality {
  quality: 'low' | 'medium' | 'high';
  renderScale: number;
}

/** First-run defaults for touch devices: favour frame rate over pixels. */
export function defaultMobileQuality(): MobileQuality {
  let dpr = 1;
  try {
    dpr = window.devicePixelRatio || 1;
  } catch { /* ssr */ }
  // High-dpi phones get a lower render scale; the screen is small so it still looks sharp.
  if (dpr >= 3) return { quality: 'low', renderScale: 0.7 };
  if (dpr >= 2) return { quality: 'medium', renderScale: 0.75 };
  return { quality: 'medium', renderScale: 0.85 };
}

/** Step the render scale toward 60fps targets. Pure so it can be unit tested. */
export function adaptRenderScale(current: number, avgFps: number): number {
  if (!isFinite(current) || !isFinite(avgFps)) return current;
  if (avgFps < 24 && current > 0.5) return Math.max(0.5, +(current - 0.15).toFixed(2));
  if (avgFps < 32 && current > 0.5) return Math.max(0.5, +(current - 0.1).toFixed(2));
  if (avgFps > 52 && current < 1) return Math.min(1, +(current + 0.05).toFixed(2));
  return current;
}

/** Touch look needs a higher gain than mouse deltas (fingers travel fewer px). */
export function touchLookGain(): number {
  return 2.4;
}

/**
 * Look delta for a drag from (lastX, lastY) to (x, y), in the same units as
 * mouse-look deltas so it can feed Input.addTouchLook directly.
 * Pure so the aim-while-firing math can be unit tested.
 */
export function dragLookDelta(lastX: number, lastY: number, x: number, y: number, gain = touchLookGain()): { dx: number; dy: number } {
  if (!isFinite(lastX) || !isFinite(lastY) || !isFinite(x) || !isFinite(y) || !isFinite(gain)) {
    return { dx: 0, dy: 0 };
  }
  return { dx: (x - lastX) * gain, dy: (y - lastY) * gain };
}
