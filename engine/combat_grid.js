/**
 * combat_grid.js — Pure grid data structure for the tactical combat arena.
 * 24×18 tile grid, each tile 26px, padded 8px left/right, 6px top/bottom.
 */

import { LAYER } from './renderer.js';

export const COMBAT_TILE  = 26;
export const COMBAT_PAD_X = 8;
export const COMBAT_PAD_Y = 6;
export const COMBAT_W     = 24;
export const COMBAT_H     = 18;

export class CombatGrid {
  constructor() {
    this.width  = COMBAT_W;
    this.height = COMBAT_H;

    // Build 2D array [y][x]
    this._tiles = [];
    for (let y = 0; y < this.height; y++) {
      this._tiles[y] = [];
      for (let x = 0; x < this.width; x++) {
        // Default: floor tile, passable
        this._tiles[y][x] = { passable: true, type: 'floor' };
      }
    }

    // Border walls — 1-tile thick ring
    for (let x = 0; x < this.width; x++) {
      this._tiles[0][x]              = { passable: false, type: 'wall' };
      this._tiles[this.height - 1][x] = { passable: false, type: 'wall' };
    }
    for (let y = 0; y < this.height; y++) {
      this._tiles[y][0]             = { passable: false, type: 'wall' };
      this._tiles[y][this.width - 1] = { passable: false, type: 'wall' };
    }

    // Three pillars
    const pillars = [{ x: 8, y: 6 }, { x: 15, y: 9 }, { x: 11, y: 12 }];
    for (const p of pillars) {
      this._tiles[p.y][p.x] = { passable: false, type: 'pillar' };
    }
  }

  /**
   * Get tile at (x, y), or null if out of bounds.
   */
  getTile(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this._tiles[y][x];
  }

