/**
 * input.js — Keyboard and mouse input handler.
 * Tracks key state, mouse position (screen + world tile), and click events.
 */

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas - the main display canvas
   * @param {import('./camera.js').Camera} camera - for screen→world conversion
   * @param {number} scale - current pixel scale (updated externally)
   */
  constructor(canvas, camera, getScale) {
    this._canvas = canvas;
    this._camera = camera;
    this._getScale = getScale; // function returning current scale

    this._keyDown = new Set();    // keys currently held
    this._keyPressed = new Set(); // keys pressed this frame (cleared each frame)

    this._mouseScreenX = 0;
    this._mouseScreenY = 0;
    this._mouseTileX = 0;
    this._mouseTileY = 0;

    this._tileClickCallbacks = [];

    this._bindEvents();
  }

  _bindEvents() {
    window.addEventListener('keydown', (e) => {
      if (!this._keyDown.has(e.code)) {
        this._keyPressed.add(e.code);
      }
      this._keyDown.add(e.code);
      // Prevent arrow key scrolling
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this._keyDown.delete(e.code);
    });

    this._canvas.addEventListener('mousemove', (e) => {
      this._updateMousePosition(e);
    });

    this._canvas.addEventListener('click', (e) => {
      this._updateMousePosition(e);
      const tile = this.getMouseTile();
      for (const cb of this._tileClickCallbacks) {
        cb(tile.tileX, tile.tileY, e);
      }
    });
  }

  _updateMousePosition(e) {
    const rect = this._canvas.getBoundingClientRect();
    const scale = this._getScale();

    // Position within the canvas element in CSS pixels
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    // Convert CSS pixels → logical pixels
    const logicalX = cssX / (rect.width / this._canvas.width) / scale;
    const logicalY = cssY / (rect.height / this._canvas.height) / scale;

    this._mouseScreenX = logicalX;
    this._mouseScreenY = logicalY;

    const worldTile = this._camera.screenToWorld(logicalX, logicalY);
    this._mouseTileX = worldTile.tileX;
    this._mouseTileY = worldTile.tileY;
  }

  /**
   * Returns true if the key is currently held down.
   * @param {string} code - KeyboardEvent.code (e.g. 'KeyW', 'ArrowUp')
   */
  isKeyDown(code) {
    return this._keyDown.has(code);
  }

  /**
   * Returns true if the key was just pressed this frame (not held).
   * Call clearFrameState() at the end of each frame to reset.
   * @param {string} code
   */
  wasKeyPressed(code) {
    return this._keyPressed.has(code);
  }

  /** @returns {{ tileX: number, tileY: number }} */
  getMouseTile() {
    return { tileX: this._mouseTileX, tileY: this._mouseTileY };
  }

  /** @returns {{ x: number, y: number }} */
  getMouseScreen() {
    return { x: this._mouseScreenX, y: this._mouseScreenY };
  }

  /**
   * Register a callback for tile clicks.
   * @param {(tileX: number, tileY: number, event: MouseEvent) => void} callback
   */
  onTileClick(callback) {
    this._tileClickCallbacks.push(callback);
  }

  /** Call at the end of each logic tick to clear single-frame key state. */
  clearFrameState() {
    this._keyPressed.clear();
  }
}
