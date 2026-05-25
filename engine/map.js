/**
 * map.js — Map loader, data container, and layer renderer.
 *
 * Handles Tier 1/2 map rendering across Layers 0–5 and the fog-of-war
 * overlay on Layer 7.
 */

import { LAYER } from './renderer.js';
import { loadTileset } from './tileset.js';
import { computeAutotileBitmask, getAutotileVariantId } from './autotile.js';

const TILE_SIZE = 32;
const VISIBILITY_RADIUS = 10;

// Procedural placeholder colors for object types
const OBJECT_COLORS = {
  chest_locked:    '#c8a020',
  chest_closed:    '#b08820',
  chest_open:      '#e0c060',
  door_closed:     '#6b4c2a',
  door_open:       '#c8966e',
  door_locked:     '#4a3018',
  portcullis_up:   '#888888',
  portcullis_down: '#555555',
  default:         '#ff00ff',
};

// ─── MapData ─────────────────────────────────────────────────────────────────

export class MapData {
  /**
   * @param {object} def - parsed map JSON
   * @param {import('./tileset.js').Tileset} tileset
   */
  constructor(def, tileset) {
    this._def     = def;
    this._tileset = tileset;
    this._floor   = def.current_floor ?? 0;
    this._visited = new Set();
  }

  // ── Tile access ──────────────────────────────────────────────────────────

  /**
   * Get the raw tile ID stored in the tiles array.
   * Returns null if coordinates are out of bounds.
   * @param {number} x
   * @param {number} y
   * @param {number} floor
   * @returns {number|null}
   */
  getTileId(x, y, floor) {
    if (x < 0 || x >= this._def.width || y < 0 || y >= this._def.height) return null;
    const floorOffset = floor * this._def.width * this._def.height;
    return this._def.tiles[floorOffset + y * this._def.width + x] ?? 0;
  }

  /**
   * Get the tile definition at (x, y, floor).
   * Returns null if out of bounds.
   * @param {number} x
   * @param {number} y
   * @param {number} floor
   * @returns {object|null}
   */
  getTile(x, y, floor) {
    const id = this.getTileId(x, y, floor);
    if (id === null) return null;
    return this._tileset.getTileDef(id);
  }

  /**
   * Check whether a tile can be entered by the party.
   * Considers both the tile's passable flag and any object on the tile.
   */
  isPassable(x, y, floor) {
    const tileDef = this.getTile(x, y, floor);
    if (!tileDef || !tileDef.passable) return false;

    const obj = this.getObjectAt(x, y, floor);
    if (obj && !obj.passable) return false;

    return true;
  }

  /**
   * Get the first object at (x, y, floor), or null.
   */
  getObjectAt(x, y, floor) {
    return this._def.objects.find(
      o => o.tile_x === x && o.tile_y === y && o.floor === floor
    ) || null;
  }

  /**
   * Switch the active floor.
   */
  setFloor(index) {
    if (index >= 0 && index < this._def.floors) {
      this._floor = index;
    }
  }

  // ── Visited tile tracking ─────────────────────────────────────────────────

  visit(x, y, floor) {
    this._visited.add(`${x},${y},${floor}`);
  }

  isVisited(x, y, floor) {
    return this._visited.has(`${x},${y},${floor}`);
  }

  // ── Object mutation ───────────────────────────────────────────────────────

  /**
   * Write a new tile ID at (x, y, floor).
   * No-op if coordinates are out of bounds.
   */
  setTile(x, y, floor, tileId) {
    if (x < 0 || x >= this._def.width || y < 0 || y >= this._def.height) return;
    const floorOffset = floor * this._def.width * this._def.height;
    this._def.tiles[floorOffset + y * this._def.width + x] = tileId;
  }

  /**
   * Change an object's state (e.g. open a door).
   * Setting state to 'open' marks the object passable.
   */
  setObjectState(objectId, newState) {
    const obj = this._def.objects.find(o => o.object_id === objectId);
    if (!obj) return;
    obj.state = newState;
    if (newState === 'open') obj.passable = true;
    if (newState === 'closed' || newState === 'locked') obj.passable = false;
  }

