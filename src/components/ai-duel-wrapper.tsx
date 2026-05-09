"use client";

import React, { useState, useRef, useCallback } from 'react';
import SuperTicTacToe, { SuperTicTacToeHandle, GameState } from './super-tic-tac-toe';
import EnhancedAIEngine from '@/lib/ai-engine';

interface AIDuelWrapperProps {
  mode: 'ai_duel' | string;
  onNewGameRequest: () => void;
}

const AIDuelWrapper = ({ mode, onNewGameRequest }: AIDuelWrapperProps) => {
  const gameRef = useRef<SuperTicTacToeHandle>(null);
  const [aiPlayer, setAiPlayer] = useState<'X' | 'O' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePlayerChoice = (choice: 'X' | 'O') => {
    setAiPlayer(choice === 'X' ? 'O' : 'X');
  };

  const handleGameStateChange = useCallback((state: GameState) => {
    if (
      state.gameStarted && 
      !state.superWinner && 
      state.currentPlayer === aiPlayer && 
      !isProcessing
    ) {
      setIsProcessing(true);
      
      setTimeout(() => {
        const move = EnhancedAIEngine.evaluateMove(state);
        if (move && gameRef.current) {
          gameRef.current.makeMove(move.game, move.cell);
        }
        setIsProcessing(false);
      }, 800);
    }
  }, [aiPlayer, isProcessing]);

  return (
    <div className="relative w-full h-full">
      {isProcessing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-yellow-500/90 text-gray-900 px-4 py-2 rounded-full font-bold text-sm shadow-lg animate-pulse">
          AI is thinking...
        </div>
      )}
      <SuperTicTacToe
        ref={gameRef}
        mode={mode}
        isAIGame={true}
        onPlayerChoice={handlePlayerChoice}
        onGameStateChange={handleGameStateChange}
        onNewGameRequest={onNewGameRequest}
        isProcessing={isProcessing}
      />
    </div>
  );
};

export default AIDuelWrapper;
