/**
 * Vehicle entity types.
 *
 * Locked decision from PLAN.md: the core entity is `Vehicle`, not `Crane`.
 * A bulldozer pushes, a crane lifts; both are vehicles carrying *implements*.
 * The implement abstraction is what makes a blade and a boom siblings rather
 * than special cases, and it is the thing that has to be right now — not when
 * there are six machines.
 */

import type { ActionId, KeyMap } from '../input/actions';
import type { Vec3 } from '../math/Vec';

export type VehicleFamily =
  | 'dozer'
  | 'excavator'
  | 'mobileCrane'
  | 'crawlerCrane'
  | 'towerCrane';

// ------------------------------------------------------------------ chassis

/** Numeric fields are intentionally mutable: the settings panel edits them live. */
export interface TrackedLocomotionSpec {
  kind: 'tracked';
  /** m/s */
  maxSpeed: number;
  maxReverseSpeed: number;
  /** m/s² */
  acceleration: number;
  braking: number;
  /** rad/s — tracked machines pivot on the spot, so this applies at rest too. */
  turnRate: number;
}

/** M6 adds `wheeled` (steered, no pivot turn) and `static` (tower cranes). */
export type LocomotionSpec = TrackedLocomotionSpec;

// --------------------------------------------------------------- implements

export interface BladeSpec {
  kind: 'blade';
  id: string;
  /** Actions this implement listens for — declared, not hard-coded. */
  raiseAction: ActionId;
  lowerAction: ActionId;
  /**
   * Toggles automatic grade control, if the machine has it.
   *
   * Optional because it is a machine FEATURE, not a fact about blades: an old
   * dozer has no such thing, and later that becomes a purchasable upgrade.
   */
  gradeHoldAction?: ActionId;

  /**
   * Blade pitch — the mouldboard rolling forward and back about its top mount.
   *
   * The second axis a real dozer has and a fixed blade does not. Pitched back
   * the face rolls material up itself and CARRIES far more before it spills;
   * pitched forward the cutting edge attacks and BITES. That trade is the
   * whole mechanic, and it is the answer to a blade that keeps dumping its
   * load: stop cutting so hard, and carry what you already have.
   *
   * Optional, like grade control: this is a machine feature, not a fact about
   * blades, and later it becomes something bought rather than assumed.
   */
  pitch?: BladePitchSpec;

  /** Cutting-edge width, metres. */
  width: number;
  /** Mouldboard height above the cutting edge, metres. Caps the bite. */
  height: number;
  /** Fore-aft thickness of the cut, metres. */
  thickness: number;
  /** Distance forward of the vehicle origin. */
  reach: number;

  /** Blade travel relative to the vehicle's ground line. Negative = digs in. */
  minHeight: number;
  maxHeight: number;
  restHeight: number;
  /** m/s */
  moveSpeed: number;

  /** m³ the blade can carry before soil spills, at neutral pitch. */
  capacity: number;
}

export interface BladePitchSpec {
  backAction: ActionId;
  forwardAction: ActionId;
  /** Radians. Negative rolls the face back, positive tips it forward. */
  min: number;
  max: number;
  rest: number;
  /** rad/s */
  speed: number;

  /**
   * How far the cutting edge stands AHEAD of the pitch pivot, metres.
   *
   * Machine geometry, not a tuning knob, and the whole reason pitching forward
   * digs: the edge hangs on a lever ahead of the trunnion, so rolling the top
   * forward swings the edge down. Set it to zero and pitch becomes purely a
   * carrying decision. The renderer builds the mouldboard around the same
   * number, so the blade you see is the blade the simulation cuts with.
   */
  edgeAhead: number;
}

/**
 * Crane — slew, luff, hoist and a hook, as ONE implement.
 *
 * Deliberately not three. The boom, the winch and the turntable are a single
 * kinematic chain: where the hook is depends on all three at once, and splitting
 * them would mean each implement reading the other two's state to answer the
 * only question that matters.
 */
export interface CraneSpec {
  kind: 'crane';
  id: string;

