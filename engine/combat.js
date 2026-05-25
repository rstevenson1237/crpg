/**
 * combat.js — Combat state machine (Phases 10 + 11).
 *
 * Phase 10: Arena transition, tactical grid, initiative, turn order, basic attack/move.
 * Phase 11: Full ability resolution for all 4 classes, status effects integration,
 *           floating combat text, post-combat loot UI, status icons.
 */

import { CombatGrid, COMBAT_TILE, COMBAT_PAD_X, COMBAT_PAD_Y } from './combat_grid.js';
import { LAYER } from './renderer.js';
import { StatusEffects, STATUS_COLORS } from './status_effects.js';
import { Abilities } from './abilities.js';
import { Classes } from './classes.js';
import { Items, LootTables } from './items.js';
import { Inventory } from './inventory.js';

// Placeholder colour per class (used when sprites are absent)
const CLASS_COLORS = {
  fighter:  '#5588bb',
  mage:     '#9955bb',
  thief:    '#336633',
  cleric:   '#bbaa22',
  skeleton: '#888888',
};

function clamp(min, max, v) { return Math.min(max, Math.max(min, v)); }

// ─── Random hex statuses for area_hex ─────────────────────────────────────────
const HEX_STATUSES = ['slowed', 'silenced', 'burning'];

// ─── Ability highlight colours ─────────────────────────────────────────────────
const ABILITY_RANGE_COLOR   = 'rgba(180,100,255,0.22)'; // purple for ability targeting
const ABILITY_AREA_COLOR    = 'rgba(255,180,50,0.22)';  // orange for area preview
const HEAL_RANGE_COLOR      = 'rgba(50,200,100,0.22)';  // green for healing

export class CombatEngine {
  constructor(renderer, input) {
    this._renderer = renderer;
    this._input    = input;

    this._active      = false;
    this._combatants  = [];
    this._turnOrder   = [];
    this._turnIdx     = 0;
    this._round       = 1;
    this._phase       = 'idle';

    this._selectedAction  = null;
    this._selectedAbility = null;   // ability def when in ability_target mode
    this._grid  = new CombatGrid();
    this._anim  = null;

    this._enemyTimer    = 0;
    this._postAnimTimer = 0;
    this._hoveredTile   = null;
    this._movementRange = new Set();
    this._attackRange   = new Set();
    this._abilityRange  = new Set();  // targeting range for selected ability
    this._hoverAreaTiles = new Set(); // 3×3 preview for area abilities on hover

    this._floatingTexts   = [];
    this._escapeConfirm   = false;
    this._onCombatEnd     = null;
    this._lootTableId     = null;

    // Ability panel state
    this._abilityPanelOpen  = false;
    this._abilityPanelItems = []; // { ability, x, y, w, h }

    // Action menu hit areas
    this._actionMenuItems = [];

    // Barriers: { x, y, rounds }
    this._barriers = [];

    // Post-combat loot
    this._lootPhase   = false;
    this._pendingLoot = [];        // [{ item_def, quantity }]
    this._lootUIItems = [];        // hit areas for loot UI

    // Click state
    this._clickPending = null;

    renderer.canvas.addEventListener('click', (e) => {
      const rect  = renderer.canvas.getBoundingClientRect();
      const scale = renderer.scale;
      const lx    = (e.clientX - rect.left) / (rect.width  / renderer.canvas.width)  / scale;
      const ly    = (e.clientY - rect.top)  / (rect.height / renderer.canvas.height) / scale;
      this._clickPending = { x: lx, y: ly };
    });
  }

  isActive() { return this._active; }

  // ─── Initiate ──────────────────────────────────────────────────────────────

