/**
 * traps.js — Trap detection, triggering, and resolution system.
 *
 * Manages trap objects on the current map:
 *   - Passive detection (Thief within 3 tiles each turn)
 *   - Active detection (Search key on faced tile)
 *   - Triggering when party steps on an undetected trap
 *   - Disarming via the Lock hard-lock system (Thief required)
 *   - Timed reset for fire_jet and alarm_wire trap types
 */

import { Lock } from './locks.js';

// How many turns before a resettable trap rearms itself
const TRAP_RESET_TURNS = {
  fire_jet:   3,
  alarm_wire: 5,
};

class TrapManager {
  constructor() {
    this._traps       = [];    // all trap objects on current map
    this._resets      = [];    // [{ trap, resetAtTurn }]

    // Callbacks set by index.html
    this._onDetect    = null;  // (trap) => void
    this._onTrigger   = null;  // (trap, effects) => void
    this._onDisarm    = null;  // (trap) => void
    this._fireEvent   = null;  // (eventId) => void
  }

  setOnDetect(cb)  { this._onDetect  = cb; }
  setOnTrigger(cb) { this._onTrigger = cb; }
  setOnDisarm(cb)  { this._onDisarm  = cb; }
  setFireEvent(fn) { this._fireEvent = fn; }

  // ── Map loading ────────────────────────────────────────────────────────────

