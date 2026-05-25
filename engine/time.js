/**
 * time.js — Game time tracking and time-of-day state management.
 * 1 game turn = 10 in-world minutes. 144 turns = 24 in-world hours.
 */

const TIME_STATES = [
  { name: 'dawn',      start:   0, end:  11 },
  { name: 'morning',   start:  12, end:  35 },
  { name: 'noon',      start:  36, end:  59 },
  { name: 'afternoon', start:  60, end:  83 },
  { name: 'dusk',      start:  84, end:  95 },
  { name: 'evening',   start:  96, end: 107 },
  { name: 'night',     start: 108, end: 131 },
  { name: 'midnight',  start: 132, end: 143 },
];

export class GameTime {
  constructor() {
    this.totalTurns = 0;
    this.dayNumber  = 1;
    this.turnOfDay  = 0;   // 0–143

    this._stateChangeCallbacks = [];
    this._currentState = this._computeState();
  }

  /** @returns {string} current time-of-day state name */
  getState() { return this._computeState(); }

  /** @returns {number} in-world hour, 0–23 */
  getHour() { return Math.floor(this.turnOfDay / 6); }

  /** @returns {number} in-world minute: 0, 10, 20, 30, 40, or 50 */
  getMinute() { return (this.turnOfDay % 6) * 10; }

  /**
   * Advance time by the given number of turns, firing state-change callbacks.
   * @param {number} [turns=1]
   */
  advance(turns = 1) {
    for (let i = 0; i < turns; i++) {
      this.totalTurns++;
      this.turnOfDay++;
      if (this.turnOfDay >= 144) {
        this.turnOfDay = 0;
        this.dayNumber++;
      }
      const next = this._computeState();
      if (next !== this._currentState) {
        const prev = this._currentState;
        this._currentState = next;
        for (const cb of this._stateChangeCallbacks) cb(next, prev);
      }
    }
  }

  /**
   * Register a callback fired on each time-of-day state transition.
   * @param {function(newState: string, oldState: string): void} cb
   */
  onStateChange(cb) { this._stateChangeCallbacks.push(cb); }

  /**
   * Skip time forward until the given state is reached (max 1 full day).
   * @param {string} stateName
   */
  skipToState(stateName) {
    let guard = 0;
    while (this._computeState() !== stateName && guard < 144) {
      this.advance(1);
      guard++;
    }
  }

  _computeState() {
    for (const s of TIME_STATES) {
      if (this.turnOfDay >= s.start && this.turnOfDay <= s.end) return s.name;
    }
    return 'dawn';
  }
}
