// Pure contract state machines. Each completion event fires exactly once.
import { MISSION } from '../config';

export type DefenseStatus = 'inactive' | 'active' | 'complete';

export class DefenseContract {
  status: DefenseStatus = 'inactive';
  progress = 0;
  inZone = false;
  private rewarded = false;

  activate(): boolean {
    if (this.status !== 'inactive') return false;
    this.status = 'active';
    return true;
  }

  /** Returns true exactly once, on the step the hold completes. */
  update(dt: number, playerInZone: boolean): boolean {
    this.inZone = playerInZone;
    if (this.status !== 'active') return false;
    if (playerInZone) this.progress += dt / MISSION.defenseHoldTime;
    else this.progress = Math.max(0, this.progress - MISSION.defenseDecay * dt);
    if (this.progress >= 1) {
      this.progress = 1;
      this.status = 'complete';
      if (!this.rewarded) {
        this.rewarded = true;
        return true;
      }
    }
    return false;
  }
}

export type HuntStatus = 'tracking' | 'complete';

export class HuntContract {
  status: HuntStatus = 'tracking';
  private rewarded = false;

  /** Returns true only for the first kill notification. */
  onTargetKilled(): boolean {
    if (this.rewarded) return false;
    this.rewarded = true;
    this.status = 'complete';
    return true;
  }
}

export function contractsComplete(d: DefenseContract, h: HuntContract): boolean {
  return d.status === 'complete' && h.status === 'complete';
}
