import readline from 'readline';
import engine, { FastBoardState, evaluateFastMove } from '../src/lib/ai-engine.ts';

const EnhancedAIEngine = engine.default || engine;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  if (!line || line.trim() === '') return;
  try {
    const payload = JSON.parse(line);
    if (payload.fast) {
      const state = new FastBoardState();
      for (let i = 0; i < 9; i++) {
        state.boardsMe[i] = payload.bMe[i];
        state.boardsOpp[i] = payload.bOpp[i];
        state.occupied[i] = payload.bMe[i] | payload.bOpp[i];
      }
      state.ownershipMe = payload.oMe;
      state.ownershipOpp = payload.oOpp;
      state.activeGame = payload.active;
      state.history = payload.history || [];
      const weights = payload.weights || undefined;
      const packed = evaluateFastMove(state, weights, payload.maxTimeMs || 15, payload.maxDepth || 6);
      if (packed !== null) {
        console.log(JSON.stringify({ game: packed >> 4, cell: packed & 0xF }));
      } else {
        console.log(JSON.stringify({ error: "no_move" }));
      }
      return;
    }
    const gameState = payload;
    const maxTime = gameState.maxTimeMs ?? 25;
    const maxDepth = gameState.maxDepth ?? 6;
    const weights = payload.weights || undefined;
    const move = EnhancedAIEngine.evaluateMove(gameState, weights, maxTime, maxDepth);
    if (move) {
      console.log(JSON.stringify({ game: move.game, cell: move.cell }));
    } else {
      console.log(JSON.stringify({ error: "no_move" }));
    }
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
  }
});
