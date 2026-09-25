import { describe, expect, it } from 'vitest';
import { adaptRenderScale, defaultMobileQuality, dragLookDelta, normalizeJoystick, touchLookGain } from '../src/ui/touchUtils';

describe('touch joystick normalisation', () => {
  it('maps screen-up to forward and clamps to unit length', () => {
    expect(normalizeJoystick(0, -52, 52)).toEqual({ x: 0, y: 1 });
    expect(normalizeJoystick(52, 0, 52)).toEqual({ x: 1, y: 0 });
    const v = normalizeJoystick(100, -100, 52);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 5);
  });

  it('has a dead zone around center', () => {
    expect(normalizeJoystick(2, -2, 52)).toEqual({ x: 0, y: 0 });
  });

  it('rejects bad radius', () => {
    expect(normalizeJoystick(10, 10, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('mobile quality defaults', () => {
  it('favours frame rate (scale <= 0.85)', () => {
    const q = defaultMobileQuality();
    expect(q.renderScale).toBeLessThanOrEqual(0.85);
    expect(['low', 'medium', 'high']).toContain(q.quality);
  });

  it('steps render scale toward 60fps', () => {
    expect(adaptRenderScale(1, 20)).toBeLessThan(1);
    expect(adaptRenderScale(0.5, 20)).toBe(0.5); // floor
    expect(adaptRenderScale(0.7, 60)).toBeGreaterThan(0.7);
    expect(adaptRenderScale(1, 60)).toBe(1); // ceiling
    expect(adaptRenderScale(0.8, 40)).toBe(0.8); // stable band
  });
});

describe('fire-button drag aim', () => {
  it('scales finger travel by the touch look gain', () => {
    const g = touchLookGain();
    expect(dragLookDelta(100, 100, 150, 80)).toEqual({ dx: 50 * g, dy: -20 * g });
  });

  it('returns zero for no movement', () => {
    expect(dragLookDelta(10, 10, 10, 10)).toEqual({ dx: 0, dy: 0 });
  });

  it('rejects non-finite input', () => {
    expect(dragLookDelta(NaN, 0, 1, 1)).toEqual({ dx: 0, dy: 0 });
    expect(dragLookDelta(0, 0, Infinity, 1)).toEqual({ dx: 0, dy: 0 });
  });
});
