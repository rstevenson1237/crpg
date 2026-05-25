/**
 * dialogue.js — Branching dialogue tree renderer and state machine.
 *
 * Renders on LAYER.DIALOGUE (Layer 10). Text types character-by-character
 * at 40 chars/sec. Options support conditional visibility and enabled state.
 * Fires events via Events.fireEvent() on option selection and node entry.
 *
 * Usage:
 *   Dialogue.init(renderer, input)  — one-time setup
 *   await Dialogue.open(npcId, rootNodeId)
 *   Dialogue.update(deltaMs)        — call every render frame
 *   Dialogue.render()               — call every render frame
 *   Dialogue.handleKey(code)        — call from tick loop when dialogue is open
 *
 * Exposed as window.Dialogue for console testing.
 */

import { LAYER } from './renderer.js';
import { GameState } from './gamestate.js';
import { Events } from './events.js';
import { NPCs } from './npc.js';

const CHARS_PER_SEC = 40;
const CHARS_PER_MS  = CHARS_PER_SEC / 1000;

// ── Dialogue box geometry ─────────────────────────────────────────────────────
const BOX        = { x: 8,  y: 296, w: 624, h: 184 };
const PORT_X     = 18,  PORT_Y = 308, PORT_W = 64, PORT_H = 64;
const TEXT_X     = 92,  TEXT_Y_BASE = 308, TEXT_W = 528;
const OPT_Y_BASE = 388, OPT_H = 15;

// ── Module-level state ────────────────────────────────────────────────────────
let _renderer = null;
let _input    = null;
let _open     = false;
let _loading  = false;  // true during async JSON fetch — prevents double-open
let _npcId    = null;
let _nodes    = null;          // Map<node_id, node>
let _node     = null;          // current node
let _charMs   = 0;
let _shown    = 0;             // chars visible so far (typewriter)
let _done     = false;         // typewriter complete
let _opts     = [];            // filtered options: [{text, target, enabled, eventId, action}]
let _mouseX   = 0, _mouseY = 0;

let _mentorTrainingHandler = null;  // (mentorId) => void — Phase 12

// Per-NPC visited-node history (persists across open/close within a session)
const _history = new Map();   // npc_id → Set<node_id>

// ─── Public API ───────────────────────────────────────────────────────────────

