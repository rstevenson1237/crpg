/**
 * combat.js — Main combat state machine for the CRPG engine.
 * Manages turn order, combatant states, movement/attack resolution,
 * animation, and rendering for the tactical combat arena.
 */

import { CombatGrid, COMBAT_TILE, COMBAT_PAD_X, COMBAT_PAD_Y } from './combat_grid.js';
import { LAYER } from './renderer.js';

// Class colors for combatant rendering (mirrors character.js)
const CLASS_COLORS = {
  fighter: '#5588bb',
  mage:    '#9955bb',
  thief:   '#336633',
  cleric:  '#bbaa22',
  skeleton: '#888888',
};

function clamp(min, max, v) {
  return Math.min(max, Math.max(min, v));
}

export class CombatEngine {
  constructor(renderer, input) {
    this._renderer = renderer;
    this._input    = input;

    this._active   = false;
    this._combatants = [];   // CombatantState[]
    this._turnOrder  = [];   // sorted by initiative
    this._turnIdx    = 0;
    this._phase      = 'idle'; // idle|player_action|enemy_thinking|animating|enemy_post|ended

    this._selectedAction = null; // 'move'|'attack'|'defend'|'wait'|null
    this._grid  = new CombatGrid();
    this._anim  = null;  // { combatantId, fromX, fromY, path, frame, totalFrames }

    this._enemyTimer     = 0;
    this._postAnimTimer  = 0;
    this._hoveredTile    = null; // { x, y }
    this._movementRange  = new Set();
    this._attackRange    = new Set();
    this._floatingTexts  = []; // { text, color, tile_x, tile_y, offsetY, alpha, timer }
    this._escapeConfirm  = false;
    this._onCombatEnd    = null;
    this._actionMenuItems = []; // [{ label, action, disabled, x, y, w, h }]

    // Click tracking via canvas listener
    this._clickPending = null; // { x, y } logical coords, consumed in handleInput

    // Register canvas click listener
    renderer.canvas.addEventListener('click', (e) => {
      const rect  = renderer.canvas.getBoundingClientRect();
      const scale = renderer.scale;
      const cssX  = e.clientX - rect.left;
      const cssY  = e.clientY - rect.top;
      const lx    = cssX / (rect.width  / renderer.canvas.width)  / scale;
      const ly    = cssY / (rect.height / renderer.canvas.height) / scale;
      this._clickPending = { x: lx, y: ly };
    });
  }

  isActive() { return this._active; }

  // ─── Initiate ──────────────────────────────────────────────────────────────

