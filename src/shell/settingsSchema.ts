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
import type { BladeSpec, VehicleDefinition } from '../sim/vehicle/types';

export interface SettingDef {
  id: string;
  label: string;
  /** The value that ships in source, so overrides can be told from defaults. */
  defaultValue: number;
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

export function buildSettings(def: VehicleDefinition, site?: JobSite): SettingGroup[] {
  const loco = def.locomotion;
  const blade = bladeOf(def);

  // Captured at first build, so "reset" restores what shipped rather than
  // whatever happened to be loaded from storage.
  const locoDefaults = { ...loco };
  const bladeDefaults = blade ? { ...blade } : null;

  const groups: SettingGroup[] = [
    {
      title: 'Machine',
      settings: [
        num('maxSpeed', 'Top speed', 1, 15, 0.1, 'm/s', loco, locoDefaults, 'maxSpeed'),
        num('maxReverseSpeed', 'Reverse speed', 0.5, 10, 0.1, 'm/s', loco, locoDefaults, 'maxReverseSpeed'),
        num('acceleration', 'Acceleration', 0.5, 20, 0.1, 'm/s²', loco, locoDefaults, 'acceleration'),
        num('braking', 'Braking', 0.5, 25, 0.1, 'm/s²', loco, locoDefaults, 'braking'),
        num('turnRate', 'Turn rate', 0.2, 4, 0.05, 'rad/s', loco, locoDefaults, 'turnRate'),
      ],
    },
  ];

  if (blade && bladeDefaults) {
    groups.push({
      title: 'Blade',
      settings: [
        num('bladeCapacity', 'Capacity', 0.5, 12, 0.1, 'm³', blade, bladeDefaults, 'capacity', 'How much it holds before soil rolls off the ends'),
        num('bladeMoveSpeed', 'Lift speed', 0.2, 4, 0.05, 'm/s', blade, bladeDefaults, 'moveSpeed'),
        num('bladeMinHeight', 'Max dig depth', -2, 0, 0.05, 'm', blade, bladeDefaults, 'minHeight', 'How far below the tracks the edge can reach'),
        num('bladeMaxHeight', 'Max lift', 0.2, 4, 0.05, 'm', blade, bladeDefaults, 'maxHeight'),
        num('bladeWidth', 'Width', 1, 8, 0.1, 'm', blade, bladeDefaults, 'width'),
        num('bladeReach', 'Reach', 1, 6, 0.1, 'm', blade, bladeDefaults, 'reach', 'Distance ahead of the machine'),
      ],
    });
  }

  if (blade?.pitch) {
    const pitch = blade.pitch;
    const pitchDefaults = { ...pitch };
    groups.push({
      title: 'Blade pitch',
      settings: [
        num('pitchBack', 'Back limit', -0.6, 0, 0.01, 'rad', pitch, pitchDefaults, 'min', 'Rolled back: carries more, cuts gently'),
        num('pitchForward', 'Forward limit', 0, 0.6, 0.01, 'rad', pitch, pitchDefaults, 'max', 'Tipped forward: bites deeper, spills sooner'),
        num('pitchSpeed', 'Pitch speed', 0.05, 2, 0.05, 'rad/s', pitch, pitchDefaults, 'speed'),
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
        num('jobTolerance', 'Grade tolerance', 0.05, 1, 0.01, 'm', site, siteDefaults, 'tolerance', 'How close to target counts as done. Repaints the overlay'),
        num('jobRequiredAccuracy', 'Required accuracy', 0.5, 1, 0.01, '', site, siteDefaults, 'requiredAccuracy', 'Share of the site that must be on grade to finish'),
        num('jobParSeconds', 'Par time', 30, 900, 10, 's', site, siteDefaults, 'parSeconds'),
      ],
    });
  }

  groups.push({
    title: 'Soil',
    settings: [
      num('fullBladeResistance', 'Full-blade drag', 0, 0.95, 0.01, '', TUNING, DEFAULT_TUNING, 'fullBladeResistance', 'How much a loaded blade slows the machine. Lower = stronger'),
      num('rockResistance', 'Rock drag', 0, 0.98, 0.01, '', TUNING, DEFAULT_TUNING, 'rockResistance', 'How hard rock stops you'),
      num('sideSpillFraction', 'Side spill', 0, 0.9, 0.01, '', TUNING, DEFAULT_TUNING, 'sideSpillFraction', 'Share of an overloaded cut that rolls off the ends'),
      num('slumpPasses', 'Slump passes', 1, 8, 1, '', TUNING, DEFAULT_TUNING, 'slumpPasses', 'Higher settles piles faster and costs more CPU'),
      num('slumpRelaxation', 'Slump strength', 0.05, 1, 0.05, '', TUNING, DEFAULT_TUNING, 'slumpRelaxation'),
    ],
  });

  return groups;
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