export const Dialogue = {

  /**
   * One-time initialisation — supply the renderer and input references.
   * @param {import('./renderer.js').Renderer} renderer
   * @param {import('./input.js').Input} input
   */
  /** Register a handler called when a dialogue option has action.type === "open_mentor_training". */
  setMentorTrainingHandler(fn) { _mentorTrainingHandler = fn; },

  init(renderer, input) {
    _renderer = renderer;
    _input    = input;

    // Track mouse position in logical pixels for option hover detection
    input._canvas.addEventListener('mousemove', e => {
      const rect  = input._canvas.getBoundingClientRect();
      const scale = input._getScale();
      _mouseX = (e.clientX - rect.left) / (rect.width / input._canvas.width) / scale;
      _mouseY = (e.clientY - rect.top)  / (rect.height / input._canvas.height) / scale;
    });

    // Click handler — consumed only when dialogue is open
    input._canvas.addEventListener('click', e => {
      if (!_open) return;
      const rect  = input._canvas.getBoundingClientRect();
      const scale = input._getScale();
      const lx = (e.clientX - rect.left) / (rect.width / input._canvas.width) / scale;
      const ly = (e.clientY - rect.top)  / (rect.height / input._canvas.height) / scale;
      _handleClick(lx, ly);
    });
  },

  isOpen() { return _open || _loading; },

  /**
   * Open a dialogue session with an NPC.
   * Fetches /data/dialogue/<npcId>.json (simple no-cache fetch).
   * @param {string} npcId
   * @param {string} rootNodeId
   */
  async open(npcId, rootNodeId) {
    if (_open || _loading) return;
    _loading = true;
    let data;
    try {
      const res = await fetch(`/data/dialogue/${npcId}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.warn(`[Dialogue] Could not load dialogue for ${npcId}:`, err);
      _loading = false;
      return;
    }
    _loading = false;

    _nodes = new Map();
    for (const n of (data.nodes ?? [])) _nodes.set(n.node_id, n);

    if (!_history.has(npcId)) _history.set(npcId, new Set());
    _npcId = npcId;
    _open  = true;

    _gotoNode(rootNodeId);
    console.log(`[Dialogue] Opened: ${npcId}  root: ${rootNodeId}`);
  },

  /** Close the dialogue and fire npc_dialogue_completed action trigger. */
  close() {
    if (!_open) return;
    const lastNodeId = _node?.node_id ?? null;
    const npcId      = _npcId;
    _open  = false;
    _nodes = null;
    _node  = null;
    _opts  = [];
    _npcId = null;
    Events.fireActionTrigger('npc_dialogue_completed', { npc_id: npcId, dialogue_node_id: lastNodeId });
    console.log(`[Dialogue] Closed. (npc: ${npcId})`);
  },

  /**
   * Advance the typewriter timer. Call every render frame.
   * @param {number} deltaMs
   */
  update(deltaMs) {
    if (!_open || _done) return;
    _charMs += deltaMs;
    _shown   = Math.min(Math.floor(_charMs * CHARS_PER_MS), _node?.text?.length ?? 0);
    if (_shown >= (_node?.text?.length ?? 0)) _done = true;
  },

  /**
   * Handle key input while dialogue is open.
   * Call this from the game tick loop with raw key codes.
   * @param {string} code — KeyboardEvent.code
   */
  handleKey(code) {
    if (!_open) return;
    if (code === 'Space') {
      if (!_done) {
        _shown = _node?.text?.length ?? 0;
        _done  = true;
      }
      return;
    }
    if (code === 'Escape') { this.close(); return; }
    const m = code.match(/^Digit([1-4])$/);
    if (m && _done) _selectOption(parseInt(m[1]) - 1);
  },

  /** Render the dialogue panel onto LAYER.DIALOGUE. */
  render() {
    if (!_open || !_renderer || !_node) return;

    const ctx = _renderer.getLayerContext(LAYER.DIALOGUE);

    // ── Dim backdrop (lower half only) ──
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, BOX.y - 4, 640, 480 - (BOX.y - 4));

    // ── Box body ──
    ctx.fillStyle   = 'rgba(10,14,24,0.97)';
    ctx.fillRect(BOX.x, BOX.y, BOX.w, BOX.h);
    ctx.strokeStyle = '#445566';
    ctx.lineWidth   = 1;
    ctx.strokeRect(BOX.x, BOX.y, BOX.w, BOX.h);

    // Top accent bar
    ctx.strokeStyle = '#3388aa';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(BOX.x + 8, BOX.y + 1);
    ctx.lineTo(BOX.x + BOX.w - 8, BOX.y + 1);
    ctx.stroke();
    ctx.lineWidth = 1;

    // ── Portrait placeholder ──
    ctx.fillStyle   = 'rgba(28,38,52,0.95)';
    ctx.fillRect(PORT_X, PORT_Y, PORT_W, PORT_H);
    ctx.strokeStyle = '#557799';
    ctx.strokeRect(PORT_X, PORT_Y, PORT_W, PORT_H);
    ctx.font         = 'bold 22px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#88aacc';
    const initial = (_node.speaker_id ?? '?').charAt(0).toUpperCase();
    ctx.fillText(initial, PORT_X + PORT_W / 2, PORT_Y + PORT_H / 2);

    // ── Speaker name ──
    ctx.font         = 'bold 10px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#88ccff';
    ctx.fillText(_speakerName(_node.speaker_id), TEXT_X, BOX.y + 10);

    // ── Typewriter text ──
    const visible = (_node.text ?? '').slice(0, _shown);
    ctx.font      = '11px monospace';
    ctx.fillStyle = '#dde8ee';
    ctx.textAlign = 'left';
    const lines = _wrapText(ctx, visible, TEXT_W);
    let ty = TEXT_Y_BASE + 22;
    for (const line of lines) {
      ctx.fillText(line, TEXT_X, ty);
      ty += 16;
    }

    // ── Divider before options ──
    if (_done && _opts.length > 0) {
      ctx.strokeStyle = '#334455';
      ctx.beginPath();
      ctx.moveTo(BOX.x + 12, OPT_Y_BASE - 5);
      ctx.lineTo(BOX.x + BOX.w - 12, OPT_Y_BASE - 5);
      ctx.stroke();
    }

    // ── Options ──
    if (_done) {
      for (let i = 0; i < _opts.length; i++) {
        const opt    = _opts[i];
        const oy     = OPT_Y_BASE + i * OPT_H;
        const hovered = _hoveredIdx() === i;

        ctx.font         = '10px monospace';
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'top';

        if (!opt.enabled) {
          ctx.fillStyle = '#445566';
        } else if (hovered) {
          // Highlight row
          ctx.fillStyle = 'rgba(51,136,170,0.18)';
          ctx.fillRect(BOX.x + 4, oy - 1, BOX.w - 8, OPT_H);
          ctx.fillStyle = '#aaddff';
        } else {
          ctx.fillStyle = '#ccddee';
        }

        const prefix = (hovered && opt.enabled) ? '▶ ' : '  ';
        ctx.fillText(`${prefix}${i + 1}. ${opt.text}`, BOX.x + 12, oy);

        if (!opt.enabled) {
          ctx.fillStyle    = '#667788';
          ctx.textAlign    = 'right';
          ctx.fillText('🔒', BOX.x + BOX.w - 10, oy);
        }
      }
    }

    // ── Footer hint ──
    ctx.font         = '9px monospace';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle    = '#446688';
    if (!_done) {
      ctx.fillText('[Space] skip text', BOX.x + BOX.w - 10, BOX.y + BOX.h - 4);
    } else if (_opts.length > 0) {
      ctx.fillText('[1–4] or click · [Esc] close', BOX.x + BOX.w - 10, BOX.y + BOX.h - 4);
    }
  },
};

if (typeof window !== 'undefined') window.Dialogue = Dialogue;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _gotoNode(nodeId) {
  if (!nodeId || !_nodes.has(nodeId)) {
    console.warn(`[Dialogue] Node not found: "${nodeId}" — closing.`);
    Dialogue.close();
    return;
  }
  _node   = _nodes.get(nodeId);
  _charMs = 0;
  _shown  = 0;
  _done   = false;

  _history.get(_npcId)?.add(nodeId);

  // Fire on-enter event if set
  if (_node.on_enter_fire_event) {
    Events.fireEvent(_node.on_enter_fire_event);
  }

  // Build filtered option list
  _opts = (_node.options ?? [])
    .filter(o => _evalCond(o.visible_condition))
    .map(o => ({
      text:    o.option_text,
      target:  o.target_node,
      enabled: _evalCond(o.enabled_condition ?? null),
      eventId: o.on_select_fire_event ?? null,
      action:  o.action ?? null,
    }));
}

function _selectOption(idx) {
  if (idx < 0 || idx >= _opts.length) return;
  const opt = _opts[idx];
  if (!opt.enabled) return;

  if (opt.eventId) Events.fireEvent(opt.eventId);

  // Dispatch inline action (e.g. open_mentor_training)
  if (opt.action) {
    if (opt.action.type === 'open_mentor_training' && _mentorTrainingHandler) {
      _mentorTrainingHandler(opt.action.mentor_id);
    }
  }

  if (opt.target === null) {
    Dialogue.close();
  } else {
    _gotoNode(opt.target);
  }
}

function _handleClick(lx, ly) {
  // Click anywhere in box while typewriter is running → skip to full text
  if (!_done && ly >= BOX.y && ly <= BOX.y + BOX.h) {
    _shown = _node?.text?.length ?? 0;
    _done  = true;
    return;
  }
  // Click on an option row
  if (!_done) return;
  const hov = _hoveredIdxAt(lx, ly);
  if (hov >= 0) _selectOption(hov);
}

function _hoveredIdx() {
  return _hoveredIdxAt(_mouseX, _mouseY);
}

function _hoveredIdxAt(lx, ly) {
  if (lx < BOX.x || lx > BOX.x + BOX.w) return -1;
  for (let i = 0; i < _opts.length; i++) {
    const oy = OPT_Y_BASE + i * OPT_H;
    if (ly >= oy - 1 && ly <= oy + OPT_H) return i;
  }
  return -1;
}

/** Evaluate a single condition using GameState (mirrors events.js logic). */
function _evalCond(cond) {
  if (!cond) return true;
  const type = cond.condition_type ?? cond.type;
  const gs   = GameState;
  switch (type) {
    case 'flag_is_set':          return gs.flags.isSet(cond.flag_id);
    case 'flag_not_set':         return !gs.flags.isSet(cond.flag_id);
    case 'secret_known':         return gs.hasSecret(cond.secret_id);
    case 'party_includes_class': return gs.party?.active?.some(c => c.def.class_id === cond.class_id) ?? false;
    case 'party_has_item':       return false; // Phase 8
    case 'event_complete':       return Events.isComplete(cond.event_id);
    case 'event_not_complete':   return !Events.isComplete(cond.event_id);
    case 'faction_standing_gte': return gs.getFactionStanding(cond.faction_id) >= cond.value;
    default:                     return true;
  }
}

/** Resolve a speaker_id to a display name. */
function _speakerName(speakerId) {
  if (!speakerId || speakerId === 'party_lead') {
    return GameState.party?.getLead()?.name ?? 'You';
  }
  const inst = NPCs.getById(speakerId);
  if (inst) return inst.def.display_name;
  return speakerId.replace(/^npc_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
