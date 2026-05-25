/**
 * status_effects.js — Status effect manager for tactical combat.
 *
 * StatusEffects.apply(combatantId, statusId, duration, source)
 * StatusEffects.tick(combatantId, combatant, allCombatants, spawnFloatingText)
 * StatusEffects.has(combatantId, statusId)
 * StatusEffects.getAll(combatantId)  → [{ id, duration, source }]
 * StatusEffects.remove(combatantId, statusId)
 * StatusEffects.clear(combatantId)
 * StatusEffects.clearAll()
 */

// combatantId → Map(statusId → { duration, source })
const _store = new Map();

export const STATUS_COLORS = {
  poisoned:   '#22cc44',
  burning:    '#ff6622',
  stunned:    '#ffee00',
  slowed:     '#4499ff',
  blinded:    '#aaaaaa',
  frightened: '#ffaa22',
  charmed:    '#ff66ff',
  silenced:   '#999999',
  bleeding:   '#cc2233',
  rooted:     '#884422',
  fortified:  '#88aaff',
  stealthed:  '#1a331a',
  sanctuary:  '#ffee88',
  shield_wall:'#4466aa',
};

export const StatusEffects = {

  /**
   * Apply a status. Extends duration if already active and new duration is longer.
   */
  apply(combatantId, statusId, duration, source = null) {
    let map = _store.get(combatantId);
    if (!map) { map = new Map(); _store.set(combatantId, map); }
    if (map.has(statusId)) {
      const e = map.get(statusId);
      if (duration > e.duration) e.duration = duration;
      return;
    }
    map.set(statusId, { duration, source });
    console.log(`[Status] ${combatantId} ← ${statusId} (${duration}t)`);
  },

  /**
   * Called at the start of a combatant's turn.
   * Applies per-turn damage/effects, decrements durations, removes expired.
   * Mutates combatant.action_state and combatant.current_hp directly.
   */
  tick(combatantId, combatant, allCombatants, spawnFn) {
    const map = _store.get(combatantId);
    if (!map || map.size === 0) return;
    const expired = [];

    for (const [sid, entry] of map) {
      switch (sid) {

        case 'poisoned':
          combatant.current_hp = Math.max(0, combatant.current_hp - 3);
          spawnFn('-3', STATUS_COLORS.poisoned, combatant.tile_x, combatant.tile_y);
          break;

        case 'burning':
          combatant.current_hp = Math.max(0, combatant.current_hp - 4);
          spawnFn('-4', STATUS_COLORS.burning, combatant.tile_x, combatant.tile_y);
          // 20% chance to spread to one adjacent combatant
          if (Math.random() < 0.20) {
            for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
              const adj = allCombatants.find(c =>
                !c.incapacitated &&
                c.tile_x === combatant.tile_x + dx &&
                c.tile_y === combatant.tile_y + dy
              );
              if (adj && !StatusEffects.has(adj.id, 'burning')) {
                StatusEffects.apply(adj.id, 'burning', 2, combatantId);
                spawnFn('FIRE SPREAD', STATUS_COLORS.burning, adj.tile_x, adj.tile_y);
                break;
              }
            }
          }
          break;

        case 'stunned':
          // Skip standard action this turn
          combatant.action_state.has_acted = true;
          spawnFn('STUNNED', STATUS_COLORS.stunned, combatant.tile_x, combatant.tile_y);
          break;

        case 'rooted':
          // Cannot move this turn
          combatant.action_state.has_moved = true;
          spawnFn('ROOTED', STATUS_COLORS.rooted, combatant.tile_x, combatant.tile_y);
          break;

        case 'frightened':
          // Flag for combat engine to auto-move away from source
          if (!combatant.action_state.has_moved && entry.source) {
            combatant._frightenedSource = entry.source;
          }
          spawnFn('FEARED', STATUS_COLORS.frightened, combatant.tile_x, combatant.tile_y);
          break;

        case 'charmed':
          // Flagged — combat engine handles AI control for party members
          spawnFn('CHARMED', STATUS_COLORS.charmed, combatant.tile_x, combatant.tile_y);
          break;

        case 'silenced':
          spawnFn('SILENCED', STATUS_COLORS.silenced, combatant.tile_x, combatant.tile_y);
          break;

        case 'slowed':
          spawnFn('SLOWED', STATUS_COLORS.slowed, combatant.tile_x, combatant.tile_y);
          break;

        case 'blinded':
          spawnFn('BLINDED', STATUS_COLORS.blinded, combatant.tile_x, combatant.tile_y);
          break;

        // bleeding is applied on-move, not on-tick
        // fortified is consumed on next hit, not decremented by turn
        // stealthed, sanctuary, shield_wall — duration managed separately
      }

      entry.duration -= 1;
      if (entry.duration <= 0) expired.push(sid);
    }

    for (const sid of expired) {
      map.delete(sid);
      console.log(`[Status] ${combatantId} — ${sid} expired`);
    }
  },

  has(combatantId, statusId) {
    return (_store.get(combatantId)?.has(statusId)) ?? false;
  },

  /** Returns [{ id, duration, source }] */
  getAll(combatantId) {
    const m = _store.get(combatantId);
    if (!m) return [];
    return [...m.entries()].map(([id, data]) => ({ id, ...data }));
  },

  remove(combatantId, statusId) {
    _store.get(combatantId)?.delete(statusId);
  },

  clear(combatantId) { _store.delete(combatantId); },
  clearAll()          { _store.clear(); },
};

if (typeof window !== 'undefined') window.StatusEffects = StatusEffects;
