/**
 * training_ui.js — Mentor training panel UI (Layer 10).
 *
 * Opens a modal panel listing a mentor's available trainings, with per-row
 * status indicators: cost, class lock, prereq lock, already-learned badge.
 * Selecting an available training calls Progression.purchaseTraining() and
 * closes the panel.
 *
 * TrainingUI.init(renderer, input)
 * TrainingUI.open(mentorId, party, inventory, factions, onClose)
 * TrainingUI.isOpen() → boolean
 * TrainingUI.close()
 * TrainingUI.render()
 * TrainingUI.handleKey(code)
 */

import { LAYER }       from '../engine/renderer.js';
import { Progression } from '../engine/progression.js';
import { Abilities }   from '../engine/abilities.js';
import { Classes }     from '../engine/classes.js';

// ── Panel geometry ────────────────────────────────────────────────────────────
const PANEL_W   = 430;
const PANEL_H   = 310;
const PANEL_X   = Math.floor((640 - PANEL_W) / 2);
const PANEL_Y   = Math.floor((480 - PANEL_H) / 2);
const ROW_H     = 56;
const ROWS_AREA_Y = PANEL_Y + 50;
const ROWS_AREA_H = PANEL_H - 80;
const MAX_ROWS_VISIBLE = Math.floor(ROWS_AREA_H / ROW_H);

// ── Module state ──────────────────────────────────────────────────────────────
let _renderer  = null;
let _input     = null;
let _open      = false;
let _mentorId  = null;
let _mentor    = null;
let _party     = null;
let _inventory = null;
let _factions  = null;
let _onClose   = null;
let _activeCharIdx = 0;    // which party member is being trained
let _scrollOffset  = 0;    // row scroll (future use)
let _mouseX = 0, _mouseY = 0;
let _resultMsg  = null;    // { text, ok, ttl } — brief feedback after purchase