  /** Turntable rotation, independent of which way the tracks point. */
  slew: { leftAction: ActionId; rightAction: ActionId; speed: number };
  /**
   * Turning the load on the hook — the tag line.
   *
   * Its own control, and it has to be. A load on a single hook does not know
   * which way the house is pointing; riggers turn it by hand on a rope. Tying
   * it to slew instead made bearing and position the SAME control: reaching a
   * pad meant slewing to point at it, which fixed the load's bearing to the
   * line from the crane, so which way a beam ended up lying was decided
   * entirely by where you parked. Measured, that left a beam 1.2 m onto its
   * pad and 12 degrees out with no control that could fix it.
   */
  turn: { leftAction: ActionId; rightAction: ActionId; speed: number };
  /** Boom angle from horizontal. Higher is steeper, closer, and stronger. */
  luff: AxisSpec;
  /** Rope paid out below the boom head. Larger is lower. */
  hoist: AxisSpec;
  /** Picks up a load under the hook, or sets down the one on it. */
  hookAction: ActionId;

  /** Boom foot, in the slewing superstructure's frame. */
  pivot: { y: number; z: number };
  /** Lattice boom: fixed. Telescoping would make this a second hoist axis. */
  boomLength: number;

  /**
   * Rated load in tonnes, and the radius out to which the crane holds it.
   *
   * Beyond `minRadius` the chart falls as a constant load moment — double the
   * radius, halve the load. That is close enough to a real capacity chart to
   * teach the only lesson that matters: reach costs you lifting power.
   */
  maxLoad: number;
  minRadius: number;

  /** How close the hook must come to a load's lug to pick it up, metres. */
  hookRadius: number;
  /** Sling from the hook block down to the top of the load, metres. */
  slingLength: number;
}

/**
 * A driven axis with travel limits — luff and hoist are the same shape.
 *
 * Named for the NUMBER, not for the direction the load moves, because those
 * disagree on the hoist: paying rope out increases the axis and lowers the
 * hook. Each spec says which key it hangs on, so the def stays readable.
 */
export interface AxisSpec {
  increaseAction: ActionId;
  decreaseAction: ActionId;
  min: number;
  max: number;
  rest: number;
  /** Units per second — radians for luff, metres for hoist. */
  speed: number;
}

/**
 * Excavator arm — house, boom, stick, bucket.
 *
 * One implement for the same reason the crane is: the teeth are at the end of
 * a chain, and where they are depends on every joint at once.
 *
 * The difference from the crane is what the end of the arm DOES. A hook takes
 * hold of a thing that already exists; a bucket takes soil out of the world and
 * carries it. That is why this spec has a capacity in cubic metres and the
 * crane's has one in tonnes.
 */
export interface ExcavatorSpec {
  kind: 'excavator';
  id: string;

  slew: { leftAction: ActionId; rightAction: ActionId; speed: number };
  /** Boom, measured up from horizontal at its foot. */
  boom: AxisSpec;
  /** Stick, measured as the angle it closes on the boom. */
  stick: AxisSpec;
  /** Bucket curl. High curls the teeth in and holds; low tips the load out. */
  curl: AxisSpec;

  /** Boom foot, in the slewing house's frame. */
  pivot: { y: number; z: number };
  boomLength: number;
  stickLength: number;
  /** Teeth reach out from the stick's end, metres. */
  bucketLength: number;
  /** Width of the cut, metres. */
  bucketWidth: number;

  /** m³ the bucket holds. */
  capacity: number;
  /**
   * m³ picked up per metre the teeth are DRAGGED through soil.
   *
   * Per metre rather than per second, and that is the difference between a
   * machine and a button: soil only enters the bucket while the arm is moving
   * through it, so filling one is a pass you make rather than a wait you sit
   * out. Held against the ground without moving, the bucket stays empty.
   */
  digRate: number;
  /** m³/s that leaves the bucket once it is tipped past `dumpCurl`. */
  dumpRate: number;
  /**
   * Curl angle below which the bucket is open and spills, radians.
   *
   * The single control that makes an excavator cycle read as a cycle: curl in
   * to hold what you have dug, swing, tip out. Without it "dump" is a button
   * rather than a thing the machine is visibly doing.
   */
  dumpCurl: number;
}

