/**
 * movement.js — Turn-based movement controller.
 *
 * Uses isKeyDown for smooth held-key repeat with a 150ms cooldown.
 * Manages facing direction, party follow chain, interaction detection,
 * and GameState.currentTurn.
 */

const MOVE_COOLDOWN_MS = 150;

const MOVE_KEYS = {
  KeyW:       { dx:  0, dy: -1, facing: 'north' },
  ArrowUp:    { dx:  0, dy: -1, facing: 'north' },
  KeyS:       { dx:  0, dy:  1, facing: 'south' },
  ArrowDown:  { dx:  0, dy:  1, facing: 'south' },
  KeyA:       { dx: -1, dy:  0, facing: 'west'  },
  ArrowLeft:  { dx: -1, dy:  0, facing: 'west'  },
  KeyD:       { dx:  1, dy:  0, facing: 'east'  },
  ArrowRight: { dx:  1, dy:  0, facing: 'east'  },
};

export class MovementController {
  /**
   * @param {import('./input.js').Input} input
   * @param {import('./map.js').MapData} mapData
   * @param {import('./party.js').Party} party
   * @param {import('./camera.js').Camera} camera
   * @param {{ currentTurn: number }} gameState
   */
  constructor(input, mapData, party, camera, gameState) {
    this._input     = input;
    this._mapData   = mapData;
    this._party     = party;
    this._camera    = camera;
    this._gameState = gameState;
    this._leadX     = 0;
    this._leadY     = 0;
    this._cooldown  = 0;
    this._interactTarget = null;
    this._onInteract = null;
    this._onMove     = null;
  }

  /** @param {(obj: object) => void} cb */
  setOnInteract(cb) { this._onInteract = cb; }

  /** @param {(x: number, y: number) => void} cb */
  setOnMove(cb)     { this._onMove = cb; }

  setLeadPosition(x, y) { this._leadX = x; this._leadY = y; }

  get leadX()          { return this._leadX; }
  get leadY()          { return this._leadY; }
  get interactTarget() { return this._interactTarget; }

  /**
   * Process one logic tick.
   * @param {number} deltaMs - tick duration in ms
   */
  tick(deltaMs) {
    this._cooldown = Math.max(0, this._cooldown - deltaMs);

    const lead = this._party.getLead();
    if (!lead) return;

    // E-key interaction (uses wasKeyPressed — single-press only)
    if (this._input.wasKeyPressed('KeyE') && this._interactTarget) {
      console.log(`Interact: ${this._interactTarget.object_id}`);
      if (this._onInteract) this._onInteract(this._interactTarget);
    }

    // Find the first held movement key
    let heldMove = null;
    for (const [code, move] of Object.entries(MOVE_KEYS)) {
      if (this._input.isKeyDown(code)) { heldMove = move; break; }
    }

    if (!heldMove) {
      for (const char of this._party.active) char.setAnimState('idle');
      return;
    }

    // Facing updates immediately even while cooldown is active
    lead.setFacing(heldMove.facing);

    if (this._cooldown > 0) return;

    this._cooldown = MOVE_COOLDOWN_MS;

    const nx = this._leadX + heldMove.dx;
    const ny = this._leadY + heldMove.dy;

    if (this._mapData.isPassable(nx, ny, this._mapData.currentFloor)) {
      this._party.recordLeadMove(this._leadX, this._leadY);
      this._leadX = nx;
      this._leadY = ny;
      for (const char of this._party.active) {
        char.setAnimState('walking');
        char.onStep();
      }
      this._camera.setTarget(nx, ny);
      this._gameState.currentTurn++;
      this._interactTarget = null;
      console.log(`Turn: ${this._gameState.currentTurn}  Tile: ${nx}, ${ny}`);
      if (this._onMove) this._onMove(nx, ny);
    } else {
      const obj = this._mapData.getObjectAt(nx, ny, this._mapData.currentFloor);
      this._interactTarget = (obj && obj.interactable) ? obj : null;
      for (const char of this._party.active) char.setAnimState('idle');
    }
  }
}