export const TrainingUI = {

  init(renderer, input) {
    _renderer = renderer;
    _input    = input;

    input._canvas.addEventListener('mousemove', e => {
      const rect  = input._canvas.getBoundingClientRect();
      const scale = input._getScale();
      _mouseX = (e.clientX - rect.left) / (rect.width / input._canvas.width) / scale;
      _mouseY = (e.clientY - rect.top)  / (rect.height / input._canvas.height) / scale;
    });

    input._canvas.addEventListener('click', e => {
      if (!_open) return;
      const rect  = input._canvas.getBoundingClientRect();
      const scale = input._getScale();
      const lx = (e.clientX - rect.left) / (rect.width / input._canvas.width) / scale;
      const ly = (e.clientY - rect.top)  / (rect.height / input._canvas.height) / scale;
      _handleClick(lx, ly);
    });
  },

  /**
   * Open the training panel for a mentor.
   * @param {string} mentorId
   * @param {object} party       — Party object
   * @param {object} inventory   — Inventory module
   * @param {object} factions    — Factions module
   * @param {Function} onClose
   */
  open(mentorId, party, inventory, factions, onClose) {
    const mentor = Progression.getMentor(mentorId);
    if (!mentor) {
      console.warn(`[TrainingUI] Unknown mentor: ${mentorId}`);
      return;
    }
    _mentorId      = mentorId;
    _mentor        = mentor;
    _party         = party;
    _inventory     = inventory;
    _factions      = factions;
    _onClose       = onClose ?? (() => {});
    _activeCharIdx = 0;
    _scrollOffset  = 0;
    _resultMsg     = null;
    _open          = true;
    console.log(`[TrainingUI] Opened for mentor: ${mentorId}`);
  },

  isOpen() { return _open; },

  close() {
    if (!_open) return;
    _open = false;
    _renderer.clearLayer(LAYER.DIALOGUE);
    if (_onClose) _onClose();
  },

  handleKey(code) {
    if (!_open) return;
    if (code === 'Escape') { this.close(); return; }
    if (code === 'ArrowLeft')  { _activeCharIdx = Math.max(0, _activeCharIdx - 1); _resultMsg = null; }
    if (code === 'ArrowRight') { _activeCharIdx = Math.min((_party?.active?.length ?? 1) - 1, _activeCharIdx + 1); _resultMsg = null; }
  },

  render(deltaMs) {
    if (!_open || !_renderer || !_mentor) return;

    const ctx = _renderer.getLayerContext(LAYER.DIALOGUE);
    _renderer.clearLayer(LAYER.DIALOGUE);

    // ── Dim backdrop ──
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, 640, 480);

    // ── Panel body ──
    ctx.fillStyle   = 'rgba(8,14,24,0.98)';
    ctx.fillRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);
    ctx.strokeStyle = '#4a6688';
    ctx.lineWidth   = 1;
    ctx.strokeRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H);

    // Top accent bar
    ctx.strokeStyle = '#2266aa';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(PANEL_X + 8, PANEL_Y + 1);
    ctx.lineTo(PANEL_X + PANEL_W - 8, PANEL_Y + 1);
    ctx.stroke();
    ctx.lineWidth = 1;

    // ── Title ──
    ctx.font         = 'bold 11px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#88bbdd';
    ctx.fillText(`Training — ${_mentor.mentor_label}`, PANEL_X + 14, PANEL_Y + 10);

    // ── Character tabs (if multiple party members) ──
    const members = _party?.active ?? [];
    if (members.length > 1) {
      for (let i = 0; i < members.length; i++) {
        const m    = members[i];
        const tx   = PANEL_X + 14 + i * 90;
        const ty   = PANEL_Y + 26;
        const sel  = (i === _activeCharIdx);
        ctx.fillStyle   = sel ? '#2255aa' : 'rgba(30,45,65,0.8)';
        ctx.fillRect(tx, ty, 84, 16);
        ctx.strokeStyle = sel ? '#4488cc' : '#334455';
        ctx.strokeRect(tx, ty, 84, 16);
        ctx.fillStyle    = sel ? '#aaddff' : '#778899';
        ctx.font         = '9px monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.name ?? m.id, tx + 42, ty + 8);
      }
    }

    const charDef = members[_activeCharIdx]?.def ?? null;

    // ── Divider ──
    const divY = ROWS_AREA_Y - 6;
    ctx.strokeStyle = '#334455';
    ctx.beginPath();
    ctx.moveTo(PANEL_X + 8, divY);
    ctx.lineTo(PANEL_X + PANEL_W - 8, divY);
    ctx.stroke();

    // ── Training rows ──
    const trainings = _mentor.trainings ?? [];
    const visible   = trainings.slice(_scrollOffset, _scrollOffset + MAX_ROWS_VISIBLE);

    for (let i = 0; i < visible.length; i++) {
      const t   = visible[i];
      const ry  = ROWS_AREA_Y + i * ROW_H;
      _renderTrainingRow(ctx, t, charDef, ry);
    }

    if (trainings.length === 0) {
      ctx.font         = '10px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = '#556677';
      ctx.fillText('No trainings available.', PANEL_X + PANEL_W / 2, ROWS_AREA_Y + 40);
    }

    // ── Result message ──
    if (_resultMsg) {
      _resultMsg.ttl -= deltaMs ?? 16;
      if (_resultMsg.ttl > 0) {
        const alpha = Math.min(1, _resultMsg.ttl / 400);
        ctx.globalAlpha  = alpha;
        ctx.fillStyle    = _resultMsg.ok ? '#223a22' : '#3a2222';
        ctx.fillRect(PANEL_X + 8, PANEL_Y + PANEL_H - 36, PANEL_W - 16, 22);
        ctx.strokeStyle  = _resultMsg.ok ? '#44aa44' : '#aa4444';
        ctx.strokeRect(PANEL_X + 8, PANEL_Y + PANEL_H - 36, PANEL_W - 16, 22);
        ctx.fillStyle    = _resultMsg.ok ? '#88ee88' : '#ee8888';
        ctx.font         = '10px monospace';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(_resultMsg.text, PANEL_X + PANEL_W / 2, PANEL_Y + PANEL_H - 25);
        ctx.globalAlpha = 1;
      } else {
        _resultMsg = null;
      }
    }

    // ── Footer ──
    ctx.font         = '9px monospace';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle    = '#446688';
    ctx.fillText('[Esc] Close · Click row to purchase', PANEL_X + PANEL_W - 8, PANEL_Y + PANEL_H - 4);
  },
};

if (typeof window !== 'undefined') window.TrainingUI = TrainingUI;

// ─── Internal ─────────────────────────────────────────────────────────────────

