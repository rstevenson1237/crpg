/**
 * events.js — Event registry, trigger evaluation, and action executor.
 *
 * The campaign nervous system: every non-rendering game state change flows
 * through here. Supports timeline, location, and action triggers; AND/OR
 * condition evaluation; sequential action execution with pause/resume for
 * narration cards and screen fades.
 *
 * Exposed as window.Events for console testing.
 */

import { GameState } from './gamestate.js';

// ─── Module-level state ──────────────────────────────────────────────────────

let _narrationHandler   = null;  // (title, text, onDismiss) => void
let _screenFadeHandler  = null;  // (direction, color, durationMs, onDone) => void
let _dialogueHandler    = null;  // (npcId, rootNodeId, onClose) => void
let _npcSpawnHandler    = null;  // (npcId, mapId, x, y) => void
let _npcDespawnHandler  = null;  // (npcId) => void
let _secretGrantHandler = null;  // (secretId) => void
let _secretRevokeHandler= null;  // (secretId) => void
let _factionHandler     = null;  // (factionId, delta) => void
let _inventoryAddHandler    = null;  // (itemId, qty) => void
let _inventoryRemoveHandler = null;  // (itemId, qty) => boolean
let _lootTableRollHandler   = null;  // (tableId) => [{item_id, quantity}]
let _mapDataRef  = null;
let _gameTimeRef = null;
let _weatherRef  = null;

const _events    = new Map();   // event_id → event def
const _completed = new Map();   // event_id → turn number when completed
const _pending   = [];          // { ev, currentTurn } — queued while paused
let   _paused    = false;

// ─── Public API ──────────────────────────────────────────────────────────────

export const Events = {

  // ── Setup ─────────────────────────────────────────────────────────────────

  load(eventArray) {
    for (const ev of eventArray) _events.set(ev.event_id, ev);
    console.log(`[Events] Loaded ${eventArray.length} event(s).`);
  },

  setNarrationHandler(fn)  { _narrationHandler  = fn; },
  setScreenFadeHandler(fn) { _screenFadeHandler = fn; },
  setDialogueHandler(fn)   { _dialogueHandler   = fn; },
  setNPCHandlers(spawnFn, despawnFn) {
    _npcSpawnHandler   = spawnFn;
    _npcDespawnHandler = despawnFn;
  },
  setSecretHandlers(grantFn, revokeFn) {
    _secretGrantHandler  = grantFn;
    _secretRevokeHandler = revokeFn;
  },
  setFactionHandler(fn) { _factionHandler = fn; },
  setInventoryHandlers(addFn, removeFn, rollFn) {
    _inventoryAddHandler    = addFn;
    _inventoryRemoveHandler = removeFn;
    _lootTableRollHandler   = rollFn;
  },
  setMapData(md)   { _mapDataRef  = md; },
  setGameTime(gt)  { _gameTimeRef = gt; },
  setWeather(w)    { _weatherRef  = w; },

  isPaused()       { return _paused; },
  isComplete(id)   { return _completed.has(id); },
  getCompleted()   { return _completed; },

  /**
   * Directly fire a named event by ID (used by dialogue on_select_fire_event, etc.).
   * Respects conditions, repeat, and pause state.
   * @param {string} eventId
   */
  fireEvent(eventId) {
    const ev = _events.get(eventId);
    if (!ev) { console.warn(`[Events] fireEvent: unknown event "${eventId}"`); return; }
    if (!ev.repeat && _completed.has(eventId)) return;
    if (_paused) { _pending.push({ ev, currentTurn: GameState.currentTurn }); return; }
    if (_evalConditions(ev)) _fireEvent(ev, GameState.currentTurn);
  },

  // ── Triggers called by the game loop ─────────────────────────────────────

  /** Called every movement turn to evaluate timeline triggers. */
  tick(currentTurn) {
    if (_paused) return;
    const cands = [];
    for (const ev of _events.values()) {
      if (!ev.repeat && _completed.has(ev.event_id)) continue;
      if (_checkTimelineTrigger(ev.trigger, currentTurn)) cands.push(ev);
    }
    _processCandidates(cands, currentTurn);
  },

  /** Called by external systems (movement E-key, items, combat, etc.). */
  fireActionTrigger(kind, context) {
    if (_paused) return;
    const cands = [];
    for (const ev of _events.values()) {
      if (!ev.repeat && _completed.has(ev.event_id)) continue;
      if (_checkActionTrigger(ev.trigger, kind, context)) cands.push(ev);
    }
    _processCandidates(cands, GameState.currentTurn);
  },

  /** Called on every party step. */
  checkLocationTriggers(mapId, tileX, tileY) {
    if (_paused) return;
    const cands = [];
    for (const ev of _events.values()) {
      if (!ev.repeat && _completed.has(ev.event_id)) continue;
      if (_checkLocationTrigger(ev.trigger, mapId, tileX, tileY)) cands.push(ev);
    }
    _processCandidates(cands, GameState.currentTurn);
  },

  /** Called when a new map finishes loading. */
  checkMapEnter(mapId) {
    if (_paused) return;
    const cands = [];
    for (const ev of _events.values()) {
      if (!ev.repeat && _completed.has(ev.event_id)) continue;
      const t = ev.trigger;
      if (t?.type === 'location_enter' && t.map_id === mapId) cands.push(ev);
    }
    _processCandidates(cands, GameState.currentTurn);
  },

  /** Called when transitioning away from a map. */
  checkMapExit(mapId) {
    if (_paused) return;
    const cands = [];
    for (const ev of _events.values()) {
      if (!ev.repeat && _completed.has(ev.event_id)) continue;
      const t = ev.trigger;
      if (t?.type === 'location_exit' && t.map_id === mapId) cands.push(ev);
    }
    _processCandidates(cands, GameState.currentTurn);
  },
};

