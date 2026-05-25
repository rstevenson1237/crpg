/**
 * npc.js — NPC system: definitions, placement, rendering, schedule management.
 *
 * NPCs render on LAYER.CHARACTERS (Layer 4), Y-sorted among themselves.
 * They block movement and have a 1-tile interaction radius.
 *
 * Exposed as window.NPCs for console testing.
 */

import { LAYER } from './renderer.js';

const TILE_SIZE = 32;

// Body colors keyed by NPC tags (first matching tag wins)
const TAG_COLORS = {
  elder:      '#99aa88',
  guard:      '#8899aa',
  merchant:   '#bb8833',
  quest_giver:'#aabbcc',
  priest:     '#bbbbee',
  scholar:    '#8899bb',
  blacksmith: '#887766',
  innkeeper:  '#bb9966',
};
const DEFAULT_COLOR = '#aa9988';

const DIR_ROWS   = { south: 0, north: 1, east: 2, west: 3 };
const TIME_ORDER = ['dawn','morning','noon','afternoon','dusk','evening','night','midnight'];

// ─── Procedural sprite generation ─────────────────────────────────────────────

function _generateSprite(def) {
  const canvas = new OffscreenCanvas(96, 128);
  const ctx    = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let bodyColor = DEFAULT_COLOR;
  for (const tag of (def.tags ?? [])) {
    if (TAG_COLORS[tag]) { bodyColor = TAG_COLORS[tag]; break; }
  }
  const headColor = _lighten(bodyColor, 0.18);

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      _drawSpriteFrame(ctx, col * 32, row * 32, row, col, bodyColor, headColor);
    }
  }
  return canvas;
}

function _drawSpriteFrame(ctx, px, py, dirRow, frameCol, bodyColor, headColor) {
  const bob = frameCol === 1 ? -1 : frameCol === 2 ? 1 : 0;
  ctx.fillStyle = bodyColor;
  ctx.fillRect(px + 6, py + 10 + bob, 20, 20);
  ctx.fillStyle = headColor;
  ctx.fillRect(px + 9, py + 2 + bob, 14, 12);
  // Small facing indicator (slightly different tint from player)
  ctx.fillStyle = 'rgba(210,210,170,0.85)';
  const cx = px + 16, cy = py + 16;
  let dx, dy;
  switch (dirRow) {
    case 0: dx = cx - 2; dy = py + 27 + bob; break; // south
    case 1: dx = cx - 2; dy = py + 2  + bob; break; // north
    case 2: dx = px + 25; dy = cy - 2 + bob; break; // east
    default:dx = px + 2;  dy = cy - 2 + bob; break; // west
  }
  ctx.fillRect(dx, dy, 4, 4);
}

function _lighten(hex, amount) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  const add = Math.floor(amount * 255);
  return `#${_h(r+add)}${_h(g+add)}${_h(b+add)}`;
}
function _h(n) { return Math.min(255, n).toString(16).padStart(2, '0'); }

// ─── NPC instance ─────────────────────────────────────────────────────────────

class NPCInstance {
  constructor(def) {
    this.def          = def;
    this.mapId        = def.map_id;
    this.tileX        = def.tile_x;
    this.tileY        = def.tile_y;
    this.facing       = def.facing ?? 'south';
    this.available    = true;
    this.dialogueRoot = def.dialogue_root;
    this._sprite      = _generateSprite(def);
    this._idleMs      = 0;
  }

  getSprite() { return this._sprite; }

  getCurrentFrame() {
    const row = DIR_ROWS[this.facing] ?? 0;
    const col = Math.floor(this._idleMs / 900) % 2 === 1 ? 2 : 0;
    return { col, row };
  }

  update(deltaMs) { this._idleMs += deltaMs; }