function _renderTrainingRow(ctx, training, charDef, ry) {
  const isHovered = (_mouseY >= ry && _mouseY < ry + ROW_H &&
                     _mouseX >= PANEL_X + 8 && _mouseX < PANEL_X + PANEL_W - 8);

  const { ok, reason } = _checkCanPurchase(training, charDef);
  const alreadyLearned = charDef?.abilities_unlocked?.includes(training.ability_granted) ?? false;

  // Row background
  if (alreadyLearned) {
    ctx.fillStyle = 'rgba(20,40,20,0.6)';
  } else if (!ok) {
    ctx.fillStyle = 'rgba(25,20,20,0.5)';
  } else if (isHovered) {
    ctx.fillStyle = 'rgba(30,60,100,0.7)';
  } else {
    ctx.fillStyle = 'rgba(15,25,40,0.7)';
  }
  ctx.fillRect(PANEL_X + 8, ry, PANEL_W - 16, ROW_H - 4);

  ctx.strokeStyle = alreadyLearned ? '#224422' : (ok ? '#334466' : '#442222');
  ctx.lineWidth   = 1;
  ctx.strokeRect(PANEL_X + 8, ry, PANEL_W - 16, ROW_H - 4);

  const tx = PANEL_X + 16;

  // Training name
  ctx.font         = 'bold 10px monospace';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = alreadyLearned ? '#44aa44' : (ok ? '#ccddff' : '#775566');
  ctx.fillText(training.training_label, tx, ry + 6);

  // Class badge
  if (training.target_class) {
    const cls = Classes.get(training.target_class);
    const badgeLabel = cls?.class_label ?? training.target_class;
    ctx.font         = '8px monospace';
    ctx.textAlign    = 'right';
    ctx.fillStyle    = '#5577aa';
    ctx.fillText(`[${badgeLabel} only]`, PANEL_X + PANEL_W - 18, ry + 6);
  }

  // Description
  ctx.font         = '9px monospace';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = alreadyLearned ? '#336633' : '#778899';
  const desc = (training.training_description ?? '').slice(0, 62);
  ctx.fillText(desc, tx, ry + 20);

  // Cost / status line
  ctx.font = '9px monospace';

  if (alreadyLearned) {
    ctx.fillStyle = '#44aa44';
    ctx.fillText('✓ Already Learned', tx, ry + 36);
  } else if (!ok) {
    ctx.fillStyle = '#aa5555';
    ctx.fillText(`✗ ${reason}`, tx, ry + 36);
  } else {
    // Show costs
    const costParts = [];
    for (const c of (training.cost_items ?? [])) {
      costParts.push(`${c.quantity}× ${_itemLabel(c.item_id)}`);
    }
    if (training.cost_faction_standing) {
      const f = training.cost_faction_standing;
      costParts.push(`${f.faction_id} ≥ ${f.minimum}`);
    }
    ctx.fillStyle = costParts.length ? '#aaaa55' : '#446644';
    ctx.fillText(costParts.length ? `Cost: ${costParts.join(', ')}` : 'Free', tx, ry + 36);
  }

  // Arrow on hover
  if (isHovered && ok && !alreadyLearned) {
    ctx.fillStyle    = '#aaddff';
    ctx.font         = 'bold 12px monospace';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('▶', PANEL_X + PANEL_W - 16, ry + ROW_H / 2 - 2);
  }
}

function _checkCanPurchase(training, charDef) {
  if (!charDef) return { ok: false, reason: 'No character selected' };
  if (charDef.abilities_unlocked?.includes(training.ability_granted)) {
    return { ok: false, reason: 'Already learned' };
  }
  if (training.target_class && charDef.class_id !== training.target_class) {
    const cls = Classes.get(training.target_class);
    return { ok: false, reason: `${cls?.class_label ?? training.target_class} only` };
  }
  for (const prereq of (training.prerequisite_abilities ?? [])) {
    if (!charDef.abilities_unlocked?.includes(prereq)) {
      const ab = Abilities.get(prereq);
      return { ok: false, reason: `Needs: ${ab?.ability_label ?? prereq}` };
    }
  }
  if (training.cost_faction_standing) {
    // Caller supplies factions; checked at purchase time
  }
  return { ok: true, reason: null };
}

function _handleClick(lx, ly) {
  if (!_open || !_mentor) return;
  if (lx < PANEL_X || lx > PANEL_X + PANEL_W) { TrainingUI.close(); return; }
  if (ly < PANEL_Y || ly > PANEL_Y + PANEL_H)  { TrainingUI.close(); return; }

  const trainings = _mentor.trainings ?? [];
  for (let i = 0; i < trainings.length && i < MAX_ROWS_VISIBLE; i++) {
    const ry = ROWS_AREA_Y + i * ROW_H;
    if (ly >= ry && ly < ry + ROW_H - 4) {
      _attemptPurchase(trainings[_scrollOffset + i]);
      return;
    }
  }
}

function _attemptPurchase(training) {
  if (!training) return;
  const members  = _party?.active ?? [];
  const charDef  = members[_activeCharIdx]?.def ?? null;

  const result = Progression.purchaseTraining(
    _mentorId,
    training.training_id,
    charDef,
    _inventory,
    _factions,
  );

  if (result.success) {
    _resultMsg = { text: `Learned: ${training.training_label}!`, ok: true, ttl: 2500 };
  } else {
    _resultMsg = { text: result.reason ?? 'Cannot purchase', ok: false, ttl: 2500 };
  }
}

function _itemLabel(itemId) {
  return itemId.replace('item_', '').replace(/_/g, ' ');
}
