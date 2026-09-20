"use client";

import React, { useState, useRef, useEffect } from 'react';
import SuperTicTacToeBoard, { SuperTicTacToeHandle, GameState } from './super-tic-tac-toe-board';
import EnhancedAIEngine, { cleanupEngine } from '@/lib/ai-engine';
import { evaluateNeuralMove } from '@/lib/neural-engine';

interface AIDuelProps {
  mode: 'ai_duel' | string;
  onNewGameRequest: () => void;
}

const AIDuel = ({ mode, onNewGameRequest }: AIDuelProps) => {
  const gameRef = useRef<SuperTicTacToeHandle>(null);
  const [aiPlayer, setAiPlayer] = useState<'X' | 'O' | null>(null);
  const [aiType, setAiType] = useState<'strategy' | 'neural'>('strategy');
  const [isProcessing, setIsProcessing] = useState(false);
  const aiPlayerRef = useRef<'X' | 'O' | null>(null);
  const aiTypeRef = useRef<'strategy' | 'neural'>('strategy');
  const isProcessingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      cleanupEngine();
    };
  }, []);

  useEffect(() => { aiPlayerRef.current = aiPlayer; }, [aiPlayer]);
  useEffect(() => { aiTypeRef.current = aiType; }, [aiType]);
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

      timerRef.current = setTimeout(async () => {
        try {
          if (!state.superWinner && state.currentPlayer === aiPlayerRef.current && gameRef.current) {
            const move = aiTypeRef.current === 'neural'
              ? await evaluateNeuralMove(state)
              : EnhancedAIEngine.evaluateMove(state);

            if (move && gameRef.current) {
              gameRef.current.makeMove(move.game, move.cell);
            }
          }
        } finally {
          timerRef.current = null;
          setIsProcessing(false);
        }
      }, 500);
    }
  };

  const handleNewGame = () => {
    cleanupEngine();
    onNewGameRequest();
  };

  return (
    <div className="relative w-full h-full">
      {isProcessing && (
        <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full font-bold text-sm shadow-lg animate-pulse flex items-center gap-2 ${
          aiType === 'neural'
            ? 'bg-cyan-500/90 text-slate-950 shadow-cyan-500/30'
            : 'bg-yellow-500/90 text-gray-900 shadow-yellow-500/30'
        }`}>
          <span>{aiType === 'neural' ? 'Neural Bot is calculating...' : 'Strategy Bot is calculating...'}</span>
        </div>
      )}
      <SuperTicTacToeBoard
        ref={gameRef}
        mode={mode}
        isAIGame={true}
        aiType={aiType}
        onAiTypeChange={setAiType}
        onPlayerChoice={handlePlayerChoice}
        onGameStateChange={handleGameStateChange}
        onNewGameRequest={handleNewGame}
        isProcessing={isProcessing}
      />
    </div>
  );
};

export default AIDuel;
