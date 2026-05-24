/**
 * tileset.js — Tileset definition loader and image builder.
 * Loads a tileset JSON and produces an image (procedural if no PNG exists).
 */

const TILES_PER_ROW = 10; // columns in the generated procedural tileset image

export class Tileset {
  /**
   * @param {object} def - parsed tileset JSON
   * @param {OffscreenCanvas|HTMLImageElement} image - the tileset image
   */
  constructor(def, image) {
    this._def = def;
    this._image = image;
    this._tilesPerRow = Math.floor(image.width / def.tile_width);
  }

  /**
   * Get the tile definition for a given tile ID.
   * @param {number} tileId
   * @returns {object|null}
   */
  getTileDef(tileId) {
    return this._def.tiles[String(tileId)] || null;
  }

  /**
   * Get the pixel coordinates of a tile in the tileset image.
   * @param {number} tileId
   * @returns {{ x: number, y: number }}
   */
  getTileCoords(tileId) {
    const col = tileId % this._tilesPerRow;
    const row = Math.floor(tileId / this._tilesPerRow);
    return {
      x: col * this._def.tile_width,
      y: row * this._def.tile_height,
    };
  }

  getImage()    { return this._image; }
  get def()     { return this._def; }
  get tileWidth()  { return this._def.tile_width; }
  get tileHeight() { return this._def.tile_height; }
}

/**
 * Load a tileset from a JSON path.
 * Falls back to procedural image generation if image_path is "procedural"
 * or the image fails to load.
 * @param {string} jsonPath
 * @returns {Promise<Tileset>}
 */
export async function loadTileset(jsonPath) {
  const resp = await fetch(jsonPath);
  if (!resp.ok) throw new Error(`Failed to load tileset JSON: ${jsonPath}`);
  const def = await resp.json();

  let image = null;

  if (def.image_path && def.image_path !== 'procedural') {
    try {
      image = await _loadImage(def.image_path);
    } catch (e) {
      console.warn(`Tileset image not found (${def.image_path}), generating procedurally`);
    }
  }

  if (!image) {
    image = _generateProceduralTileset(def);
  }

  return new Tileset(def, image);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Build a flat-color procedural tileset OffscreenCanvas from the tile definitions.
 * Each tile gets a solid colored 32×32 cell. Autotile variants get connection
 * indicators drawn over the base color.
 */
function _generateProceduralTileset(def) {
  const tw = def.tile_width;
  const th = def.tile_height;

  // Find the highest tile ID we need to accommodate (including autotile variants)
  let maxId = 0;
  for (const [idStr, tileDef] of Object.entries(def.tiles)) {
    maxId = Math.max(maxId, parseInt(idStr));
    if (tileDef.autotile_variants) {
      for (const vid of tileDef.autotile_variants) maxId = Math.max(maxId, vid);
    }
  }

  const rows = Math.ceil((maxId + 1) / TILES_PER_ROW);
  const canvas = new OffscreenCanvas(TILES_PER_ROW * tw, rows * th);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Draw each defined tile
  for (const [idStr, tileDef] of Object.entries(def.tiles)) {
    const id = parseInt(idStr);
    _drawBaseTile(ctx, id, tileDef, tw, th);

    // Draw all autotile variants for this tile
    if (tileDef.autotile_variants) {
      for (let mask = 0; mask < 16; mask++) {
        _drawAutotileVariant(ctx, tileDef.autotile_variants[mask], tileDef, mask, tw, th);
      }
    }
  }

  return canvas;
}

function _tilePos(id, tw, th) {
  const col = id % TILES_PER_ROW;
  const row = Math.floor(id / TILES_PER_ROW);
  return { px: col * tw, py: row * th };
}

function _drawBaseTile(ctx, id, tileDef, tw, th) {
  const { px, py } = _tilePos(id, tw, th);
  const color = tileDef.procedural_color || (tileDef.passable ? '#888888' : '#333333');

  ctx.fillStyle = color;
  ctx.fillRect(px, py, tw, th);

  // Dashed inner border for visual texture
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 3, py + 3, tw - 6, th - 6);

  // Impassable tiles get a heavier dark border
  if (!tileDef.passable) {
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, tw - 2, th - 2);
  }
}

/**
 * Draw one autotile variant — base color plus directional connection indicators.
 * mask bits: N=1, E=2, S=4, W=8
 */
function _drawAutotileVariant(ctx, id, baseTileDef, mask, tw, th) {
  const { px, py } = _tilePos(id, tw, th);
  const color = baseTileDef.procedural_color || '#888888';

  ctx.fillStyle = color;
  ctx.fillRect(px, py, tw, th);

  // Draw bright connector arms based on the bitmask
  const cx = px + tw / 2;
  const cy = py + th / 2;
  const armW = 10;

  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  // N
  if (mask & 1) ctx.fillRect(cx - armW / 2, py, armW, th / 2 + 1);
  // E
  if (mask & 2) ctx.fillRect(cx - 1, cy - armW / 2, tw / 2 + 1, armW);
  // S
  if (mask & 4) ctx.fillRect(cx - armW / 2, cy - 1, armW, th / 2 + 1);
  // W
  if (mask & 8) ctx.fillRect(px, cy - armW / 2, tw / 2 + 1, armW);

  // Center hub
  ctx.fillRect(cx - armW / 2, cy - armW / 2, armW, armW);
}
