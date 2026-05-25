/**
 * renderer.js — Canvas rendering engine
 * 12-layer composited renderer for the CRPG engine.
 * Logical resolution: 640×480. Integer scaling only (2×, 3×, 4×).
 */

export const LAYER = {
  TERRAIN_BASE:    0,
  TERRAIN_DETAIL:  1,
  OBJECT_BASE:     2,
  ENTITY_SHADOW:   3,
  CHARACTERS:      4,
  OBJECT_OVERLAY:  5,
  WEATHER:         6,
  LIGHTING:        7,
  EFFECTS:         8,
  UI_CHROME:       9,
  DIALOGUE:        10,
  TRANSITION:      11,
};

const LAYER_COUNT = 12;
const LOGICAL_W = 640;
const LOGICAL_H = 480;

export class Renderer {
  constructor() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    // Main display canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'main-canvas';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    document.body.appendChild(this.canvas);

    // 12 offscreen layer canvases
    this.layers = [];
    this.layerCtxs = [];
    for (let i = 0; i < LAYER_COUNT; i++) {
      const c = new OffscreenCanvas(LOGICAL_W, LOGICAL_H);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      this.layers.push(c);
      this.layerCtxs.push(ctx);
    }

    this._applyScale();
    window.addEventListener('resize', () => this._applyScale());
  }

  _applyScale() {
    const scaleX = Math.floor(window.innerWidth / LOGICAL_W);
    const scaleY = Math.floor(window.innerHeight / LOGICAL_H);
    this.scale = Math.max(1, Math.min(scaleX, scaleY));

    const displayW = LOGICAL_W * this.scale;
    const displayH = LOGICAL_H * this.scale;

    this.canvas.width  = displayW;
    this.canvas.height = displayH;
    // Canvas resize resets context state; restore pixel-art setting
    this.ctx.imageSmoothingEnabled = false;
    this.canvas.style.display = 'block';

    // Center in window
    this.offsetX = Math.floor((window.innerWidth  - displayW) / 2);
    this.offsetY = Math.floor((window.innerHeight - displayH) / 2);
    this.canvas.style.position = 'absolute';
    this.canvas.style.left = this.offsetX + 'px';
    this.canvas.style.top  = this.offsetY + 'px';

    this.ctx.imageSmoothingEnabled = false;
  }

  /** Clear a single layer. */
  clearLayer(layerIndex) {
    const ctx = this.layerCtxs[layerIndex];
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
  }

  /** Clear all layers. */
  clearAll() {
    for (let i = 0; i < LAYER_COUNT; i++) this.clearLayer(i);
  }

  /**
   * Draw a tile (32×32 region from a tileset ImageBitmap) at tile coords.
   * @param {number} layerIndex
   * @param {ImageBitmap|OffscreenCanvas|HTMLCanvasElement} bitmap - source tileset image
   * @param {number} srcX - pixel X in source
   * @param {number} srcY - pixel Y in source
   * @param {number} destX - destination pixel X on layer
   * @param {number} destY - destination pixel Y on layer
   * @param {number} [w=32]
   * @param {number} [h=32]
   */
  drawTile(layerIndex, bitmap, srcX, srcY, destX, destY, w = 32, h = 32) {
    this.layerCtxs[layerIndex].drawImage(bitmap, srcX, srcY, w, h, destX, destY, w, h);
  }

  /**
   * Draw a sprite frame at pixel coordinates on a layer.
   * @param {number} layerIndex
   * @param {ImageBitmap|OffscreenCanvas|HTMLCanvasElement} sheet
   * @param {number} frameX - pixel X of frame in sheet
   * @param {number} frameY - pixel Y of frame in sheet
   * @param {number} destX
   * @param {number} destY
   * @param {number} [w=32]
   * @param {number} [h=32]
   */
  drawSprite(layerIndex, sheet, frameX, frameY, destX, destY, w = 32, h = 32) {
    this.layerCtxs[layerIndex].drawImage(sheet, frameX, frameY, w, h, destX, destY, w, h);
  }

  /**
   * Draw a filled rectangle on a layer.
   * @param {number} layerIndex
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {string} color - CSS color string
   * @param {number} [alpha=1]
   */
  drawRect(layerIndex, x, y, w, h, color, alpha = 1) {
    const ctx = this.layerCtxs[layerIndex];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /**
   * Composite all layers onto the main canvas in order.
   * Layer 7 (LIGHTING) uses 'multiply' composite operation.
   */
  composite() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(this.scale, this.scale);

    for (let i = 0; i < LAYER_COUNT; i++) {
      if (i === LAYER.LIGHTING) {
        ctx.globalCompositeOperation = 'multiply';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(this.layers[i], 0, 0);
    }

    ctx.restore();
  }

  /** Get the 2D context for a specific layer (for direct drawing). */
  getLayerContext(layerIndex) {
    return this.layerCtxs[layerIndex];
  }

  getLogicalWidth()  { return LOGICAL_W; }
  getLogicalHeight() { return LOGICAL_H; }
}
