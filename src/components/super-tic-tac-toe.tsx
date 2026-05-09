"use client";

import React, { useState, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';

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
}

interface SuperTicTacToeProps {
  mode: 'pass_and_play' | 'ai_duel' | string;
  onGameStateChange?: (state: GameState) => void;
  onNewGameRequest?: () => void;
  isAIGame?: boolean;
  onPlayerChoice?: (choice: 'X' | 'O') => void;
  isProcessing?: boolean;
}

const SuperTicTacToe = forwardRef<SuperTicTacToeHandle, SuperTicTacToeProps>(({ 
  mode, 
  onGameStateChange, 
  onNewGameRequest,
  isAIGame = false,
  onPlayerChoice,
  isProcessing = false,
}, ref) => {
  // Initialize 9x9 board (9 games, each with 9 cells)
  const createEmptyBoard = () => Array(9).fill(null).map(() => Array(9).fill(null));
  
  const [superBoard, setSuperBoard] = useState<(string | null)[][]>(createEmptyBoard());
  const [currentPlayer, setCurrentPlayer] = useState<string | null>(null);
  const [activeGame, setActiveGame] = useState<number | null>(null);
  const [gameOwnership, setGameOwnership] = useState<(string | null)[]>(Array(9).fill(null));
  const [previousGame, setPreviousGame] = useState<number | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [lastMove, setLastMove] = useState<{ game: number; cell: number } | null>(null);
  const [superWinner, setSuperWinner] = useState<string | null>(null);
  const [gameHistory, setGameHistory] = useState<number[]>([]);

  useImperativeHandle(ref, () => ({
    makeMove: (gameIndex: number, cellIndex: number) => {
      handleClick(gameIndex, cellIndex);
    },
    resetGame: () => {
      handleNewGame();
    }
  }));

  // Set page title and meta description for SEO
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

  // Sound effects setup (with SSR safety)
  const audioRefs = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return {
      moveO: '/sounds/moveO.mp3',
      moveX: '/sounds/moveX.mp3',
      win: '/sounds/win.mp3',
      superWin: '/sounds/superWin.mp3',
      error: '/sounds/error.mp3'
    };
  }, []);

  const playSound = useCallback((soundName: keyof NonNullable<typeof audioRefs>) => {
    if (!audioRefs) return;
    try {
      const audio = new Audio(audioRefs[soundName]);
      audio.play().catch(() => { /* Ignore autoplay blocks */ });
    } catch (error) {
      console.log('Sound playback error:', error);
    }
  }, [audioRefs]);

  const currentGameState = useMemo(() => ({
    superBoard,
    currentPlayer,
    activeGame,
    gameOwnership,
    superWinner,
    lastMove,
    gameStarted,
    previousGame,
    gameHistory
  }), [superBoard, currentPlayer, activeGame, gameOwnership, superWinner, lastMove, gameStarted, previousGame, gameHistory]);

  useEffect(() => {
    if (!gameStarted) return;

    // Notify parent of state changes
    if (onGameStateChange) {
      onGameStateChange(currentGameState);
    }
  }, [gameStarted, currentGameState, onGameStateChange]);

  // Check for super winner
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

  // UI color scheme
  const colors = {
    background: 'bg-gray-900',
    board: 'bg-gray-800',
    cell: 'bg-gray-700',
    cellHover: 'hover:bg-gray-600',
    playerO: 'text-cyan-400',
    playerX: 'text-red-500',
    accent: 'text-yellow-400',
    button: {
      base: 'bg-gray-700 hover:bg-gray-600 transition-colors duration-200',
      text: 'text-yellow-400 hover:text-yellow-300'
    }
  };

  // Check if a game is won
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

  const findValidGame = (targetGame: number | null, currentSuperBoard: (string | null)[][]): number | null => {
    const isGamePlayable = (gameIdx: number | null): boolean => {
      if (gameIdx === null) return false;
      return currentSuperBoard[gameIdx].some(cell => cell === null);
    };

    if (targetGame !== null && isGamePlayable(targetGame)) {
      return targetGame;
    }

    if (previousGame !== null && isGamePlayable(previousGame)) {
      return previousGame;
    }

    for (let i = gameHistory.length - 1; i >= 0; i--) {
      const historicGame = gameHistory[i];
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

    setSuperBoard(createEmptyBoard());
    setGameOwnership(Array(9).fill(null));
    setCurrentPlayer(startingPlayer);
    setActiveGame(null);
    setPreviousGame(null);
    setLastMove(null);
    setSuperWinner(null);
    setGameStarted(true);
    setGameHistory([]);

    if (onGameStateChange) {
      onGameStateChange({
        superBoard: createEmptyBoard(),
        gameOwnership: Array(9).fill(null),
        currentPlayer: startingPlayer,
        activeGame: null,
        lastMove: null,
        superWinner: null,
        gameStarted: true
      });
    }
  };

  const handleNewGame = () => {
    setSuperBoard(createEmptyBoard());
    setGameOwnership(Array(9).fill(null));
    setCurrentPlayer(null);
    setActiveGame(null);
    setPreviousGame(null);
    setLastMove(null);
    setSuperWinner(null);
    setGameStarted(false);
    setGameHistory([]);
    
    if (onNewGameRequest) {
      onNewGameRequest();
    }
  };

  const handleClick = (gameIndex: number, cellIndex: number) => {
    if (!gameStarted || superWinner) return;

    if (activeGame !== null && activeGame !== gameIndex) {
      playSound('error');
      return;
    }

    if (superBoard[gameIndex][cellIndex] !== null) {
      playSound('error');
      return;
    }

    const newSuperBoard = structuredClone(superBoard);
    newSuperBoard[gameIndex][cellIndex] = currentPlayer;
    setSuperBoard(newSuperBoard);
    
    setGameHistory(prevHistory => {
      const newHistory = [...prevHistory, gameIndex];
      if (newHistory.length > 9) return newHistory.slice(-9);
      return newHistory;
    });

    setLastMove({ game: gameIndex, cell: cellIndex });
    setPreviousGame(gameIndex);
    playSound(currentPlayer === 'O' ? 'moveO' : 'moveX');

    const winResult = checkWin(newSuperBoard[gameIndex]);
    let nextGameOwnership = gameOwnership;
    if (winResult) {
      if (!gameOwnership[gameIndex]) {
        nextGameOwnership = [...gameOwnership];
        nextGameOwnership[gameIndex] = winResult.winner;
        setGameOwnership(nextGameOwnership);
        playSound('win');
      }
    }

    const winner = checkSuperWin(nextGameOwnership);
    if (winner) {
      setSuperWinner(winner);
      playSound('superWin');
      return;
    }

    if (isSuperBoardFilled(newSuperBoard)) {
      setSuperWinner('Draw');
      playSound('error');
      return;
    }

    const nextPlayer = currentPlayer === 'O' ? 'X' : 'O';
    setCurrentPlayer(nextPlayer);

    const nextGame = findValidGame(cellIndex, newSuperBoard);
    if (nextGame === null) {
      const anyPlayableGame = Array.from({length: 9}).some((_, idx) => 
        newSuperBoard[idx].some(cell => cell === null)
      );

      if (!anyPlayableGame) {
        setSuperWinner('Draw');
        playSound('error');
        return;
      } else {
        const safetyGame = findValidGame(null, newSuperBoard);
        setActiveGame(safetyGame);
        return;
      }
    }

    setActiveGame(nextGame);
  };

  const renderCell = (gameIndex: number, cellIndex: number, value: string | null, isZoomed = false) => {
    const isPlayable = gameStarted && (activeGame === null || activeGame === gameIndex);
    const isLastMove = lastMove?.game === gameIndex && lastMove?.cell === cellIndex;

    return (
      <button
        className={`
          w-full h-full flex items-center justify-center
          ${colors.cell} ${isPlayable && !superWinner ? colors.cellHover : ''}
          border border-gray-600 rounded
          transition-all duration-200
          ${value === 'O' ? colors.playerO : value === 'X' ? colors.playerX : ''}
          ${isLastMove ? 'scale-105 ring-2 ring-yellow-400' : 'scale-100'}
          ${isZoomed ? 'text-6xl md:text-7xl' : 'text-2xl sm:text-3xl md:text-4xl'} font-bold
          shadow-md hover:shadow-lg
        `}
        onClick={() => isPlayable && !superWinner ? handleClick(gameIndex, cellIndex) : null}
        disabled={!isPlayable || !!superWinner || isProcessing}
      >
        {value}
      </button>
    );
  };

  const renderGame = (gameIndex: number, game: (string | null)[], isZoomed = false) => {
    const owner = gameOwnership[gameIndex];

    return (
      <div className={`
        relative
        ${isZoomed ? 'w-full h-full' : 'w-full h-full'}
        ${activeGame === gameIndex && gameStarted && !superWinner ? 'ring-2 ring-yellow-500' : ''}
        ${colors.board} rounded-lg p-1 md:p-2
        transition-all duration-300
        shadow-xl
      `}>
        {owner && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <span className={`text-[15vmin] sm:text-[18vmin] md:text-[20vmin] font-bold opacity-50 ${owner === 'O' ? colors.playerO : colors.playerX}`}>
              {owner}
            </span>
          </div>
        )}
        <div className={`grid grid-cols-3 ${isZoomed ? 'gap-1' : 'gap-2'} h-full relative z-20`}>
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
    <div className={`min-h-screen ${colors.background} text-gray-100 flex flex-col p-2 md:p-4`}>
      <div className="container mx-auto flex flex-col gap-4 flex-1">
        <div className="text-center mb-2">
          <h1 className={`text-xl md:text-2xl font-bold ${colors.accent}`}>Super Tic Tac Toe</h1>
          {gameStarted && (
            <p className="text-lg">
              {superWinner ? (
                <span className={`text-xl ${superWinner === 'Draw' ? 'text-yellow-400' : superWinner === 'O' ? colors.playerO : colors.playerX}`}>
                  {superWinner === 'Draw' ? 'Match Draw!' : `Player ${superWinner} Wins!`}
                </span>
              ) : (
                <>
                  Current Player:
                  <span className={currentPlayer === 'O' ? colors.playerO : colors.playerX}>
                    {` ${currentPlayer}`}
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex-1 flex flex-col md:flex-row gap-4 min-h-0">
          <div className="flex-1 md:max-w-[85vh] w-full mx-auto relative">
            {superWinner && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-80 z-50 rounded-lg backdrop-blur-sm">
                <span className={`text-5xl md:text-7xl font-bold text-center mb-8 px-4 ${
                  superWinner === 'Draw' 
                    ? 'text-yellow-400' 
                    : superWinner === 'O' 
                      ? colors.playerO 
                      : colors.playerX
                }`}>
                  {superWinner === 'Draw' ? 'Match Draw!' : `Player ${superWinner} Wins!`}
                </span>
                <button
                  onClick={handleNewGame}
                  className={`${colors.button.base} ${colors.button.text} px-8 py-3 rounded-xl text-xl font-bold border border-gray-600 shadow-2xl hover:scale-105 transition-transform`}
                >
                  Play Again
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 h-full relative z-10">
              {superBoard.map((game, idx) => (
                <div key={idx} className="aspect-square relative">
                  {renderGame(idx, game)}
                </div>
              ))}
            </div>
          </div>

          <div className="w-full md:w-1/3 md:max-w-[400px] flex flex-col justify-center items-center">
            {!gameStarted ? (
              <div className="w-full flex flex-col items-center justify-center gap-4 p-4">
                <h2 className={`text-lg ${colors.accent} mb-4`}>
                  {isAIGame ? 'Choose Your Player' : 'Choose Starting Player'}
                </h2>
                <button
                  onClick={() => startGame('O')}
                  className={`w-full max-w-[200px] py-3 rounded-lg ${colors.button.base} ${colors.playerO} text-lg font-semibold`}
                >
                  {isAIGame ? 'Play as O' : 'Player O'}
                </button>
                <button
                  onClick={() => startGame('X')}
                  className={`w-full max-w-[200px] py-3 rounded-lg ${colors.button.base} ${colors.playerX} text-lg font-semibold`}
                >
                  {isAIGame ? 'Play as X' : 'Player X'}
                </button>
              </div>
            ) : (
              <div className="w-full flex flex-col items-center justify-center p-4">
                <div className="text-center mb-4">
                  <h2 className="text-lg md:text-xl text-blue-400">Current Game</h2>
                </div>
                <div className="aspect-square w-full max-w-[300px] mx-auto">
                  {activeGame !== null ? (
                    renderGame(activeGame, superBoard[activeGame], true)
                  ) : (
                    <div className="bg-gray-800 h-full rounded-lg flex items-center justify-center p-4 text-center text-gray-400 border border-gray-700">
                      {superWinner ? 'Game Over!' : 'Select any game to start'}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleNewGame}
                  className={`${colors.button.base} ${colors.button.text} w-full max-w-[200px] mt-6 py-3 rounded-lg text-lg font-semibold border border-gray-700`}
                >
                  New Game
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

SuperTicTacToe.displayName = 'SuperTicTacToe';

export default SuperTicTacToe;