if (typeof window !== 'undefined') window.Events = Events;

// ─── Trigger checks ──────────────────────────────────────────────────────────

function _checkTimelineTrigger(trigger, currentTurn) {
  if (!trigger || trigger.type !== 'timeline') return false;

  if (trigger.at_time_of_day) {
    return _gameTimeRef?.getState() === trigger.at_time_of_day;
  }
  if (trigger.reference === 'game_start') {
    return currentTurn >= (trigger.delay_turns ?? 0);
  }
  if (trigger.reference === 'event_complete') {
    const completedTurn = _completed.get(trigger.after_event);
    if (completedTurn === undefined) return false;
    return currentTurn >= completedTurn + (trigger.delay_turns ?? 0);
  }
  return false;
}

function _checkActionTrigger(trigger, kind, context) {
  if (!trigger || trigger.type !== 'action') return false;
  if (trigger.action_kind !== kind) return false;
  switch (kind) {
    case 'object_interacted':      return trigger.object_id        === context.object_id;
    case 'npc_dialogue_completed': return trigger.npc_id           === context.npc_id &&
                                          trigger.dialogue_node_id === context.dialogue_node_id;
    case 'item_used':              return trigger.item_id === context.item_id &&
                                          (!trigger.on_map_id || trigger.on_map_id === context.map_id);
    case 'secret_discovered':      return trigger.secret_id      === context.secret_id;
    case 'party_member_joins':     return trigger.character_id   === context.character_id;
    case 'combat_complete':        return trigger.encounter_id   === context.encounter_id;
    default:                       return true;
  }
}

function _checkLocationTrigger(trigger, mapId, tileX, tileY) {
  if (!trigger || trigger.type !== 'location_tile') return false;
  if (trigger.map_id !== mapId) return false;
  const r  = trigger.trigger_radius ?? 0;
  const dx = trigger.tile_x - tileX;
  const dy = trigger.tile_y - tileY;
  return r === 0 ? (dx === 0 && dy === 0) : (dx * dx + dy * dy <= r * r);
}

// ─── Condition evaluation ────────────────────────────────────────────────────

function _evalConditions(event) {
  const conds = event.conditions ?? [];
  if (!conds.length) return true;
  const join = event.condition_join ?? 'and';
  for (const c of conds) {
    const pass = _evalCondition(c);
    if (join === 'and' && !pass) return false;
    if (join === 'or'  &&  pass) return true;
  }
  return join === 'and';
}

