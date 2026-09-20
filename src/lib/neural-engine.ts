"use client";

import { Move, GameState } from './ai-engine';
import EnhancedAIEngine from './ai-engine';

export async function evaluateNeuralMove(gameState: GameState): Promise<Move | null> {
  const myPlayer = gameState.currentPlayer || 'O';

  try {
    const res = await fetch('/api/ai/neural-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        superBoard: gameState.superBoard,
        gameOwnership: gameState.gameOwnership,
        activeGame: gameState.activeGame,
        myPlayer
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.move && typeof data.move.game === 'number' && typeof data.move.cell === 'number') {
        return data.move;
      }
    }
  } catch (e) {
    console.warn('Neural API evaluation fallback to heuristic engine:', e);
  }

  return EnhancedAIEngine.evaluateMove(gameState);
}
