/**
 * The action layer (FR-4.2).
 *
 * A vehicle NEVER sees a keyboard event. Raw keys are resolved to named
 * actions once, centrally, and vehicles read actions. That indirection is the
 * entire reason per-vehicle keymaps (FR-4.1) cost nothing, and it is why
 * gamepad support later (FR-4.5) is an input-layer change and nothing more.
 */

/** Locomotion actions are fixed: every driveable chassis understands them. */
export const Action = {
  ThrottleForward: 'throttleForward',
  ThrottleReverse: 'throttleReverse',
  SteerLeft: 'steerLeft',
  SteerRight: 'steerRight',
} as const;

/**
 * Implement actions are NOT fixed — a blade raises, a boom slews, a hook
 * winches. Each implement spec names the actions it listens for, so adding a
 * crane adds action ids without touching this file.
 */
export type ActionId = string;

/** Analogue-friendly: 0..1 per action, so a gamepad axis drops in unchanged. */
export type ActionState = Readonly<Record<ActionId, number>>;

/** Action id -> the `KeyboardEvent.code` values that trigger it. */
export type KeyMap = Readonly<Record<ActionId, readonly string[]>>;

export const EMPTY_ACTION_STATE: ActionState = Object.freeze({});

export function actionValue(state: ActionState, id: ActionId): number {
  return state[id] ?? 0;
}

/** Combine an opposing pair into a single -1..1 axis. */
export function actionAxis(state: ActionState, positive: ActionId, negative: ActionId): number {
  return actionValue(state, positive) - actionValue(state, negative);
}