function _evalCondition(c) {
  const gs = GameState;
  switch (c.type) {
    case 'flag_is_set':           return gs.flags.isSet(c.flag_id);
    case 'flag_not_set':          return !gs.flags.isSet(c.flag_id);
    case 'event_complete':        return _completed.has(c.event_id);
    case 'event_not_complete':    return !_completed.has(c.event_id);
    case 'party_includes_class':  return gs.party?.active?.some(ch => ch.def.class_id === c.class_id) ?? false;
    case 'party_has_item':        return false; // Phase 7
    case 'variable_gte':          return gs.vars.get(c.variable_id) >= c.value;
    case 'variable_lte':          return gs.vars.get(c.variable_id) <= c.value;
    case 'variable_equals':       return gs.vars.get(c.variable_id) === c.value;
    case 'time_of_day_is':        return _gameTimeRef?.getState() === c.time;
    case 'weather_is':            return _weatherRef?.getState()   === c.weather;
    case 'secret_known':          return gs.hasSecret(c.secret_id);
    case 'faction_standing_gte':  return gs.getFactionStanding(c.faction_id) >= c.value;
    case 'party_size_equals':     return gs.party?.active?.length === c.size;
    case 'map_is':                return gs.currentMap === c.map_id;
    default:
      console.warn(`[Events] Unknown condition type: ${c.type}`);
      return true;
  }
}

// ─── Firing ──────────────────────────────────────────────────────────────────

function _processCandidates(cands, currentTurn) {
  if (!cands.length) return;
  cands.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const ev of cands) {
    if (!_evalConditions(ev)) continue;
    if (_paused) {
      _pending.push({ ev, currentTurn });
    } else {
      _fireEvent(ev, currentTurn);
    }
  }
}

function _fireEvent(ev, currentTurn) {
  const turn = currentTurn ?? GameState.currentTurn;
  if (!ev.repeat) _completed.set(ev.event_id, turn);
  console.log(`[Events] Firing: ${ev.event_id}  "${ev.event_label ?? ''}"`);

  _executeActions(ev.actions ?? [], 0, () => {
    // Chain: fire on_complete_fire_event after all actions resolve
    if (ev.on_complete_fire_event) {
      const chained = _events.get(ev.on_complete_fire_event);
      if (chained && (!_completed.has(chained.event_id) || chained.repeat)) {
        if (_evalConditions(chained)) {
          if (_paused) {
            _pending.push({ ev: chained, currentTurn: turn });
          } else {
            _fireEvent(chained, turn);
          }
        }
      }
    }
    _drainPending();
  });
}

function _drainPending() {
  while (_pending.length > 0 && !_paused) {
    const { ev, currentTurn } = _pending.shift();
    if (!ev.repeat && _completed.has(ev.event_id)) continue;
    if (_evalConditions(ev)) _fireEvent(ev, currentTurn);
  }
}

// ─── Action execution ────────────────────────────────────────────────────────

function _executeActions(actions, index, onDone) {
  if (index >= actions.length) { onDone(); return; }
  _executeAction(actions[index], () => _executeActions(actions, index + 1, onDone));
}