  /** Turn to face the player when they are exactly 1 tile away (cardinal). */
  faceToward(playerX, playerY) {
    const dx = playerX - this.tileX;
    const dy = playerY - this.tileY;
    if (Math.abs(dx) === 1 && dy === 0) {
      this.facing = dx > 0 ? 'east' : 'west';
    } else if (dx === 0 && Math.abs(dy) === 1) {
      this.facing = dy > 0 ? 'south' : 'north';
    }
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const _defs    = new Map();  // npc_id → raw def JSON
const _spawned = new Map();  // npc_id → NPCInstance

// ─── Public API ───────────────────────────────────────────────────────────────

export const NPCs = {

  /** Register NPC definitions from a parsed JSON array. */
  load(npcArray) {
    for (const def of npcArray) _defs.set(def.npc_id, def);
    console.log(`[NPCs] Loaded ${npcArray.length} NPC def(s).`);
  },

  /** Place a single NPC by ID onto a map (optional tile override). */
  spawn(npcId, mapId, tileX, tileY) {
    const def = _defs.get(npcId);
    if (!def) { console.warn(`[NPCs] Unknown NPC: ${npcId}`); return; }
    const merged = Object.assign({}, def, {
      map_id: mapId ?? def.map_id,
      tile_x: tileX ?? def.tile_x,
      tile_y: tileY ?? def.tile_y,
    });
    _spawned.set(npcId, new NPCInstance(merged));
    console.log(`[NPCs] Spawned ${npcId} at (${merged.tile_x},${merged.tile_y}) on ${merged.map_id}.`);
  },

  /** Spawn all registered NPCs whose map_id matches the given map. Skips initially_hidden ones. */
  spawnForMap(mapId) {
    for (const [id, def] of _defs) {
      if (def.map_id === mapId && !def.initially_hidden) {
        this.spawn(id, mapId, def.tile_x, def.tile_y);
      }
    }
  },

  despawn(npcId) {
    _spawned.delete(npcId);
    console.log(`[NPCs] Despawned ${npcId}.`);
  },

  /** @returns {NPCInstance|null} */
  getAtTile(mapId, tileX, tileY) {
    for (const npc of _spawned.values()) {
      if (npc.available && npc.mapId === mapId && npc.tileX === tileX && npc.tileY === tileY) {
        return npc;
      }
    }
    return null;
  },

  /** Returns true if a live NPC occupies this tile. */
  isNPCAt(mapId, tileX, tileY) {
    return this.getAtTile(mapId, tileX, tileY) !== null;
  },

  /** Get NPC instance by ID (for speaker name lookup etc.). */
  getById(npcId) { return _spawned.get(npcId) ?? null; },

  getAllOnMap(mapId) {
    return [..._spawned.values()].filter(n => n.available && n.mapId === mapId);
  },

  /**
   * Apply time-of-day schedule overrides. Call once per game-turn advance.
   * @param {import('./time.js').GameTime} gameTime
   */
  update(gameTime) {
    const state = gameTime.getState();
    for (const npc of _spawned.values()) {
      const match = (npc.def.schedule ?? []).find(e => _inRange(state, e.time_start, e.time_end));
      if (match) {
        npc.available    = match.available !== false;
        npc.dialogueRoot = match.dialogue_root_override ?? npc.def.dialogue_root;
        if (match.position) {
          npc.tileX = match.position.tile_x;
          npc.tileY = match.position.tile_y;
        }
      } else {
        // No active schedule entry — restore defaults
        npc.available    = true;
        npc.dialogueRoot = npc.def.dialogue_root;
        npc.tileX        = npc.def.tile_x;
        npc.tileY        = npc.def.tile_y;
      }
    }
  },

  /** Make adjacent NPCs face the player. Call every movement tick. */
  updateFacing(mapId, playerX, playerY) {
    for (const npc of _spawned.values()) {
      if (npc.available && npc.mapId === mapId) npc.faceToward(playerX, playerY);
    }
  },

  /**
   * Render all spawned NPCs for a map onto LAYER.CHARACTERS.
   * Call after party.render() — does NOT clear the layer.
   */
  render(renderer, camera, mapId, deltaMs) {
    const npcs = [];
    for (const npc of _spawned.values()) {
      if (npc.available && npc.mapId === mapId) {
        npc.update(deltaMs);
        npcs.push(npc);
      }
    }
    npcs.sort((a, b) => a.tileY - b.tileY || a.tileX - b.tileX);

    const charCtx   = renderer.getLayerContext(LAYER.CHARACTERS);
    const shadowCtx = renderer.getLayerContext(LAYER.ENTITY_SHADOW);

    for (const npc of npcs) {
      const screen  = camera.worldToScreen(npc.tileX, npc.tileY);
      const { col, row } = npc.getCurrentFrame();

      // Drop shadow
      shadowCtx.fillStyle = 'rgba(0,0,0,0.28)';
      shadowCtx.fillRect(screen.x + 4, screen.y + 26, 24, 5);

      // Sprite frame
      charCtx.drawImage(
        npc.getSprite(),
        col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE,
        screen.x, screen.y, TILE_SIZE, TILE_SIZE
      );

      // Floating name tag
      charCtx.save();
      charCtx.font         = '8px monospace';
      charCtx.textAlign    = 'center';
      charCtx.textBaseline = 'bottom';
      const label = npc.def.display_name;
      const tw = charCtx.measureText(label).width + 6;
      charCtx.fillStyle = 'rgba(0,0,0,0.72)';
      charCtx.fillRect(screen.x + 16 - tw / 2, screen.y - 11, tw, 10);
      charCtx.fillStyle = '#ffe070';
      charCtx.fillText(label, screen.x + 16, screen.y - 1);
      charCtx.restore();
    }
  },
};

if (typeof window !== 'undefined') window.NPCs = NPCs;

// ─── Time range helper ────────────────────────────────────────────────────────

function _inRange(current, start, end) {
  const ci = TIME_ORDER.indexOf(current);
  const si = TIME_ORDER.indexOf(start);
  const ei = TIME_ORDER.indexOf(end);
  if (ci < 0 || si < 0 || ei < 0) return false;
  // Handle wrap-around (e.g. night → dawn)
  return si <= ei ? (ci >= si && ci <= ei) : (ci >= si || ci <= ei);
}
