/**
 * camera.js — Viewport/camera system
 * Tracks a world-tile target with 8-frame lerp soft centering.
 * Clamps to map boundaries. Supports hard snap for transitions.
 */

const TILE_SIZE = 32;
const LOGICAL_W = 640;
const LOGICAL_H = 480;
const LERP_FRAMES = 8;

export class Camera {
  constructor() {
    // Camera position in world pixels (top-left corner of viewport)
    this.x = 0;
    this.y = 0;

    // Target position in world pixels
    this._targetX = 0;
    this._targetY = 0;

    // Map boundary in world pixels
    this._mapPixelW = 0;
    this._mapPixelH = 0;

    // Lerp alpha per frame (1/8 gives 8-frame convergence feel)
    this._lerpAlpha = 1 / LERP_FRAMES;

    this._snapMode = false;
  }

  /**
   * Set the map bounds so the camera clamps correctly.
   * @param {number} mapTileW
   * @param {number} mapTileH
   */
  setMapBounds(mapTileW, mapTileH) {
    this._mapPixelW = mapTileW * TILE_SIZE;
    this._mapPixelH = mapTileH * TILE_SIZE;
  }

  /**
   * Set the follow target to a world tile coordinate.
   * @param {number} tileX
   * @param {number} tileY
   */
  setTarget(tileX, tileY) {
    // Center of the target tile in world pixels
    this._targetX = tileX * TILE_SIZE + TILE_SIZE / 2 - LOGICAL_W / 2;
    this._targetY = tileY * TILE_SIZE + TILE_SIZE / 2 - LOGICAL_H / 2;
  }

  /**
   * Instantly snap the camera to the target tile (no lerp).
   * Used on location transitions.
   * @param {number} tileX
   * @param {number} tileY
   */
  snapTo(tileX, tileY) {
    this.setTarget(tileX, tileY);
    this.x = this._clampX(this._targetX);
    this.y = this._clampY(this._targetY);
  }

  /** Update camera position — call once per render frame. */
  update() {
    if (this._snapMode) return;

    const clampedTargetX = this._clampX(this._targetX);
    const clampedTargetY = this._clampY(this._targetY);

    this.x += (clampedTargetX - this.x) * this._lerpAlpha;
    this.y += (clampedTargetY - this.y) * this._lerpAlpha;

    // Snap to pixel once close enough to avoid sub-pixel drift
    if (Math.abs(this.x - clampedTargetX) < 0.5) this.x = clampedTargetX;
    if (Math.abs(this.y - clampedTargetY) < 0.5) this.y = clampedTargetY;
  }

  _clampX(val) {
    const maxX = Math.max(0, this._mapPixelW - LOGICAL_W);
    return Math.max(0, Math.min(val, maxX));
  }

  _clampY(val) {
    const maxY = Math.max(0, this._mapPixelH - LOGICAL_H);
    return Math.max(0, Math.min(val, maxY));
  }

  /**
   * Convert world tile coordinates to screen pixel coordinates.
   * @param {number} tileX
   * @param {number} tileY
   * @returns {{ x: number, y: number }}
   */
  worldToScreen(tileX, tileY) {
    return {
      x: Math.round(tileX * TILE_SIZE - this.x),
      y: Math.round(tileY * TILE_SIZE - this.y),
    };
  }

  /**
   * Convert screen pixel coordinates to world tile coordinates.
   * @param {number} pixelX
   * @param {number} pixelY
   * @returns {{ tileX: number, tileY: number }}
   */
  screenToWorld(pixelX, pixelY) {
    const worldX = pixelX + this.x;
    const worldY = pixelY + this.y;
    return {
      tileX: Math.floor(worldX / TILE_SIZE),
      tileY: Math.floor(worldY / TILE_SIZE),
    };
  }

  /** Camera top-left in world pixels (useful for tile culling). */
  getWorldRect() {
    return {
      x: this.x,
      y: this.y,
      w: LOGICAL_W,
      h: LOGICAL_H,
    };
  }
}
