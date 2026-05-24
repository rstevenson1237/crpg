/**
 * gameloop.js — Main game loop.
 * Fixed logic timestep (default 100ms/tick) with 60fps rendering.
 * Logic and rendering are decoupled.
 */

export class GameLoop {
  /**
   * @param {number} [tickMs=100] - milliseconds per logic tick
   */
  constructor(tickMs = 100) {
    this._tickMs = tickMs;
    this._tickCallbacks = [];
    this._renderCallbacks = [];

    this._running = false;
    this._rafId = null;

    this._lastTime = 0;
    this._accumulator = 0;
  }

  /**
   * Register a logic tick callback.
   * @param {(deltaMs: number) => void} callback
   */
  onTick(callback) {
    this._tickCallbacks.push(callback);
  }

  /**
   * Register a render callback. Called every animation frame.
   * @param {(interpolation: number, deltaMs: number) => void} callback
   *   interpolation: 0–1, fraction of the current tick that has elapsed
   */
  onRender(callback) {
    this._renderCallbacks.push(callback);
  }

  /** Start the game loop. */
  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._accumulator = 0;
    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  /** Stop the game loop. */
  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _loop(timestamp) {
    if (!this._running) return;

    const deltaMs = Math.min(timestamp - this._lastTime, 200); // cap at 200ms to avoid spiral
    this._lastTime = timestamp;
    this._accumulator += deltaMs;

    // Run as many fixed logic ticks as have elapsed
    while (this._accumulator >= this._tickMs) {
      for (const cb of this._tickCallbacks) cb(this._tickMs);
      this._accumulator -= this._tickMs;
    }

    // Interpolation factor: how far between ticks are we?
    const interpolation = this._accumulator / this._tickMs;

    // Render
    for (const cb of this._renderCallbacks) cb(interpolation, deltaMs);

    this._rafId = requestAnimationFrame((t) => this._loop(t));
  }

  /** Change the tick duration (e.g. for pause or slow-motion). */
  setTickMs(ms) {
    this._tickMs = ms;
  }

  get tickMs() { return this._tickMs; }
}
