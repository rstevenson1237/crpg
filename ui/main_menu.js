/**
 * main_menu.js — Canvas-rendered title screen and save-slot picker.
 *
 * MainMenu draws directly onto a provided 2D context (640×480 logical px).
 * It manages its own input via a passed Input instance and calls back
 * onNewGame() or onLoadGame(slotData) when the player makes a selection.
 *
 * Pause menu (accessible in-game) re-uses the slot panel for save/load.
 */

const TITLE   = 'CRPG ENGINE';
const SUBTITLE = 'A Prototype Adventure';

// Vertical layout anchors for the main menu options
const MENU_TOP  = 220;
const MENU_STEP = 28;

export class MainMenu {
  /**
   * @param {HTMLCanvasElement} canvas  — display canvas (640×480 logical)
   * @param {object} input              — Input instance
   * @param {object} Save               — Save module
   */
  constructor(canvas, input, Save) {
    this._canvas  = canvas;
    this._ctx     = canvas.getContext('2d');
    this._input   = input;
    this._Save    = Save;

    this._phase   = 'title';   // 'title' | 'slots' | 'pause'
    this._mode    = 'load';    // 'load' | 'save' — what the slot panel does
    this._cursor  = 0;         // selected menu item index
    this._slots   = [null, null, null];
    this._slotCur = 0;
    this._dirty   = true;

    this._onNewGame  = null;
    this._onLoadGame = null;
    this._onResume   = null;
    this._onMainMenu = null;

    // Title menu items depend on whether saves exist
    this._menuItems = [];
    this._titleTime = 0;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Show the title screen. Loads save slot metadata asynchronously. */
  async showTitle() {
    this._phase  = 'title';
    this._cursor = 0;
    await this._refreshSlots();
    this._buildTitleMenu();
    this._dirty = true;
  }

  /** Show the pause menu (called from in-game Escape). */
  async showPause() {
    this._phase  = 'pause';
    this._cursor = 0;
    await this._refreshSlots();
    this._dirty = true;
  }

  /** Show save-slot panel in save mode (called from pause menu). */
  showSavePanel() {
    this._phase   = 'slots';
    this._mode    = 'save';
    this._slotCur = 0;
    this._dirty   = true;
  }

  /** Show save-slot panel in load mode. */
  showLoadPanel() {
    this._phase   = 'slots';
    this._mode    = 'load';
    this._slotCur = 0;
    this._dirty   = true;
  }

  isVisible() {
    return this._phase === 'title' || this._phase === 'pause' || this._phase === 'slots';
  }

  setOnNewGame(fn)  { this._onNewGame  = fn; }
  setOnLoadGame(fn) { this._onLoadGame = fn; }
  setOnResume(fn)   { this._onResume   = fn; }
  setOnMainMenu(fn) { this._onMainMenu = fn; }

  // ── Input ──────────────────────────────────────────────────────────────────

  /** Call once per tick while the menu is showing. Returns true if consumed. */
  handleInput() {
    const input = this._input;
    if (this._phase === 'title') {
      return this._handleTitleInput(input);
    } else if (this._phase === 'pause') {
      return this._handlePauseInput(input);
    } else if (this._phase === 'slots') {
      return this._handleSlotInput(input);
    }
    return false;
  }

  _handleTitleInput(input) {
    const items = this._menuItems;
    if (input.wasKeyPressed('ArrowUp')) {
      this._cursor = (this._cursor - 1 + items.length) % items.length;
      this._dirty = true;
    }
    if (input.wasKeyPressed('ArrowDown')) {
      this._cursor = (this._cursor + 1) % items.length;
      this._dirty = true;
    }
    if (input.wasKeyPressed('Space') || input.wasKeyPressed('Enter') || input.wasKeyPressed('KeyZ')) {
      this._activateTitleItem(items[this._cursor]);
    }
    // Number shortcuts
    for (let i = 0; i < items.length; i++) {
      const code = `Digit${i + 1}`;
      if (input.wasKeyPressed(code)) { this._activateTitleItem(items[i]); break; }
    }
    return true;
  }

  _activateTitleItem(item) {
    if (!item) return;
    if (item.id === 'new_game' && this._onNewGame) this._onNewGame();
    if (item.id === 'continue') this._loadSlot(this._bestSlot());
    if (item.id === 'load_game') this.showLoadPanel();
  }

  _handlePauseInput(input) {
    const items = this._pauseItems();
    if (input.wasKeyPressed('ArrowUp')) {
      this._cursor = (this._cursor - 1 + items.length) % items.length;
      this._dirty = true;
    }
    if (input.wasKeyPressed('ArrowDown')) {
      this._cursor = (this._cursor + 1) % items.length;
      this._dirty = true;
    }
    if (input.wasKeyPressed('Space') || input.wasKeyPressed('Enter') || input.wasKeyPressed('KeyZ')) {
      this._activatePauseItem(items[this._cursor]);
    }
    if (input.wasKeyPressed('Escape')) {
      if (this._onResume) this._onResume();
    }
    return true;
  }

  _activatePauseItem(item) {
    if (!item) return;
    if (item.id === 'resume'    && this._onResume)   this._onResume();
    if (item.id === 'save_game')   this.showSavePanel();
    if (item.id === 'load_game')   this.showLoadPanel();
    if (item.id === 'main_menu' && this._onMainMenu) this._onMainMenu();
  }

  _handleSlotInput(input) {
    if (input.wasKeyPressed('Escape')) {
      // Go back
      this._phase  = this._onResume ? 'pause' : 'title';
      this._cursor = 0;
      this._dirty  = true;
      return true;
    }
    if (input.wasKeyPressed('ArrowUp')) {
      this._slotCur = (this._slotCur - 1 + this._Save.NUM_SLOTS) % this._Save.NUM_SLOTS;
      this._dirty = true;
    }
    if (input.wasKeyPressed('ArrowDown')) {
      this._slotCur = (this._slotCur + 1) % this._Save.NUM_SLOTS;
      this._dirty = true;
    }
    if (input.wasKeyPressed('Space') || input.wasKeyPressed('Enter') || input.wasKeyPressed('KeyZ')) {
      if (this._mode === 'save') {
        this._saveToSlot(this._slotCur);
      } else {
        this._loadSlot(this._slotCur);
      }
    }
    if (input.wasKeyPressed('KeyX') || input.wasKeyPressed('Delete')) {
      // Delete save in slot
      this._deleteSlot(this._slotCur);
    }
    return true;
  }

  // ── Save / Load actions ────────────────────────────────────────────────────

  async _saveToSlot(slot) {
    try {
      await this._Save.save(slot);
      await this._refreshSlots();
      this._dirty = true;
      // Brief feedback — return to pause
      this._phase  = 'pause';
      this._cursor = 0;
    } catch (e) {
      console.error('[MainMenu] Save failed:', e);
    }
  }

  async _loadSlot(slot) {
    const info = this._slots[slot];
    if (!info && this._mode === 'load') return;
    if (this._onLoadGame) {
      try {
        const data = await this._Save.load(slot);
        if (data) this._onLoadGame(data);
      } catch (e) {
        console.error('[MainMenu] Load failed:', e);
      }
    }
  }

  async _deleteSlot(slot) {
    if (!this._slots[slot]) return;
    await this._Save.deleteSave(slot);
    await this._refreshSlots();
    this._dirty = true;
  }

  _bestSlot() {
    // Find most-recent slot
    let best = null, bestTime = null;
    for (const s of this._slots) {
      if (!s) continue;
      if (!bestTime || s.timestamp > bestTime) { bestTime = s.timestamp; best = s.slot; }
    }
    return best ?? 0;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  async _refreshSlots() {
    this._slots = await Promise.all(
      Array.from({ length: this._Save.NUM_SLOTS }, (_, i) => this._Save.getSaveInfo(i))
    );
  }

  _buildTitleMenu() {
    const hasSaves = this._slots.some(s => s !== null);
    this._menuItems = [
      { id: 'new_game',  label: 'New Game' },
      ...(hasSaves ? [{ id: 'continue',  label: 'Continue' }] : []),
      ...(hasSaves ? [{ id: 'load_game', label: 'Load Game' }] : []),
    ];
  }

  _pauseItems() {
    return [
      { id: 'resume',    label: 'Resume' },
      { id: 'save_game', label: 'Save Game' },
      { id: 'load_game', label: 'Load Game' },
      { id: 'main_menu', label: 'Main Menu' },
    ];
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  /** Call once per render frame while isVisible(). */
  render(deltaMs) {
    this._titleTime += deltaMs;
    const ctx = this._ctx;
    ctx.save();

    if (this._phase === 'title') {
      this._renderTitle(ctx);
    } else if (this._phase === 'pause') {
      this._renderPause(ctx);
    } else if (this._phase === 'slots') {
      this._renderSlots(ctx);
    }

    ctx.restore();
  }

  _renderTitle(ctx) {
    // Full-screen dark gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, 480);
    grad.addColorStop(0, '#050810');
    grad.addColorStop(1, '#0d1520');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 480);

    // Subtle star field (deterministic via sin)
    ctx.fillStyle = 'rgba(200,210,255,0.6)';
    for (let i = 0; i < 80; i++) {
      const sx = (Math.sin(i * 137.5) * 0.5 + 0.5) * 640;
      const sy = (Math.sin(i * 97.1)  * 0.5 + 0.5) * 200;
      const sr = 0.5 + (Math.sin(i * 53.3) * 0.5 + 0.5) * 1.0;
      const tw = this._titleTime / 1000;
      const blink = 0.5 + 0.5 * Math.sin(tw * (0.5 + (i % 7) * 0.3) + i);
      ctx.globalAlpha = blink * 0.7;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Title text
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';

    const pulse = 0.85 + 0.15 * Math.sin(this._titleTime / 700);
    ctx.save();
    ctx.translate(320, 90);
    ctx.scale(pulse, pulse);
    ctx.font      = 'bold 38px monospace';
    ctx.fillStyle = '#ffe880';
    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur  = 18;
    ctx.fillText(TITLE, 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();

    ctx.font      = '13px monospace';
    ctx.fillStyle = '#8899bb';
    ctx.fillText(SUBTITLE, 320, 138);

    // Decorative line
    ctx.strokeStyle = '#223344';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(160, 162); ctx.lineTo(480, 162);
    ctx.stroke();

    // Menu items
    const items = this._menuItems;
    for (let i = 0; i < items.length; i++) {
      const y      = MENU_TOP + i * MENU_STEP;
      const sel    = i === this._cursor;
      const prefix = sel ? '▶ ' : '  ';

      if (sel) {
        ctx.fillStyle = 'rgba(255,238,128,0.08)';
        ctx.fillRect(200, y - 2, 240, MENU_STEP - 4);
      }

      ctx.font      = sel ? 'bold 15px monospace' : '14px monospace';
      ctx.fillStyle = sel ? '#ffe880' : '#889aaa';
      ctx.fillText(prefix + items[i].label, 320, y);
    }

    // Controls hint
    ctx.font      = '9px monospace';
    ctx.fillStyle = '#334455';
    ctx.fillText('↑↓ navigate   Z/Enter select', 320, 460);
  }

  _renderPause(ctx) {
    // Dim background overlay (game world is beneath)
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, 640, 480);

    const PW = 220, PH = 200;
    const PX = Math.round((640 - PW) / 2);
    const PY = Math.round((480 - PH) / 2);

    ctx.fillStyle = 'rgba(10,14,24,0.97)';
    ctx.fillRect(PX, PY, PW, PH);
    ctx.strokeStyle = '#334455';
    ctx.lineWidth   = 1;
    ctx.strokeRect(PX, PY, PW, PH);

    // Title bar accent
    ctx.strokeStyle = '#33aacc';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(PX + 8, PY + 1); ctx.lineTo(PX + PW - 8, PY + 1);
    ctx.stroke();

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.font         = 'bold 13px monospace';
    ctx.fillStyle    = '#ffe880';
    ctx.fillText('PAUSED', PX + PW / 2, PY + 10);

    const items = this._pauseItems();
    const STEP  = 36;
    const startY = PY + 36;

    for (let i = 0; i < items.length; i++) {
      const y   = startY + i * STEP;
      const sel = i === this._cursor;

      if (sel) {
        ctx.fillStyle = 'rgba(255,238,128,0.10)';
        ctx.fillRect(PX + 12, y - 2, PW - 24, STEP - 8);
      }

      ctx.font      = sel ? 'bold 13px monospace' : '12px monospace';
      ctx.fillStyle = sel ? '#ffe880' : '#889aaa';
      ctx.fillText((sel ? '▶ ' : '  ') + items[i].label, PX + PW / 2, y);
    }

    ctx.font      = '9px monospace';
    ctx.fillStyle = '#334455';
    ctx.fillText('Esc = Resume', PX + PW / 2, PY + PH - 12);
  }

  _renderSlots(ctx) {
    // Dim
    ctx.fillStyle = 'rgba(0,0,0,0.80)';
    ctx.fillRect(0, 0, 640, 480);

    const PW = 340, PH = 210;
    const PX = Math.round((640 - PW) / 2);
    const PY = Math.round((480 - PH) / 2);

    ctx.fillStyle = 'rgba(10,14,24,0.97)';
    ctx.fillRect(PX, PY, PW, PH);
    ctx.strokeStyle = '#334455';
    ctx.lineWidth   = 1;
    ctx.strokeRect(PX, PY, PW, PH);

    ctx.strokeStyle = '#33aacc';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(PX + 8, PY + 1); ctx.lineTo(PX + PW - 8, PY + 1);
    ctx.stroke();

    const modeLabel = this._mode === 'save' ? 'SAVE GAME' : 'LOAD GAME';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.font         = 'bold 12px monospace';
    ctx.fillStyle    = '#ffe880';
    ctx.fillText(modeLabel, PX + PW / 2, PY + 10);

    const SLOT_H = 48, SLOT_Y0 = PY + 32, GAP = 8;

    for (let i = 0; i < this._Save.NUM_SLOTS; i++) {
      const info = this._slots[i];
      const sy   = SLOT_Y0 + i * (SLOT_H + GAP);
      const sel  = i === this._slotCur;

      const bgColor = sel ? 'rgba(40,60,80,0.95)' : 'rgba(18,24,36,0.90)';
      ctx.fillStyle  = bgColor;
      ctx.fillRect(PX + 12, sy, PW - 24, SLOT_H);
      ctx.strokeStyle = sel ? '#44aacc' : '#2a3a4a';
      ctx.lineWidth   = sel ? 2 : 1;
      ctx.strokeRect(PX + 12, sy, PW - 24, SLOT_H);

      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';

      if (info) {
        ctx.font      = 'bold 11px monospace';
        ctx.fillStyle = sel ? '#ffe880' : '#aabbcc';
        ctx.fillText(info.label, PX + 22, sy + 8);

        ctx.font      = '9px monospace';
        ctx.fillStyle = sel ? '#88ccff' : '#557788';
        const ts = new Date(info.timestamp).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        ctx.fillText(`Turn ${info.turn}  —  ${ts}`, PX + 22, sy + 24);
        ctx.fillText(`Map: ${info.map}`, PX + 22, sy + 36);

        // Delete hint on selected
        if (sel && this._mode === 'load') {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#664444';
          ctx.fillText('[X] delete', PX + PW - 18, sy + 8);
          ctx.textAlign = 'left';
        }
      } else {
        ctx.font      = '11px monospace';
        ctx.fillStyle = sel ? '#556677' : '#2a3a4a';
        ctx.fillText(`Slot ${i + 1}  — empty`, PX + 22, sy + 16);
      }

      // Slot number badge
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.font         = 'bold 9px monospace';
      ctx.fillStyle    = sel ? '#33aacc' : '#2a3a4a';
      ctx.fillText(`${i + 1}`, PX + PW - 20, sy + SLOT_H - 16);
    }

    ctx.textAlign = 'center';
    ctx.font      = '9px monospace';
    ctx.fillStyle = '#334455';
    ctx.fillText('↑↓ select   Enter confirm   Esc back', PX + PW / 2, PY + PH - 12);
  }
}
