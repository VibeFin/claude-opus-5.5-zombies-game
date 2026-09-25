import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../src/config';
import {
  applyUpgrade, cancelReload, canFire, createWeapon, damageAtRange, effectiveStats, fire, startReload, updateWeapon,
} from '../src/weapons/WeaponState';

describe('weapon ammunition and reload rules', () => {
  it('consumes one round per shot and respects the fire cadence', () => {
    const w = createWeapon('rifle');
    expect(fire(w)).toBe(true);
    expect(w.mag).toBe(29);
    expect(fire(w)).toBe(false); // still cooling down
    updateWeapon(w, effectiveStats('rifle', 0).fireInterval + 1e-6);
    expect(fire(w)).toBe(true);
    expect(w.mag).toBe(28);
  });

  it('cannot fire with an empty magazine', () => {
    const w = createWeapon('pistol');
    w.mag = 0;
    expect(canFire(w)).toBe(false);
    expect(fire(w)).toBe(false);
  });

  it('magazine reload transfers ammo exactly once, only when complete', () => {
    const w = createWeapon('rifle');
    w.mag = 5;
    const reserve = w.reserve;
    expect(startReload(w)).toBe(true);
    expect(startReload(w)).toBe(false); // no double start
    updateWeapon(w, 1.0);
    expect(w.mag).toBe(5);
    expect(canFire(w)).toBe(false); // magazine reloads block firing
    updateWeapon(w, 5); // big step completes it
    expect(w.mag).toBe(30);
    expect(w.reserve).toBe(reserve - 25);
    expect(w.reloadPhase).toBe('none');
    updateWeapon(w, 5); // no second transfer
    expect(w.mag).toBe(30);
    expect(w.reserve).toBe(reserve - 25);
  });

  it('cancelled magazine reload (weapon switch) transfers nothing and leaves the weapon usable', () => {
    const w = createWeapon('rifle');
    w.mag = 3;
    const reserve = w.reserve;
    startReload(w);
    updateWeapon(w, 1.5);
    cancelReload(w);
    expect(w.mag).toBe(3);
    expect(w.reserve).toBe(reserve);
    expect(w.reloadPhase).toBe('none');
    expect(canFire(w)).toBe(true);
    expect(startReload(w)).toBe(true);
  });

  it('reload is limited by reserve ammunition', () => {
    const w = createWeapon('pistol');
    w.mag = 0;
    w.reserve = 4;
    startReload(w);
    updateWeapon(w, 10);
    expect(w.mag).toBe(4);
    expect(w.reserve).toBe(0);
    expect(startReload(w)).toBe(false);
  });

  it('shotgun reloads shell by shell and firing interrupts it while keeping inserted shells', () => {
    const w = createWeapon('shotgun');
    const sh = WEAPONS.shotgun.shellReload!;
    w.mag = 2;
    const reserve = w.reserve;
    startReload(w);
    updateWeapon(w, sh.start + sh.perShell * 2 + 0.01);
    expect(w.mag).toBe(4);
    expect(w.reserve).toBe(reserve - 2);
    w.cooldown = 0;
    expect(canFire(w)).toBe(true);
    expect(fire(w)).toBe(true);
    expect(w.reloadPhase).toBe('none');
    expect(w.mag).toBe(3);
    updateWeapon(w, 10);
    expect(w.mag).toBe(3); // no phantom shells after interruption
  });

  it('shell reload completes to full without exceeding capacity even with a huge delta', () => {
    const w = createWeapon('shotgun');
    w.mag = 0;
    startReload(w);
    for (let i = 0; i < 10; i++) updateWeapon(w, 1);
    expect(w.mag).toBe(effectiveStats('shotgun', 0).magSize);
    expect(w.reloadPhase).toBe('none');
  });

  it('upgrades increase damage and magazine size and refill ammo', () => {
    const w = createWeapon('rifle');
    w.mag = 1;
    const base = effectiveStats('rifle', 0);
    expect(applyUpgrade(w)).toBe(true);
    const t1 = effectiveStats('rifle', 1);
    expect(t1.damage).toBeGreaterThan(base.damage);
    expect(t1.magSize).toBeGreaterThan(base.magSize);
    expect(w.mag).toBe(t1.magSize);
    expect(applyUpgrade(w)).toBe(true);
    expect(applyUpgrade(w)).toBe(false); // max tier
  });

  it('damage falls off with range', () => {
    expect(damageAtRange('rifle', 100, 5)).toBe(100);
    expect(damageAtRange('rifle', 100, 500)).toBeCloseTo(100 * WEAPONS.rifle.minDamageMult);
    expect(damageAtRange('shotgun', 100, 15)).toBeLessThan(100);
  });
});
