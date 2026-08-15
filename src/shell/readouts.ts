/**
 * Turning implement state into words a player can act on.
 *
 * Lives in the shell rather than in the HUD because it is per-MACHINE, and the
 * HUD should not know what machines exist. Lives outside the vehicle
 * definitions because it is presentation, and those have to stay pure.
 *
 * The house style throughout: name the decision, not the number. "-0.14 rad"
 * says nothing about whether the blade is carrying or cutting, and "0.81" says
 * nothing about whether you are about to be refused a lift.
 */

import type { BladeState, CraneState } from '../sim/vehicle/types';
import type { MachineRow } from './Hud';

const degrees = (radians: number): number => (radians * 180) / Math.PI;

export function bladeRows(state: BladeState, gradeAtBlade: number | null): MachineRow[] {
  // The hold flag matters more than the number it produces: a player who
  // cannot tell auto from manual cannot tell a working servo from a stuck one.
  const hold = state.gradeHold
    ? state.gradeHoldSaturated
      ? '  ▸ HOLD (out of travel)'
      : '  ▸ HOLD'
    : '';

  let grade = 'off site';
  if (gradeAtBlade !== null) {
    grade =
      Math.abs(gradeAtBlade) < 0.2
        ? 'on grade'
        : `${gradeAtBlade > 0 ? 'cut' : 'fill'} ${Math.abs(gradeAtBlade).toFixed(2)} m`;
  }

  const deg = degrees(state.pitch);
  const pitchMode =
    Math.abs(deg) < 1 ? 'neutral' : deg < 0 ? 'back · carries' : 'forward · bites';

  return [
    {
      label: 'Blade',
      value: `${state.height.toFixed(2)} m${state.blocked ? '  ⛔' : ''}${hold}`,
      alert: state.blocked || state.gradeHoldSaturated,
    },
    { label: 'At blade', value: grade },
    { label: 'Pitch', value: `${deg >= 0 ? '+' : ''}${deg.toFixed(0)}° ${pitchMode}` },
    {
      // Against capacity, so the effect of pitch on what the blade holds is
      // visible while the load is building rather than after it spills.
      label: 'Pushing',
      value: `${state.carriedVolume.toFixed(2)} / ${state.effectiveCapacity.toFixed(1)} m³`,
    },
  ];
}

export function craneRows(
  state: CraneState,
  /** Ground height directly under the hook, or null if it is off the map. */
  groundUnderHook: number | null,
  /** The load on the hook, if any. */
  holding: { name: string; yaw: number } | null,
): MachineRow[] {
  const swing = Math.hypot(state.swayX, state.swayZ);
  const clear = groundUnderHook === null ? null : state.hook.y - groundUnderHook;

  const rows: MachineRow[] = [
    { label: 'Boom', value: `${degrees(state.luff).toFixed(0)}°` },
    // Radius and rated load together, because they are one fact: reach costs
    // lifting power, and splitting them across two rows hides the trade.
    { label: 'Radius', value: `${state.radius.toFixed(1)} m · ${state.ratedLoad.toFixed(1)} t max` },
    { label: 'Hook', value: clear === null ? '—' : `${clear.toFixed(1)} m up` },
    {
      // The one number that says "wait before you set it down". A swinging load
      // set on a pad drifts off it, and nothing else on screen shows that.
      label: 'Swing',
      value: swing < 0.05 ? 'steady' : `${swing.toFixed(2)} m`,
      alert: swing > 0.8,
    },
    {
      // Name, weight and the share of rated it is using, in that order: what
      // you picked up, and how much crane you have left to move it with.
      label: 'On hook',
      value:
        holding === null
          ? 'empty'
          : `${holding.name} · ${state.hookLoad.toFixed(1)} t · ` +
            `${Math.round(state.loadFraction * 100)}%${state.limited ? '  ⛔ LIMIT' : ''}`,
      alert: state.limited,
    },
  ];

  // Only while something is on the hook. A bearing with no load is a number
  // about nothing, and the row would sit there reading 0° all game.
  if (holding) {
    const bearing = ((degrees(holding.yaw) % 360) + 360) % 360;
    rows.push({ label: 'Load bearing', value: `${bearing.toFixed(0)}°` });
  }
  return rows;
}