  get currentFloor() { return this._floor; }
  get width()  { return this._def.width; }
  get height() { return this._def.height; }
  get def()     { return this._def; }
  get tileset() { return this._tileset; }
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Load a map and its tileset from JSON.
 * @param {string} mapJsonPath
 * @param {string} [tilesetBasePath='/data/tilesets/']
 * @returns {Promise<MapData>}
 */
export async function loadMap(mapJsonPath, tilesetBasePath = '/data/tilesets/') {
  const resp = await fetch(mapJsonPath);
  if (!resp.ok) throw new Error(`Failed to load map: ${mapJsonPath}`);
  const def = await resp.json();

  const tilesetPath = `${tilesetBasePath}${def.tileset}.json`;
  const tileset = await loadTileset(tilesetPath);

  return new MapData(def, tileset);
}

// ─── MapRenderer ─────────────────────────────────────────────────────────────

export class MapRenderer {
  /**
   * @param {import('./renderer.js').Renderer} renderer
   * @param {import('./camera.js').Camera} camera
   */
  constructor(renderer, camera) {
    this._renderer = renderer;
    this._camera   = camera;
  }

  /**
   * Full render pass for the current frame.
   * @param {MapData} mapData
   * @param {number} playerTileX
   * @param {number} playerTileY
   * @param {number} [visibilityRadius]
   */
  render(mapData, playerTileX, playerTileY, visibilityRadius = VISIBILITY_RADIUS) {
    const floor = mapData.currentFloor;

    // Expand the visited set around the player
    this._markVisible(mapData, playerTileX, playerTileY, floor, visibilityRadius);

    // Determine the tile range visible through the camera
    const cam = this._camera.getWorldRect();
    const sc = Math.max(0, Math.floor(cam.x / TILE_SIZE) - 1);
    const sr = Math.max(0, Math.floor(cam.y / TILE_SIZE) - 1);
    const ec = Math.min(mapData.width  - 1, Math.ceil((cam.x + cam.w) / TILE_SIZE));
    const er = Math.min(mapData.height - 1, Math.ceil((cam.y + cam.h) / TILE_SIZE));

    this._renderTerrainBase(mapData, floor, sc, sr, ec, er);
    this._renderTerrainDetail(mapData, floor, sc, sr, ec, er);
    this._renderObjects(mapData, floor, sc, sr, ec, er);
    this._renderFogOfWar(mapData, floor, sc, sr, ec, er, playerTileX, playerTileY, visibilityRadius);
  }

  // ── Private render passes ─────────────────────────────────────────────────

