/**
 * renderer.js — Canvas rendering engine
 * 12-layer composited renderer for the CRPG engine.
 * Logical resolution: 640×480.
 *
 * Scaling strategy: the main canvas is always kept at 640×480 (logical pixels).
 * CSS width/height stretch it to the largest viewport-fitting size while
 * preserving the 4:3 aspect ratio.  image-rendering: pixelated gives
 * nearest-neighbour upscaling identical to integer scaling at exact multiples
 * and acceptably crisp at fractional multipliers.
 *
 * renderer.scale is always 1 — coordinate math across the engine uses the
 * logical 640×480 space; CSS display scaling is transparent to all callers.
 * renderer.cssScale exposes the current visual multiplier for informational use.
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
    this.scale    = 1;       // always 1 — logical coordinate scale
    this.cssScale = 1;       // current CSS display multiplier (informational)
    this.offsetX  = 0;
    this.offsetY  = 0;

    // Main display canvas — stays at LOGICAL_W × LOGICAL_H
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'main-canvas';
    this.canvas.width  = LOGICAL_W;
    this.canvas.height = LOGICAL_H;

    // Nearest-neighbour upscaling preserves pixel-art sharpness
    this.canvas.style.imageRendering = 'pixelated';
    // Fallback for Firefox / older Safari
    this.canvas.style.imageRendering = '-moz-crisp-edges';
    // Re-apply pixelated (overrides the -moz line where supported)
    this.canvas.style.imageRendering = 'pixelated';

    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    document.body.appendChild(this.canvas);

    // 12 offscreen layer canvases at logical resolution
    this.layers    = [];
    this.layerCtxs = [];
    for (let i = 0; i < LAYER_COUNT; i++) {
      const c   = new OffscreenCanvas(LOGICAL_W, LOGICAL_H);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      this.layers.push(c);
      this.layerCtxs.push(ctx);
    }

    this._applyScale();
    window.addEventListener('resize', () => this._applyScale());
  }

  _applyScale() {
    // Largest size that fits the viewport while maintaining 4:3 aspect ratio
    const cssScale = Math.min(
      window.innerWidth  / LOGICAL_W,
      window.innerHeight / LOGICAL_H,
    );
    this.cssScale = cssScale;

    // Pixel-perfect sizing: round to integer display pixels so there is no
    // sub-pixel canvas edge bleed
    const displayW = Math.round(LOGICAL_W * cssScale);
    const displayH = Math.round(LOGICAL_H * cssScale);

    this.canvas.style.width  = displayW + 'px';
    this.canvas.style.height = displayH + 'px';
    this.canvas.style.display    = 'block';
    this.canvas.style.position   = 'absolute';

    // Center in window
    this.offsetX = Math.floor((window.innerWidth  - displayW) / 2);
    this.offsetY = Math.floor((window.innerHeight - displayH) / 2);
    this.canvas.style.left = this.offsetX + 'px';
    this.canvas.style.top  = this.offsetY + 'px';

    // Canvas pixel size never changes — no ctx state reset needed
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
   */
  drawTile(layerIndex, bitmap, srcX, srcY, destX, destY, w = 32, h = 32) {
    this.layerCtxs[layerIndex].drawImage(bitmap, srcX, srcY, w, h, destX, destY, w, h);
  }

  /**
   * Draw a sprite frame at pixel coordinates on a layer.
   */
  drawSprite(layerIndex, sheet, frameX, frameY, destX, destY, w = 32, h = 32) {
    this.layerCtxs[layerIndex].drawImage(sheet, frameX, frameY, w, h, destX, destY, w, h);
  }

  /**
   * Draw a filled rectangle on a layer.
   */
  drawRect(layerIndex, x, y, w, h, color, alpha = 1) {
    const ctx = this.layerCtxs[layerIndex];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  /**
   * Composite all layers onto the main canvas in order.
   * Layer 7 (LIGHTING) uses 'multiply' composite operation.
   * Canvas is 640×480; CSS display scaling is applied by the browser.
   */
  composite() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

    for (let i = 0; i < LAYER_COUNT; i++) {
      ctx.globalCompositeOperation = (i === LAYER.LIGHTING) ? 'multiply' : 'source-over';
      ctx.drawImage(this.layers[i], 0, 0);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /** Get the 2D context for a specific layer (for direct drawing). */
  getLayerContext(layerIndex) {
    return this.layerCtxs[layerIndex];
  }

  getLogicalWidth()  { return LOGICAL_W; }
  getLogicalHeight() { return LOGICAL_H; }
}

