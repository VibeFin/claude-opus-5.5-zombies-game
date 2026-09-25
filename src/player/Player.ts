// First-person player movement: acceleration-based walking, sprint, crouch with clearance checks,
// jumping, gravity and collision sliding. Pure simulation - the camera reads from it.
import { PLAYER, WORLD } from '../config';
import type { CollisionWorld } from '../world/Collision';
import type { Input } from '../core/Input';
import { canSprint, createVitals, type Vitals } from './Vitals';

export interface MoveEvents {
  footstep: boolean;
  landed: number; // impact speed on landing (0 = none)
  jumped: boolean;
}

export class Player {
  pos = { x: 0, y: 0, z: 0 };
  vel = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  height: number = PLAYER.standHeight;
  crouched = false;
  grounded = true;
  sprinting = false;
  moving = false;
  speed2d = 0;
  vitals: Vitals = createVitals();
  stepPhase = 0;
  /** Accumulated view recoil in radians (applied to pitch/yaw, recovers over time). */
  recoilPitch = 0;
  recoilYaw = 0;
  aiming = false;
  /** 0..1 aim transition, driven by weapon system. */
  adsT = 0;
  private stepDist = 0;
  private airTime = 0;

  reset(x: number, z: number, yaw: number): void {
    this.pos = { x, y: 0, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = yaw;
    this.pitch = 0;
    this.height = PLAYER.standHeight;
    this.crouched = false;
    this.grounded = true;
    this.sprinting = false;
    this.vitals = createVitals();
    this.recoilPitch = this.recoilYaw = 0;
    this.stepDist = 0;
    this.adsT = 0;
  }

  get eyeY(): number {
    return this.pos.y + this.height - PLAYER.eyeOffset;
  }

  look(dx: number, dy: number, sensitivity: number): void {
    const k = 0.0022 * sensitivity * (1 - this.adsT * 0.35);
    this.yaw -= dx * k;
    this.pitch -= dy * k;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  update(dt: number, input: Input, world: CollisionWorld, opts: { canSprintExtra: boolean; speedMult: number }): MoveEvents {
    const ev: MoveEvents = { footstep: false, landed: 0, jumped: false };
    const v = this.vitals;
    // --- Crouch toggle with ceiling clearance check ---
    if (input.consume('crouch')) {
      if (this.crouched) {
        if (!world.overlaps(this.pos.x, this.pos.y + 0.02, this.pos.z, PLAYER.radius, PLAYER.standHeight - 0.02)) this.crouched = false;
      } else this.crouched = true;
    }
    // Sprinting while crouched stands up if there is room.
    let fwd = 0, strafe = 0;
    if (input.isHeld('forward')) fwd += 1;
    if (input.isHeld('back')) fwd -= 1;
    if (input.isHeld('right')) strafe += 1;
    if (input.isHeld('left')) strafe -= 1;
    const wantSprint = input.isHeld('sprint') && fwd > 0 && opts.canSprintExtra;
    if (wantSprint && this.crouched && !world.overlaps(this.pos.x, this.pos.y + 0.02, this.pos.z, PLAYER.radius, PLAYER.standHeight - 0.02)) this.crouched = false;
    this.sprinting = wantSprint && !this.crouched && this.grounded && canSprint(v) && !this.aiming;
    if (this.sprinting && !canSprint(v)) this.sprinting = false;

    // Smooth height change; never grow into a ceiling.
    const targetH = this.crouched ? PLAYER.crouchHeight : PLAYER.standHeight;
    if (targetH > this.height) {
      const nh = Math.min(targetH, this.height + dt * 6);
      if (!world.overlaps(this.pos.x, this.pos.y + 0.02, this.pos.z, PLAYER.radius, nh - 0.02)) this.height = nh;
      else this.crouched = true;
    } else this.height = Math.max(targetH, this.height - dt * 7);

    // --- Horizontal velocity ---
    let maxSpeed = PLAYER.walkSpeed;
    if (this.crouched) maxSpeed = PLAYER.crouchSpeed;
    else if (this.sprinting) maxSpeed = PLAYER.sprintSpeed;
    if (this.aiming) maxSpeed = Math.min(maxSpeed, PLAYER.adsSpeed);
    if (fwd < 0) maxSpeed *= 0.85;
    maxSpeed *= opts.speedMult;
    const len = Math.hypot(fwd, strafe);
    let wx = 0, wz = 0;
    if (len > 0) {
      // Normalised so diagonals are not faster.
      const f = fwd / len, s = strafe / len;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // Forward is -Z at yaw 0.
      wx = -sin * f + cos * s;
      wz = -cos * f - sin * s;
    }
    const accel = this.grounded ? PLAYER.groundAccel : PLAYER.airAccel;
    const tx = wx * maxSpeed, tz = wz * maxSpeed;
    if (this.grounded && len === 0) {
      const drop = Math.max(0, 1 - PLAYER.friction * dt);
      this.vel.x *= drop;
      this.vel.z *= drop;
    }
    const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 0 && (len > 0 || this.grounded)) {
      const step = Math.min(dl, accel * dt);
      this.vel.x += (dvx / dl) * step;
      this.vel.z += (dvz / dl) * step;
    }

    // --- Jump / gravity ---
    if (input.consume('jump') && this.grounded && !this.crouched) {
      this.vel.y = PLAYER.jumpVelocity;
      this.grounded = false;
      ev.jumped = true;
    }
    this.vel.y -= WORLD.gravity * dt;
    if (this.vel.y < -30) this.vel.y = -30;

    const prevVy = this.vel.y;
    const px = this.pos.x, pz = this.pos.z;
    const res = world.move(this.pos, PLAYER.radius, this.height, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt,
      this.grounded ? PLAYER.stepHeight : 0.05, this.grounded);
    if (res.blockedX) this.vel.x = 0;
    if (res.blockedZ) this.vel.z = 0;
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    if (res.grounded) {
      if (!this.grounded && this.airTime > 0.15) ev.landed = -prevVy;
      this.vel.y = 0;
      this.airTime = 0;
    } else this.airTime += dt;
    this.grounded = res.grounded;

    // Hard clamp to playable bounds (walls already block, this is a safety net).
    this.pos.x = Math.max(WORLD.minX + 1, Math.min(WORLD.maxX - 1, this.pos.x));
    this.pos.z = Math.max(WORLD.minZ + 1, Math.min(WORLD.maxZ - 1, this.pos.z));

    const moved = Math.hypot(this.pos.x - px, this.pos.z - pz);
    this.speed2d = moved / dt;
    this.moving = this.speed2d > 0.5 && this.grounded;
    if (this.moving) {
      this.stepDist += moved;
      this.stepPhase += moved * (this.sprinting ? 1.25 : 1.6);
      const stride = this.sprinting ? 2.3 : this.crouched ? 1.3 : 1.85;
      if (this.stepDist >= stride) {
        this.stepDist -= stride;
        ev.footstep = !this.crouched || this.stepDist > 0; // crouch steps are quieter but still audible
      }
    }
    return ev;
  }

  /** Pushes the player out of zombie bodies horizontally (zombies body-block). */
  pushOut(x: number, z: number, r: number, world: CollisionWorld): void {
    const dx = this.pos.x - x, dz = this.pos.z - z;
    const d = Math.hypot(dx, dz);
    const min = r + PLAYER.radius;
    if (d >= min || d < 1e-4) return;
    const push = (min - d) * 0.5;
    world.move(this.pos, PLAYER.radius, this.height, (dx / d) * push, 0, (dz / d) * push, 0, false);
  }

  applyRecoil(pitchDeg: number, yawDeg: number): void {
    this.recoilPitch += (pitchDeg * Math.PI) / 180;
    this.recoilYaw += (yawDeg * Math.PI) / 180;
  }

  recoverRecoil(dt: number, rateDeg: number): void {
    const r = (rateDeg * Math.PI) / 180 * dt;
    // Recoil is applied directly to aim, then partially recovered back down.
    const rp = Math.min(this.recoilPitch, r);
    this.recoilPitch -= rp;
    this.pitch -= rp * 0.6;
    const ry = Math.sign(this.recoilYaw) * Math.min(Math.abs(this.recoilYaw), r * 0.5);
    this.recoilYaw -= ry;
  }

  kickView(pitchRad: number, yawRad: number): void {
    this.pitch = Math.min(Math.PI / 2 - 0.02, this.pitch + pitchRad);
    this.yaw += yawRad;
  }
}
