/**
 * Lift contract — set the right load on the right pad, the right way round.
 *
 * The crane's answer to `sim/job/`, and deliberately a separate file rather
 * than a generalisation of it. A grading job scores a FIELD: every cell in
 * bounds, continuously, against a target height. A lift job scores a handful
 * of discrete placements. Forcing one abstraction over both would produce
 * something that describes neither.
 *
 * Bearing counts as well as position. A beam dropped across its pad instead of
 * along it is not placed, and that is the whole reason slew control has to be
 * something you can be good at rather than something you hold down.
 */

import type { Payload, PayloadKind } from './Payload';

export interface LiftTarget {
  readonly id: string;
  readonly label: string;
  /** Where the load's centre must end up. */
  readonly x: number;
  readonly z: number;
  /** How far off centre still counts, metres. */
  readonly radius: number;
  /** Bearing the load must lie on, radians. */
  readonly yaw: number;
  /** How far off that bearing still counts, radians. */
  readonly yawTolerance: number;
  /** Which kind of load belongs here. */
  readonly accepts: PayloadKind;
}

export interface TargetStatus {
  readonly target: LiftTarget;
  /** The load sitting on it, or null. */
  readonly payloadId: string | null;
  readonly placed: boolean;
  /** Metres off centre for the nearest candidate load, or null if none is near. */
  readonly distance: number | null;
  /** Radians off bearing for that same load, or null. */
  readonly yawError: number | null;
}

export interface LiftProgress {
  readonly placed: number;
  readonly total: number;
  readonly statuses: readonly TargetStatus[];
}

export interface LiftResult {
  readonly elapsed: number;
  readonly underPar: boolean;
  /** Times a load was dropped from height rather than set down. */
  readonly dropped: number;
}

/** Smallest signed difference between two bearings, radians. */
export function angleDelta(a: number, b: number): number {
  const twoPi = Math.PI * 2;
  let d = (a - b) % twoPi;
  if (d > Math.PI) d -= twoPi;
  if (d < -Math.PI) d += twoPi;
  return d;
}

/**
 * A load lying along its own axis is the same load turned end for end.
 *
 * Without this, half of every correctly-placed beam would score zero for being
 * 180° out — a distinction no rigger would make and no player would forgive.
 */
function bearingError(payloadYaw: number, targetYaw: number): number {
  const direct = Math.abs(angleDelta(payloadYaw, targetYaw));
  const flipped = Math.abs(angleDelta(payloadYaw + Math.PI, targetYaw));
  return Math.min(direct, flipped);
}

export function evaluateLift(
  targets: readonly LiftTarget[],
  payloads: readonly Payload[],
): LiftProgress {
  // One load cannot satisfy two pads, so claim as we go.
  const claimed = new Set<string>();
  const statuses: TargetStatus[] = [];

  for (const target of targets) {
    let best: { payload: Payload; distance: number; yawError: number } | null = null;

    for (const payload of payloads) {
      if (claimed.has(payload.id)) continue;
      if (payload.spec.kind !== target.accepts) continue;

      const dx = payload.position.x - target.x;
      const dz = payload.position.z - target.z;
      const distance = Math.hypot(dx, dz);
      if (best !== null && distance >= best.distance) continue;
      best = { payload, distance, yawError: bearingError(payload.yaw, target.yaw) };
    }

    // Hanging on the hook is not set down, however well it is lined up.
    const placed =
      best !== null &&
      best.payload.grounded &&
      !best.payload.hooked &&
      best.distance <= target.radius &&
      best.yawError <= target.yawTolerance;

    if (placed && best) claimed.add(best.payload.id);

    statuses.push({
      target,
      payloadId: placed && best ? best.payload.id : null,
      placed,
      distance: best ? best.distance : null,
      yawError: best ? best.yawError : null,
    });
  }

  return {
    placed: statuses.filter((s) => s.placed).length,
    total: targets.length,
    statuses,
  };
}

/**
 * The live contract: progress, the clock, and whether it is finished.
 *
 * Completion latches. A load that scores and is then knocked off its pad has
 * still been placed once, and re-opening a finished job would read as the game
 * taking something back.
 */
export class LiftRunner {
  readonly targets: readonly LiftTarget[];
  readonly title: string;
  readonly brief: string;
  readonly parSeconds: number;

  private elapsedSeconds = 0;
  private progress: LiftProgress;
  private completion: LiftResult | null = null;
  private droppedCount = 0;

  constructor(config: {
    targets: readonly LiftTarget[];
    title: string;
    brief: string;
    parSeconds: number;
  }) {
    this.targets = config.targets;
    this.title = config.title;
    this.brief = config.brief;
    this.parSeconds = config.parSeconds;
    this.progress = evaluateLift(this.targets, []);
  }

  get elapsed(): number {
    return this.elapsedSeconds;
  }

  get current(): LiftProgress {
    return this.progress;
  }

  get result(): LiftResult | null {
    return this.completion;
  }

  /** Loads let go above the ground rather than set down on it. */
  get dropped(): number {
    return this.droppedCount;
  }

  step(dt: number, payloads: readonly Payload[], droppedThisStep: number): void {
    this.droppedCount += droppedThisStep;
    this.progress = evaluateLift(this.targets, payloads);

    if (this.completion) return;
    this.elapsedSeconds += dt;

    if (this.progress.total > 0 && this.progress.placed === this.progress.total) {
      this.completion = {
        elapsed: this.elapsedSeconds,
        underPar: this.elapsedSeconds <= this.parSeconds,
        dropped: this.droppedCount,
      };
    }
  }
}