  /**
   * Extract and initialise trap objects from a map definition.
   * @param {object} mapDef — raw map JSON
   */
  loadFromMap(mapDef) {
    this._traps  = (mapDef.objects ?? []).filter(o => o.object_type === 'trap');
    this._resets = [];

    // Ensure runtime boolean state exists on each trap
    for (const trap of this._traps) {
      if (typeof trap.detected  !== 'boolean') trap.detected  = !trap.hidden;
      if (typeof trap.triggered !== 'boolean') trap.triggered = false;
    }

    console.log(`[Traps] Loaded ${this._traps.length} trap(s) from map.`);
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  /** Return the trap at (x, y, floor), or null. */
  getTrapAt(x, y, floor = 0) {
    return this._traps.find(
      t => t.tile_x === x && t.tile_y === y && (t.floor ?? 0) === floor
    ) ?? null;
  }

  /** All traps that have been detected but not yet triggered (show on map). */
  getDetectedTraps() {
    return this._traps.filter(t => t.detected && !t.triggered);
  }

  /** All traps (for rendering hidden-trap sprites if Thief is in party). */
  getAllTraps() { return this._traps; }

  // ── Passive detection (called every turn when Thief is in party) ───────────

  /**
   * Attempt passive detection for all undiscovered traps within 3 tiles.
   * @param {number}   partyX
   * @param {number}   partyY
   * @param {object[]} partyMembers — Character instances
   */
  passiveCheck(partyX, partyY, partyMembers) {
    const hasThief = partyMembers.some(
      m => (m.def?.class_id ?? m.class_id) === 'thief'
    );
    if (!hasThief) return;

    for (const trap of this._traps) {
      if (trap.detected || trap.triggered) continue;
      const dist = Math.abs(trap.tile_x - partyX) + Math.abs(trap.tile_y - partyY);
      if (dist > 3) continue;

      // d20 + 5 thief skill bonus vs detection_dc
      const roll = Math.floor(Math.random() * 20) + 1 + 5;
      if (roll >= (trap.detection_dc ?? 12)) {
        this._detect(trap);
      }
    }
  }

  // ── Active search (F key facing tile) ─────────────────────────────────────

  /**
   * Attempt to actively detect a trap at the target tile.
   * @param {number}   targetX
   * @param {number}   targetY
   * @param {object[]} partyMembers
   * @returns {boolean} true if a trap was found/already known
   */
  activeSearch(targetX, targetY, partyMembers) {
    const trap = this.getTrapAt(targetX, targetY, 0);
    if (!trap) return false;
    if (trap.detected) return true;  // already known

    const hasThief = partyMembers.some(
      m => (m.def?.class_id ?? m.class_id) === 'thief'
    );

    // Non-thief: +5 harder DC; Thief: standard roll with +5 bonus
    const bonus = hasThief ? 5 : 0;
    const dc    = (trap.detection_dc ?? 12) + (hasThief ? 0 : 5);
    const roll  = Math.floor(Math.random() * 20) + 1 + bonus;

    if (roll >= dc) {
      this._detect(trap);
      return true;
    }
    return false;
  }

  // ── Step check (called on every party move) ────────────────────────────────

  /**
   * Check if the party stepped onto an undetected trap tile and trigger it.
   * Detected but undisarmed traps are NOT auto-triggered here — the player
   * gets an interaction prompt instead.
   *
   * @param {number}   tileX
   * @param {number}   tileY
   * @param {object}   partyLead   — Character instance
   * @param {number}   currentTurn
   * @returns {boolean} true if a trap triggered
   */
  checkStep(tileX, tileY, partyLead, currentTurn) {
    const trap = this.getTrapAt(tileX, tileY, 0);
    if (!trap) return false;
    if (trap.triggered) return false;  // spent (or timed reset pending)
    if (trap.detected)  return false;  // player can see it — let them choose

    this._trigger(trap, partyLead, currentTurn);
    return true;
  }

  // ── Disarm attempt (E key on detected trap) ────────────────────────────────

  /**
   * Attempt to disarm a detected trap.  Requires the Thief (hard lock).
   * On success: mark safe and fire on_disarm_event.
   * On failure: the trap triggers on the acting character.
   *
   * @param {object}   trap
   * @param {object[]} partyMembers
   * @param {object}   partyLead    — Character instance (takes damage on fail)
   * @param {number}   currentTurn
   * @returns {{ success: boolean, message: string }}
   */
  attemptDisarm(trap, partyMembers, partyLead, currentTurn) {
    const result = Lock.resolve('disarm_trap', 'hard', partyMembers);

    if (result.success) {
      trap.triggered = true;  // safe — spent
      trap.detected  = true;
      console.log(`[Traps] Disarmed: ${trap.object_id}`);
      if (trap.on_disarm_event && this._fireEvent) {
        this._fireEvent(trap.on_disarm_event);
      }
      if (this._onDisarm) this._onDisarm(trap);
      return { success: true, message: 'You carefully disarm the trap.' };
    } else {
      // Failed disarm — trap fires on the disarmer
      this._trigger(trap, partyLead, currentTurn);
      return { success: false, message: 'You fumble the disarm — the trap triggers!' };
    }
  }

  // ── Turn advance (reset timed traps) ─────────────────────────────────────

  /**
   * Called once per game turn to process pending trap resets.
   * @param {number} currentTurn
   */
  onTurnAdvance(currentTurn) {
    const pending = [];
    for (const entry of this._resets) {
      if (currentTurn >= entry.resetAtTurn) {
        entry.trap.triggered = false;
        console.log(`[Traps] Reset: ${entry.trap.object_id} (${entry.trap.trap_type})`);
      } else {
        pending.push(entry);
      }
    }
    this._resets = pending;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _detect(trap) {
    trap.detected = true;
    console.log(`[Traps] Detected: ${trap.object_id} (${trap.trap_type}) at (${trap.tile_x},${trap.tile_y})`);
    if (this._onDetect) this._onDetect(trap);
  }

  _trigger(trap, partyLead, currentTurn) {
    trap.triggered = true;
    console.log(`[Traps] Triggered: ${trap.object_id}`);

    // Apply effects to the party lead
    const effects = trap.on_trigger_effects ?? [];
    for (const eff of effects) {
      this._applyEffect(eff, partyLead);
    }

    // Fire scripted event
    if (trap.on_trigger_event && this._fireEvent) {
      this._fireEvent(trap.on_trigger_event);
    }

    if (this._onTrigger) this._onTrigger(trap, effects);

    // Schedule reset for traps that rearm themselves
    const resetDelay = TRAP_RESET_TURNS[trap.trap_type];
    if (resetDelay && currentTurn > 0) {
      this._resets.push({ trap, resetAtTurn: currentTurn + resetDelay });
    }
  }

  _applyEffect(effect, partyLead) {
    if (!partyLead) return;
    const name = partyLead.def?.display_name ?? partyLead.name ?? 'Party lead';

    if (effect.type === 'deal_damage') {
      const dmg = effect.value ?? 5;
      partyLead.def.base_stats.hp = Math.max(0, partyLead.def.base_stats.hp - dmg);
      console.log(`[Traps] ${name} takes ${dmg} trap damage → HP ${partyLead.def.base_stats.hp}`);
    } else if (effect.type === 'apply_status') {
      // Outside of combat, statuses are logged only (no status effect engine in world mode)
      console.log(`[Traps] ${name} would gain status: ${effect.status_id} (${effect.duration_turns ?? '?'} turns)`);
    }
  }
}

export const Traps = new TrapManager();