  /**
   * @param {string}   encounterId
   * @param {Array}    rawCombatants  [{ entity, side, tile_x, tile_y }]
   * @param {function} onCombatEnd    called with outcome string
   * @param {string}   lootTableId    optional loot table to roll on victory
   */
  initiate(encounterId, rawCombatants, onCombatEnd, lootTableId = null) {
    this._onCombatEnd   = onCombatEnd;
    this._lootTableId   = lootTableId;
    this._combatants    = [];
    this._turnOrder     = [];
    this._turnIdx       = 0;
    this._round         = 1;
    this._floatingTexts = [];
    this._anim          = null;
    this._escapeConfirm = false;
    this._selectedAction  = null;
    this._selectedAbility = null;
    this._movementRange   = new Set();
    this._attackRange     = new Set();
    this._abilityRange    = new Set();
    this._hoverAreaTiles  = new Set();
    this._clickPending    = null;
    this._barriers        = [];
    this._lootPhase       = false;
    this._pendingLoot     = [];
    this._abilityPanelOpen = false;

    StatusEffects.clearAll();

    for (let i = 0; i < rawCombatants.length; i++) {
      const raw    = rawCombatants[i];
      const entity = raw.entity;
      const def    = entity.def ?? entity;
      const stats  = def.base_stats ?? {};

      const magic = stats.magic ?? 0;
      const state = {
        id:            def.character_id ?? `combatant_${i}`,
        entity,
        side:          raw.side,
        tile_x:        raw.tile_x,
        tile_y:        raw.tile_y,
        current_hp:    stats.hp      ?? 10,
        max_hp:        stats.max_hp  ?? stats.hp ?? 10,
        speed:         stats.speed   ?? 4,
        attack_stat:   stats.attack  ?? 5,
        defense_stat:  stats.defense ?? 3,
        magic_stat:    magic,
        current_mp:    Math.max(5, magic * 2),
        max_mp:        Math.max(5, magic * 2),
        initiative:    0,
        incapacitated: false,
        defending:     false,
        action_state:  { has_moved: false, has_acted: false },
        class_id:      def.class_id ?? 'unknown',
        display_name:  def.display_name ?? 'Unknown',
        tags:          def.tags ?? [],
        stances:       {},   // shield_wall, sanctuary, stealthed flags
      };

      state.initiative = state.speed + Math.floor(Math.random() * 6) + 1;
      this._combatants.push(state);
    }

    this._turnOrder = [...this._combatants].sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      if (a.side === 'party' && b.side !== 'party') return -1;
      if (b.side === 'party' && a.side !== 'party') return  1;
      return 0;
    });

    this._active = true;
    console.log(`[Combat] Initiated: ${encounterId}`);
    this._startTurn();
  }

  // ─── Turn management ───────────────────────────────────────────────────────

  _currentCombatant() { return this._turnOrder[this._turnIdx] ?? null; }

  _startTurn() {
    const c = this._currentCombatant();
    if (!c) { this._doVictory(); return; }

    c.action_state    = { has_moved: false, has_acted: false };
    c.defending       = false;
    c._frightenedSource = null;

    if (c.incapacitated) { this._advanceTurn(); return; }

    // Tick status effects at turn start — may deal damage or modify action state
    StatusEffects.tick(c.id, c, this._combatants, (t, col, tx, ty) => this._spawnFloatingText(t, col, tx, ty));

    // Check if tick damage incapacitated this combatant
    if (c.current_hp <= 0) {
      c.current_hp    = 0;
      c.incapacitated = true;
      this._spawnFloatingText('DEFEATED', '#ff8800', c.tile_x, c.tile_y);
      this._advanceTurn();
      return;
    }

    // Handle frightened: auto-move away from source before actions
    if (c._frightenedSource && !c.action_state.has_moved) {
      this._executeFrightenedMove(c);
    }

    // Charmed party members are controlled by enemy AI
    if (c.side === 'party' && StatusEffects.has(c.id, 'charmed')) {
      this._phase      = 'enemy_thinking';
      this._enemyTimer = 800;
      return;
    }

    if (c.side === 'party') {
      this._phase           = 'player_action';
      this._selectedAction  = null;
      this._abilityPanelOpen = false;
      this._updateHighlightRanges(c);
    } else {
      this._phase      = 'enemy_thinking';
      this._enemyTimer = 800;
    }
  }

  _advanceTurn() {
    const enemiesAlive = this._combatants.filter(c => c.side === 'enemy' && !c.incapacitated);
    const partyAlive   = this._combatants.filter(c => c.side === 'party' && !c.incapacitated);
    if (enemiesAlive.length === 0) { this._doVictory(); return; }
    if (partyAlive.length   === 0) { this.end('defeat');  return; }

    this._turnIdx = (this._turnIdx + 1) % this._turnOrder.length;

    // When the turn order wraps, increment round and tick barriers
    if (this._turnIdx === 0) {
      this._round++;
      this._tickBarriers();
    }

    this._startTurn();
  }

  _tickBarriers() {
    const surviving = [];
    for (const b of this._barriers) {
      b.rounds--;
      if (b.rounds <= 0) {
        // Restore the tile to passable floor
        this._grid.setTile(b.x, b.y, { passable: true, type: 'floor' });
        this._spawnFloatingText('barrier fades', '#8888ff', b.x, b.y);
      } else {
        surviving.push(b);
      }
    }
    this._barriers = surviving;
  }

  _updateHighlightRanges(c) {
    if (!c || c.incapacitated) {
      this._movementRange = new Set();
      this._attackRange   = new Set();
      this._abilityRange  = new Set();
      return;
    }

    if (this._selectedAction === 'move' && !c.action_state.has_moved) {
      const speedBonus = StatusEffects.has(c.id, 'slowed') ? -Math.ceil(c.speed / 2) : 0;
      const effectiveSpeed = Math.max(1, c.speed + speedBonus);
      this._movementRange = this._grid.getMovementRange(c.tile_x, c.tile_y, effectiveSpeed, c.id, this._combatants);
      this._attackRange   = new Set();
      this._abilityRange  = new Set();
    } else if (this._selectedAction === 'attack' && !c.action_state.has_acted) {
      this._attackRange   = this._getAdjacentEnemyTiles(c);
      this._movementRange = new Set();
      this._abilityRange  = new Set();
    } else if (this._selectedAction === 'ability_target' && this._selectedAbility) {
      this._abilityRange  = this._computeAbilityRange(c, this._selectedAbility);
      this._movementRange = new Set();
      this._attackRange   = new Set();
    } else {
      this._movementRange = new Set();
      this._attackRange   = new Set();
      this._abilityRange  = new Set();
    }
  }

  // ─── Ability system ────────────────────────────────────────────────────────

  _getAvailableAbilities(c) {
    const def      = c.entity?.def ?? c.entity;
    const classDef = Classes.get(def.class_id);
    if (!classDef) return [];
    return Abilities.getActions(def, classDef).filter(ab => {
      if (ab.world_only) return false;
      if (ab.ability_type === 'move_action'     && c.action_state.has_moved) return false;
      if (ab.ability_type === 'standard_action' && c.action_state.has_acted) return false;
      if (ab.ability_type === 'stance'          && c.action_state.has_acted) return false;
      // Silenced: block magic abilities (arcane_bolt, area_hex, barrier, blink, cure, mass_cure, turn_undead, sanctuary)
      if (StatusEffects.has(c.id, 'silenced')) {
        const magicAbilities = ['arcane_bolt','area_hex','barrier','blink','cure','mass_cure','turn_undead','sanctuary'];
        if (magicAbilities.includes(ab.ability_id)) return false;
      }
      return true;
    });
  }

  /** Compute targetable tile set for an ability. */
  _computeAbilityRange(caster, ability) {
    const range   = new Set();
    const maxDist = ability.range_tiles;

    // Self-targeting: no range display needed
    if (ability.target === 'self') return range;

    for (const c of this._combatants) {
      if (c.incapacitated) continue;
      const dist = Math.abs(c.tile_x - caster.tile_x) + Math.abs(c.tile_y - caster.tile_y);
      if (dist > maxDist) continue;
      if (ability.target === 'single_enemy' && c.side !== caster.side) range.add(`${c.tile_x},${c.tile_y}`);
      if (ability.target === 'single_ally'  && c.side === caster.side) range.add(`${c.tile_x},${c.tile_y}`);
      if (ability.target === 'area' || ability.target === 'tile')       range.add(`${c.tile_x},${c.tile_y}`);
    }

    if (ability.target === 'tile' || ability.target === 'area') {
      // Add all passable tiles within range too (for placement abilities like barrier)
      for (let dy = -maxDist; dy <= maxDist; dy++) {
        for (let dx = -maxDist; dx <= maxDist; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > maxDist) continue;
          const tx = caster.tile_x + dx;
          const ty = caster.tile_y + dy;
          if (tx >= 0 && ty >= 0 && tx < 24 && ty < 18) range.add(`${tx},${ty}`);
        }
      }
    }

    return range;
  }

  /** Compute 3×3 area preview centred on (tx, ty). */
  _computeAreaPreview(tx, ty) {
    const s = new Set();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) s.add(`${tx+dx},${ty+dy}`);
    }
    return s;
  }

  /** Execute an ability from the ability panel. */
  _activateAbility(ability) {
    const c = this._currentCombatant();
    if (!c) return;

    // MP check
    if (ability.cost?.type === 'mp' && c.current_mp < ability.cost.amount) {
      this._spawnFloatingText('No MP!', '#ff4444', c.tile_x, c.tile_y);
      return;
    }

    if (ability.target === 'self' || ability.target === 'none') {
      // Execute immediately
      this._abilityPanelOpen = false;
      this._selectedAction   = null;
      this._executeAbility(c, ability, c.tile_x, c.tile_y);
    } else {
      // Enter targeting mode
      this._abilityPanelOpen  = false;
      this._selectedAbility   = ability;
      this._selectedAction    = 'ability_target';
      this._updateHighlightRanges(c);
    }
  }

  /** Dispatch to per-ability handlers. */
  _executeAbility(caster, ability, tx, ty) {
    // Deduct MP
    if (ability.cost?.type === 'mp') {
      caster.current_mp = Math.max(0, caster.current_mp - ability.cost.amount);
    }

    // Track usage
    const def = caster.entity?.def ?? caster.entity;
    Abilities.recordUse(def, ability.ability_id);

    const id = ability.ability_id;

    if      (id === 'cleave')       this._abilityCleave(caster, tx, ty);
    else if (id === 'charge')       this._abilityCharge(caster, tx, ty);
    else if (id === 'shield_wall')  this._abilityShieldWall(caster);
    else if (id === 'fortify')      this._abilityFortify(caster);
    else if (id === 'intimidate')   this._abilityIntimidate(caster, tx, ty);
    else if (id === 'breach')       this._abilityBreach(caster, tx, ty);
    else if (id === 'arcane_bolt')  this._abilityArcaneBolt(caster, tx, ty);
    else if (id === 'area_hex')     this._abilityAreaHex(caster, tx, ty);
    else if (id === 'barrier')      this._abilityBarrier(caster, tx, ty);
    else if (id === 'blink')        this._abilityBlink(caster, tx, ty);
    else if (id === 'backstab')     this._abilityBackstab(caster, tx, ty);
    else if (id === 'shadow_step')  this._abilityShadowStep(caster, tx, ty);
    else if (id === 'vanish')       this._abilityVanish(caster);
    else if (id === 'cure')         this._abilityCure(caster, tx, ty);
    else if (id === 'mass_cure')    this._abilityMassCure(caster);
    else if (id === 'turn_undead')  this._abilityTurnUndead(caster);
    else if (id === 'smite')        this._abilitySmite(caster, tx, ty);
    else if (id === 'sanctuary')    this._abilitySanctuary(caster);
    else {
      console.log(`[Combat] Ability ${id} not yet implemented`);
      // Still consume action for unimplemented abilities
      if (ability.ability_type === 'standard_action' || ability.ability_type === 'stance') {
        caster.action_state.has_acted = true;
      } else if (ability.ability_type === 'move_action') {
        caster.action_state.has_moved = true;
      }
    }

    this._selectedAction  = null;
    this._selectedAbility = null;
    this._movementRange   = new Set();
    this._attackRange     = new Set();
    this._abilityRange    = new Set();

    if (caster.side === 'party') {
      this._phase = 'player_action';
      this._updateHighlightRanges(caster);
      if (caster.action_state.has_moved && caster.action_state.has_acted) {
        this._postAnimTimer = 300;
        this._phase = 'enemy_post';
      }
    }
  }

  // ─── Fighter abilities ─────────────────────────────────────────────────────

  _abilityCleave(caster, tx, ty) {
    const primary = this._getOccupant(tx, ty);
    if (!primary || primary.side === caster.side || primary.incapacitated) return;

    // Primary target — full damage
    this._resolveHit(caster, primary, 1.0, false);

    // All adjacent to primary — 60% damage
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const adj = this._getOccupant(tx + dx, ty + dy);
      if (adj && adj.side !== caster.side && !adj.incapacitated && adj.id !== primary.id) {
        this._resolveHit(caster, adj, 0.6, false);
      }
    }

    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Cleave`);
  }

  _abilityCharge(caster, tx, ty) {
    const target = this._getOccupant(tx, ty);
    if (!target || target.side === caster.side || target.incapacitated) return;

    // Require straight-line path (same row or column)
    const inRow    = caster.tile_y === ty;
    const inCol    = caster.tile_x === tx;
    if (!inRow && !inCol) {
      this._spawnFloatingText('Must charge in a straight line', '#ff8844', caster.tile_x, caster.tile_y);
      return;
    }

    // Move to tile adjacent to target
    const dx = inRow ? Math.sign(tx - caster.tile_x) : 0;
    const dy = inCol ? Math.sign(ty - caster.tile_y) : 0;
    const destX = tx - dx;
    const destY = ty - dy;
    const dist = Math.abs(destX - caster.tile_x) + Math.abs(destY - caster.tile_y);

    if (dist > caster.speed) {
      this._spawnFloatingText('Too far!', '#ff8844', caster.tile_x, caster.tile_y);
      return;
    }

    // Move
    caster.tile_x = destX;
    caster.tile_y = destY;
    this._anim = {
      combatantId: caster.id, fromX: caster.tile_x, fromY: caster.tile_y,
      path: [{ x: destX, y: destY }], frame: 0, totalFrames: 8,
    };

    // Attack with bonus damage
    const bonusDmg = dist * 2;
    this._resolveHit(caster, target, 1.0, false, bonusDmg);

    caster.action_state.has_moved = true;
    caster.action_state.has_acted = true;
    this._phase = 'animating';
    console.log(`[Ability] ${caster.display_name} — Charge (dist ${dist}, +${bonusDmg} dmg)`);
  }

  _abilityShieldWall(caster) {
    caster.stances.shield_wall = true;
    caster.action_state.has_moved = true; // Cannot move while in Shield Wall stance
    caster.action_state.has_acted = true;
    StatusEffects.apply(caster.id, 'shield_wall', 999, null);
    this._spawnFloatingText('SHIELD WALL', STATUS_COLORS.shield_wall, caster.tile_x, caster.tile_y);
    console.log(`[Ability] ${caster.display_name} — Shield Wall`);
  }

  _abilityFortify(caster) {
    StatusEffects.apply(caster.id, 'fortified', 1, null);
    caster.action_state.has_acted = true;
    this._spawnFloatingText('FORTIFIED', STATUS_COLORS.fortified, caster.tile_x, caster.tile_y);
    console.log(`[Ability] ${caster.display_name} — Fortify`);
  }

  _abilityIntimidate(caster, tx, ty) {
    const target = this._getOccupant(tx, ty);
    if (!target || target.side === caster.side || target.incapacitated) return;

    const hpPct = target.current_hp / target.max_hp;
    if (hpPct > 0.30) {
      this._spawnFloatingText('Not scared!', '#aaaaaa', target.tile_x, target.tile_y);
      caster.action_state.has_acted = true;
      return;
    }
    if (target.tags?.includes('boss')) {
      this._spawnFloatingText('Cannot intimidate boss!', '#aaaaaa', target.tile_x, target.tile_y);
      caster.action_state.has_acted = true;
      return;
    }

    // Enemy flees — removed from combat, no loot
    target.incapacitated = true;
    target._intimidated  = true;   // flag: no loot
    this._spawnFloatingText('FLED!', STATUS_COLORS.frightened, target.tile_x, target.tile_y);
    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Intimidate: ${target.display_name} flees`);
  }

  _abilityBreach(caster, tx, ty) {
    // In combat, Breach destroys cover/pillar tiles adjacent to caster
    const tile = this._grid.getTile(tx, ty);
    if (!tile || tile.passable) {
      this._spawnFloatingText('Nothing to breach!', '#aaaaaa', caster.tile_x, caster.tile_y);
    } else {
      this._grid.setTile(tx, ty, { passable: true, type: 'floor' });
      this._spawnFloatingText('BREACH!', '#ff8844', tx, ty);
      console.log(`[Ability] ${caster.display_name} — Breach (${tx},${ty})`);
    }
    caster.action_state.has_acted = true;
  }

  // ─── Mage abilities ────────────────────────────────────────────────────────

  _abilityArcaneBolt(caster, tx, ty) {
    const target = this._getOccupant(tx, ty);
    if (!target || target.side === caster.side || target.incapacitated) return;

    const damage = Math.max(1, caster.magic_stat);  // ignores physical defense
    target.current_hp -= damage;
    this._spawnFloatingText(`-${damage}`, '#dd88ff', target.tile_x, target.tile_y);
    this._spawnFloatingText('MAGIC', '#cc66ff', target.tile_x, target.tile_y - 1);

    if (target.current_hp <= 0) {
      target.current_hp    = 0;
      target.incapacitated = true;
      this._spawnFloatingText('DEFEATED', '#ff8800', target.tile_x, target.tile_y - 1);
    }

    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Arcane Bolt → ${target.display_name} (-${damage})`);
  }

  _abilityAreaHex(caster, tx, ty) {
    // 3×3 area centred on target tile
    let hitCount = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this._getOccupant(tx + dx, ty + dy);
        if (!t || t.side === caster.side || t.incapacitated) continue;

        const damage = Math.max(1, caster.magic_stat - 1);
        t.current_hp -= damage;
        this._spawnFloatingText(`-${damage}`, '#dd88ff', t.tile_x, t.tile_y);

        if (Math.random() < 0.60) {
          const status = HEX_STATUSES[Math.floor(Math.random() * HEX_STATUSES.length)];
          StatusEffects.apply(t.id, status, 2, caster.id);
          this._spawnFloatingText(status.toUpperCase(), STATUS_COLORS[status], t.tile_x, t.tile_y);
        }

        if (t.current_hp <= 0) {
          t.current_hp    = 0;
          t.incapacitated = true;
          this._spawnFloatingText('DEFEATED', '#ff8800', t.tile_x, t.tile_y - 1);
        }
        hitCount++;
      }
    }

    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Area Hex (hit ${hitCount} targets)`);
  }

  _abilityBarrier(caster, tx, ty) {
    const tile = this._grid.getTile(tx, ty);
    if (!tile || !tile.passable) {
      this._spawnFloatingText('Tile occupied!', '#aaaaaa', caster.tile_x, caster.tile_y);
      caster.action_state.has_acted = true;
      return;
    }
    const occupant = this._getOccupant(tx, ty);
    if (occupant) {
      this._spawnFloatingText('Tile occupied!', '#aaaaaa', caster.tile_x, caster.tile_y);
      caster.action_state.has_acted = true;
      return;
    }

    this._grid.setTile(tx, ty, { passable: false, type: 'barrier' });
    this._barriers.push({ x: tx, y: ty, rounds: 3 });
    this._spawnFloatingText('BARRIER', '#8888ff', tx, ty);
    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Barrier at (${tx},${ty})`);
  }

  _abilityBlink(caster, tx, ty) {
    const tile = this._grid.getTile(tx, ty);
    if (!tile || !tile.passable || this._getOccupant(tx, ty)) {
      this._spawnFloatingText('Invalid blink target!', '#aaaaaa', caster.tile_x, caster.tile_y);
      return;
    }
    this._spawnFloatingText('BLINK', '#cc88ff', caster.tile_x, caster.tile_y);
    caster.tile_x = tx;
    caster.tile_y = ty;
    caster.action_state.has_moved = true;
    console.log(`[Ability] ${caster.display_name} — Blink to (${tx},${ty})`);
  }

  // ─── Thief abilities ───────────────────────────────────────────────────────

  _abilityBackstab(caster, tx, ty) {
    const target = this._getOccupant(tx, ty);
    if (!target || target.side === caster.side || target.incapacitated) return;

    // Triple damage if: target has not acted this round AND approached from non-facing tile
    const targetHasActed = target.action_state?.has_acted ?? true;
    // "From behind" = caster is NOT in the target's front tile (simplified: caster not in same direction target faces)
    const isBackstab = !targetHasActed;  // simplified: triple if target hasn't acted

    const multiplier = isBackstab ? 3.0 : 1.0;
    this._resolveHit(caster, target, multiplier, false);
    if (isBackstab) {
      this._spawnFloatingText('BACKSTAB!', '#ff2255', target.tile_x, target.tile_y);
    }

    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Backstab x${multiplier}`);
  }

  _abilityShadowStep(caster, tx, ty) {
    // Teleport to any tile within range (treat all floor tiles as shadow tiles for now)
    const tile = this._grid.getTile(tx, ty);
    if (!tile || !tile.passable || this._getOccupant(tx, ty)) {
      this._spawnFloatingText('Invalid shadow step!', '#aaaaaa', caster.tile_x, caster.tile_y);
      return;
    }
    this._spawnFloatingText('SHADOW STEP', STATUS_COLORS.stealthed, caster.tile_x, caster.tile_y);
    caster.tile_x = tx;
    caster.tile_y = ty;
    caster.action_state.has_moved = true;
    console.log(`[Ability] ${caster.display_name} — Shadow Step to (${tx},${ty})`);
  }

  _abilityVanish(caster) {
    StatusEffects.apply(caster.id, 'stealthed', 99, null);
    caster.stances.stealthed = true;
    caster.action_state.has_acted = true;
    this._spawnFloatingText('VANISH', STATUS_COLORS.stealthed, caster.tile_x, caster.tile_y);
    console.log(`[Ability] ${caster.display_name} — Vanish`);
  }

  // ─── Cleric abilities ──────────────────────────────────────────────────────

  _abilityCure(caster, tx, ty) {
    const target = this._getOccupant(tx, ty);
    if (!target || target.side !== caster.side || target.incapacitated) return;

    const healed = caster.magic_stat * 2 + 8;
    target.current_hp = Math.min(target.max_hp, target.current_hp + healed);
    StatusEffects.remove(target.id, 'poisoned');
    StatusEffects.remove(target.id, 'bleeding');
    this._spawnFloatingText(`+${healed}`, '#44ff66', target.tile_x, target.tile_y);
    this._spawnFloatingText('CURE', '#44ff66', target.tile_x, target.tile_y - 1);

    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Cure: +${healed} HP to ${target.display_name}`);
  }

  _abilityMassCure(caster) {
    const radius = 3;
    const healed = caster.magic_stat + 4;
    let count = 0;
    for (const c of this._combatants) {
      if (c.incapacitated || c.side !== caster.side) continue;
      const dist = Math.abs(c.tile_x - caster.tile_x) + Math.abs(c.tile_y - caster.tile_y);
      if (dist > radius) continue;
      c.current_hp = Math.min(c.max_hp, c.current_hp + healed);
      this._spawnFloatingText(`+${healed}`, '#44ff66', c.tile_x, c.tile_y);
      count++;
    }
    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Mass Cure: +${healed} to ${count} allies`);
  }

  _abilityTurnUndead(caster) {
    const radius = 5;
    let affected = 0;
    for (const c of this._combatants) {
      if (c.incapacitated || c.side === caster.side) continue;
      if (!c.tags?.includes('undead')) continue;
      const dist = Math.abs(c.tile_x - caster.tile_x) + Math.abs(c.tile_y - caster.tile_y);
      if (dist > radius) continue;

      // Roll magic vs target magic (undead have 0 magic by default)
      const roll = Math.random();
      const threshold = (caster.magic_stat) / (caster.magic_stat + (c.magic_stat ?? 0) + 1);
      if (roll < threshold) {
        StatusEffects.apply(c.id, 'frightened', 3, caster.id);
        this._spawnFloatingText('TURN UNDEAD', '#ffffaa', c.tile_x, c.tile_y);
        affected++;
      }
    }
    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Turn Undead: ${affected} turned`);
  }

  _abilitySmite(caster, tx, ty) {
    const target = this._getOccupant(tx, ty);
    if (!target || target.side === caster.side || target.incapacitated) return;

    const isHoly = target.tags?.includes('undead') || target.tags?.includes('corrupted');
    const multiplier = isHoly ? 1.5 : 1.0;
    this._resolveHit(caster, target, multiplier, false);
    if (isHoly) this._spawnFloatingText('SMITE!', '#ffffaa', target.tile_x, target.tile_y);

    caster.action_state.has_acted = true;
    console.log(`[Ability] ${caster.display_name} — Smite x${multiplier}`);
  }

  _abilitySanctuary(caster) {
    StatusEffects.apply(caster.id, 'sanctuary', 99, null);
    caster.stances.sanctuary = true;
    caster.action_state.has_acted = true;
    this._spawnFloatingText('SANCTUARY', STATUS_COLORS.sanctuary, caster.tile_x, caster.tile_y);
    console.log(`[Ability] ${caster.display_name} — Sanctuary`);
  }

  // ─── Core attack/move helpers ──────────────────────────────────────────────

  /**
   * Resolve a physical hit with optional damage multiplier and flat bonus.
   * Respects blinded, fortified, defending, shield_wall.
   */
  _resolveHit(attacker, target, multiplier = 1.0, isRanged = false, flatBonus = 0) {
    let hitChance = clamp(0.10, 0.95,
      0.75 + (attacker.attack_stat - target.defense_stat) * 0.05
    );

    // Blinded: hit chance capped at 30%
    if (StatusEffects.has(attacker.id, 'blinded')) hitChance = Math.min(hitChance, 0.30);

    // Defending: +20% dodge
    if (target.defending) hitChance = Math.max(0.05, hitChance - 0.20);

    // Shield Wall: check if any adjacent ally of target is in shield_wall stance
    for (const ally of this._combatants) {
      if (ally.incapacitated || ally.side !== target.side) continue;
      if (!ally.stances?.shield_wall) continue;
      const dist = Math.abs(ally.tile_x - target.tile_x) + Math.abs(ally.tile_y - target.tile_y);
      if (dist <= 1) { hitChance = Math.max(0.05, hitChance - 0.15); break; }
    }

    // Sanctuary check: if target has sanctuary, attacker must pass magic check to target them
    if (StatusEffects.has(target.id, 'sanctuary')) {
      const aMagic = attacker.magic_stat ?? 0;
      const tMagic = target.magic_stat   ?? 0;
      if (Math.random() > (aMagic / (aMagic + tMagic + 1))) {
        this._spawnFloatingText('SANCTIFIED', STATUS_COLORS.sanctuary, target.tile_x, target.tile_y);
        return; // attack deflected
      }
    }

    if (Math.random() < hitChance) {
      let damage = Math.max(1, attacker.attack_stat - target.defense_stat) * multiplier + flatBonus;
      damage = Math.floor(damage);

      // Fortified: reduce by 50%, consume the status
      if (StatusEffects.has(target.id, 'fortified')) {
        damage = Math.max(1, Math.floor(damage * 0.5));
        StatusEffects.remove(target.id, 'fortified');
        this._spawnFloatingText('FORTIFIED', STATUS_COLORS.fortified, target.tile_x, target.tile_y);
      }

      target.current_hp -= damage;
      const textColor = (target.side === 'party') ? '#ff4444' : '#ffffff';
      this._spawnFloatingText(`-${damage}`, textColor, target.tile_x, target.tile_y);

      // Stealth breaks on being hit
      if (StatusEffects.has(target.id, 'stealthed')) {
        StatusEffects.remove(target.id, 'stealthed');
        target.stances.stealthed = false;
      }

      if (target.current_hp <= 0) {
        target.current_hp    = 0;
        target.incapacitated = true;
        this._spawnFloatingText('DEFEATED', '#ff8800', target.tile_x, target.tile_y - 1);
      }
    } else {
      this._spawnFloatingText('MISS', '#aaaaaa', target.tile_x, target.tile_y);
    }
  }

  // ─── Player action handling ────────────────────────────────────────────────

  selectAction(action) {
    if (this._phase !== 'player_action') return;
    const c = this._currentCombatant();
    if (!c) return;

    this._abilityPanelOpen = false;

    if (action === 'move'   && c.action_state.has_moved) return;
    if ((action === 'attack' || action === 'defend') && c.action_state.has_acted) return;

    if (action === 'wait') {
      c.action_state.has_moved = true;
      c.action_state.has_acted = true;
      this._selectedAction     = null;
      this._movementRange      = new Set();
      this._attackRange        = new Set();
      this._abilityRange       = new Set();
      this._advanceTurn();
      return;
    }

    if (action === 'defend') {
      c.defending              = true;
      c.action_state.has_acted = true;
      this._selectedAction     = null;
      this._attackRange        = new Set();
      this._abilityRange       = new Set();
      if (c.action_state.has_moved) this._advanceTurn();
      return;
    }

    if (action === 'ability') {
      const abilities = this._getAvailableAbilities(c);
      if (abilities.length === 0) {
        this._spawnFloatingText('No abilities!', '#aaaaaa', c.tile_x, c.tile_y);
        return;
      }
      this._abilityPanelOpen = true;
      this._selectedAction   = 'ability';
      this._movementRange    = new Set();
      this._attackRange      = new Set();
      this._abilityRange     = new Set();
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
    } else if (this._selectedAction === 'ability_target' && this._selectedAbility) {
      if (this._abilityRange.has(`${tx},${ty}`)) {
        const ability = this._selectedAbility;
        this._selectedAction  = null;
        this._selectedAbility = null;
        this._abilityRange    = new Set();
        this._executeAbility(c, ability, tx, ty);
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

    // Bleeding: -2 HP per tile moved
    if (StatusEffects.has(combatant.id, 'bleeding')) {
      const hpLoss = path.length * 2;
      combatant.current_hp = Math.max(0, combatant.current_hp - hpLoss);
      this._spawnFloatingText(`-${hpLoss}`, STATUS_COLORS.bleeding, combatant.tile_x, combatant.tile_y);
      if (combatant.current_hp === 0) {
        combatant.incapacitated = true;
        this._spawnFloatingText('DEFEATED', '#ff8800', combatant.tile_x, combatant.tile_y);
      }
    }

    // Stealth breaks on movement (standard move)
    if (StatusEffects.has(combatant.id, 'stealthed')) {
      StatusEffects.remove(combatant.id, 'stealthed');
      combatant.stances.stealthed = false;
    }

    combatant.action_state.has_moved = true;

    const fromX = combatant.tile_x;
    const fromY = combatant.tile_y;

    this._anim = {
      combatantId: combatant.id,
      fromX, fromY,
      path,
      frame:       0,
      totalFrames: path.length * 8,
    };

    combatant.tile_x = toX;
    combatant.tile_y = toY;

    this._selectedAction = null;
    this._movementRange  = new Set();
    this._attackRange    = new Set();
    this._abilityRange   = new Set();
    this._phase          = 'animating';
  }

  // ─── Frightened auto-move ──────────────────────────────────────────────────

  _executeFrightenedMove(combatant) {
    const sourceId = combatant._frightenedSource;
    const source   = this._combatants.find(c => c.id === sourceId);
    if (!source) { combatant.action_state.has_moved = true; return; }

    // Move away from source by 1–2 tiles
    const dx = Math.sign(combatant.tile_x - source.tile_x) || 1;
    const dy = Math.sign(combatant.tile_y - source.tile_y) || 0;

    const targets = [
      { x: combatant.tile_x + dx, y: combatant.tile_y },
      { x: combatant.tile_x,      y: combatant.tile_y + dy },
      { x: combatant.tile_x + dx, y: combatant.tile_y + dy },
    ];

    for (const t of targets) {
      if (this._grid.isPassable(t.x, t.y, combatant.id, this._combatants)) {
        combatant.tile_x = t.x;
        combatant.tile_y = t.y;
        break;
      }
    }
    combatant.action_state.has_moved = true;
    combatant._frightenedSource = null;
  }

  // ─── Basic attack execution ────────────────────────────────────────────────

  _executeAttack(attacker, target) {
    this._resolveHit(attacker, target, 1.0, false);

    // Stealth breaks when attacker acts
    if (StatusEffects.has(attacker.id, 'stealthed')) {
      StatusEffects.remove(attacker.id, 'stealthed');
      attacker.stances.stealthed = false;
    }

    attacker.action_state.has_acted = true;
    this._selectedAction = null;
    this._movementRange  = new Set();
    this._attackRange    = new Set();

    console.log(`[Combat] Attack: ${attacker.display_name} → ${target.display_name}`);

    if (attacker.side === 'party') {
      this._phase = 'player_action';
      this._updateHighlightRanges(attacker);
      if (attacker.action_state.has_moved && attacker.action_state.has_acted) {
        this._postAnimTimer = 400;
        this._phase = 'enemy_post';
      }
    } else {
      this._phase         = 'enemy_post';
      this._postAnimTimer = 600;
    }
  }

  // ─── Adjacent enemy tiles ──────────────────────────────────────────────────

  _getAdjacentEnemyTiles(combatant) {
    const result = new Set();
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
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

  /** Whether attacker can target this target (stealth / sanctuary checks). */
  _canTarget(attacker, target) {
    if (target.incapacitated) return false;
    // Stealth: cannot target from range unless adjacent
    if (StatusEffects.has(target.id, 'stealthed')) {
      const dist = Math.abs(attacker.tile_x - target.tile_x) + Math.abs(attacker.tile_y - target.tile_y);
      if (dist > 1) return false;
    }
    // Sanctuary: magic check
    if (StatusEffects.has(target.id, 'sanctuary')) {
      const aMagic = attacker.magic_stat ?? 0;
      const tMagic = target.magic_stat   ?? 0;
      if (Math.random() > (aMagic / (aMagic + tMagic + 1))) return false;
    }
    return true;
  }

  // ─── Enemy AI ──────────────────────────────────────────────────────────────

  _runEnemyAI(c) {
    const isCharmed = StatusEffects.has(c.id, 'charmed');
    // Charmed: target own side; otherwise target opposite side
    const targetSide = isCharmed
      ? c.side
      : (c.side === 'party' ? 'enemy' : 'party');

    const possibleTargets = this._combatants.filter(p =>
      p.side === targetSide && !p.incapacitated && p.id !== c.id
    );
    if (possibleTargets.length === 0) { this._advanceTurn(); return; }

    // Filter by sanctuary / stealth
    const validTargets = possibleTargets.filter(p => this._canTarget(c, p));
    if (validTargets.length === 0) { this._advanceTurn(); return; }

    // Pick nearest
    let nearest = validTargets[0];
    let nearestDist = Infinity;
    for (const p of validTargets) {
      const dist = Math.abs(p.tile_x - c.tile_x) + Math.abs(p.tile_y - c.tile_y);
      if (dist < nearestDist) { nearestDist = dist; nearest = p; }
    }

    // Adjacent attack
    if (nearestDist === 1 && !c.action_state.has_acted) {
      this._executeAttack(c, nearest);
      return;
    }

    // Move closer
    if (!c.action_state.has_moved) {
      const speed = StatusEffects.has(c.id, 'slowed')
        ? Math.max(1, Math.ceil(c.speed / 2))
        : c.speed;
      const range = this._grid.getMovementRange(c.tile_x, c.tile_y, speed, c.id, this._combatants);
      let bestTile = null, bestDist = nearestDist;
      for (const key of range) {
        const [rx, ry] = key.split(',').map(Number);
        const d = Math.abs(rx - nearest.tile_x) + Math.abs(ry - nearest.tile_y);
        if (d < bestDist) { bestDist = d; bestTile = { x: rx, y: ry }; }
      }
      if (bestTile) {
        this._executeMove(c, bestTile.x, bestTile.y);
        return;
      }
    }

    this._advanceTurn();
  }

  // ─── Floating text ─────────────────────────────────────────────────────────

  _spawnFloatingText(text, color, tile_x, tile_y) {
    this._floatingTexts.push({ text, color, tile_x, tile_y, offsetY: 0, alpha: 1, timer: 1200 });
  }

  // ─── Victory / defeat / loot ───────────────────────────────────────────────

  _doVictory() {
    console.log('[Combat] Victory!');
    this._phase = 'loot';

    // Roll loot table
    this._pendingLoot = [];
    if (this._lootTableId) {
      try {
        const loot = LootTables.roll(this._lootTableId);
        for (const { item_id, quantity } of loot) {
          const def = Items.get(item_id);
          if (def) this._pendingLoot.push({ def, quantity });
        }
      } catch (e) {
        console.warn('[Combat] Loot table error:', e);
      }
    }

    this._lootPhase = true;
    this._active    = false;   // combat grid no longer active; loot UI shows instead
  }

  _collectLoot() {
    for (const { def, quantity } of this._pendingLoot) {
      Inventory.add(def.item_id, quantity);
    }
    this._pendingLoot = [];
    this._lootPhase   = false;
    if (this._onCombatEnd) this._onCombatEnd('victory');
  }

  _skipLoot() {
    this._pendingLoot = [];
    this._lootPhase   = false;
    if (this._onCombatEnd) this._onCombatEnd('victory');
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  update(deltaMs) {
    // Handle loot UI input
    if (this._lootPhase) {
      if (this._clickPending) {
        const { x, y } = this._clickPending;
        this._clickPending = null;
        for (const btn of this._lootUIItems) {
          if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
            if (btn.action === 'collect') this._collectLoot();
            else if (btn.action === 'skip') this._skipLoot();
            return;
          }
        }
      }
      return;
    }

    if (!this._active) return;

    // Floating text decay
    for (const ft of this._floatingTexts) {
      ft.timer   -= deltaMs;
      ft.offsetY += deltaMs * 0.025;
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

    // Enemy thinking
    if (this._phase === 'enemy_thinking') {
      this._enemyTimer -= deltaMs;
      if (this._enemyTimer <= 0) {
        const c = this._currentCombatant();
        if (c && !c.incapacitated) this._runEnemyAI(c);
        else this._advanceTurn();
      }
    }

    // Enemy post-action (also used for party post-attack advance)
    if (this._phase === 'enemy_post') {
      this._postAnimTimer -= deltaMs;
      if (this._postAnimTimer <= 0) {
        const c = this._currentCombatant();
        if (c && c.side === 'enemy' && !c.action_state.has_acted) {
          const adj = this._getAdjacentEnemyTiles(c);
          if (adj.size > 0) {
            for (const key of adj) {
              const [tx, ty] = key.split(',').map(Number);
              const occ = this._getOccupant(tx, ty);
              if (occ && occ.side !== c.side && this._canTarget(c, occ)) {
                this._executeAttack(c, occ);
                this._postAnimTimer = 600;
                return;
              }
            }
          }
        }
        this._advanceTurn();
      }
    }

    // Update hover
    const mouse = this._input.getMouseScreen();
    this._hoveredTile = this._grid.screenToTile(mouse.x, mouse.y);

    // Update area preview on hover (for area abilities)
    if (this._selectedAbility?.target === 'area' && this._hoveredTile &&
        this._abilityRange.has(`${this._hoveredTile.x},${this._hoveredTile.y}`)) {
      this._hoverAreaTiles = this._computeAreaPreview(this._hoveredTile.x, this._hoveredTile.y);
    } else {
      this._hoverAreaTiles = new Set();
    }
  }

  // ─── Input handling ────────────────────────────────────────────────────────

  handleInput(input) {
    if (this._lootPhase) {
      if (input.wasKeyPressed('Enter') || input.wasKeyPressed('Space')) this._collectLoot();
      if (input.wasKeyPressed('Escape')) this._skipLoot();
      this._clickPending = null;
      return;
    }

    if (!this._active) return;

    const mouse = input.getMouseScreen();
    this._hoveredTile = this._grid.screenToTile(mouse.x, mouse.y);

    if (this._escapeConfirm) {
      if (input.wasKeyPressed('KeyY')) { this.end('flee'); return; }
      if (input.wasKeyPressed('KeyN')) { this._escapeConfirm = false; }
      this._clickPending = null;
      return;
    }

    if (input.wasKeyPressed('Escape')) {
      // Close ability panel first if open
      if (this._abilityPanelOpen) {
        this._abilityPanelOpen = false;
        this._selectedAction   = null;
      } else {
        this._escapeConfirm = !this._escapeConfirm;
      }
    }

    if (this._phase !== 'player_action') {
      this._clickPending = null;
      return;
    }

    if (this._clickPending) {
      const lx = this._clickPending.x;
      const ly = this._clickPending.y;
      this._clickPending = null;

      // Ability panel click
      if (this._abilityPanelOpen) {
        const hit = this._hitTestAbilityPanel(lx, ly);
        if (hit === '__back__') {
          this._abilityPanelOpen = false;
          this._selectedAction   = null;
          return;
        }
        if (hit) {
          this._activateAbility(hit);
          return;
        }
        // Click outside panel closes it
        this._abilityPanelOpen = false;
        this._selectedAction   = null;
        return;
      }

      // Action menu
      const hit = this._hitTestActionMenu(lx, ly);
      if (hit) { this.selectAction(hit); return; }

      // Grid tile
      const tile = this._grid.screenToTile(lx, ly);
      if (tile) this.handleTileClick(tile.x, tile.y);
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

  _hitTestAbilityPanel(lx, ly) {
    for (const item of this._abilityPanelItems) {
      if (lx >= item.x && lx <= item.x + item.w &&
          ly >= item.y && ly <= item.y + item.h) {
        return item.ability;
      }
    }
    return null;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  render() {
    // Loot UI (shown after combat, before calling onCombatEnd)
    if (this._lootPhase) {
      for (let i = 0; i <= 11; i++) this._renderer.clearLayer(i);
      this._renderLootUI();
      this._renderer.composite();
      return;
    }

    if (!this._active) return;

    for (let i = 0; i <= 10; i++) this._renderer.clearLayer(i);

    this._grid.renderTerrain(this._renderer);

    // Barrier overlays on OBJECT_BASE (Layer 2)
    this._renderBarriers();

    // Overlays on EFFECTS (8)
    const effectCtx = this._renderer.getLayerContext(LAYER.EFFECTS);
    this._renderer.clearLayer(LAYER.EFFECTS);
    this._grid.renderOverlays(effectCtx, this._movementRange, this._attackRange, this._hoveredTile);
    this._renderAbilityHighlights(effectCtx);

    // Combatants on CHARACTERS (4)
    this._renderer.clearLayer(LAYER.CHARACTERS);
    this._renderCombatants();
    this._renderFloatingTexts();

    // HUD on UI_CHROME (9)
    this._renderer.clearLayer(LAYER.UI_CHROME);
    this._renderTurnStrip();
    this._renderCombatantInfo();
    this._renderPhaseIndicator();

    // Action menu + ability panel + escape confirm on DIALOGUE (10)
    this._renderer.clearLayer(LAYER.DIALOGUE);
    this._renderActionMenu();
    if (this._abilityPanelOpen) this._renderAbilityPanel();
    if (this._escapeConfirm)    this._renderEscapeConfirm();
  }

  // ─── Barrier rendering ─────────────────────────────────────────────────────

  _renderBarriers() {
    const ctx = this._renderer.getLayerContext(LAYER.OBJECT_BASE);
    for (const b of this._barriers) {
      const px = COMBAT_PAD_X + b.x * COMBAT_TILE;
      const py = COMBAT_PAD_Y + b.y * COMBAT_TILE;
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle   = '#2233aa';
      ctx.fillRect(px, py, COMBAT_TILE, COMBAT_TILE);
      ctx.strokeStyle = '#8888ff';
      ctx.lineWidth   = 2;
      ctx.strokeRect(px + 1, py + 1, COMBAT_TILE - 2, COMBAT_TILE - 2);
      ctx.fillStyle   = '#ffffff';
      ctx.font        = '6px monospace';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.rounds), px + COMBAT_TILE / 2, py + COMBAT_TILE / 2);
      ctx.restore();
    }
  }

  // ─── Ability highlight overlays ────────────────────────────────────────────

  _renderAbilityHighlights(ctx) {
    if (!this._selectedAbility) return;

    const isHealing = ['cure','mass_cure'].includes(this._selectedAbility?.ability_id);
    const rangeColor = isHealing ? HEAL_RANGE_COLOR : ABILITY_RANGE_COLOR;

    ctx.fillStyle = rangeColor;
    for (const key of this._abilityRange) {
      const [x, y] = key.split(',').map(Number);
      ctx.fillRect(
        COMBAT_PAD_X + x * COMBAT_TILE,
        COMBAT_PAD_Y + y * COMBAT_TILE,
        COMBAT_TILE, COMBAT_TILE
      );
    }

    // Area preview
    if (this._hoverAreaTiles.size > 0) {
      ctx.fillStyle = ABILITY_AREA_COLOR;
      for (const key of this._hoverAreaTiles) {
        const [x, y] = key.split(',').map(Number);
        ctx.fillRect(
          COMBAT_PAD_X + x * COMBAT_TILE,
          COMBAT_PAD_Y + y * COMBAT_TILE,
          COMBAT_TILE, COMBAT_TILE
        );
      }
    }
  }

  // ─── Combatant rendering ───────────────────────────────────────────────────

  _renderCombatants() {
    const ctx     = this._renderer.getLayerContext(LAYER.CHARACTERS);
    const sorted  = [...this._combatants].sort((a, b) => a.tile_y - b.tile_y);
    const current = this._currentCombatant();

    for (const c of sorted) {
      let pixX, pixY;

      if (this._anim && this._anim.combatantId === c.id) {
        const anim     = this._anim;
        const t        = anim.frame / anim.totalFrames;
        const segCount = anim.path.length;
        const segFrac  = t * segCount;
        const segIdx   = clamp(0, segCount - 1, Math.floor(segFrac));
        const segT     = segFrac - segIdx;
        const fromTile = segIdx === 0 ? { x: anim.fromX, y: anim.fromY } : anim.path[segIdx - 1];
        const toTile   = anim.path[segIdx];
        pixX = COMBAT_PAD_X + (fromTile.x + (toTile.x - fromTile.x) * segT) * COMBAT_TILE;
        pixY = COMBAT_PAD_Y + (fromTile.y + (toTile.y - fromTile.y) * segT) * COMBAT_TILE;
      } else {
        pixX = COMBAT_PAD_X + c.tile_x * COMBAT_TILE;
        pixY = COMBAT_PAD_Y + c.tile_y * COMBAT_TILE;
      }

      pixX = Math.round(pixX);
      pixY = Math.round(pixY);

      if (c.incapacitated) {
        ctx.save();
        ctx.strokeStyle = '#555555';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(pixX + 4, pixY + 4); ctx.lineTo(pixX + COMBAT_TILE - 4, pixY + COMBAT_TILE - 4);
        ctx.moveTo(pixX + COMBAT_TILE - 4, pixY + 4); ctx.lineTo(pixX + 4, pixY + COMBAT_TILE - 4);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      // Selection ring
      if (current && c.id === current.id) {
        const pulse = Math.sin(Date.now() / 300) * 0.4 + 0.6;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#ffffaa';
        ctx.lineWidth   = 2;
        ctx.strokeRect(pixX + 1, pixY + 1, COMBAT_TILE - 2, COMBAT_TILE - 2);
        ctx.restore();
      }

      // Stealth: render semi-transparent
      const isStealthed = StatusEffects.has(c.id, 'stealthed');
      ctx.save();
      if (isStealthed) ctx.globalAlpha = 0.4;

      // Body
      const color = CLASS_COLORS[c.class_id] ?? (c.side === 'party' ? '#5588bb' : '#884444');
      ctx.fillStyle = color;
      ctx.fillRect(pixX + 3, pixY + 3, COMBAT_TILE - 6, COMBAT_TILE - 6);

      // Side dot
      ctx.fillStyle = c.side === 'party' ? '#4488ff' : '#ff4444';
      ctx.fillRect(pixX + 3, pixY + 3, 4, 4);

      ctx.restore();

      // HP bar (above sprite, always full opacity)
      const hpFrac = Math.max(0, c.current_hp / c.max_hp);
      ctx.fillStyle = '#330000';
      ctx.fillRect(pixX, pixY - 4, COMBAT_TILE, 3);
      ctx.fillStyle = hpFrac > 0.5 ? '#44aa44' : hpFrac > 0.25 ? '#aaaa22' : '#aa2222';
      ctx.fillRect(pixX, pixY - 4, Math.round(COMBAT_TILE * hpFrac), 3);

      // Status icons: small 5×5 dots below sprite
      const statuses = StatusEffects.getAll(c.id);
      if (statuses.length > 0) {
        const DOT = 5;
        const GAP = 2;
        const startX = pixX + 1;
        const dotY   = pixY + COMBAT_TILE;
        for (let si = 0; si < statuses.length && si < 5; si++) {
          const col = STATUS_COLORS[statuses[si].id] ?? '#888888';
          ctx.fillStyle = col;
          ctx.fillRect(startX + si * (DOT + GAP), dotY, DOT, DOT);
        }
      }

      // Name (party members only)
      if (c.side === 'party') {
        ctx.save();
        ctx.font         = '7px monospace';
        ctx.fillStyle    = '#ffffff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(c.display_name, pixX + COMBAT_TILE / 2, pixY + COMBAT_TILE + 7);
        ctx.restore();
      }
    }
  }

  // ─── Turn strip ────────────────────────────────────────────────────────────

  _renderTurnStrip() {
    const ctx    = this._renderer.getLayerContext(LAYER.UI_CHROME);
    const SLOT_W = 40, SLOT_H = 40;
    const count  = this._turnOrder.length;
    const totalW = count * (SLOT_W + 2) - 2;
    const startX = Math.round((640 - totalW) / 2);
    const startY = 2;

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(startX - 2, startY, totalW + 4, SLOT_H + 4);

    for (let i = 0; i < this._turnOrder.length; i++) {
      const c   = this._turnOrder[i];
      const isAct = (i === this._turnIdx) && !this._lootPhase;
      const sx  = startX + i * (SLOT_W + 2);
      const sy  = startY + 2;

      ctx.fillStyle = c.incapacitated ? '#222222' : '#1a1a2a';
      ctx.fillRect(sx, sy, SLOT_W, SLOT_H);
      ctx.strokeStyle = isAct ? '#ffffaa' : '#444444';
      ctx.lineWidth   = isAct ? 2 : 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, SLOT_W - 1, SLOT_H - 1);

      const color = CLASS_COLORS[c.class_id] ?? (c.side === 'party' ? '#5588bb' : '#884444');
      ctx.fillStyle = c.incapacitated ? '#555555' : color;
      ctx.fillRect(sx + 4, sy + 4, SLOT_W - 8, SLOT_H - 16);

      if (c.incapacitated) {
        ctx.save();
        ctx.strokeStyle = '#888888'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx + 4, sy + 4); ctx.lineTo(sx + SLOT_W - 4, sy + SLOT_H - 16);
        ctx.moveTo(sx + SLOT_W - 4, sy + 4); ctx.lineTo(sx + 4, sy + SLOT_H - 16);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.font = '6px monospace'; ctx.fillStyle = '#cccccc';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(String(c.initiative), sx + SLOT_W - 2, sy + 2);
      ctx.restore();

      ctx.save();
      ctx.font = '7px monospace';
      ctx.fillStyle = c.incapacitated ? '#666666' : (isAct ? '#ffffaa' : '#aaaaaa');
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
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

    const bx = 4, by = 446, bw = 200, bh = 32;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#444455'; ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.save();
    ctx.font = '9px monospace'; ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(
      `${c.display_name}  HP:${c.current_hp}/${c.max_hp}  MP:${c.current_mp}/${c.max_mp}`,
      bx + 4, by + 3
    );

    // HP bar
    const hpFrac = Math.max(0, c.current_hp / c.max_hp);
    ctx.fillStyle = '#330000';
    ctx.fillRect(bx + 4, by + 15, bw - 8, 5);
    ctx.fillStyle = hpFrac > 0.5 ? '#44aa44' : hpFrac > 0.25 ? '#aaaa22' : '#aa2222';
    ctx.fillRect(bx + 4, by + 15, Math.round((bw - 8) * hpFrac), 5);

    // MP bar
    const mpFrac = Math.max(0, c.current_mp / Math.max(1, c.max_mp));
    ctx.fillStyle = '#001133';
    ctx.fillRect(bx + 4, by + 22, bw - 8, 5);
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(bx + 4, by + 22, Math.round((bw - 8) * mpFrac), 5);

    ctx.restore();

    // Active status dots below info panel
    const statuses = StatusEffects.getAll(c.id);
    if (statuses.length > 0) {
      ctx.save();
      ctx.font = '7px monospace';
      ctx.textBaseline = 'top';
      let sx = bx + 4;
      const sY = by + bh + 2;
      for (const s of statuses) {
        const col = STATUS_COLORS[s.id] ?? '#888888';
        ctx.fillStyle = col;
        ctx.fillRect(sx, sY, 6, 6);
        ctx.fillStyle = '#cccccc';
        ctx.fillText(s.id.slice(0, 4), sx + 8, sY);
        sx += 50;
        if (sx > bx + bw) break;
      }
      ctx.restore();
    }
  }

  // ─── Phase indicator ───────────────────────────────────────────────────────

  _renderPhaseIndicator() {
    const ctx = this._renderer.getLayerContext(LAYER.UI_CHROME);
    let text = '', color = '#aaaaaa';
    switch (this._phase) {
      case 'player_action': text = 'YOUR TURN';  color = '#ffff44'; break;
      case 'enemy_thinking': case 'enemy_post': text = 'ENEMY TURN'; color = '#ff8822'; break;
      case 'animating':     text = '...';        color = '#888888'; break;
      default: return;
    }
    ctx.save();
    ctx.font = 'bold 9px monospace'; ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
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

    const ctx   = this._renderer.getLayerContext(LAYER.DIALOGUE);
    const BTN_W = 80, BTN_H = 18, GAP = 2;
    const RIGHT  = 556;
    const BOTTOM = 478;

    const actions = [
      { label: 'Move',    action: 'move',    disabled: c.action_state.has_moved  },
      { label: 'Ability', action: 'ability', disabled: this._getAvailableAbilities(c).length === 0 },
      { label: 'Attack',  action: 'attack',  disabled: c.action_state.has_acted  },
      { label: 'Defend',  action: 'defend',  disabled: c.action_state.has_acted  },
      { label: 'Wait',    action: 'wait',    disabled: false                      },
    ];

    this._actionMenuItems = [];

    for (let i = 0; i < actions.length; i++) {
      const a  = actions[i];
      const bx = RIGHT;
      const by = BOTTOM - (actions.length - i) * (BTN_H + GAP);
      const active = (this._selectedAction === a.action) && !this._abilityPanelOpen;

      ctx.fillStyle = a.disabled ? 'rgba(30,30,30,0.80)' : active ? 'rgba(40,80,160,0.90)' : 'rgba(20,20,40,0.85)';
      ctx.fillRect(bx, by, BTN_W, BTN_H);
      ctx.strokeStyle = a.disabled ? '#333333' : active ? '#5588ff' : '#555566';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, BTN_W - 1, BTN_H - 1);
      ctx.save();
      ctx.font = '9px monospace'; ctx.fillStyle = a.disabled ? '#555555' : '#dddddd';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(a.label, bx + BTN_W / 2, by + BTN_H / 2);
      ctx.restore();

      this._actionMenuItems.push({ ...a, x: bx, y: by, w: BTN_W, h: BTN_H });
    }

    // Show ability name hint below menu when targeting
    if (this._selectedAbility) {
      ctx.save();
      ctx.font = '8px monospace'; ctx.fillStyle = '#cc99ff';
      ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText(`↑ ${this._selectedAbility.ability_label}`, RIGHT + BTN_W - 2, BOTTOM - actions.length * (BTN_H + GAP) - 12);
      ctx.restore();
    }
  }

  // ─── Ability panel ─────────────────────────────────────────────────────────

  _renderAbilityPanel() {
    const c = this._currentCombatant();
    if (!c) return;

    const ctx     = this._renderer.getLayerContext(LAYER.DIALOGUE);
    const abilities = this._getAvailableAbilities(c);
    const PANEL_W = 200;
    const ROW_H   = 20;
    const PANEL_H = (abilities.length + 1) * ROW_H + 6;
    const px      = 640 - PANEL_W - 4;
    const py      = 478 - PANEL_H - (5 * 20) - 4;  // above action menu

    // Background
    ctx.fillStyle = 'rgba(10,10,25,0.95)';
    ctx.fillRect(px, py, PANEL_W, PANEL_H);
    ctx.strokeStyle = '#555577'; ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, PANEL_W - 1, PANEL_H - 1);

    this._abilityPanelItems = [];

    // Back button row
    const backY = py + 3;
    ctx.fillStyle = 'rgba(60,30,30,0.8)';
    ctx.fillRect(px + 2, backY, PANEL_W - 4, ROW_H - 2);
    ctx.save();
    ctx.font = '8px monospace'; ctx.fillStyle = '#ffaaaa';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('← Back', px + PANEL_W / 2, backY + (ROW_H - 2) / 2);
    ctx.restore();
    this._abilityPanelItems.push({ ability: '__back__', x: px + 2, y: backY, w: PANEL_W - 4, h: ROW_H - 2 });

    for (let i = 0; i < abilities.length; i++) {
      const ab   = abilities[i];
      const rowY = py + 3 + (i + 1) * ROW_H;
      const canAfford = ab.cost?.type !== 'mp' || c.current_mp >= (ab.cost.amount ?? 0);
      const rowBg = canAfford ? 'rgba(20,20,50,0.80)' : 'rgba(30,20,20,0.80)';

      ctx.fillStyle = rowBg;
      ctx.fillRect(px + 2, rowY, PANEL_W - 4, ROW_H - 2);

      // Ability name
      ctx.save();
      ctx.font = '8px monospace';
      ctx.fillStyle = canAfford ? '#ddddff' : '#666655';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const shortName = ab.ability_label.length > 16 ? ab.ability_label.slice(0, 16) : ab.ability_label;
      ctx.fillText(shortName, px + 5, rowY + (ROW_H - 2) / 2);

      // MP cost
      if (ab.cost?.type === 'mp') {
        ctx.fillStyle = canAfford ? '#7799ff' : '#554444';
        ctx.textAlign = 'right';
        ctx.fillText(`${ab.cost.amount}MP`, px + PANEL_W - 5, rowY + (ROW_H - 2) / 2);
      }
      ctx.restore();

      if (canAfford) {
        this._abilityPanelItems.push({ ability: ab, x: px + 2, y: rowY, w: PANEL_W - 4, h: ROW_H - 2 });
      }
    }
  }

  // ─── Loot UI ───────────────────────────────────────────────────────────────

  _renderLootUI() {
    const ctx  = this._renderer.getLayerContext(LAYER.DIALOGUE);
    const PW   = 360, PH = Math.max(120, 60 + this._pendingLoot.length * 20 + 40);
    const px   = Math.round((640 - PW) / 2);
    const py   = Math.round((480 - PH) / 2);

    // Dark background
    const bgCtx = this._renderer.getLayerContext(LAYER.TERRAIN_BASE);
    bgCtx.fillStyle = 'rgba(0,0,0,0.85)';
    bgCtx.fillRect(0, 0, 640, 480);

    // Panel
    ctx.fillStyle = 'rgba(10,15,25,0.97)';
    ctx.fillRect(px, py, PW, PH);
    ctx.strokeStyle = '#665533'; ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, PW - 2, PH - 2);

    // Title
    ctx.save();
    ctx.font = 'bold 12px monospace'; ctx.fillStyle = '#ffee88';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('VICTORY!', px + PW / 2, py + 10);
    ctx.restore();

    ctx.save();
    ctx.font = '9px monospace'; ctx.fillStyle = '#cccccc';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';

    if (this._pendingLoot.length === 0) {
      ctx.fillText('No loot found.', px + PW / 2, py + 30);
    } else {
      ctx.fillText('You found:', px + PW / 2, py + 30);
      for (let i = 0; i < this._pendingLoot.length; i++) {
        const entry = this._pendingLoot[i];
        const label = entry.quantity > 1
          ? `${entry.def.item_label} ×${entry.quantity}`
          : entry.def.item_label;
        ctx.fillStyle = '#ffffcc';
        ctx.fillText(label, px + PW / 2, py + 50 + i * 20);
      }
    }
    ctx.restore();

    this._lootUIItems = [];
    const btnY = py + PH - 32;
    const btnW = 120, btnH = 22;

    // Collect All
    const collectX = px + PW / 2 - btnW - 8;
    ctx.fillStyle = 'rgba(20,60,20,0.9)';
    ctx.fillRect(collectX, btnY, btnW, btnH);
    ctx.strokeStyle = '#44aa44'; ctx.lineWidth = 1;
    ctx.strokeRect(collectX + 0.5, btnY + 0.5, btnW - 1, btnH - 1);
    ctx.save();
    ctx.font = '9px monospace'; ctx.fillStyle = '#88ff88';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Collect All [Enter]', collectX + btnW / 2, btnY + btnH / 2);
    ctx.restore();
    this._lootUIItems.push({ action: 'collect', x: collectX, y: btnY, w: btnW, h: btnH });

    // Skip
    const skipX = px + PW / 2 + 8;
    ctx.fillStyle = 'rgba(50,30,30,0.9)';
    ctx.fillRect(skipX, btnY, btnW, btnH);
    ctx.strokeStyle = '#aa4444'; ctx.lineWidth = 1;
    ctx.strokeRect(skipX + 0.5, btnY + 0.5, btnW - 1, btnH - 1);
    ctx.save();
    ctx.font = '9px monospace'; ctx.fillStyle = '#ff8888';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Skip [Esc]', skipX + btnW / 2, btnY + btnH / 2);
    ctx.restore();
    this._lootUIItems.push({ action: 'skip', x: skipX, y: btnY, w: btnW, h: btnH });
  }

  // ─── Escape confirm ────────────────────────────────────────────────────────

  _renderEscapeConfirm() {
    const ctx = this._renderer.getLayerContext(LAYER.DIALOGUE);
    const MW = 280, MH = 40;
    const mx = Math.round((640 - MW) / 2);
    const my = Math.round((480 - MH) / 2);
    ctx.fillStyle = 'rgba(10,10,20,0.92)';
    ctx.fillRect(mx, my, MW, MH);
    ctx.strokeStyle = '#665544'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + 0.5, my + 0.5, MW - 1, MH - 1);
    ctx.save();
    ctx.font = '10px monospace'; ctx.fillStyle = '#ffeecc';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
      ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ft.text, px, py);
      ctx.restore();
    }
  }

  // ─── End combat ────────────────────────────────────────────────────────────

  end(outcome) {
    this._active         = false;
    this._lootPhase      = false;
    this._phase          = 'idle';
    this._combatants     = [];
    this._turnOrder      = [];
    this._floatingTexts  = [];
    this._anim           = null;
    this._movementRange  = new Set();
    this._attackRange    = new Set();
    this._abilityRange   = new Set();
    this._selectedAction  = null;
    this._selectedAbility = null;
    this._abilityPanelOpen = false;
    this._barriers       = [];
    this._escapeConfirm  = false;
    StatusEffects.clearAll();

    console.log(`[Combat] ended: ${outcome}`);
    if (this._onCombatEnd) this._onCombatEnd(outcome);
  }
}
