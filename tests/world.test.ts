import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../src/world/Collision';
import { NavGrid } from '../src/world/NavGrid';

function room(): CollisionWorld {
  const w = new CollisionWorld(-20, -20, 20, 20);
  // A wall along X at z=0 from x=-10 to x=5 (gap at x 5..10)
  w.add(-10, 0, -0.2, 5, 3, 0.2);
  // A low curb
  w.add(-3, 0, 5, 3, 0.15, 7, { floor: true });
  // A ceiling beam at 1.3m
  w.add(8, 1.3, -5, 12, 2, 5);
  return w;
}

describe('collision', () => {
  it('blocks movement through walls and slides along them', () => {
    const w = room();
    const p = { x: 0, y: 0, z: 2 };
    const r = w.move(p, 0.3, 1.75, 0.5, 0, -5, 0.45, true);
    expect(p.z).toBeGreaterThan(0.2);
    expect(r.blockedZ).toBe(true);
    expect(p.x).toBeCloseTo(0.5); // tangential motion preserved
  });

  it('steps up small curbs while grounded', () => {
    const w = room();
    const p = { x: 0, y: 0, z: 4 };
    for (let i = 0; i < 20; i++) w.move(p, 0.3, 1.75, 0, -0.1, 0.1, 0.45, true);
    expect(p.y).toBeCloseTo(0.15);
  });

  it('detects ceiling clearance for crouching', () => {
    const w = room();
    expect(w.overlaps(10, 0, 0, 0.3, 1.75)).toBe(true);
    expect(w.overlaps(10, 0, 0, 0.3, 1.1)).toBe(false);
  });

  it('rays stop at the first solid surface and report its normal', () => {
    const w = room();
    const h = w.raycast(0, 1.5, 5, 0, 0, -1, 50)!;
    expect(h).not.toBeNull();
    expect(h.dist).toBeCloseTo(4.8);
    expect(h.nz).toBe(1);
    expect(w.segmentBlocked(0, 1.5, 5, 0, 1.5, -5)).toBe(true);
    expect(w.segmentBlocked(7, 1.5, 5, 7, 1.5, -5)).toBe(false); // through the gap
  });

  it('non-solid colliders (fences) block movement but not bullets', () => {
    const w = new CollisionWorld(-20, -20, 20, 20);
    w.add(-5, 0, -0.05, 5, 2.6, 0.05, { solid: false });
    expect(w.raycast(0, 1, 3, 0, 0, -1, 10)).toBeNull();
    const p = { x: 0, y: 0, z: 2 };
    w.move(p, 0.3, 1.75, 0, 0, -4, 0.45, true);
    expect(p.z).toBeGreaterThan(0.05);
  });
});

describe('navigation flow field', () => {
  it('routes around walls instead of through them', () => {
    const w = room();
    const nav = new NavGrid(-20, -20, 20, 20);
    nav.build(w);
    nav.computeFlow(0, -5); // target behind the wall
    const out = { x: 0, z: 0 };
    // Walk an agent from (0, 5) following the field; it must pass through the gap at x 5..10.
    let x = 0.5, z = 5.5, passedGap = false;
    for (let i = 0; i < 200; i++) {
      if (!nav.flowDir(x, z, out)) break;
      x += out.x * 0.4;
      z += out.z * 0.4;
      if (Math.abs(z) < 0.5) { expect(x).toBeGreaterThan(5); passedGap = true; }
      if (Math.hypot(x - 0, z + 5) < 1) break;
    }
    expect(passedGap).toBe(true);
    expect(Math.hypot(x, z + 5)).toBeLessThan(1.5);
  });

  it('marks unreachable areas as infinite distance', () => {
    const w = new CollisionWorld(-20, -20, 20, 20);
    // Sealed box
    w.add(-6, 0, -6, 6, 3, -5.8); w.add(-6, 0, 5.8, 6, 3, 6); w.add(-6, 0, -6, -5.8, 3, 6); w.add(5.8, 0, -6, 6, 3, 6);
    const nav = new NavGrid(-20, -20, 20, 20);
    nav.build(w);
    nav.computeFlow(15, 15);
    expect(nav.pathDist(0.5, 0.5)).toBe(Infinity);
    expect(isFinite(nav.pathDist(-15, -15))).toBe(true);
  });
});
