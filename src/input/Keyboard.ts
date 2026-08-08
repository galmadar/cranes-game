/**
 * Keyboard -> ActionState adapter.
 *
 * Lives outside `sim/` because it touches the DOM. This is the ONLY module
 * that knows what a key is; swapping in a gamepad (FR-4.5) means adding a
 * sibling to this file and nothing else.
 */

import type { ActionState, KeyMap } from '../sim/input/actions';

/** Keys we swallow so driving doesn't scroll the page. */
const SWALLOW = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'PageUp',
  'PageDown',
]);

export class Keyboard {
  private readonly pressed = new Set<string>();
  private readonly state: Record<string, number> = {};
  private readonly target: Window;

  constructor(target: Window = window) {
    this.target = target;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    // Losing focus mid-press would otherwise leave the throttle stuck on.
    this.target.addEventListener('blur', this.onBlur);
  }

  isPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /**
   * Resolve currently-held keys against a vehicle's keymap.
   * The returned object is reused between frames — read it, don't retain it.
   */
  sample(keymap: KeyMap): ActionState {
    for (const key of Object.keys(this.state)) delete this.state[key];

    for (const actionId of Object.keys(keymap)) {
      const codes = keymap[actionId];
      if (!codes) continue;
      let value = 0;
      for (const code of codes) {
        if (this.pressed.has(code)) {
          value = 1;
          break;
        }
      }
      this.state[actionId] = value;
    }
    return this.state;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.pressed.clear();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (SWALLOW.has(event.code)) event.preventDefault();
    this.pressed.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
  };
}

/** Human-readable label for a `KeyboardEvent.code`, for on-screen hints (FR-4.3). */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  switch (code) {
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'Space':
      return 'Space';
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'Shift';
    default:
      return code;
  }
}