  _markVisible(mapData, px, py, floor, radius) {
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          mapData.visit(px + dx, py + dy, floor);
        }
      }
    }
  }

  _renderTerrainBase(mapData, floor, sc, sr, ec, er) {
    this._renderer.clearLayer(LAYER.TERRAIN_BASE);
    const ctx     = this._renderer.getLayerContext(LAYER.TERRAIN_BASE);
    const tileset = mapData.tileset;
    const tw = tileset.tileWidth;
    const th = tileset.tileHeight;
    const img = tileset.getImage();

    for (let row = sr; row <= er; row++) {
      for (let col = sc; col <= ec; col++) {
        const baseTileId = mapData.getTileId(col, row, floor);
        if (baseTileId === null) continue;

        const tileDef = tileset.getTileDef(baseTileId);
        if (!tileDef) continue;

        // Autotile: compute variant ID for rendering
        let renderTileId = baseTileId;
        if (tileDef.autotile_group) {
          const mask = computeAutotileBitmask(
            (x, y, f) => mapData.getTileId(x, y, f),
            (id)       => tileset.getTileDef(id),
            col, row, floor, tileDef.autotile_group,
            mapData.width, mapData.height
          );
          renderTileId = getAutotileVariantId(baseTileId, tileDef, mask);
        }

        const { x: sx, y: sy } = tileset.getTileCoords(renderTileId);
        const screen = this._camera.worldToScreen(col, row);
        ctx.drawImage(img, sx, sy, tw, th, screen.x, screen.y, tw, th);
      }
    }
  }

  _renderTerrainDetail(mapData, floor, sc, sr, ec, er) {
    this._renderer.clearLayer(LAYER.TERRAIN_DETAIL);
    const detail = mapData.def.tile_detail;
    if (!detail) return;

    const ctx     = this._renderer.getLayerContext(LAYER.TERRAIN_DETAIL);
    const tileset = mapData.tileset;
    const tw = tileset.tileWidth;
    const th = tileset.tileHeight;
    const img = tileset.getImage();
    const W = mapData.width;
    const H = mapData.height;
    const floorOffset = floor * W * H;

    for (let row = sr; row <= er; row++) {
      for (let col = sc; col <= ec; col++) {
        const detailId = detail[floorOffset + row * W + col] || 0;
        if (!detailId) continue;

        const { x: sx, y: sy } = tileset.getTileCoords(detailId);
        const screen = this._camera.worldToScreen(col, row);
        ctx.drawImage(img, sx, sy, tw, th, screen.x, screen.y, tw, th);
      }
    }
  }

  _renderObjects(mapData, floor, sc, sr, ec, er) {
    this._renderer.clearLayer(LAYER.OBJECT_BASE);
    this._renderer.clearLayer(LAYER.OBJECT_OVERLAY);

    // Y-sort visible objects (painter's algorithm)
    const visible = mapData.def.objects
      .filter(o =>
        o.floor === floor &&
        o.tile_x >= sc && o.tile_x <= ec &&
        o.tile_y >= sr && o.tile_y <= er
      )
      .sort((a, b) => a.tile_y - b.tile_y || a.tile_x - b.tile_x);

    for (const obj of visible) {
      const screen = this._camera.worldToScreen(obj.tile_x, obj.tile_y);
      const color  = OBJECT_COLORS[obj.object_type] || OBJECT_COLORS.default;
      const pad    = 3;
      const s = TILE_SIZE - pad * 2;

      // Object body
      this._renderer.drawRect(LAYER.OBJECT_BASE, screen.x + pad, screen.y + pad, s, s, color);

      // Dark border
      const ctx = this._renderer.getLayerContext(LAYER.OBJECT_BASE);
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(screen.x + pad, screen.y + pad, s, s);

      // Tiny label
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        obj.object_type.replace('_', ' ').substring(0, 10),
        screen.x + TILE_SIZE / 2,
        screen.y + TILE_SIZE / 2
      );
    }
  }

  /**
   * Fog of war on Layer 7 (LIGHTING, composite: 'multiply').
   * - Unvisited tiles:          solid black  → multiply gives pure black
   * - Visited, not visible:     dark grey    → multiply darkens/desaturates
   * - Currently visible:        transparent  → multiply is no-op
   */
  _renderFogOfWar(mapData, floor, sc, sr, ec, er, px, py, radius) {
    this._renderer.clearLayer(LAYER.LIGHTING);
    const ctx = this._renderer.getLayerContext(LAYER.LIGHTING);
    const r2  = radius * radius;

    for (let row = sr; row <= er; row++) {
      for (let col = sc; col <= ec; col++) {
        const dx = col - px;
        const dy = row - py;
        const isVisible  = dx * dx + dy * dy <= r2;
        const isVisited  = mapData.isVisited(col, row, floor);
        const screen     = this._camera.worldToScreen(col, row);

        if (!isVisited) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);
        } else if (!isVisible) {
          // ~31% brightness when multiplied — approximates 40% desaturation
          ctx.fillStyle = 'rgb(80, 80, 80)';
          ctx.fillRect(screen.x, screen.y, TILE_SIZE, TILE_SIZE);
        }
        // Visible: leave transparent — multiply passes the terrain colour through
      }
    }
  }
}
