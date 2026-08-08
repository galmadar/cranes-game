/**
 * Fixed-timestep game loop (NFR-2).
 *
 * The simulation always advances in identical increments, decoupled from the
 * display refresh rate. Without this, terrain deformation would depend on
 * frame rate — a fast machine would dig faster than a slow one, which is a
 * real bug and not a theoretical one.
 */

export interface GameLoopOptions {
  /** Seconds per simulation step. */
  step: number;
  /** Upper bound on a single frame's dt, so a backgrounded tab can't spiral. */
  maxFrameTime?: number;
  update: (dt: number) => void;
  render: (alpha: number) => void;
}

export class GameLoop {
  readonly step: number;

  private readonly maxFrameTime: number;
  private readonly update: (dt: number) => void;
  private readonly renderFn: (alpha: number) => void;

  private rafId = 0;
  private lastTime = 0;
  private accumulator = 0;
  private running = false;

  private smoothedFrameMs = 16.7;
  private stepsThisFrame = 0;

  constructor(options: GameLoopOptions) {
    this.step = options.step;
    this.maxFrameTime = options.maxFrameTime ?? 0.25;
    this.update = options.update;
    this.renderFn = options.render;
  }

  get fps(): number {
    return this.smoothedFrameMs > 0 ? 1000 / this.smoothedFrameMs : 0;
  }

  get frameMs(): number {
    return this.smoothedFrameMs;
  }

  /** Sim steps executed during the most recent frame. Should hover at 1. */
  get lastStepCount(): number {
    return this.stepsThisFrame;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const rawMs = now - this.lastTime;
    this.lastTime = now;
    this.smoothedFrameMs += (rawMs - this.smoothedFrameMs) * 0.1;

    // Clamp before accumulating: after a tab-out, `rawMs` can be minutes.
    this.accumulator += Math.min(rawMs / 1000, this.maxFrameTime);

    this.stepsThisFrame = 0;
    while (this.accumulator >= this.step) {
      this.update(this.step);
      this.accumulator -= this.step;
      this.stepsThisFrame++;
    }

    this.renderFn(this.accumulator / this.step);
  };
}
