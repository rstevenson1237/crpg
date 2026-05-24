/**
 * gamestate.js — Global game state container.
 * Shared singleton accessed by engine modules.
 */

export const GameState = {
  currentTurn: 0,
  party: null,
  gameTime: null,   // set during init — GameTime instance
};
