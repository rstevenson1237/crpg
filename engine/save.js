/**
 * save.js — IndexedDB-backed save/load system.
 *
 * DB: "crpg_engine_saves", object store: "saves", key = slot (0-2).
 * Call Save.connect(refs) before any save/load, then Save.init() to open the DB.
 * Save.save(slot) serializes current engine state into a versioned snapshot.
 * Save.load(slot) restores that snapshot into the live engine objects.
 */

import { Character } from './character.js';

const DB_NAME    = 'crpg_engine_saves';
const STORE_NAME = 'saves';
const SCHEMA_VER = '1.0';

let _db   = null;
let _refs = {};

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE_NAME, { keyPath: 'slot' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function _store(mode) {
  return _db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function _get(store, key) {
  return new Promise((res, rej) => {
    const r = store.get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror   = () => rej(r.error);
  });
}

function _put(store, val) {
  return new Promise((res, rej) => {
    const r = store.put(val);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

function _del(store, key) {
  return new Promise((res, rej) => {
    const r = store.delete(key);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const Save = {

  NUM_SLOTS: 3,

  /**
   * Connect live engine objects. Call once before save/load.
   * @param {{ GameState, party, mapData, Inventory, Events, gameTime, weather, movement }} refs
   */
  connect(refs) { _refs = refs; },

  async init() {
    _db = await _openDB();
    console.log('[Save] IndexedDB ready.');
  },

  /**
   * Write current engine state to a slot.
   * @param {number} slot
   * @param {string} [label]
   * @returns {Promise<object>} the saved data blob
   */
  async save(slot, label) {
    const { GameState, party, mapData, Inventory, Events, gameTime, weather, movement } = _refs;

    const data = {
      slot,
      version:    SCHEMA_VER,
      timestamp:  new Date().toISOString(),
      save_label: label ?? `Save ${slot + 1}`,

      gamestate: {
        currentTurn: GameState.currentTurn,
        flags:       GameState.flags.toJSON(),
        vars:        GameState.vars.toJSON(),
        secrets:     [...GameState.secrets],
        factions:    [...GameState.factions.entries()],
        worldLog:    GameState.worldLog.slice(-100),
        currentMap:  GameState.currentMap,
      },

      party: {
        maxSize:   party._maxSize,
        leadIndex: party._leadIndex,
        members:   party._active.map(c => JSON.parse(JSON.stringify(c.def))),
        roster:    party._roster.map(c => JSON.parse(JSON.stringify(c.def))),
      },

      inventory: Inventory.serialize(),

      world: {
        currentFloor:    mapData.currentFloor,
        partyPosition:   { x: movement.leadX, y: movement.leadY },
        visitedTiles:    [...mapData.getVisitedTiles()],
        mapObjectStates: mapData.def.objects.map(o => ({
          object_id: o.object_id,
          state:     o.state,
          passable:  o.passable,
        })),
      },

      events: {
        completedEvents: (() => {
          const arr = [];
          Events.getCompleted().forEach((turn, id) => arr.push({ id, turn }));
          return arr;
        })(),
      },

      time:    { totalTurns: gameTime.totalTurns, dayNumber: gameTime.dayNumber },
      weather: { currentState: weather.getState() },
    };

    await _put(_store('readwrite'), data);
    console.log(`[Save] Saved slot ${slot}: "${data.save_label}"`);
    return data;
  },

  /**
   * Restore engine state from a slot.
   * Returns the loaded data, or null if the slot is empty.
   * The caller is responsible for updating any derived state (camera, music, etc.)
   * after load returns.
   */
  async load(slot) {
    const data = await _get(_store('readonly'), slot);
    if (!data) { console.warn(`[Save] Slot ${slot} is empty.`); return null; }

    const { GameState, party, mapData, Inventory, Events, gameTime, weather, movement } = _refs;

    // GameState
    const gs = data.gamestate;
    GameState.currentTurn = gs.currentTurn;
    GameState.flags.fromJSON(gs.flags);
    GameState.vars.fromJSON(gs.vars);
    GameState.secrets.clear();
    for (const id of gs.secrets) GameState.secrets.add(id);
    GameState.factions.clear();
    for (const [id, val] of gs.factions) GameState.factions.set(id, val);
    GameState.worldLog   = gs.worldLog ?? [];
    GameState.currentMap = gs.currentMap;

    // Party
    const pd = data.party;
    party._active     = pd.members.map(def => new Character(def));
    party._roster     = pd.roster.map(def => new Character(def));
    party._maxSize    = pd.maxSize;
    party._leadIndex  = pd.leadIndex;
    party._posHistory = [];

    // Position
    const pos = data.world.partyPosition;
    movement.setLeadPosition(pos.x, pos.y);

    // Inventory
    Inventory.deserialize(data.inventory);

    // Map — visited tiles & object states
    mapData._visited.clear();
    for (const key of data.world.visitedTiles) mapData._visited.add(key);
    mapData.setFloor(data.world.currentFloor);
    for (const saved of data.world.mapObjectStates) {
      const obj = mapData.def.objects.find(o => o.object_id === saved.object_id);
      if (obj) { obj.state = saved.state; obj.passable = saved.passable; }
    }

    // Events completed log
    Events.getCompleted().clear();
    for (const { id, turn } of data.events.completedEvents) {
      Events.getCompleted().set(id, turn);
    }

    // Time
    gameTime.totalTurns = data.time.totalTurns;
    gameTime.dayNumber  = data.time.dayNumber;

    // Weather
    weather.setState(data.weather.currentState);

    console.log(`[Save] Loaded slot ${slot}: "${data.save_label}"`);
    return data;
  },

  /**
   * Get lightweight save metadata for a slot without restoring state.
   * Returns null if the slot is empty.
   */
  async getSaveInfo(slot) {
    const data = await _get(_store('readonly'), slot);
    if (!data) return null;
    return {
      slot,
      label:     data.save_label,
      timestamp: data.timestamp,
      turn:      data.gamestate?.currentTurn ?? 0,
      map:       data.gamestate?.currentMap  ?? '?',
    };
  },

  async deleteSave(slot) {
    await _del(_store('readwrite'), slot);
    console.log(`[Save] Deleted slot ${slot}.`);
  },
};