  /**
   * Start a combat encounter.
   * @param {string} encounterId
   * @param {Array<{entity:object, side:string, tile_x:number, tile_y:number}>} rawCombatants
   * @param {function} onCombatEnd  called with outcome string when combat ends
   */
  initiate(encounterId, rawCombatants, onCombatEnd) {
    this._onCombatEnd   = onCombatEnd;
    this._combatants    = [];
    this._turnOrder     = [];
    this._turnIdx       = 0;
    this._floatingTexts = [];
    this._anim          = null;
    this._escapeConfirm = false;
    this._selectedAction = null;
    this._movementRange  = new Set();
    this._attackRange    = new Set();
    this._clickPending   = null;

    for (let i = 0; i < rawCombatants.length; i++) {
      const raw    = rawCombatants[i];
      const entity = raw.entity;

      // Support both Character instances (.def wrapper) and plain def objects
      const def   = entity.def ?? entity;
      const stats = def.base_stats ?? {};

      const state = {
        id:           def.character_id ?? `combatant_${i}`,
        entity:       entity,
        side:         raw.side,
        tile_x:       raw.tile_x,
        tile_y:       raw.tile_y,
        current_hp:   stats.hp   ?? 10,
        max_hp:       stats.max_hp ?? stats.hp ?? 10,
        speed:        stats.speed  ?? 4,
        attack_stat:  stats.attack ?? 5,
        defense_stat: stats.defense ?? 3,
        initiative:   0,
        incapacitated: false,
        defending:    false,
        action_state: { has_moved: false, has_acted: false },
        class_id:     def.class_id ?? 'unknown',
        display_name: def.display_name ?? 'Unknown',
        status_effects: [],
      };

      state.initiative = state.speed + Math.floor(Math.random() * 6) + 1;
      this._combatants.push(state);
    }

    // Sort turn order: descending initiative; party-first on tie
    this._turnOrder = [...this._combatants].sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      // party first on tie
      if (a.side === 'party' && b.side !== 'party') return -1;
      if (b.side === 'party' && a.side !== 'party') return  1;
      return 0;
    });

    this._active = true;
    console.log(`[Combat] Initiated encounter: ${encounterId}`);
    this._startTurn();
  }

  // ─── Turn management ───────────────────────────────────────────────────────

  _currentCombatant() {
    return this._turnOrder[this._turnIdx] ?? null;
  }

  _startTurn() {
    const c = this._currentCombatant();
    if (!c) { this.end('victory'); return; }

    c.action_state = { has_moved: false, has_acted: false };
    c.defending    = false;

    if (c.incapacitated) {
      this._advanceTurn();
      return;
    }

    if (c.side === 'party') {
      this._phase          = 'player_action';
      this._selectedAction = null;
      this._updateHighlightRanges(c);
    } else {
      this._phase      = 'enemy_thinking';
      this._enemyTimer = 800;
    }
  }

  _advanceTurn() {
    // Win/lose check
    const enemiesAlive = this._combatants.filter(c => c.side === 'enemy' && !c.incapacitated);
    const partyAlive   = this._combatants.filter(c => c.side === 'party' && !c.incapacitated);
    if (enemiesAlive.length === 0) { this.end('victory'); return; }
    if (partyAlive.length   === 0) { this.end('defeat');  return; }

    this._turnIdx = (this._turnIdx + 1) % this._turnOrder.length;
    this._startTurn();
  }

  _updateHighlightRanges(c) {
    if (!c || c.incapacitated) {
      this._movementRange = new Set();
      this._attackRange   = new Set();
      return;
    }
    if (this._selectedAction === 'move' && !c.action_state.has_moved) {
      this._movementRange = this._grid.getMovementRange(c.tile_x, c.tile_y, c.speed, c.id, this._combatants);
      this._attackRange   = new Set();
    } else if (this._selectedAction === 'attack' && !c.action_state.has_acted) {
      this._attackRange   = this._getAdjacentEnemyTiles(c);
      this._movementRange = new Set();
    } else {
      this._movementRange = new Set();
      this._attackRange   = new Set();
    }
  }

  // ─── Player action handling ────────────────────────────────────────────────

  selectAction(action) {
    if (this._phase !== 'player_action') return;
    const c = this._currentCombatant();
    if (!c) return;

    if (action === 'move'   && c.action_state.has_moved) return;
    if ((action === 'attack' || action === 'defend') && c.action_state.has_acted) return;

    if (action === 'wait') {
      c.action_state.has_moved = true;
      c.action_state.has_acted = true;
      this._selectedAction     = null;
      this._movementRange      = new Set();
      this._attackRange        = new Set();
      this._advanceTurn();
      return;
    }

    if (action === 'defend') {
      c.defending              = true;
      c.action_state.has_acted = true;
      this._selectedAction     = null;
      this._attackRange        = new Set();
      if (c.action_state.has_moved) {
        this._advanceTurn();
      }
      return;
    }

    this._selectedAction = action;
    this._updateHighlightRanges(c);
  }

  handleTileClick(tx, ty) {
    if (this._phase !== 'player_action') return;
    const c = this._currentCombatant();
    if (!c) return;

    if (this._selectedAction === 'move' && this._movementRange.has(`${tx},${ty}`)) {
      this._executeMove(c, tx, ty);
    } else if (this._selectedAction === 'attack') {
      const occ = this._getOccupant(tx, ty);
      if (occ && occ.side !== c.side && !occ.incapacitated) {
        this._executeAttack(c, occ);
      }
    }
  }

  // ─── Move execution ────────────────────────────────────────────────────────

  _executeMove(combatant, toX, toY) {
    const path = this._grid.findPath(
      combatant.tile_x, combatant.tile_y, toX, toY,
      combatant.id, this._combatants
    );
    if (!path || path.length === 0) return;

    combatant.action_state.has_moved = true;

    this._anim = {
      combatantId: combatant.id,
      fromX:       combatant.tile_x,
      fromY:       combatant.tile_y,
      path,
      frame:       0,
      totalFrames: path.length * 8,
    };

    // Update tile position immediately so grid logic is consistent
    combatant.tile_x = toX;
    combatant.tile_y = toY;

    this._selectedAction = null;
    this._movementRange  = new Set();
    this._attackRange    = new Set();
    this._phase          = 'animating';
  }

  // ─── Attack execution ──────────────────────────────────────────────────────

  _executeAttack(attacker, target) {
    const hitChance = clamp(0.10, 0.95,
      0.75 + (attacker.attack_stat - target.defense_stat) * 0.05
    );

    if (Math.random() < hitChance) {
      const damage = Math.max(1, attacker.attack_stat - target.defense_stat);
      target.current_hp -= damage;
      this._spawnFloatingText(`-${damage}`, '#ff4444', target.tile_x, target.tile_y);
      if (target.current_hp <= 0) {
        target.current_hp    = 0;
        target.incapacitated = true;
        this._spawnFloatingText('DEFEATED', '#ff8800', target.tile_x, target.tile_y - 1);
      }
    } else {
      this._spawnFloatingText('MISS', '#aaaaaa', target.tile_x, target.tile_y);
    }

    attacker.action_state.has_acted = true;
    this._selectedAction = null;
    this._movementRange  = new Set();
    this._attackRange    = new Set();

    console.log(`[Combat] Attack: ${attacker.display_name} → ${target.display_name}`);

    // After attack, if both actions used then advance turn
    // Otherwise stay in player_action (or enemy_post for enemies)
    if (attacker.side === 'party') {
      this._phase = 'player_action';
      if (attacker.action_state.has_moved && attacker.action_state.has_acted) {
        // Both done — schedule advance after short delay via timer
        this._postAnimTimer = 500;
        this._phase         = 'enemy_post'; // reuse enemy_post timer for post-attack advance
        // We'll special-case this in enemy_post: if current is party, just advance
      }
    } else {
      // Enemy attacked — schedule advance
      this._phase         = 'enemy_post';
      this._postAnimTimer = 600;
    }
  }

  // ─── Adjacent enemy tile helpers ───────────────────────────────────────────

  _getAdjacentEnemyTiles(combatant) {
    const result = new Set();
    const dirs   = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dx, dy] of dirs) {
      const nx = combatant.tile_x + dx;
      const ny = combatant.tile_y + dy;
      const occ = this._getOccupant(nx, ny);
      if (occ && occ.side !== combatant.side && !occ.incapacitated) {
        result.add(`${nx},${ny}`);
      }
    }
    return result;
  }

  _getOccupant(tx, ty) {
    return this._combatants.find(c => !c.incapacitated && c.tile_x === tx && c.tile_y === ty) ?? null;
  }

  // ─── Enemy AI ──────────────────────────────────────────────────────────────

  _runEnemyAI(c) {
    const partyAlive = this._combatants.filter(p => p.side === 'party' && !p.incapacitated);
    if (partyAlive.length === 0) { this._advanceTurn(); return; }

    // Find nearest party member
    let nearest = null;
    let nearestDist = Infinity;
    for (const p of partyAlive) {
      const dist = Math.abs(p.tile_x - c.tile_x) + Math.abs(p.tile_y - c.tile_y);
      if (dist < nearestDist) { nearestDist = dist; nearest = p; }
    }

    // If adjacent and can attack
    if (nearestDist === 1 && !c.action_state.has_acted) {
      this._executeAttack(c, nearest);
      return;
    }

    // Try to move closer
    if (!c.action_state.has_moved) {
      const range = this._grid.getMovementRange(c.tile_x, c.tile_y, c.speed, c.id, this._combatants);
      let bestTile = null;
      let bestDist = nearestDist;
      for (const key of range) {
        const [rx, ry] = key.split(',').map(Number);
        const d = Math.abs(rx - nearest.tile_x) + Math.abs(ry - nearest.tile_y);
        if (d < bestDist) { bestDist = d; bestTile = { x: rx, y: ry }; }
      }
      if (bestTile) {
        this._executeMove(c, bestTile.x, bestTile.y);
        return; // will enter 'animating' phase
      }
    }

    this._advanceTurn();
  }

  // ─── Floating text ─────────────────────────────────────────────────────────

  _spawnFloatingText(text, color, tile_x, tile_y) {
    this._floatingTexts.push({
      text, color, tile_x, tile_y,
      offsetY: 0,
      alpha:   1,
      timer:   1200,
    });
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  update(deltaMs) {
    if (!this._active) return;

    // Update floating texts
    for (const ft of this._floatingTexts) {
      ft.timer   -= deltaMs;
      ft.offsetY += deltaMs * 0.025; // drift upward
      ft.alpha    = Math.max(0, ft.timer / 1200);
    }
    this._floatingTexts = this._floatingTexts.filter(ft => ft.timer > 0);

    // Animation phase
    if (this._phase === 'animating' && this._anim) {
      this._anim.frame++;
      if (this._anim.frame >= this._anim.totalFrames) {
        this._anim = null;
        const c    = this._currentCombatant();
        if (c) {
          if (c.side === 'party') {
            this._phase = 'player_action';
            this._updateHighlightRanges(c);
          } else {
            this._phase         = 'enemy_post';
            this._postAnimTimer = 400;
          }
        }
      }
    }

    // Enemy thinking phase
    if (this._phase === 'enemy_thinking') {
      this._enemyTimer -= deltaMs;
      if (this._enemyTimer <= 0) {
        const c = this._currentCombatant();
        if (c && !c.incapacitated) {
          this._runEnemyAI(c);
        } else {
          this._advanceTurn();
        }
      }
    }

    // Enemy post-action phase (also used for party post-attack advance)
    if (this._phase === 'enemy_post') {
      this._postAnimTimer -= deltaMs;
      if (this._postAnimTimer <= 0) {
        const c = this._currentCombatant();
        if (c && c.side === 'enemy') {
          // Check if enemy can still attack after moving
          const adj = this._getAdjacentEnemyTiles(c);
          if (adj.size > 0 && !c.action_state.has_acted) {
            // Attack nearest adjacent party member
            let target = null;
            for (const key of adj) {
              const [tx, ty] = key.split(',').map(Number);
              const occ = this._getOccupant(tx, ty);
              if (occ && occ.side !== c.side) { target = occ; break; }
            }
            if (target) {
              this._executeAttack(c, target);
              this._postAnimTimer = 600;
              return;
            }
          }
        }
        this._advanceTurn();
      }
    }

    // Update hovered tile from mouse position
    const mouse = this._input.getMouseScreen();
    this._hoveredTile = this._grid.screenToTile(mouse.x, mouse.y);
  }

  // ─── Input handling ────────────────────────────────────────────────────────

  handleInput(input) {
    if (!this._active) return;

    // Update hover
    const mouse = input.getMouseScreen();
    this._hoveredTile = this._grid.screenToTile(mouse.x, mouse.y);

    // Escape confirm modal
    if (this._escapeConfirm) {
      if (input.wasKeyPressed('KeyY')) { this.end('flee'); return; }
      if (input.wasKeyPressed('KeyN')) { this._escapeConfirm = false; }
      this._clickPending = null;
      return;
    }

    if (input.wasKeyPressed('Escape')) {
      this._escapeConfirm = !this._escapeConfirm;
    }

    if (this._phase !== 'player_action') {
      this._clickPending = null;
      return;
    }

    // Process pending click
    if (this._clickPending) {
      const lx = this._clickPending.x;
      const ly = this._clickPending.y;
      this._clickPending = null;

      // Hit-test action menu buttons
      const hit = this._hitTestActionMenu(lx, ly);
      if (hit) {
        this.selectAction(hit);
        return;
      }

      // Hit-test grid tile
      const tile = this._grid.screenToTile(lx, ly);
      if (tile) {
        this.handleTileClick(tile.x, tile.y);
      }
    }
  }

  _hitTestActionMenu(lx, ly) {
    for (const item of this._actionMenuItems) {
      if (!item.disabled &&
          lx >= item.x && lx <= item.x + item.w &&
          ly >= item.y && ly <= item.y + item.h) {
        return item.action;
      }
    }
    return null;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  render() {
    if (!this._active) return;

    // Clear layers 0–10
    for (let i = 0; i <= 10; i++) {
      this._renderer.clearLayer(i);
    }

    // Terrain (layers TERRAIN_BASE=0, OBJECT_BASE=2)
    this._grid.renderTerrain(this._renderer);

    // Overlays on LAYER.EFFECTS (8): grid lines, movement/attack highlights, hover
    const effectCtx = this._renderer.getLayerContext(LAYER.EFFECTS);
    this._renderer.clearLayer(LAYER.EFFECTS);
    this._grid.renderOverlays(effectCtx, this._movementRange, this._attackRange, this._hoveredTile);

    // Combatants on LAYER.CHARACTERS (4)
    this._renderer.clearLayer(LAYER.CHARACTERS);
    this._renderCombatants();

    // Floating texts also on LAYER.EFFECTS (after overlays)
    this._renderFloatingTexts();

    // HUD on LAYER.UI_CHROME (9)
    this._renderer.clearLayer(LAYER.UI_CHROME);
    this._renderTurnStrip();
    this._renderCombatantInfo();
    this._renderPhaseIndicator();

    // Action menu + escape confirm on LAYER.DIALOGUE (10)
    this._renderer.clearLayer(LAYER.DIALOGUE);
    this._renderActionMenu();
    if (this._escapeConfirm) this._renderEscapeConfirm();
  }

  // ─── Combatant rendering ───────────────────────────────────────────────────

  _renderCombatants() {
    const ctx     = this._renderer.getLayerContext(LAYER.CHARACTERS);
    const sorted  = [...this._combatants].sort((a, b) => a.tile_y - b.tile_y);
    const current = this._currentCombatant();

    for (const c of sorted) {
      let pixX, pixY;

      if (this._anim && this._anim.combatantId === c.id) {
        const anim      = this._anim;
        const t         = anim.frame / anim.totalFrames;
        const segCount  = anim.path.length;
        const segFrac   = t * segCount;
        const segIdx    = clamp(0, segCount - 1, Math.floor(segFrac));
        const segT      = segFrac - segIdx;
        const fromTile  = segIdx === 0
          ? { x: anim.fromX, y: anim.fromY }
          : anim.path[segIdx - 1];
        const toTile    = anim.path[segIdx];

        pixX = COMBAT_PAD_X + (fromTile.x + (toTile.x - fromTile.x) * segT) * COMBAT_TILE;
        pixY = COMBAT_PAD_Y + (fromTile.y + (toTile.y - fromTile.y) * segT) * COMBAT_TILE;
      } else {
        pixX = COMBAT_PAD_X + c.tile_x * COMBAT_TILE;
        pixY = COMBAT_PAD_Y + c.tile_y * COMBAT_TILE;
      }

      pixX = Math.round(pixX);
      pixY = Math.round(pixY);

      // Incapacitated: grey X
      if (c.incapacitated) {
        ctx.save();
        ctx.strokeStyle = '#555555';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(pixX + 4,               pixY + 4);
        ctx.lineTo(pixX + COMBAT_TILE - 4, pixY + COMBAT_TILE - 4);
        ctx.moveTo(pixX + COMBAT_TILE - 4, pixY + 4);
        ctx.lineTo(pixX + 4,               pixY + COMBAT_TILE - 4);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      // Selection ring for current combatant
      if (current && c.id === current.id) {
        const pulse = Math.sin(Date.now() / 300) * 0.4 + 0.6;
        ctx.save();
        ctx.globalAlpha  = pulse;
        ctx.strokeStyle  = '#ffffaa';
        ctx.lineWidth    = 2;
        ctx.strokeRect(pixX + 1, pixY + 1, COMBAT_TILE - 2, COMBAT_TILE - 2);
        ctx.restore();
      }

      // Body: colored rect (inset 3px on each side)
      const bx = pixX + 3;
      const by = pixY + 3;
      const bw = COMBAT_TILE - 6;
      const bh = COMBAT_TILE - 6;

      const color = CLASS_COLORS[c.class_id] ?? (c.side === 'party' ? '#5588bb' : '#884444');
      ctx.fillStyle = color;
      ctx.fillRect(bx, by, bw, bh);

      // Side indicator dot (4×4 at top-left)
      ctx.fillStyle = c.side === 'party' ? '#4488ff' : '#ff4444';
      ctx.fillRect(bx, by, 4, 4);

      // HP bar (3px tall, above sprite)
      const hpFrac = Math.max(0, c.current_hp / c.max_hp);
      ctx.fillStyle = '#330000';
      ctx.fillRect(pixX, pixY - 4, COMBAT_TILE, 3);
      ctx.fillStyle = hpFrac > 0.5 ? '#44aa44' : hpFrac > 0.25 ? '#aaaa22' : '#aa2222';
      ctx.fillRect(pixX, pixY - 4, Math.round(COMBAT_TILE * hpFrac), 3);

      // Name below (party only), 7px monospace
      if (c.side === 'party') {
        ctx.save();
        ctx.font         = '7px monospace';
        ctx.fillStyle    = '#ffffff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(c.display_name, pixX + COMBAT_TILE / 2, pixY + COMBAT_TILE + 1);
        ctx.restore();
      }
    }
  }

  // ─── Turn strip ────────────────────────────────────────────────────────────

  _renderTurnStrip() {
    const ctx      = this._renderer.getLayerContext(LAYER.UI_CHROME);
    const SLOT_W   = 40;
    const SLOT_H   = 40;
    const count    = this._turnOrder.length;
    const totalW   = count * (SLOT_W + 2) - 2;
    const startX   = Math.round((640 - totalW) / 2);
    const startY   = 2;

    // Background bar
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(startX - 2, startY, totalW + 4, SLOT_H + 4);

    for (let i = 0; i < this._turnOrder.length; i++) {
      const c     = this._turnOrder[i];
      const isAct = (i === this._turnIdx);
      const sx    = startX + i * (SLOT_W + 2);
      const sy    = startY + 2;

      // Slot background
      ctx.fillStyle = c.incapacitated ? '#222222' : '#1a1a2a';
      ctx.fillRect(sx, sy, SLOT_W, SLOT_H);

      // Active slot border
      ctx.strokeStyle = isAct ? '#ffffaa' : '#444444';
      ctx.lineWidth   = isAct ? 2 : 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, SLOT_W - 1, SLOT_H - 1);

      // Class color swatch
      const color = CLASS_COLORS[c.class_id] ?? (c.side === 'party' ? '#5588bb' : '#884444');
      ctx.fillStyle = c.incapacitated ? '#555555' : color;
      ctx.fillRect(sx + 4, sy + 4, SLOT_W - 8, SLOT_H - 16);

      // Dead overlay X
      if (c.incapacitated) {
        ctx.save();
        ctx.strokeStyle = '#888888';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(sx + 4,          sy + 4);
        ctx.lineTo(sx + SLOT_W - 4, sy + SLOT_H - 16);
        ctx.moveTo(sx + SLOT_W - 4, sy + 4);
        ctx.lineTo(sx + 4,          sy + SLOT_H - 16);
        ctx.stroke();
        ctx.restore();
      }

      // Initiative number (6px monospace, top-right corner)
      ctx.save();
      ctx.font         = '6px monospace';
      ctx.fillStyle    = '#cccccc';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(String(c.initiative), sx + SLOT_W - 2, sy + 2);
      ctx.restore();

      // Name below slot (7px monospace)
      ctx.save();
      ctx.font         = '7px monospace';
      ctx.fillStyle    = c.incapacitated ? '#666666' : (isAct ? '#ffffaa' : '#aaaaaa');
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      // Truncate to 5 chars
      const label = c.display_name.length > 5 ? c.display_name.slice(0, 5) : c.display_name;
      ctx.fillText(label, sx + SLOT_W / 2, sy + SLOT_H - 10);
      ctx.restore();
    }
  }

  // ─── Combatant info panel ──────────────────────────────────────────────────

  _renderCombatantInfo() {
    const ctx = this._renderer.getLayerContext(LAYER.UI_CHROME);
    const c   = this._currentCombatant();
    if (!c) return;

    const bx = 4, by = 450, bw = 180, bh = 26;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#444455';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.save();
    ctx.font         = '9px monospace';
    ctx.fillStyle    = '#ffffff';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${c.display_name}  HP: ${c.current_hp}/${c.max_hp}`, bx + 4, by + 4);

    // HP bar
    const hpFrac = Math.max(0, c.current_hp / c.max_hp);
    ctx.fillStyle = '#330000';
    ctx.fillRect(bx + 4, by + 16, bw - 8, 5);
    ctx.fillStyle = hpFrac > 0.5 ? '#44aa44' : hpFrac > 0.25 ? '#aaaa22' : '#aa2222';
    ctx.fillRect(bx + 4, by + 16, Math.round((bw - 8) * hpFrac), 5);
    ctx.restore();
  }

  // ─── Phase indicator ───────────────────────────────────────────────────────

  _renderPhaseIndicator() {
    const ctx = this._renderer.getLayerContext(LAYER.UI_CHROME);
    let text  = '';
    let color = '#aaaaaa';

    switch (this._phase) {
      case 'player_action':                       text = 'YOUR TURN';   color = '#ffff44'; break;
      case 'enemy_thinking': case 'enemy_post':   text = 'ENEMY TURN';  color = '#ff8822'; break;
      case 'animating':                           text = '...';         color = '#888888'; break;
      default: return;
    }

    ctx.save();
    ctx.font         = 'bold 9px monospace';
    ctx.fillStyle    = color;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(text, 320, 48);
    ctx.restore();
  }

  // ─── Action menu ───────────────────────────────────────────────────────────

  _renderActionMenu() {
    const c = this._currentCombatant();
    if (this._phase !== 'player_action' || !c || c.side !== 'party') {
      this._actionMenuItems = [];
      return;
    }

    const ctx    = this._renderer.getLayerContext(LAYER.DIALOGUE);
    const BTN_W  = 90;
    const BTN_H  = 20;
    const GAP    = 3;
    const RIGHT  = 535;
    const BOTTOM = 478;

    const actions = [
      { label: 'Move',    action: 'move',    disabled: c.action_state.has_moved  },
      { label: 'Attack',  action: 'attack',  disabled: c.action_state.has_acted  },
      { label: 'Defend',  action: 'defend',  disabled: c.action_state.has_acted  },
      { label: 'Wait',    action: 'wait',    disabled: false                      },
    ];

    this._actionMenuItems = [];

    for (let i = 0; i < actions.length; i++) {
      const a  = actions[i];
      const bx = RIGHT;
      const by = BOTTOM - (actions.length - i) * (BTN_H + GAP);

      // Background
      if (a.disabled) {
        ctx.fillStyle = 'rgba(40,40,40,0.80)';
      } else if (this._selectedAction === a.action) {
        ctx.fillStyle = 'rgba(40,80,160,0.90)';
      } else {
        ctx.fillStyle = 'rgba(20,20,40,0.85)';
      }
      ctx.fillRect(bx, by, BTN_W, BTN_H);

      ctx.strokeStyle = a.disabled ? '#333333' : (this._selectedAction === a.action ? '#5588ff' : '#555566');
      ctx.lineWidth   = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, BTN_W - 1, BTN_H - 1);

      ctx.save();
      ctx.font         = '9px monospace';
      ctx.fillStyle    = a.disabled ? '#555555' : '#dddddd';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.label, bx + BTN_W / 2, by + BTN_H / 2);
      ctx.restore();

      this._actionMenuItems.push({ ...a, x: bx, y: by, w: BTN_W, h: BTN_H });
    }
  }

  // ─── Escape confirm modal ──────────────────────────────────────────────────

  _renderEscapeConfirm() {
    const ctx = this._renderer.getLayerContext(LAYER.DIALOGUE);
    const MW  = 260, MH = 40;
    const mx  = Math.round((640 - MW) / 2);
    const my  = Math.round((480 - MH) / 2);

    ctx.fillStyle = 'rgba(10,10,20,0.92)';
    ctx.fillRect(mx, my, MW, MH);
    ctx.strokeStyle = '#665544';
    ctx.lineWidth   = 1;
    ctx.strokeRect(mx + 0.5, my + 0.5, MW - 1, MH - 1);

    ctx.save();
    ctx.font         = '10px monospace';
    ctx.fillStyle    = '#ffeecc';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Flee combat?  [Y] Yes   [N] No', mx + MW / 2, my + MH / 2);
    ctx.restore();
  }

  // ─── Floating text rendering ───────────────────────────────────────────────

  _renderFloatingTexts() {
    const ctx = this._renderer.getLayerContext(LAYER.EFFECTS);

    for (const ft of this._floatingTexts) {
      const px = COMBAT_PAD_X + ft.tile_x * COMBAT_TILE + COMBAT_TILE / 2;
      const py = COMBAT_PAD_Y + ft.tile_y * COMBAT_TILE + COMBAT_TILE / 2 - ft.offsetY;

      ctx.save();
      ctx.globalAlpha  = ft.alpha;
      ctx.font         = 'bold 10px monospace';
      ctx.fillStyle    = ft.color;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ft.text, px, py);
      ctx.restore();
    }
  }

  // ─── End combat ────────────────────────────────────────────────────────────

  end(outcome) {
    this._active         = false;
    this._phase          = 'idle';
    this._combatants     = [];
    this._turnOrder      = [];
    this._floatingTexts  = [];
    this._anim           = null;
    this._movementRange  = new Set();
    this._attackRange    = new Set();
    this._selectedAction = null;
    this._escapeConfirm  = false;

    console.log(`[Combat] ended: ${outcome}`);
    if (this._onCombatEnd) this._onCombatEnd(outcome);
  }
}
