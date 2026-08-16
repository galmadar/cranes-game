/**
 * What the settings panel exposes.
 *
 * Settings are described as get/set pairs over the LIVE objects — the vehicle
 * definition and the global tuning record. Nothing is copied, so a change is
 * felt on the next simulation step with no apply step and no restart. That
 * immediacy is the entire point: these numbers can only be judged by driving.
 */

import type { JobSite } from '../sim/job/JobSite';
import { DEFAULT_TUNING, TUNING } from '../sim/tuning';
import type { BladeSpec, CraneSpec, ExcavatorSpec, VehicleDefinition } from '../sim/vehicle/types';

export interface SettingDef {
  id: string;
  label: string;
  /** The value that ships in source, so overrides can be told from defaults. */
  defaultValue: number;
  /**
   * Hidden until the panel is switched to advanced.
   *
   * The dividing line is not importance but *legibility*: basic settings are
   * the ones whose effect you can predict before you drag them. Everything
   * else stays available — a panel of thirty sliders you cannot read is worse
   * than a panel of eight, and worse than no panel at all.
   */
  advanced?: boolean;
  hint?: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  get(): number;
  set(value: number): void;
  reset(): void;
}

export interface SettingGroup {
  title: string;
  settings: SettingDef[];
}

function bladeOf(def: VehicleDefinition): BladeSpec | undefined {
  return def.implements.find((i): i is BladeSpec => i.kind === 'blade');
}

function craneOf(def: VehicleDefinition): CraneSpec | undefined {
  return def.implements.find((i): i is CraneSpec => i.kind === 'crane');
}

function armOf(def: VehicleDefinition): ExcavatorSpec | undefined {
  return def.implements.find((i): i is ExcavatorSpec => i.kind === 'excavator');
}

