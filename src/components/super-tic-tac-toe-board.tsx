"use client";

import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

export interface GameState {
  superBoard: (string | null)[][];
  currentPlayer: string | null;
  activeGame: number | null;
  gameOwnership: (string | null)[];
  superWinner: string | null;
  lastMove: { game: number; cell: number } | null;
  gameStarted: boolean;
  previousGame?: number | null;
  gameHistory?: number[];
}

export interface SuperTicTacToeHandle {
  makeMove: (gameIndex: number, cellIndex: number) => void;
  resetGame: () => void;
  loadGameState: (state: GameState) => void;
}

interface SuperTicTacToeProps {
  mode: 'pass_and_play' | 'ai_duel' | string;
  onGameStateChange?: (state: GameState) => void;
  onNewGameRequest?: () => void;
  isAIGame?: boolean;
  aiType?: 'strategy' | 'neural';
  onAiTypeChange?: (type: 'strategy' | 'neural') => void;
  onPlayerChoice?: (choice: 'X' | 'O') => void;
  isProcessing?: boolean;
}

const SuperTicTacToe = forwardRef<SuperTicTacToeHandle, SuperTicTacToeProps>(({ 
  mode, 
  onGameStateChange, 
  onNewGameRequest,
  isAIGame = false,
  aiType = 'strategy',
  onAiTypeChange,
  onPlayerChoice,
  isProcessing = false,
}, ref) => {
  const createEmptyBoard = () => Array(9).fill(null).map(() => Array(9).fill(null));
  
  const [gameState, setGameState] = useState<GameState>({
    superBoard: createEmptyBoard(),
    currentPlayer: null,
    activeGame: null,
    gameOwnership: Array(9).fill(null),
    superWinner: null,
    lastMove: null,
    gameStarted: false,
    previousGame: null,
    gameHistory: []
  });

  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const lastEmittedStateRef = useRef<GameState | null>(null);

  useEffect(() => {
    document.title = isAIGame || mode === 'ai_duel'
      ? 'Playing AI Duel - Super Tic Tac Toe'
      : 'Playing Pass and Play - Super Tic Tac Toe';
    
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', 
        isAIGame || mode === 'ai_duel'
          ? 'Challenge our AI in Super Tic Tac Toe! Make strategic moves to win three games in a row and claim victory on the super board.'
          : 'Play Super Tic Tac Toe with a friend! Take turns making moves and use strategy to win three games in a row.'
      );
    }
  }, [isAIGame, mode]);

  const audioPlayersRef = useRef<Record<string, HTMLAudioElement> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prefix = process.env.NODE_ENV === 'production' ? '/supertictactoe' : '';
    audioPlayersRef.current = {
      moveO: new Audio(`${prefix}/sounds/moveO.mp3`),
      moveX: new Audio(`${prefix}/sounds/moveX.mp3`),
      win: new Audio(`${prefix}/sounds/win.mp3`),
      superWin: new Audio(`${prefix}/sounds/superWin.mp3`),
      error: new Audio(`${prefix}/sounds/error.mp3`)
    };

    Object.values(audioPlayersRef.current).forEach(audio => {
      audio.load();
    });
  }, []);

  const playSound = useCallback((soundName: 'moveO' | 'moveX' | 'win' | 'superWin' | 'error') => {
    if (!audioPlayersRef.current) return;
    if (typeof window !== 'undefined') {
      const isMuted = localStorage.getItem("sttt_mute") === "true";
      if (isMuted) return;
    }
    try {
      const audio = audioPlayersRef.current[soundName];
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => { /* Ignore autoplay blocks */ });
      }
    } catch (error) {
      console.log('Sound playback error:', error);
    }
  }, []);

  useEffect(() => {
    if (!gameState.gameStarted || !onGameStateChange) return;
    if (lastEmittedStateRef.current === gameState) return;
    lastEmittedStateRef.current = gameState;
    onGameStateChange(gameState);
  }, [gameState, onGameStateChange]);

  const checkSuperWin = (ownership: (string | null)[]) => {
    for (const line of WINNING_LINES) {
      const [a, b, c] = line;
      if (ownership[a] && 
        ownership[a] === ownership[b] && 
        ownership[a] === ownership[c]) {
        return ownership[a];
      }
    }
    return null;
  };

  const colors = {
    background: 'bg-transparent',
    board: 'glass-panel border border-white/5',
    cell: 'bg-white/5 backdrop-blur-sm border border-white/5 rounded-xl transition-all duration-200',
    cellHover: 'hover:border-yellow-500/50 hover:bg-white/10 cursor-pointer',
    playerO: 'text-cyan-400 glow-o',
    playerX: 'text-red-500 glow-x',
    accent: 'text-yellow-400 glow-accent',
    button: {
      base: 'bg-white/10 hover:bg-white/15 border border-white/5 backdrop-blur-md rounded-xl transition-all duration-200 cursor-pointer',
      text: 'text-yellow-400 hover:text-yellow-300'
    }
  };

  const checkWin = (board: (string | null)[]) => {
    for (let i = 0; i < WINNING_LINES.length; i++) {
      const [a, b, c] = WINNING_LINES[i];
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { winner: board[a], line: WINNING_LINES[i] };
      }
    }
    return null;
  };

  const isGameFilled = (game: (string | null)[]) => {
    return game.every(cell => cell !== null);
  };

  const isSuperBoardFilled = (board: (string | null)[][]) => {
    return board.every(game => isGameFilled(game));
  };

  const findValidGame = (targetGame: number | null, currentSuperBoard: (string | null)[][], fallbackGame: number | null = null, currentHistory: number[] = []): number | null => {
    const isGamePlayable = (gameIdx: number | null): boolean => {
      if (gameIdx === null) return false;
      return currentSuperBoard[gameIdx].some(cell => cell === null);
    };

    if (targetGame !== null && isGamePlayable(targetGame)) {
      return targetGame;
    }

    if (fallbackGame !== null && isGamePlayable(fallbackGame)) {
      return fallbackGame;
    }

    for (let i = currentHistory.length - 1; i >= 0; i--) {
      const historicGame = currentHistory[i];
      if (isGamePlayable(historicGame)) {
        return historicGame;
      }
    }

    for (let i = 0; i < 9; i++) {
      if (isGamePlayable(i)) {
        return i;
      }
    }
    
    return null;
  };

  const startGame = (startingPlayer: 'X' | 'O') => {
    if (isAIGame && onPlayerChoice) {
      onPlayerChoice(startingPlayer);
    }

    const freshBoard = createEmptyBoard();
    const freshOwnership = Array(9).fill(null);

    setGameState({
      superBoard: freshBoard,
      currentPlayer: startingPlayer,
      activeGame: null,
      gameOwnership: freshOwnership,
      superWinner: null,
      lastMove: null,
      gameStarted: true,
      previousGame: null,
      gameHistory: []
    });
  };

  const handleNewGame = () => {
    setGameState({
      superBoard: createEmptyBoard(),
      currentPlayer: null,
      activeGame: null,
      gameOwnership: Array(9).fill(null),
      superWinner: null,
      lastMove: null,
      gameStarted: false,
      previousGame: null,
      gameHistory: []
    });
    
    if (onNewGameRequest) {
      onNewGameRequest();
    }
  };

  const handleClick = (gameIndex: number, cellIndex: number) => {
    if (!gameState.gameStarted || gameState.superWinner) return;

    if (gameState.activeGame !== null && gameState.activeGame !== gameIndex) {
      playSound('error');
      return;
    }

    if (gameState.superBoard[gameIndex][cellIndex] !== null) {
      playSound('error');
      return;
    }

    const newSuperBoard = structuredClone(gameState.superBoard);
    newSuperBoard[gameIndex][cellIndex] = gameState.currentPlayer;
    
    const newHistory = [...(gameState.gameHistory || []), gameIndex];
    const finalHistory = newHistory.length > 9 ? newHistory.slice(-9) : newHistory;

    playSound(gameState.currentPlayer === 'O' ? 'moveO' : 'moveX');

    const winResult = checkWin(newSuperBoard[gameIndex]);
    const nextGameOwnership = [...gameState.gameOwnership];
    if (winResult) {
      if (!gameState.gameOwnership[gameIndex]) {
        nextGameOwnership[gameIndex] = winResult.winner;
        playSound('win');
        setConfettiTrigger(prev => prev + 1);
      }
    }

    const winner = checkSuperWin(nextGameOwnership);
    if (winner) {
      setGameState({
        superBoard: newSuperBoard,
        currentPlayer: null,
        activeGame: null,
        gameOwnership: nextGameOwnership,
        superWinner: winner,
        lastMove: { game: gameIndex, cell: cellIndex },
        gameStarted: true,
        previousGame: gameIndex,
        gameHistory: finalHistory
      });
      playSound('superWin');
      setConfettiTrigger(prev => prev + 1);
      return;
    }

    if (isSuperBoardFilled(newSuperBoard)) {
      setGameState({
        superBoard: newSuperBoard,
        currentPlayer: null,
        activeGame: null,
        gameOwnership: nextGameOwnership,
        superWinner: 'Draw',
        lastMove: { game: gameIndex, cell: cellIndex },
        gameStarted: true,
        previousGame: gameIndex,
        gameHistory: finalHistory
      });
      playSound('win');
      return;
    }

    const nextPlayer = gameState.currentPlayer === 'O' ? 'X' : 'O';
    const nextGame = findValidGame(cellIndex, newSuperBoard, gameIndex, finalHistory);

    if (nextGame === null) {
      const anyPlayableGame = Array.from({length: 9}).some((_, idx) => 
        newSuperBoard[idx].some(cell => cell === null)
      );

      if (!anyPlayableGame) {
        setGameState({
          superBoard: newSuperBoard,
          currentPlayer: null,
          activeGame: null,
          gameOwnership: nextGameOwnership,
          superWinner: 'Draw',
          lastMove: { game: gameIndex, cell: cellIndex },
          gameStarted: true,
          previousGame: gameIndex,
          gameHistory: finalHistory
        });
        playSound('win');
        return;
      } else {
        const safetyGame = findValidGame(null, newSuperBoard, gameIndex, finalHistory);
        setGameState({
          superBoard: newSuperBoard,
          currentPlayer: nextPlayer,
          activeGame: safetyGame,
          gameOwnership: nextGameOwnership,
          superWinner: null,
          lastMove: { game: gameIndex, cell: cellIndex },
          gameStarted: true,
          previousGame: gameIndex,
          gameHistory: finalHistory
        });
        return;
      }
    }

    setGameState({
      superBoard: newSuperBoard,
      currentPlayer: nextPlayer,
      activeGame: nextGame,
      gameOwnership: nextGameOwnership,
      superWinner: null,
      lastMove: { game: gameIndex, cell: cellIndex },
      gameStarted: true,
      previousGame: gameIndex,
      gameHistory: finalHistory
    });
  };

  useImperativeHandle(ref, () => ({
    makeMove: (gameIndex: number, cellIndex: number) => {
      handleClick(gameIndex, cellIndex);
    },
    resetGame: () => {
      handleNewGame();
    },
    loadGameState: (state: GameState) => {
      setGameState(state);
    }
  }));

  const renderCell = (gameIndex: number, cellIndex: number, value: string | null, isZoomed = false) => {
    const isPlayable = value === null && gameState.gameStarted && (gameState.activeGame === null || gameState.activeGame === gameIndex);
    const isLastMove = gameState.lastMove?.game === gameIndex && gameState.lastMove?.cell === cellIndex;

    const cellClasses = `
      w-full h-full flex items-center justify-center
      ${colors.cell} ${isPlayable && !gameState.superWinner ? colors.cellHover : ''}
      ${isLastMove ? 'scale-105 ring-2 ring-yellow-400/80 shadow-[0_0_10px_rgba(234,179,8,0.3)]' : 'scale-100'}
      ${isZoomed ? 'text-6xl md:text-7xl' : 'text-2xl sm:text-3xl md:text-4xl'} font-bold
      shadow-md transition-all duration-300
    `;

    const content = (
      <AnimatePresence mode="popLayout">
        {value && (
          <motion.span
            initial={{ scale: 0, rotate: -30, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className={value === 'O' ? colors.playerO : colors.playerX}
          >
            {value}
          </motion.span>
        )}
      </AnimatePresence>
    );

    if (value !== null) {
      return <div className={cellClasses}>{content}</div>;
    }

    return (
      <button
        className={cellClasses}
        onClick={() => isPlayable && !gameState.superWinner ? handleClick(gameIndex, cellIndex) : null}
        disabled={!isPlayable || !!gameState.superWinner || isProcessing}
      >
        {content}
      </button>
    );
  };

  const renderGame = (gameIndex: number, game: (string | null)[], isZoomed = false) => {
    const owner = gameState.gameOwnership[gameIndex];
    const isActive = gameState.activeGame === gameIndex && gameState.gameStarted && !gameState.superWinner;

    return (
      <div className={`
        relative
        w-full h-full
        ${isActive ? 'neon-active-grid scale-[1.02] z-30' : 'scale-100'}
        ${colors.board} rounded-2xl p-1.5 md:p-3
        transition-all duration-300
        shadow-xl
      `}>
        {owner && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 0.25, scale: 1 }}
            transition={{ type: "spring", stiffness: 100 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
          >
            <span className={`text-[15vmin] sm:text-[18vmin] md:text-[20vmin] font-extrabold select-none ${owner === 'O' ? colors.playerO : colors.playerX}`}>
              {owner}
            </span>
          </motion.div>
        )}
        <div className={`grid grid-cols-3 ${isZoomed ? 'gap-1.5' : 'gap-2'} h-full relative z-20`}>
          {game.map((cell, idx) => (
            <div key={idx} className="aspect-square">
              {renderCell(gameIndex, idx, cell, isZoomed)}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className={`min-h-screen ${colors.background} text-gray-100 flex flex-col p-2 md:p-4 relative`}>
      <ConfettiCelebration trigger={confettiTrigger} />
      <div className="container mx-auto flex flex-col gap-4 flex-1 justify-center py-6">
        <div className="text-center mb-2">
          <motion.h1 
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className={`text-2xl md:text-3xl font-extrabold tracking-wide uppercase ${colors.accent}`}
          >
            Super Tic Tac Toe
          </motion.h1>
          {gameState.gameStarted && (
            <p className="text-lg mt-1.5 font-semibold">
              {gameState.superWinner ? (
                <span className={`text-xl ${gameState.superWinner === 'Draw' ? 'text-yellow-400 glow-accent' : gameState.superWinner === 'O' ? colors.playerO : colors.playerX}`}>
                  {gameState.superWinner === 'Draw' ? 'Match Draw!' : `Player ${gameState.superWinner} Wins!`}
                </span>
              ) : (
                <span className="text-gray-300">
                  Current Turn:
                  <span className={gameState.currentPlayer === 'O' ? colors.playerO : colors.playerX}>
                    {` ${gameState.currentPlayer}`}
                  </span>
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex-1 flex flex-col md:flex-row gap-8 items-center justify-center min-h-0 max-w-6xl w-full mx-auto">
          <div className="flex-1 md:max-w-[72vh] aspect-square w-full relative">
            <AnimatePresence>
              {gameState.superWinner && (
                <motion.div 
                  initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
                  animate={{ opacity: 1, backdropFilter: "blur(12px)" }}
                  exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
                  className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/85 z-50 rounded-3xl border border-white/10 shadow-2xl"
                >
                  <motion.span 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", delay: 0.1 }}
                    className={`text-5xl md:text-7xl font-extrabold text-center mb-8 px-4 ${
                      gameState.superWinner === 'Draw' 
                        ? 'text-yellow-400 glow-accent' 
                        : gameState.superWinner === 'O' 
                          ? colors.playerO 
                          : colors.playerX
                    }`}
                  >
                    {gameState.superWinner === 'Draw' ? 'Match Draw!' : `Player ${gameState.superWinner} Wins!`}
                  </motion.span>
                  <motion.button
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    onClick={handleNewGame}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`${colors.button.base} ${colors.button.text} px-8 py-3.5 text-xl font-bold border border-yellow-500/20 shadow-2xl`}
                  >
                    Play Again
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-3 gap-3 h-full relative z-10">
              {gameState.superBoard.map((game, idx) => (
                <div key={idx} className="aspect-square relative">
                  {renderGame(idx, game)}
                </div>
              ))}
            </div>
          </div>

          <div className="w-full md:w-1/3 md:max-w-[340px] flex flex-col justify-center items-center">
            {!gameState.gameStarted ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full flex flex-col items-center justify-center gap-4 p-6 glass-panel rounded-2xl border border-white/5 shadow-2xl text-center"
              >
                {isAIGame && (
                  <div className="w-full text-left">
                    <div className="text-[11px] font-semibold text-gray-400 tracking-wider uppercase mb-2">
                      Opponent Engine
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-white/5 rounded-xl border border-white/5">
                      <button
                        type="button"
                        onClick={() => onAiTypeChange?.('strategy')}
                        className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition-all flex flex-col items-center gap-0.5 cursor-pointer ${
                          aiType === 'strategy'
                            ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 shadow-sm'
                            : 'text-gray-400 hover:text-gray-200 border border-transparent'
                        }`}
                      >
                        <span className="font-bold">Strategy Bot</span>
                        <span className="text-[10px] opacity-70 font-mono">Minimax</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onAiTypeChange?.('neural')}
                        className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition-all flex flex-col items-center gap-0.5 cursor-pointer ${
                          aiType === 'neural'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                            : 'text-gray-400 hover:text-gray-200 border border-transparent'
                        }`}
                      >
                        <span className="font-bold">Neural Bot</span>
                        <span className="text-[10px] opacity-70 font-mono">AlphaZero</span>
                      </button>
                    </div>
                  </div>
                )}

                <h2 className={`text-lg font-bold tracking-wide ${colors.accent}`}>
                  {isAIGame ? 'Choose Your Side' : 'Select Starting Player'}
                </h2>
                <div className="w-full flex flex-col gap-3 mt-1">
                  <motion.button
                    onClick={() => startGame('O')}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className={`w-full py-3.5 rounded-xl ${colors.button.base} ${colors.playerO} text-lg font-bold`}
                  >
                    {isAIGame ? 'Play as O (Cyan)' : 'Player O (Cyan)'}
                  </motion.button>
                  <motion.button
                    onClick={() => startGame('X')}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className={`w-full py-3.5 rounded-xl ${colors.button.base} ${colors.playerX} text-lg font-bold`}
                  >
                    {isAIGame ? 'Play as X (Red)' : 'Player X (Red)'}
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="w-full flex flex-col items-center justify-center p-6 glass-panel rounded-2xl border border-white/5 shadow-2xl"
              >
                <div className="text-center mb-4">
                  {isAIGame && (
                    <div className="mb-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono">
                      <span className={`w-2 h-2 rounded-full ${aiType === 'neural' ? 'bg-cyan-400 animate-pulse' : 'bg-yellow-400'}`} />
                      <span className="text-gray-300">{aiType === 'neural' ? 'Neural Bot (AlphaZero)' : 'Strategy Bot (Minimax)'}</span>
                    </div>
                  )}
                  <h2 className="text-lg font-bold text-cyan-400 tracking-wider uppercase">Active Sub-Board</h2>
                </div>
                <div className="aspect-square w-full max-w-[240px] mx-auto relative">
                  {gameState.activeGame !== null ? (
                    renderGame(gameState.activeGame, gameState.superBoard[gameState.activeGame], true)
                  ) : (
                    <div className="glass-panel backdrop-blur-md h-full rounded-2xl flex items-center justify-center p-4 text-center text-gray-400 border border-white/5 shadow-xl">
                      {gameState.superWinner ? 'Game Over!' : 'Select any game to start'}
                    </div>
                  )}
                </div>
                <motion.button
                  onClick={handleNewGame}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`${colors.button.base} ${colors.button.text} w-full max-w-[200px] mt-6 py-3 rounded-xl font-bold border border-yellow-500/20`}
                >
                  New Game
                </motion.button>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

SuperTicTacToe.displayName = 'SuperTicTacToe';

export default SuperTicTacToe;

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  rotate: number;
  borderRadius: string;
}

const ConfettiCelebration = ({ trigger }: { trigger: number }) => {
  const particlesRef = useRef<Particle[]>([]);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (trigger === 0) return;

    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444'];
    particlesRef.current = Array.from({ length: 45 }).map((_, i) => ({
      id: Date.now() + i,
      x: (Math.random() - 0.5) * 500,
      y: -Math.random() * 400 - 150,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 6,
      rotate: Math.random() * 360,
      borderRadius: Math.random() > 0.5 ? '50%' : '15%'
    }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTick(t => t + 1);

    const timer = setTimeout(() => {
      particlesRef.current = [];
      setTick(t => t + 1);
    }, 2500);

    return () => clearTimeout(timer);
  }, [trigger]);

  return (
    <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden flex items-center justify-center">
      <AnimatePresence>
        {/* eslint-disable-next-line react-hooks/refs */}
        {particlesRef.current.map((p) => (
          <motion.div
            key={p.id}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
            animate={{
              x: p.x,
              y: p.y,
              opacity: 0,
              scale: 0.2,
              rotate: p.rotate + 270,
              transition: { duration: 2.2, ease: "easeOut" }
            }}
            exit={{ opacity: 0 }}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: p.borderRadius,
              boxShadow: `0 0 6px ${p.color}`
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
