/**
 * arena_generator.js — Procedural arena assembly from handcrafted room templates.
 *
 * Loads template JSON files, selects appropriate templates by tag, places
 * party members and enemies in their respective spawn zones, and returns
 * a populated combatant list ready for CombatEngine.initiate().
 */

// Cached template definitions indexed by template_id
const _templates = new Map();

// Base stat blocks for enemy types referenced in encounter pools
const ENEMY_BASES = {
  wolf: {
    display_name: 'Wolf',
    hp: 18, speed: 6, attack: 5, defense: 2, magic: 0,
    tags: ['beast'],
  },
  bandit: {
    display_name: 'Bandit',
    hp: 22, speed: 4, attack: 5, defense: 3, magic: 0,
    tags: ['humanoid'],
  },
  skeleton: {
    display_name: 'Skeleton',
    hp: 15, speed: 4, attack: 4, defense: 2, magic: 0,
    tags: ['undead'],
  },
  goblin: {
    display_name: 'Goblin',
    hp: 12, speed: 5, attack: 3, defense: 1, magic: 0,
    tags: ['humanoid'],
  },
  orc_warrior: {
    display_name: 'Orc Warrior',
    hp: 28, speed: 3, attack: 6, defense: 4, magic: 0,
    tags: ['humanoid'],
  },
  cultist: {
    display_name: 'Cultist',
    hp: 16, speed: 4, attack: 4, defense: 2, magic: 3,
    tags: ['humanoid'],
  },
};

export const ArenaGenerator = {

  /**
   * Register a single arena template definition.
   * @param {object} def — parsed arena template JSON
   */
  loadTemplate(def) {
    _templates.set(def.template_id, def);
    console.log(`[ArenaGenerator] Loaded template: ${def.template_id} (tags: ${def.template_tags?.join(', ')})`);
  },

  /**
   * Register an array of arena template definitions.
   * @param {object[]} defs
   */
  loadTemplates(defs) {
    for (const d of defs) this.loadTemplate(d);
  },

  /**
   * Select a random template whose template_tags include ALL of the given tags.
   * Falls back to any loaded template if none match.
   * @param {string[]} tags
   * @returns {object|null}
   */
  selectTemplate(tags) {
    const matches = [];
    for (const [, t] of _templates) {
      if (tags.every(tag => (t.template_tags ?? []).includes(tag))) {
        matches.push(t);
      }
    }
    if (matches.length > 0) {
      return matches[Math.floor(Math.random() * matches.length)];
    }
    // Fallback: any loaded template
    const all = [..._templates.values()];
    if (all.length === 0) { console.error('[ArenaGenerator] No templates loaded'); return null; }
    return all[Math.floor(Math.random() * all.length)];
  },

  /**
   * Generate a populated arena from a template and encounter definition.
   *
   * @param {string|null}   templateId      — specific template ID, or null to auto-select by tags
   * @param {object}        encounter       — encounter definition from the pool
   * @param {object[]}      partyMembers    — Character instances (party.active)
   * @returns {{ template: object, combatants: object[], lootTableId: string|null } | null}
   */
  generate(templateId, encounter, partyMembers) {
    // Template selection
    let template = templateId ? _templates.get(templateId) : null;
    if (!template) {
      const tags = encounter.arena_template_tags ?? [];
      template = this.selectTemplate(tags);
    }
    if (!template) return null;

    const { party_spawn_zone: pz, enemy_spawn_zone: ez } = template;

    // Build passable tile lists for each zone
    const partyTiles = _passableTilesInZone(template, pz);
    const enemyTiles = _passableTilesInZone(template, ez);

    _shuffle(partyTiles);
    _shuffle(enemyTiles);

    // Place party
    const partyCombatants = [];
    for (let i = 0; i < Math.min(partyMembers.length, partyTiles.length); i++) {
      partyCombatants.push({
        entity:  partyMembers[i],
        side:    'party',
        tile_x:  partyTiles[i].x,
        tile_y:  partyTiles[i].y,
      });
    }

    // Place enemies from all enemy_groups
    const enemyCombatants = [];
    const usedKeys = new Set();
    let   tileIdx  = 0;

    for (const group of (encounter.enemy_groups ?? [])) {
      const count = group.count_min +
        Math.floor(Math.random() * (group.count_max - group.count_min + 1));

      for (let i = 0; i < count; i++) {
        // Find next unused enemy spawn tile
        while (tileIdx < enemyTiles.length) {
          const t = enemyTiles[tileIdx++];
          const key = `${t.x},${t.y}`;
          if (!usedKeys.has(key)) {
            usedKeys.add(key);
            const entity = _buildEnemy(group.enemy_id, i, group.level_modifier ?? 0);
            enemyCombatants.push({ entity, side: 'enemy', tile_x: t.x, tile_y: t.y });
            break;
          }
        }
      }
    }

    const combatants = [...partyCombatants, ...enemyCombatants];
    console.log(`[ArenaGenerator] Generated arena: ${template.template_id} — ${partyCombatants.length} party, ${enemyCombatants.length} enemies`);

    return {
      template,
      combatants,
      lootTableId: encounter.loot_table ?? null,
    };
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return all passable tiles in the given zone rectangle.
 * A tile is passable if its tile_id is not 4 (wall) and no impassable object sits on it.
 */
function _passableTilesInZone(template, zone) {
  if (!zone) return [];
  const { x1, y1, x2, y2 } = zone;
  const tiles = [];
  const impassableObjs = new Set(
    (template.objects ?? [])
      .filter(o => o.passable === false)
      .map(o => `${o.tile_x},${o.tile_y}`)
  );

  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const tileId = template.tiles[y * template.width + x] ?? 0;
      if (tileId === 4) continue;                         // wall
      if (impassableObjs.has(`${x},${y}`)) continue;     // blocked by object
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Fisher-Yates shuffle in place. */
function _shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Construct an enemy entity definition from base stats + level modifier. */
function _buildEnemy(enemyId, index, levelMod) {
  const base = ENEMY_BASES[enemyId] ?? {
    display_name: enemyId,
    hp: 15, speed: 4, attack: 4, defense: 2, magic: 0, tags: [],
  };
  const hp = Math.max(1, base.hp + levelMod * 2);
  return {
    character_id:  `${enemyId}_enc_${Date.now()}_${index}`,
    display_name:  base.display_name,
    class_id:      enemyId,
    base_stats:    {
      hp, max_hp: hp,
      speed:   base.speed,
      attack:  base.attack,
      defense: base.defense,
      magic:   base.magic,
    },
    tags: base.tags,
  };
}