export function buildSettings(def: VehicleDefinition, site?: JobSite): SettingGroup[] {
  const loco = def.locomotion;
  const blade = bladeOf(def);
  const crane = craneOf(def);
  const arm = armOf(def);

  /**
   * Namespace a setting to the machine that owns it.
   *
   * Every machine has a "Top speed", and with bare ids they were the SAME
   * saved value. Measured: a crawler crane rated at 1.6 m/s drove off the
   * hardstand at 8.1 m/s and spun at 3.35 rad/s, because those were the
   * numbers a bulldozer had been tuned to in an earlier session. Global feel
   * constants stay unprefixed — those genuinely are one value for the world.
   */
  const own = (id: string): string => `${def.id}:${id}`;

  // Captured at first build, so "reset" restores what shipped rather than
  // whatever happened to be loaded from storage.
  const locoDefaults = { ...loco };
  const bladeDefaults = blade ? { ...blade } : null;

  const groups: SettingGroup[] = [
    {
      title: 'Machine',
      settings: [
        num(own('maxSpeed'), 'Top speed', 1, 15, 0.1, 'm/s', loco, locoDefaults, 'maxSpeed'),
        num(own('turnRate'), 'Turn rate', 0.2, 4, 0.05, 'rad/s', loco, locoDefaults, 'turnRate'),
        adv(num(own('maxReverseSpeed'), 'Reverse speed', 0.5, 10, 0.1, 'm/s', loco, locoDefaults, 'maxReverseSpeed')),
        adv(num(own('acceleration'), 'Acceleration', 0.5, 20, 0.1, 'm/s²', loco, locoDefaults, 'acceleration')),
        adv(num(own('braking'), 'Braking', 0.5, 25, 0.1, 'm/s²', loco, locoDefaults, 'braking')),
      ],
    },
  ];

  if (blade && bladeDefaults) {
    groups.push({
      title: 'Blade',
      settings: [
        num(own('bladeCapacity'), 'Capacity', 0.5, 12, 0.1, 'm³', blade, bladeDefaults, 'capacity', 'How much it holds before soil rolls off the ends'),
        num(own('bladeMoveSpeed'), 'Lift speed', 0.2, 4, 0.05, 'm/s', blade, bladeDefaults, 'moveSpeed', 'How fast the blade answers R and F'),
        num(own('bladeMinHeight'), 'Max dig depth', -2, 0, 0.05, 'm', blade, bladeDefaults, 'minHeight', 'How far below the tracks the edge can reach'),
        adv(num(own('bladeMaxHeight'), 'Max lift', 0.2, 4, 0.05, 'm', blade, bladeDefaults, 'maxHeight')),
        adv(num(own('bladeWidth'), 'Width', 1, 8, 0.1, 'm', blade, bladeDefaults, 'width')),
        adv(num(own('bladeReach'), 'Reach', 1, 6, 0.1, 'm', blade, bladeDefaults, 'reach', 'Distance ahead of the machine')),
      ],
    });
  }

  if (blade?.pitch) {
    const pitch = blade.pitch;
    const pitchDefaults = { ...pitch };
    groups.push({
      title: 'Blade pitch',
      settings: [
        adv(num(own('pitchBack'), 'Back limit', -0.6, 0, 0.01, 'rad', pitch, pitchDefaults, 'min', 'Rolled back: carries more, cuts gently')),
        adv(num(own('pitchForward'), 'Forward limit', 0, 0.6, 0.01, 'rad', pitch, pitchDefaults, 'max', 'Tipped forward: bites deeper, spills sooner')),
        adv(num(own('pitchSpeed'), 'Pitch speed', 0.05, 2, 0.05, 'rad/s', pitch, pitchDefaults, 'speed')),
      ],
    });
  }

  if (crane) {
    const craneDefaults = { ...crane };
    const slewDefaults = { ...crane.slew };
    const turnDefaults = { ...crane.turn };
    const luffDefaults = { ...crane.luff };
    const hoistDefaults = { ...crane.hoist };

    groups.push({
      title: 'Crane',
      settings: [
        num(own('craneMaxLoad'), 'Rated load', 2, 40, 0.5, 't', crane, craneDefaults, 'maxLoad', 'What it lifts at minimum radius. Falls off as you reach out'),
        num(own('craneMinRadius'), 'Full-chart radius', 2, 20, 0.5, 'm', crane, craneDefaults, 'minRadius', 'Reach past this and rated load starts dropping'),
        num(own('craneSlewSpeed'), 'Slew speed', 0.05, 1.5, 0.01, 'rad/s', crane.slew, slewDefaults, 'speed', 'Faster slew, wilder swing'),
        num(own('craneHoistSpeed'), 'Hoist speed', 0.5, 8, 0.1, 'm/s', crane.hoist, hoistDefaults, 'speed'),
        adv(num(own('craneLuffSpeed'), 'Boom speed', 0.05, 1, 0.01, 'rad/s', crane.luff, luffDefaults, 'speed')),
        adv(num(own('craneBoomLength'), 'Boom length', 8, 60, 1, 'm', crane, craneDefaults, 'boomLength', 'Takes effect on reload — the lattice is built once')),
        adv(num(own('craneHookRadius'), 'Hook catch', 0.5, 5, 0.1, 'm', crane, craneDefaults, 'hookRadius', 'How near the lug the hook must be to take hold')),
        adv(num(own('craneMaxRope'), 'Rope out', 5, 40, 0.5, 'm', crane.hoist, hoistDefaults, 'max')),
      ],
    });

    groups.push({
      title: 'Load swing',
      settings: [
        num('swayDamping', 'Sway damping', 0.02, 1, 0.01, '', TUNING, DEFAULT_TUNING, 'swayDamping', 'How fast a swinging load settles. Low is realistic and cruel'),
        adv(num('maxSwingFraction', 'Swing limit', 0.1, 0.9, 0.05, '', TUNING, DEFAULT_TUNING, 'maxSwingFraction', 'Furthest the hook may swing, as a share of rope out')),
        adv(num(own('craneTurnSpeed'), 'Tag line speed', 0.05, 3, 0.05, 'rad/s', crane.turn, turnDefaults, 'speed', 'How fast Z and X turn the load on the hook')),
      ],
    });
  }

  if (arm) {
    const armDefaults = { ...arm };
    const armSlewDefaults = { ...arm.slew };
    const boomDefaults = { ...arm.boom };
    const stickDefaults = { ...arm.stick };
    const curlDefaults = { ...arm.curl };

    groups.push({
      title: 'Arm',
      settings: [
        num(own('armCapacity'), 'Bucket', 0.2, 5, 0.05, 'm³', arm, armDefaults, 'capacity', 'How much it holds before it stops filling'),
        num(own('armDigRate'), 'Dig rate', 0.2, 4, 0.05, 'm³/m', arm, armDefaults, 'digRate', 'Soil picked up per metre the teeth are dragged'),
        num(own('armSlewSpeed'), 'Slew speed', 0.1, 3, 0.05, 'rad/s', arm.slew, armSlewDefaults, 'speed'),
        num(own('armStickSpeed'), 'Stick speed', 0.1, 3, 0.05, 'rad/s', arm.stick, stickDefaults, 'speed', 'The joint you drag a cut with'),
        adv(num(own('armBoomSpeed'), 'Boom speed', 0.1, 3, 0.05, 'rad/s', arm.boom, boomDefaults, 'speed')),
        adv(num(own('armCurlSpeed'), 'Curl speed', 0.1, 4, 0.05, 'rad/s', arm.curl, curlDefaults, 'speed')),
        adv(num(own('armDumpRate'), 'Dump rate', 0.5, 15, 0.5, 'm³/s', arm, armDefaults, 'dumpRate')),
        adv(num(own('armBoomMin'), 'Lowest boom', -1.2, 0, 0.05, 'rad', arm.boom, boomDefaults, 'min', 'How far below horizontal it reaches — this is dig depth')),
        adv(num(own('armDumpCurl'), 'Tip point', -0.6, 0.4, 0.05, 'rad', arm, armDefaults, 'dumpCurl', 'Curl below this and the bucket spills')),
      ],
    });
  }

  if (site) {
    // How hard the job should be is a question only playing can answer, so it
    // is a knob rather than a constant.
    const siteDefaults = { ...site };
    groups.push({
      title: 'Contract',
      settings: [
        num(`${site.id}:jobTolerance`, 'Grade tolerance', 0.05, 1, 0.01, 'm', site, siteDefaults, 'tolerance', 'How close to target counts as done. Repaints the overlay'),
        num(`${site.id}:jobRequiredAccuracy`, 'Required accuracy', 0.5, 1, 0.01, '', site, siteDefaults, 'requiredAccuracy', 'Share of the site that must be on grade to finish'),
        num(`${site.id}:jobParSeconds`, 'Par time', 30, 900, 10, 's', site, siteDefaults, 'parSeconds', 'Finish inside this to beat the contract'),
      ],
    });
  }

  // Only where something can actually move soil. On the lift yard every one of
  // these is a slider with no observable effect, which is worse than absent.
  if (blade) {
    groups.push({
      title: 'Soil',
      settings: [
        adv(num('fullBladeResistance', 'Full-blade drag', 0, 0.95, 0.01, '', TUNING, DEFAULT_TUNING, 'fullBladeResistance', 'How much a loaded blade slows the machine. Lower = stronger')),
        adv(num('stallFill', 'Stall point', 1.2, 5, 0.1, '×', TUNING, DEFAULT_TUNING, 'stallFill', 'Blade loads before the machine bogs down. Lower = gets stuck sooner')),
        adv(num('rockResistance', 'Rock drag', 0, 0.98, 0.01, '', TUNING, DEFAULT_TUNING, 'rockResistance', 'How hard rock stops you')),
        adv(num('sideSpillFraction', 'Side spill', 0, 0.9, 0.01, '', TUNING, DEFAULT_TUNING, 'sideSpillFraction', 'Share of an overloaded cut that rolls off the ends')),
        adv(num('slumpPasses', 'Slump passes', 1, 8, 1, '', TUNING, DEFAULT_TUNING, 'slumpPasses', 'Higher settles piles faster and costs more CPU')),
        adv(num('slumpRelaxation', 'Slump strength', 0.05, 1, 0.05, '', TUNING, DEFAULT_TUNING, 'slumpRelaxation')),
      ],
    });
  }

  return groups;
}

/** Marks a setting advanced. A wrapper rather than another positional argument. */
function adv(setting: SettingDef): SettingDef {
  return { ...setting, advanced: true };
}

/** Binds a slider to one numeric property of a live object. */
function num<T extends object, K extends keyof T>(
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  unit: string,
  target: T,
  // Partial, because a spec may carry optional feature blocks (pitch, grade
  // control) and spreading one then yields optional keys.
  defaults: Readonly<Partial<Record<K, unknown>>>,
  key: K,
  hint?: string,
): SettingDef {
  const fallback = defaults[key] as number;
  return {
    id,
    label,
    defaultValue: fallback,
    min,
    max,
    step,
    ...(unit ? { unit } : {}),
    ...(hint ? { hint } : {}),
    get: () => target[key] as number,
    set: (value: number) => {
      (target as Record<K, number>)[key] = value;
    },
    reset: () => {
      (target as Record<K, number>)[key] = fallback;
    },
  };
}