  /**
   * Check if (x, y) is passable, optionally excluding a combatant by id.
   * @param {number} x
   * @param {number} y
   * @param {string|null} excludeId
   * @param {Array} combatants
   */
  isPassable(x, y, excludeId = null, combatants = []) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    const tile = this._tiles[y][x];
    if (!tile || !tile.passable) return false;
    // Check if any active combatant (not excludeId, not incapacitated) occupies (x, y)
    for (const c of combatants) {
      if (c.incapacitated) continue;
      if (c.id === excludeId) continue;
      if (c.tile_x === x && c.tile_y === y) return false;
    }
    return true;
  }

  /**
   * BFS to find all reachable tiles within maxTiles steps.
   * Returns a Set of "x,y" strings. Does NOT include the start tile.
   */
  getMovementRange(startX, startY, maxTiles, excludeId, combatants) {
    const reachable = new Set();
    // BFS: queue entries are [x, y, stepsUsed]
    const queue = [[startX, startY, 0]];
    const visited = new Set();
    visited.add(`${startX},${startY}`);

    while (queue.length > 0) {
      const [cx, cy, steps] = queue.shift();
      if (steps >= maxTiles) continue;

      const neighbors = [
        [cx - 1, cy], [cx + 1, cy],
        [cx, cy - 1], [cx, cy + 1],
      ];
      for (const [nx, ny] of neighbors) {
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (!this.isPassable(nx, ny, excludeId, combatants)) continue;
        reachable.add(key);
        queue.push([nx, ny, steps + 1]);
      }
    }

    return reachable;
  }

  /**
   * BFS pathfinding from (fromX, fromY) to (toX, toY).
   * For non-target tiles: uses isPassable. For the target tile: only checks grid passability.
   * Returns array of {x, y} steps excluding the start, or null if no path.
   */
  findPath(fromX, fromY, toX, toY, excludeId, combatants) {
    if (fromX === toX && fromY === toY) return [];

    const queue = [[fromX, fromY]];
    const visited = new Set();
    const parent = new Map();
    visited.add(`${fromX},${fromY}`);

    while (queue.length > 0) {
      const [cx, cy] = queue.shift();

      const neighbors = [
        [cx - 1, cy], [cx + 1, cy],
        [cx, cy - 1], [cx, cy + 1],
      ];
      for (const [nx, ny] of neighbors) {
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);

        // For target tile: only check grid tile passability (not occupants)
        const isTarget = (nx === toX && ny === toY);
        if (isTarget) {
          const tile = this.getTile(nx, ny);
          if (!tile || !tile.passable) continue;
        } else {
          if (!this.isPassable(nx, ny, excludeId, combatants)) continue;
        }

        parent.set(key, `${cx},${cy}`);

        if (isTarget) {
          // Reconstruct path
          const path = [];
          let cur = key;
          while (cur !== `${fromX},${fromY}`) {
            const [px, py] = cur.split(',').map(Number);
            path.unshift({ x: px, y: py });
            cur = parent.get(cur);
          }
          return path;
        }

        queue.push([nx, ny]);
      }
    }

    return null; // No path found
  }

  /**
   * Overwrite a tile's data. Used by barriers, Breach, etc.
   * @param {number} x
   * @param {number} y
   * @param {{ passable: boolean, type: string }} tile
   */
  setTile(x, y, tile) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this._tiles[y][x] = tile;
  }

  /**
   * Convert logical pixel coords to combat tile coords.
   * Returns { x, y } or null if out of bounds.
   */
  screenToTile(logicalX, logicalY) {
    const tx = Math.floor((logicalX - COMBAT_PAD_X) / COMBAT_TILE);
    const ty = Math.floor((logicalY - COMBAT_PAD_Y) / COMBAT_TILE);
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return null;
    return { x: tx, y: ty };
  }

  /**
   * Render terrain tiles onto the renderer's layers.
   * Walls and floors on LAYER.TERRAIN_BASE, pillars on LAYER.OBJECT_BASE.
   */
  renderTerrain(renderer) {
    const terrainCtx = renderer.getLayerContext(LAYER.TERRAIN_BASE);
    const objectCtx  = renderer.getLayerContext(LAYER.OBJECT_BASE);

    renderer.clearLayer(LAYER.TERRAIN_BASE);
    renderer.clearLayer(LAYER.OBJECT_BASE);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this._tiles[y][x];
        const px = COMBAT_PAD_X + x * COMBAT_TILE;
        const py = COMBAT_PAD_Y + y * COMBAT_TILE;

        if (tile.type === 'wall') {
          // Outer fill
          terrainCtx.fillStyle = '#1a1520';
          terrainCtx.fillRect(px, py, COMBAT_TILE, COMBAT_TILE);
          // Inner inset
          terrainCtx.fillStyle = '#22202a';
          terrainCtx.fillRect(px + 1, py + 1, COMBAT_TILE - 2, COMBAT_TILE - 2);
        } else if (tile.type === 'pillar') {
          // Draw floor base first on terrain
          terrainCtx.fillStyle = '#2d2d3a';
          terrainCtx.fillRect(px, py, COMBAT_TILE, COMBAT_TILE);
          terrainCtx.strokeStyle = '#252530';
          terrainCtx.lineWidth = 1;
          terrainCtx.strokeRect(px + 0.5, py + 0.5, COMBAT_TILE - 1, COMBAT_TILE - 1);

          // Pillar on OBJECT_BASE
          // Pillar inset box
          const inset = 3;
          objectCtx.fillStyle = '#3a3040';
          objectCtx.fillRect(px + inset, py + inset, COMBAT_TILE - inset * 2, COMBAT_TILE - inset * 2);
          // Top highlight
          objectCtx.fillStyle = '#5a5068';
          objectCtx.fillRect(px + inset, py + inset, COMBAT_TILE - inset * 2, 3);
          // Stroke
          objectCtx.strokeStyle = '#4a4050';
          objectCtx.lineWidth = 1;
          objectCtx.strokeRect(px + inset + 0.5, py + inset + 0.5, COMBAT_TILE - inset * 2 - 1, COMBAT_TILE - inset * 2 - 1);
        } else {
          // Floor tile
          terrainCtx.fillStyle = '#2d2d3a';
          terrainCtx.fillRect(px, py, COMBAT_TILE, COMBAT_TILE);
          terrainCtx.strokeStyle = '#252530';
          terrainCtx.lineWidth = 1;
          terrainCtx.strokeRect(px + 0.5, py + 0.5, COMBAT_TILE - 1, COMBAT_TILE - 1);
        }
      }
    }
  }

  /**
   * Render overlay highlights onto the given context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Set<string>} movementRange
   * @param {Set<string>} attackRange
   * @param {{ x: number, y: number }|null} hoveredTile
   */
  renderOverlays(ctx, movementRange, attackRange, hoveredTile) {
    // Grid lines
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const px = COMBAT_PAD_X + x * COMBAT_TILE;
        const py = COMBAT_PAD_Y + y * COMBAT_TILE;
        ctx.strokeRect(px + 0.5, py + 0.5, COMBAT_TILE - 1, COMBAT_TILE - 1);
      }
    }

    // Movement range highlight
    if (movementRange && movementRange.size > 0) {
      ctx.fillStyle = 'rgba(100,150,255,0.25)';
      for (const key of movementRange) {
        const [x, y] = key.split(',').map(Number);
        const px = COMBAT_PAD_X + x * COMBAT_TILE;
        const py = COMBAT_PAD_Y + y * COMBAT_TILE;
        ctx.fillRect(px, py, COMBAT_TILE, COMBAT_TILE);
      }
    }

    // Attack range highlight
    if (attackRange && attackRange.size > 0) {
      ctx.fillStyle = 'rgba(255,100,100,0.20)';
      for (const key of attackRange) {
        const [x, y] = key.split(',').map(Number);
        const px = COMBAT_PAD_X + x * COMBAT_TILE;
        const py = COMBAT_PAD_Y + y * COMBAT_TILE;
        ctx.fillRect(px, py, COMBAT_TILE, COMBAT_TILE);
      }
    }

    // Hovered tile outline
    if (hoveredTile) {
      const px = COMBAT_PAD_X + hoveredTile.x * COMBAT_TILE;
      const py = COMBAT_PAD_Y + hoveredTile.y * COMBAT_TILE;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, COMBAT_TILE - 2, COMBAT_TILE - 2);
    }

    ctx.restore();
  }
}
