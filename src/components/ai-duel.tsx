"use client";

import React, { useState, useRef, useEffect } from 'react';
import SuperTicTacToeBoard, { SuperTicTacToeHandle, GameState } from './super-tic-tac-toe-board';
import EnhancedAIEngine from '@/lib/ai-engine';

interface AIDuelProps {
  mode: 'ai_duel' | string;
  onNewGameRequest: () => void;
}

const AIDuel = ({ mode, onNewGameRequest }: AIDuelProps) => {
  const gameRef = useRef<SuperTicTacToeHandle>(null);
  const [aiPlayer, setAiPlayer] = useState<'X' | 'O' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const aiPlayerRef = useRef<'X' | 'O' | null>(null);
  const isProcessingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => { aiPlayerRef.current = aiPlayer; }, [aiPlayer]);
  useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

  const handlePlayerChoice = (choice: 'X' | 'O') => {
    setAiPlayer(choice === 'X' ? 'O' : 'X');
  };

  const handleGameStateChange = (state: GameState) => {
    if (
      state.gameStarted &&
      !state.superWinner &&
      state.currentPlayer === aiPlayerRef.current &&
      !isProcessingRef.current
    ) {
      setIsProcessing(true);

      timerRef.current = setTimeout(() => {
        try {
          if (!state.superWinner && state.currentPlayer === aiPlayerRef.current && gameRef.current) {
            const move = EnhancedAIEngine.evaluateMove(state);
            if (move && gameRef.current) {
              gameRef.current.makeMove(move.game, move.cell);
            }
          }
        } finally {
          timerRef.current = null;
          setIsProcessing(false);
        }
      }, 800);
    }
  };

  return (
    <div className="relative w-full h-full">
      {isProcessing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-yellow-500/90 text-gray-900 px-4 py-2 rounded-full font-bold text-sm shadow-lg animate-pulse">
          AI is thinking...
        </div>
      )}
      <SuperTicTacToeBoard
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

export default AIDuel;