function _executeAction(action, next) {
  const gs = GameState;

  switch (action.type) {

    // ── State mutations ────────────────────────────────────────────────────
    case 'set_flag':
      gs.flags.set(action.flag_id);
      next(); break;

    case 'clear_flag':
      gs.flags.clear(action.flag_id);
      next(); break;

    case 'set_variable':
      gs.vars.set(action.variable_id, action.value);
      next(); break;

    case 'increment_variable':
      gs.vars.increment(action.variable_id, action.amount ?? 1);
      next(); break;

    case 'grant_secret':
      if (_secretGrantHandler) _secretGrantHandler(action.secret_id);
      else gs.addSecret(action.secret_id);
      next(); break;

    case 'revoke_secret':
      if (_secretRevokeHandler) _secretRevokeHandler(action.secret_id);
      else gs.secrets.delete(action.secret_id);
      next(); break;

    case 'add_world_log_entry':
      gs.worldLog.push({ turn: gs.currentTurn, text: action.text });
      console.log(`[WorldLog] T${gs.currentTurn}: ${action.text}`);
      next(); break;

    case 'modify_npc_faction_standing':
      if (_factionHandler) _factionHandler(action.faction_id, action.delta);
      else gs.modifyFaction(action.faction_id, action.delta);
      next(); break;

    // ── Map mutations ─────────────────────────────────────────────────────
    case 'modify_map_object':
      _mapDataRef?.setObjectState(action.object_id, action.new_state);
      next(); break;

    case 'modify_map_tile':
      if (_mapDataRef && _mapDataRef.def.map_id === action.map_id) {
        _mapDataRef.setTile(action.tile_x, action.tile_y, _mapDataRef.currentFloor, action.new_tile_id);
      }
      next(); break;

    // ── World state ────────────────────────────────────────────────────────
    case 'set_weather':
      _weatherRef?.setState(action.weather);
      next(); break;

    case 'set_time_of_day':
      _gameTimeRef?.skipToState(action.time);
      next(); break;

    // ── Event chaining ─────────────────────────────────────────────────────
    case 'fire_event': {
      const target = _events.get(action.event_id);
      if (target && (!_completed.has(target.event_id) || target.repeat)) {
        if (_evalConditions(target)) {
          if (_paused) _pending.push({ ev: target, currentTurn: gs.currentTurn });
          else _fireEvent(target, gs.currentTurn);
        }
      }
      next(); break;
    }

    // ── Pausing actions (async — do NOT call next() here) ─────────────────
    case 'show_narration':
      _paused = true;
      if (_narrationHandler) {
        _narrationHandler(action.title ?? null, action.text, () => {
          _paused = false;
          _drainPending();
          next();
        });
      } else {
        console.log(`[Narration] ${action.title ? action.title + ': ' : ''}${action.text}`);
        _paused = false;
        next();
      }
      return; // intentional — do not fall through to next()

    case 'screen_fade':
      _paused = true;
      if (_screenFadeHandler) {
        _screenFadeHandler(action.direction, action.color ?? '#000000', action.duration_ms ?? 500, () => {
          _paused = false;
          _drainPending();
          next();
        });
      } else {
        _paused = false;
        next();
      }
      return;

    // ── Dialogue (pausing action — calls next() via callback) ─────────────
    case 'show_dialogue':
      _paused = true;
      if (_dialogueHandler) {
        _dialogueHandler(action.npc_id, action.dialogue_root_id, () => {
          _paused = false;
          _drainPending();
          next();
        });
      } else {
        console.log(`[Events] show_dialogue stub: npc=${action.npc_id} root=${action.dialogue_root_id}`);
        _paused = false;
        next();
      }
      return;

    // ── NPC management ─────────────────────────────────────────────────────
    case 'spawn_npc':
      if (_npcSpawnHandler) _npcSpawnHandler(action.npc_id, action.map_id, action.tile_x, action.tile_y);
      else console.log(`[Events] spawn_npc stub: ${action.npc_id}`);
      next(); break;

    case 'despawn_npc':
      if (_npcDespawnHandler) _npcDespawnHandler(action.npc_id);
      else console.log(`[Events] despawn_npc stub: ${action.npc_id}`);
      next(); break;

    case 'grant_item':
      if (_inventoryAddHandler) _inventoryAddHandler(action.item_id, action.quantity ?? 1);
      else console.log(`[Events] grant_item stub: ${action.item_id}`);
      next(); break;

    case 'remove_item':
      if (_inventoryRemoveHandler) _inventoryRemoveHandler(action.item_id, action.quantity ?? 1);
      else console.log(`[Events] remove_item stub: ${action.item_id}`);
      next(); break;

    case 'place_loot_cache': {
      const tableId = action.loot_table_id;
      if (_lootTableRollHandler && _inventoryAddHandler) {
        const results = _lootTableRollHandler(tableId);
        for (const { item_id, quantity } of results) _inventoryAddHandler(item_id, quantity);
        if (results.length > 0 && _narrationHandler) {
          const lines = results.map(r => `• ${r.quantity}× ${r.item_id.replace('item_', '').replace(/_/g, ' ')}`).join('\n');
          _paused = true;
          _narrationHandler(null, `You found:\n${lines}`, () => {
            _paused = false;
            _drainPending();
            next();
          });
          return; // intentional — resume via callback
        }
      } else {
        console.log(`[Events] place_loot_cache stub: table=${tableId}`);
      }
      next(); break;
    }

    case 'add_party_member': case 'remove_party_member':
    case 'lock_party_member': case 'unlock_party_member':
    case 'grant_skill_unlock': case 'modify_npc_schedule':
    case 'trigger_encounter':
    case 'teleport_party': case 'grant_mentor_training':
    case 'set_music_mood':
      console.log(`[Events] Stub action: ${action.type}`);
      next(); break;

    default:
      console.warn(`[Events] Unknown action type: ${action.type}`);
      next(); break;
  }
}