export type ImplementSpec = BladeSpec | CraneSpec | ExcavatorSpec;

export interface BladeState {
  kind: 'blade';
  /** Cutting-edge height relative to the vehicle's ground line. */
  height: number;
  /**
   * m³ standing above the cutting edge directly ahead — the prow the blade is
   * pushing. Measured from the terrain, not accumulated in a hidden tally, so
   * what the player sees and what the sim believes cannot drift apart.
   */
  carriedVolume: number;
  /** m³/s currently being cut. Diagnostic. */
  cutRate: number;
  /** True while the blade is up against non-diggable material (FR-3.2). */
  blocked: boolean;

  /** True while the blade is servoing to an elevation instead of the lever. */
  gradeHold: boolean;
  /**
   * True when hold is on but the blade has run out of travel.
   *
   * Worth surfacing: standing on a mound, design grade can be further below
   * the tracks than the rams reach, and a player who cannot see that concludes
   * grade control is broken rather than that the cut needs another layer.
   */
  gradeHoldSaturated: boolean;

  /** Blade pitch in radians. Negative carries, positive bites. */
  pitch: number;
  /** m³ the blade holds at the current pitch — `capacity` is the neutral value. */
  effectiveCapacity: number;
}

export interface CraneState {
  kind: 'crane';
  /** Superstructure bearing relative to the tracks, radians. */
  slew: number;
  /** Boom angle above horizontal, radians. */
  luff: number;
  /** Rope paid out below the boom head, metres. */
  rope: number;

  /** Boom head, world space. Derived every step; the view reads it. */
  head: Vec3;
  /** Hook block, world space. What a load hangs from. */
  hook: Vec3;

  /**
   * Hook swing away from plumb, metres, in world axes.
   *
   * A swinging load is the crane's whole difficulty — slew fast and the load
   * keeps going after you stop. Carried as position + velocity rather than as
   * an angle so the pendulum stays a plain second-order system.
   */
  swayX: number;
  swayZ: number;
  swayVX: number;
  swayVZ: number;

  /** Horizontal distance from the slew centre to the hook, metres. */
  radius: number;
  /** What the chart allows at that radius, tonnes. */
  ratedLoad: number;
  /** Tonnes currently on the hook. */
  hookLoad: number;
  /** Load over rated. Past 1 the limiter cuts out. */
  loadFraction: number;
  /** True while the limiter is refusing to make the overload worse. */
  limited: boolean;

  /** Id of the load on the hook, or null. */
  hookedPayloadId: string | null;
}

export interface ExcavatorState {
  kind: 'excavator';
  slew: number;
  boom: number;
  stick: number;
  curl: number;

  /** Bucket teeth, world space. Derived every step; the view reads it. */
  teeth: Vec3;
  /** Horizontal distance from the slew centre to the teeth, metres. */
  radius: number;
  /** Ground height directly under the teeth. What "how deep am I" is measured from. */
  groundAtTeeth: number;

  /** m³ currently in the bucket. */
  carried: number;
  /** m³/s going in (positive) or coming out (negative). Diagnostic. */
  flowRate: number;
  /** True while the teeth are up against something they cannot cut. */
  blocked: boolean;
  /** True while the bucket is tipped open. */
  dumping: boolean;
}

export type ImplementState = BladeState | CraneState | ExcavatorState;

// ----------------------------------------------------------------- vehicle

export interface VehicleDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly family: VehicleFamily;
  readonly description: string;

  /** Metres. Used by the view and, later, by collision. */
  readonly dimensions: { length: number; width: number; height: number };

  readonly locomotion: LocomotionSpec;
  readonly implements: readonly ImplementSpec[];
  readonly keymap: KeyMap;
}

export interface VehicleState {
  readonly defId: string;
  position: Vec3;
  /** Yaw in radians. 0 faces +Z; increasing turns left. */
  heading: number;
  /** Derived from the terrain normal each step (FR-2.3). */
  pitch: number;
  roll: number;
  /** Signed ground speed, m/s. */
  speed: number;
  implementStates: Record<string, ImplementState>;
}
