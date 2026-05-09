"use client";

// --- Types ---

export interface Move {
  game: number;
  cell: number;
}

export interface GameState {
  superBoard: (string | null)[][];
  currentPlayer: string | null;
  activeGame: number | null;
  gameOwnership: (string | null)[];
  superWinner: string | null;
  lastMove: Move | null;
  gameStarted: boolean;
}

type AnalysisData = Record<string, unknown>;

interface PatternAnalysis {
  winningMove?: number | null;
  isWinning?: boolean;
  forkMove?: number | null;
  potentialLines?: number;
  offensivePotential?: number;
  threats?: Threat[];
  blockingMove?: number | null;
  boardStrength?: BoardStrength;
}

interface Threat {
  pattern: number[];
  position: number;
  type: string;
}

interface BoardStrength {
  winningThreats: number;
  forkPotential: number;
  centerControl: number;
  cornerControl: number;
  blockingValue: number;
}

interface StrategicAnalysis {
  type: string;
  strength: number;
  moves: StrategicMove[];
  controlledPositions: Set<number>;
}

interface StrategicMove {
  game: number;
  priority: number;
  type: string;
}

interface GameAnalysis {
  analysis: AnalysisData;
  timestamp: number;
}

interface AdaptationEntry {
  phase: string;
  timestamp: number;
  reason: string;
}

interface ContingencyPlan {
  primaryTargets: Set<number>;
  priority: number;
  backupMoves?: StrategicMoveWithScore[];
  transitionMoves?: StrategicMoveWithStrength[];
  blockingMoves?: StrategicMoveWithPriority[];
}

interface StrategicMoveWithScore extends Move {
  value: number;
}

interface StrategicMoveWithStrength {
  gameIndex: number;
  strength: BoardStrength;
}

interface StrategicMoveWithPriority extends Move {
  priority: number;
}

// --- AI Config ---

const AI_CONFIG = {
  MAX_DEPTH: 6,
  ENDGAME_DEPTH: 8,
  PATTERNS: {
    CORNERS: [0, 2, 6, 8],
    EDGES: [1, 3, 5, 7],
    CENTER: 4,
    WIN_PATTERNS: [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ],
    STRONG_POSITIONS: {
      CENTER_GAME: 4,
      CORNER_GAMES: [0, 2, 6, 8],
      EDGE_GAMES: [1, 3, 5, 7]
    }
  },
  PHASES: {
    SABOTAGE: 'SABOTAGE',
    CONTROL: 'CONTROL',
    SACRIFICE: 'SACRIFICE',
    ENDGAME: 'ENDGAME'
  },
  WEIGHTS: {
    SUPER_WIN: 10000,
    IMMEDIATE_WIN: 900,
    BLOCKING_OPPONENT_WIN: 850,
    MAINTAIN_SABOTAGE: 800,
    CONTROL_PATTERN: 700,
    SACRIFICE_VALUE: 600,
    PREVENT_OPPONENT_WIN: 750,
    BLOCK_FORK: 800,
    FORCED_MOVE_PENALTY: -400,
    BREAK_STRATEGY_PENALTY: -600,
    ENABLE_OPPONENT_WIN: -800,
    PATTERN_MAINTENANCE: 500,
    RECOVERY_BONUS: 300,
    DIAGONAL_CONTROL: 200,
    FORK_SETUP: 400,
    CONNECTION_STRENGTH: 100,
    PHASE_MULTIPLIERS: {
      EARLY_GAME: 1.0,
      MID_GAME: 1.5,
      LATE_GAME: 2.0,
      ENDGAME: 2.5,
      SABOTAGE: 1.0,
      CONTROL: 1.5,
      SACRIFICE: 2.0
    } as Record<string, number>
  },
  DYNAMIC_WEIGHTS: {
    EARLY_GAME: { CORNER_VALUE: 200, CENTER_VALUE: 300, EDGE_VALUE: 150, CONNECTIVITY: 250, BLOCKING: 300 },
    MID_GAME: { CORNER_VALUE: 300, CENTER_VALUE: 400, EDGE_VALUE: 200, CONNECTIVITY: 450, BLOCKING: 500 },
    LATE_GAME: { CORNER_VALUE: 400, CENTER_VALUE: 500, EDGE_VALUE: 300, CONNECTIVITY: 600, BLOCKING: 700 }
  } as Record<string, any>
};

// --- Pattern Cache ---

const PatternCache = {
  boardPatterns: new Map<string, PatternAnalysis>(),
  gameAnalysis: new Map<string, GameAnalysis>(),
  patternTypeCache: new Map<string, { analysis: StrategicAnalysis; timestamp: number }>(),
  
  generateKey: (board: (string | null)[], player: string) => `${board.join('')}-${player}`,
  
  cachePatternAnalysis: (board: (string | null)[], player: string, analysis: PatternAnalysis) => {
    const key = PatternCache.generateKey(board, player);
    const existing = PatternCache.boardPatterns.get(key) || {};
    PatternCache.boardPatterns.set(key, { ...existing, ...analysis });
  },
  
  getCachedPattern: (board: (string | null)[], player: string) => {
    const key = PatternCache.generateKey(board, player);
    return PatternCache.boardPatterns.get(key);
  },
  
  cacheGameAnalysis: (gameState: GameState, gameIndex: number, analysis: AnalysisData) => {
    const key = `${gameIndex}-${gameState.currentPlayer}`;
    PatternCache.gameAnalysis.set(key, {
      analysis,
      timestamp: Date.now()
    });
  },
  
  getCachedGameAnalysis: (gameState: GameState, gameIndex: number) => {
    const key = `${gameIndex}-${gameState.currentPlayer}`;
    const cached = PatternCache.gameAnalysis.get(key);
    
    if (cached && Date.now() - cached.timestamp < 1000) {
      return cached.analysis;
    }
    return null;
  },
  
  generatePatternKey: (board: (string | null)[][], patternType: string) => 
    `${board.map(g => g.join('')).join('')}-${patternType}`,

  cachePatternType: (board: (string | null)[][], patternType: string, analysis: StrategicAnalysis) => {
    const key = PatternCache.generatePatternKey(board, patternType);
    PatternCache.patternTypeCache.set(key, {
      analysis,
      timestamp: Date.now()
    });
  },

  getCachedPatternType: (board: (string | null)[][], patternType: string) => {
    const key = PatternCache.generatePatternKey(board, patternType);
    const cached = PatternCache.patternTypeCache.get(key);

    if (cached && Date.now() - cached.timestamp < 1000) {
      return cached.analysis;
    }
    return null;
  },

  clearCache: () => {
    PatternCache.boardPatterns.clear();
    PatternCache.gameAnalysis.clear();
    PatternCache.patternTypeCache.clear();
  }
};

// --- Winning Analyzer ---

const WinningAnalyzer = {
  WEIGHTS: {
    IMMEDIATE_WIN: 1000,
    BLOCKING_OPPONENT_WIN: 900,
    FORK_OPPORTUNITY: 850,
    TWO_IN_LINE_VALUE: 400,
    ENABLE_WIN_NEXT_TURN: 950,
    
    PHASE_MULTIPLIERS: {
      SABOTAGE: 2.5,
      CONTROL: 2.0,
      SACRIFICE: 1.5,
      ENDGAME: 3.0,
      EARLY_GAME: 1.0,
      MID_GAME: 1.5,
      LATE_GAME: 2.0
    } as Record<string, number>,
    
    POSITION: {
      CENTER: 100,
      CORNER: 75,
      EDGE: 50
    }
  },

  findWinningMove: (board: (string | null)[], player: string) => {
    const cached = PatternCache.getCachedPattern(board, player);
    if (cached?.winningMove !== undefined) {
      return cached.winningMove;
    }

    let winningMove = null;
    for (let i = 0; i < board.length; i++) {
      if (board[i] === null) {
        const testBoard = [...board];
        testBoard[i] = player;
        if (WinningAnalyzer.isWinningBoard(testBoard, player)) {
          winningMove = i;
          break;
        }
      }
    }

    PatternCache.cachePatternAnalysis(board, player, { winningMove });
    return winningMove;
  },

  isWinningBoard: (board: (string | null)[], player: string) => {
    const cached = PatternCache.getCachedPattern(board, player);
    if (cached?.isWinning !== undefined) {
      return cached.isWinning;
    }

    const isWinning = AI_CONFIG.PATTERNS.WIN_PATTERNS.some(pattern => {
      const [a, b, c] = pattern;
      return board[a] === player && board[b] === player && board[c] === player;
    });

    PatternCache.cachePatternAnalysis(board, player, { isWinning });
    return isWinning;
  },

  findForkMove: (board: (string | null)[], player: string) => {
    const cached = PatternCache.getCachedPattern(board, player);
    if (cached?.forkMove !== undefined) {
      return cached.forkMove;
    }

    const moves: { position: number; winningLines: number }[] = [];
    for (let i = 0; i < board.length; i++) {
      if (board[i] === null) {
        const testBoard = [...board];
        testBoard[i] = player;
        const winningLines = WinningAnalyzer.countPotentialWinningLines(testBoard, player);
        if (winningLines >= 2) {
          moves.push({ position: i, winningLines });
        }
      }
    }

    const bestMove = moves.sort((a, b) => b.winningLines - a.winningLines)[0]?.position ?? null;
    PatternCache.cachePatternAnalysis(board, player, { forkMove: bestMove });
    return bestMove;
  },

  countPotentialWinningLines: (board: (string | null)[], player: string) => {
    const cached = PatternCache.getCachedPattern(board, player);
    if (cached?.potentialLines !== undefined) {
      return cached.potentialLines;
    }

    const count = AI_CONFIG.PATTERNS.WIN_PATTERNS.filter(pattern => {
      const [a, b, c] = pattern;
      const cells = [board[a], board[b], board[c]];
      const playerCount = cells.filter(cell => cell === player).length;
      const emptyCount = cells.filter(cell => cell === null).length;
      return playerCount === 2 && emptyCount === 1;
    }).length;

    PatternCache.cachePatternAnalysis(board, player, { potentialLines: count });
    return count;
  },

  evaluateOffensivePotential: (board: (string | null)[], player: string) => {
    const cached = PatternCache.getCachedPattern(board, player);
    if (cached?.offensivePotential !== undefined) {
      return cached.offensivePotential;
    }

    let score = 0;
    const gameStage = PhaseManager.getGameStage({ superBoard: [board] } as any);
    const phaseMultiplier = WinningAnalyzer.WEIGHTS.PHASE_MULTIPLIERS[gameStage] || 1;
    
    const emptySpots = board.map((cell, index) => cell === null ? index : -1)
      .filter(idx => idx !== -1);
    
    for (const spot of emptySpots) {
      const testBoard = [...board];
      testBoard[spot] = player;
      
      if (WinningAnalyzer.isWinningBoard(testBoard, player)) {
        score += WinningAnalyzer.WEIGHTS.IMMEDIATE_WIN * phaseMultiplier;
        continue;
      }
      
      const forkMove = WinningAnalyzer.findForkMove(testBoard, player);
      if (forkMove !== null) {
        score += WinningAnalyzer.WEIGHTS.FORK_OPPORTUNITY * phaseMultiplier;
      }
      
      if (spot === 4) { // Center
        score += WinningAnalyzer.WEIGHTS.POSITION.CENTER;
      } else if ([0, 2, 6, 8].includes(spot)) { // Corners
        score += WinningAnalyzer.WEIGHTS.POSITION.CORNER;
      } else { // Edges
        score += WinningAnalyzer.WEIGHTS.POSITION.EDGE;
      }
      
      const twoInLines = WinningAnalyzer.countPotentialWinningLines(testBoard, player);
      score += twoInLines * WinningAnalyzer.WEIGHTS.TWO_IN_LINE_VALUE * phaseMultiplier;
    }

    PatternCache.cachePatternAnalysis(board, player, { offensivePotential: score });
    return score;
  },

  analyzeThreats: (board: (string | null)[], player: string) => {
    const cached = PatternCache.getCachedPattern(board, player);
    if (cached?.threats !== undefined) {
      return cached.threats;
    }

    const threats: Threat[] = [];
    AI_CONFIG.PATTERNS.WIN_PATTERNS.forEach(pattern => {
      const [a, b, c] = pattern;
      const cells = [board[a], board[b], board[c]];
      const playerCells = cells.filter(cell => cell === player);
      const emptyCells = cells.filter(cell => cell === null);
      
      if (playerCells.length === 2 && emptyCells.length === 1) {
        const threatPosition = pattern[cells.findIndex(cell => cell === null)];
        threats.push({
          pattern,
          position: threatPosition,
          type: 'immediate'
        });
      }
    });

    PatternCache.cachePatternAnalysis(board, player, { threats });
    return threats;
  },

  findBlockingMove: (board: (string | null)[], player: string) => {
    const cached = PatternCache.getCachedPattern(board, player);
    if (cached?.blockingMove !== undefined) {
      return cached.blockingMove;
    }

    const opponent = player === 'X' ? 'O' : 'X';
    const threats = WinningAnalyzer.analyzeThreats(board, opponent);
    
    const blockingMove = threats.length > 0 ? threats[0].position : null;
    PatternCache.cachePatternAnalysis(board, player, { blockingMove });
    return blockingMove;
  },

  evaluateBoardStrength: (board: (string | null)[], player: string) => {
    const cached = PatternCache.getCachedPattern(board, player);
    if (cached?.boardStrength !== undefined) {
      return cached.boardStrength;
    }

    const strength: BoardStrength = {
      winningThreats: WinningAnalyzer.countPotentialWinningLines(board, player),
      forkPotential: WinningAnalyzer.findForkMove(board, player) !== null ? 1 : 0,
      centerControl: board[4] === player ? 1 : 0,
      cornerControl: [0, 2, 6, 8].filter(i => board[i] === player).length,
      blockingValue: WinningAnalyzer.findBlockingMove(board, player) !== null ? 1 : 0
    };

    PatternCache.cachePatternAnalysis(board, player, { boardStrength: strength });
    return strength;
  }
};

// --- Minimax Optimizer ---

const MinimaxOptimizer = {
  transpositionTable: new Map<string, { depth: number; score: number; move: Move | null }>(),

  orderMoves: (gameState: GameState, validMoves: Move[]) => {
    try {
      return validMoves.map(move => ({
        move,
        weight: EnhancedAIEngine.calculateCumulativeWeight(
          WinningAnalyzer.evaluateOffensivePotential(
            gameState.superBoard[move.game],
            gameState.currentPlayer!
          ),
          gameState,
          move,
          { includePattern: true }
        ) || 0
      }))
      .sort((a, b) => b.weight - a.weight)
      .map(item => item.move);
    } catch (error) {
      console.error("Error in move ordering:", error);
      return validMoves;
    }
  },

  generatePositionKey: (gameState: GameState) => {
    return `${gameState.superBoard.map(game => game.join('')).join('')}-${gameState.currentPlayer}-${gameState.activeGame}`;
  },

  getCachedEvaluation: (gameState: GameState, depth: number) => {
    const key = MinimaxOptimizer.generatePositionKey(gameState);
    const cached = MinimaxOptimizer.transpositionTable.get(key);
    
    if (cached && cached.depth >= depth) {
      return cached;
    }
    return null;
  },

  cacheEvaluation: (gameState: GameState, depth: number, score: number, move: Move | null) => {
    const key = MinimaxOptimizer.generatePositionKey(gameState);
    MinimaxOptimizer.transpositionTable.set(key, { depth, score, move });
  },

  clearCache: () => {
    MinimaxOptimizer.transpositionTable.clear();
  }
};

// --- Strategic Pattern Analyzer ---

const StrategicPatternAnalyzer = {
  PATTERN_TYPES: {
    DIAGONAL_DOMINANCE: 'DIAGONAL_DOMINANCE',
    CORNER_CONTROL: 'CORNER_CONTROL',
    CENTER_EXPANSION: 'CENTER_EXPANSION',
    EDGE_SQUEEZE: 'EDGE_SQUEEZE',
    FORK_SETUP: 'FORK_SETUP'
  },

  WEIGHTS: {
    PATTERN_COMPLETION: 700,
    PATTERN_SETUP: 500,
    PATTERN_DISRUPTION: 400,
    PATTERN_DEFENSE: 300,
    PATTERN_MULTIPLIERS: {
      CRITICAL: 2.0,
      HIGH: 1.5,
      MEDIUM: 1.0,
      LOW: 0.5
    } as Record<string, number>
  },

  state: {
    activePatterns: new Set<string>(),
    patternHistory: [] as any[],
    patternStrengths: new Map<string, number>()
  },

  analyzePatterns: (gameState: GameState) => {
    const patterns = new Map<string, StrategicAnalysis>();
    
    try {
      Object.values(StrategicPatternAnalyzer.PATTERN_TYPES).forEach(patternType => {
        const analysis = StrategicPatternAnalyzer.analyzePatternType(gameState, patternType);
        if (analysis && analysis.strength > 0) {
          patterns.set(patternType, analysis);
        }
      });
      StrategicPatternAnalyzer.updatePatternState(patterns);
    } catch (error) {
      console.error("Error in pattern analysis:", error);
      return new Map();
    }
    
    return patterns;
  },

  analyzePatternType: (gameState: GameState, patternType: string) => {
    const cached = PatternCache.getCachedPatternType(gameState.superBoard, patternType);
    if (cached) return cached;

    const analysis: StrategicAnalysis = {
      type: patternType,
      strength: 0,
      moves: [],
      controlledPositions: new Set<number>()
    };

    switch (patternType) {
      case StrategicPatternAnalyzer.PATTERN_TYPES.DIAGONAL_DOMINANCE: {
        const diagonals = [
          {positions: [0, 4, 8]},
          {positions: [2, 4, 6]}
        ];

        diagonals.forEach(diagonal => {
          let diagonalStrength = 0;
          const availableMoves: StrategicMove[] = [];

          diagonal.positions.forEach(pos => {
            if (gameState.gameOwnership[pos] === gameState.currentPlayer) {
              diagonalStrength += 300;
              analysis.controlledPositions.add(pos);
            } else if (!gameState.gameOwnership[pos]) {
              const gameStrength = WinningAnalyzer.evaluateBoardStrength(
                gameState.superBoard[pos],
                gameState.currentPlayer!
              );

              if (gameStrength.winningThreats > 0) {
                diagonalStrength += 200;
                availableMoves.push({
                  game: pos,
                  priority: gameStrength.winningThreats,
                  type: 'winning'
                });
              }
            }
          });

          analysis.strength = Math.max(analysis.strength, diagonalStrength);
          analysis.moves.push(...availableMoves);
        });
        break;
      }

      case StrategicPatternAnalyzer.PATTERN_TYPES.CORNER_CONTROL: {
        const corners = [0, 2, 6, 8];
        corners.forEach(corner => {
          if (gameState.gameOwnership[corner] === gameState.currentPlayer) {
            analysis.strength += 250;
            analysis.controlledPositions.add(corner);
          } else if (!gameState.gameOwnership[corner]) {
            const gameStrength = WinningAnalyzer.evaluateBoardStrength(
              gameState.superBoard[corner],
              gameState.currentPlayer!
            );

            if (gameStrength.winningThreats > 0) {
              analysis.strength += 150;
              analysis.moves.push({
                game: corner,
                priority: gameStrength.winningThreats,
                type: 'corner-threat'
              });
            }
          }
        });
        break;
      }

      case StrategicPatternAnalyzer.PATTERN_TYPES.CENTER_EXPANSION: {
        const center = 4;
        const adjacentGames = [1, 3, 5, 7];

        if (gameState.gameOwnership[center] === gameState.currentPlayer) {
          analysis.strength += 400;
          analysis.controlledPositions.add(center);

          adjacentGames.forEach(adj => {
            if (!gameState.gameOwnership[adj]) {
              const gameStrength = WinningAnalyzer.evaluateBoardStrength(
                gameState.superBoard[adj],
                gameState.currentPlayer!
              );

              if (gameStrength.winningThreats > 0) {
                analysis.strength += 100;
                analysis.moves.push({
                  game: adj,
                  priority: gameStrength.winningThreats,
                  type: 'expansion'
                });
              }
            }
          });
        } else if (!gameState.gameOwnership[center]) {
          const centerStrength = WinningAnalyzer.evaluateBoardStrength(
            gameState.superBoard[center],
            gameState.currentPlayer!
          );

          if (centerStrength.winningThreats > 0) {
            analysis.strength += 300;
            analysis.moves.push({
              game: center,
              priority: centerStrength.winningThreats * 2,
              type: 'center-capture'
            });
          }
        }
        break;
      }
      default:
        return null;
    }

    PatternCache.cachePatternType(gameState.superBoard, patternType, analysis);
    return analysis;
  },

  updatePatternState: (patterns: Map<string, StrategicAnalysis>) => {
    StrategicPatternAnalyzer.state.activePatterns.clear();
    StrategicPatternAnalyzer.state.patternStrengths.clear();

    patterns.forEach((analysis, patternType) => {
      if (analysis.strength >= 2) {
        StrategicPatternAnalyzer.state.activePatterns.add(patternType);
        StrategicPatternAnalyzer.state.patternStrengths.set(patternType, analysis.strength);
      }
    });
  },

  evaluatePatternMove: (gameState: GameState, move: Move) => {
    let score = 0;

    Object.values(StrategicPatternAnalyzer.PATTERN_TYPES).forEach(patternType => {
      const analysis = StrategicPatternAnalyzer.analyzePatternType(gameState, patternType);
      if (!analysis) return;

      const patternMove = analysis.moves.find(m => m.game === move.game);
      if (patternMove) {
        const moveValue = analysis.strength * (patternMove.priority / 3);
        const multiplierKey = analysis.strength > 700 ? 'CRITICAL' :
          analysis.strength > 500 ? 'HIGH' :
          analysis.strength > 300 ? 'MEDIUM' : 'LOW';
        
        const multiplier = StrategicPatternAnalyzer.WEIGHTS.PATTERN_MULTIPLIERS[multiplierKey];
        score += moveValue * multiplier;
      }
    });

    return score;
  }
};

// --- Recovery System ---

interface RecoveryMetrics {
  brokenPatterns: Set<number>;
  riskLevel: number;
  threatLevel: number;
  recoveryOptions: RecoveryOption[];
}

interface RecoveryOption {
  type: string;
  priority: number;
  targetGames: Set<number>;
}

const RecoverySystem = {
  RECOVERY_STATES: {
    NORMAL: 'NORMAL',
    PARTIAL_BREAK: 'PARTIAL_BREAK',
    FULL_BREAK: 'FULL_BREAK',
    REBUILDING: 'REBUILDING',
    TRANSITION: 'TRANSITION'
  },

  RISK_LEVELS: {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
    CRITICAL: 4
  },

  state: {
    recoveryState: 'NORMAL',
    brokenPatterns: new Set<number>(),
    riskLevel: 1,
    recoveryAttempts: 0,
    lastValidPattern: null as number[] | null,
    alternativePatterns: [] as RecoveryOption[],
    recoveryStartTime: null as number | null,
    adaptationHistory: [] as AdaptationEntry[],
    contingencyPlans: new Map<string, ContingencyPlan>()
  },

  assessStrategyBreak: (gameState: GameState): RecoveryMetrics => {
    const metrics: RecoveryMetrics = {
      brokenPatterns: new Set<number>(),
      riskLevel: RecoverySystem.RISK_LEVELS.LOW,
      threatLevel: 0,
      recoveryOptions: []
    };

    const patternIntegrity = RecoverySystem.analyzePatternIntegrity(gameState);
    metrics.brokenPatterns = patternIntegrity.brokenPatterns;
    metrics.riskLevel = Math.max(metrics.riskLevel, patternIntegrity.riskLevel);

    const threatAnalysis = RecoverySystem.analyzeOpponentThreats(gameState);
    metrics.threatLevel = threatAnalysis.threatLevel;
    
    metrics.recoveryOptions = RecoverySystem.generateRecoveryOptions(
      gameState,
      metrics.brokenPatterns,
      threatAnalysis
    );

    return metrics;
  },

  analyzePatternIntegrity: (gameState: GameState) => {
    const brokenPatterns = new Set<number>();
    let maxRiskLevel = RecoverySystem.RISK_LEVELS.LOW;

    EnhancedAIEngine.state.sabotageGames.forEach(game => {
      const boardAnalysis = WinningAnalyzer.evaluateBoardStrength(
        gameState.superBoard[game],
        gameState.currentPlayer!
      );

      const riskLevel = RecoverySystem.calculateRiskLevel(boardAnalysis);
      maxRiskLevel = Math.max(maxRiskLevel, riskLevel);

      if (riskLevel >= RecoverySystem.RISK_LEVELS.MEDIUM) {
        brokenPatterns.add(game);
      }
    });

    return { brokenPatterns, riskLevel: maxRiskLevel };
  },

  calculateRiskLevel: (boardAnalysis: BoardStrength) => {
    if (boardAnalysis.winningThreats >= 2) return RecoverySystem.RISK_LEVELS.CRITICAL;
    if (boardAnalysis.forkPotential > 0) return RecoverySystem.RISK_LEVELS.HIGH;
    if (boardAnalysis.winningThreats > 0) return RecoverySystem.RISK_LEVELS.MEDIUM;
    return RecoverySystem.RISK_LEVELS.LOW;
  },

  analyzeOpponentThreats: (gameState: GameState) => {
    const opponent = gameState.currentPlayer === 'X' ? 'O' : 'X';
    const threats: { gameIndex: number; threatLevel: number; type: string }[] = [];
    let maxThreatLevel = 0;

    gameState.superBoard.forEach((game, gameIndex) => {
      if (!gameState.gameOwnership[gameIndex]) {
        const opponentStrength = WinningAnalyzer.evaluateBoardStrength(game, opponent);
        
        if (opponentStrength.winningThreats > 0) {
          threats.push({
            gameIndex,
            threatLevel: opponentStrength.winningThreats * 2 + opponentStrength.forkPotential * 3,
            type: opponentStrength.forkPotential > 0 ? 'FORK' : 'DIRECT'
          });
          maxThreatLevel = Math.max(maxThreatLevel, threats[threats.length - 1].threatLevel);
        }
      }
    });

    return {
      threats: threats.sort((a, b) => b.threatLevel - a.threatLevel),
      threatLevel: maxThreatLevel
    };
  },

  generateRecoveryOptions: (gameState: GameState, brokenPatterns: Set<number>, threatAnalysis: { threats: { gameIndex: number }[], threatLevel: number }): RecoveryOption[] => {
    const options: RecoveryOption[] = [];
    
    if (brokenPatterns.size === 1) {
      options.push({
        type: 'PRESERVE',
        priority: 3,
        targetGames: new Set([...EnhancedAIEngine.state.sabotageGames]
          .filter(game => !brokenPatterns.has(game)))
      });
    }

    const alternativePattern = RecoverySystem.findAlternativePattern(gameState, brokenPatterns);
    if (alternativePattern) {
      options.push({
        type: 'TRANSITION',
        priority: 2,
        targetGames: new Set(alternativePattern)
      });
    }

    if (threatAnalysis.threats.length > 0) {
      options.push({
        type: 'MITIGATE',
        priority: threatAnalysis.threatLevel >= 3 ? 4 : 1,
        targetGames: new Set(threatAnalysis.threats.map((t) => t.gameIndex))
      });
    }

    return options.sort((a, b) => b.priority - a.priority);
  },

  findAlternativePattern: (gameState: GameState, brokenPatterns: Set<number>) => {
    const availableGames = Array.from({ length: 9 }, (_, i) => i)
      .filter(i => !brokenPatterns.has(i) && !gameState.gameOwnership[i]);

    return AI_CONFIG.PATTERNS.WIN_PATTERNS
      .filter(pattern => 
        pattern.every(game => availableGames.includes(game)) &&
        pattern.some(game => EnhancedAIEngine.state.sabotageGames.includes(game))
      )
      .sort((a, b) => 
        RecoverySystem.evaluatePatternStrength(gameState, b) -
        RecoverySystem.evaluatePatternStrength(gameState, a)
      )[0];
  },

  evaluatePatternStrength: (gameState: GameState, pattern: number[]) => {
    const gameStage = PhaseManager.getGameStage(gameState);
    const phaseMultiplier = AI_CONFIG.WEIGHTS.PHASE_MULTIPLIERS[gameStage];

    return pattern.reduce((strength, game) => {
      const gameStrength = WinningAnalyzer.evaluateBoardStrength(
        gameState.superBoard[game],
        gameState.currentPlayer!
      );

      let positionValue = 0;
      const dw = AI_CONFIG.DYNAMIC_WEIGHTS[gameStage];
      if (game === 4) positionValue = dw.CENTER_VALUE;
      else if ([0, 2, 6, 8].includes(game)) positionValue = dw.CORNER_VALUE;
      else positionValue = dw.EDGE_VALUE;

      return strength + 
        (gameStrength.winningThreats * AI_CONFIG.WEIGHTS.IMMEDIATE_WIN * 0.2 +
         gameStrength.forkPotential * AI_CONFIG.WEIGHTS.FORK_SETUP * 0.3 +
         positionValue) * phaseMultiplier;
    }, 0);
  },

  initializeRecovery: (gameState: GameState) => {
    const metrics = RecoverySystem.assessStrategyBreak(gameState);
    
    RecoverySystem.state = {
      recoveryState: metrics.brokenPatterns.size > 1 
        ? RecoverySystem.RECOVERY_STATES.FULL_BREAK
        : RecoverySystem.RECOVERY_STATES.PARTIAL_BREAK,
      brokenPatterns: metrics.brokenPatterns,
      riskLevel: metrics.riskLevel,
      recoveryAttempts: 0,
      lastValidPattern: null,
      alternativePatterns: metrics.recoveryOptions,
      recoveryStartTime: Date.now(),
      adaptationHistory: [],
      contingencyPlans: new Map<string, ContingencyPlan>()
    };

    metrics.recoveryOptions.forEach((option) => {
      RecoverySystem.state.contingencyPlans.set(
        option.type,
        RecoverySystem.generateContingencyPlan(gameState, option)
      );
    });
  },

  generateContingencyPlan: (gameState: GameState, option: RecoveryOption): ContingencyPlan => {
    switch (option.type) {
      case 'PRESERVE':
        return {
          primaryTargets: new Set(option.targetGames),
          backupMoves: RecoverySystem.findBackupMoves(gameState, option.targetGames),
          priority: option.priority
        };
      case 'TRANSITION':
        return {
          primaryTargets: new Set(option.targetGames),
          transitionMoves: RecoverySystem.findTransitionMoves(gameState, option.targetGames),
          priority: option.priority
        };
      case 'MITIGATE':
        return {
          primaryTargets: new Set(option.targetGames),
          blockingMoves: RecoverySystem.findBlockingMoves(gameState, option.targetGames),
          priority: option.priority
        };
      default:
        return { primaryTargets: new Set(), priority: 0 };
    }
  },

  findBackupMoves: (gameState: GameState, targetGames: Set<number>) => {
    const moves: StrategicMoveWithScore[] = [];
    targetGames.forEach(gameIndex => {
      const game = gameState.superBoard[gameIndex];
      const validSquares = game
        .map((cell, idx) => cell === null ? idx : -1)
        .filter(idx => idx !== -1);
      
      validSquares.forEach(square => {
        moves.push({
          game: gameIndex,
          cell: square,
          value: RecoverySystem.evaluateBackupMove(gameState, gameIndex, square)
        });
      });
    });
    return moves.sort((a, b) => b.value - a.value);
  },

  evaluateBackupMove: (gameState: GameState, gameIndex: number, square: number) => {
    const testBoard = [...gameState.superBoard[gameIndex]];
    testBoard[square] = gameState.currentPlayer!;
    return WinningAnalyzer.evaluateOffensivePotential(testBoard, gameState.currentPlayer!) +
      (square === 4 ? 200 : [0, 2, 6, 8].includes(square) ? 150 : 100);
  },

  findTransitionMoves: (gameState: GameState, targetGames: Set<number>) => {
    const moves: StrategicMoveWithStrength[] = [];
    targetGames.forEach(gameIndex => {
      if (!gameState.gameOwnership[gameIndex]) {
        const gameStrength = WinningAnalyzer.evaluateBoardStrength(
          gameState.superBoard[gameIndex],
          gameState.currentPlayer!
        );
        if (gameStrength.winningThreats > 0 || gameStrength.forkPotential > 0) {
          moves.push({ gameIndex, strength: gameStrength });
        }
      }
    });
    return moves.sort((a, b) => 
      (b.strength.winningThreats * 2 + b.strength.forkPotential * 3) -
      (a.strength.winningThreats * 2 + a.strength.forkPotential * 3)
    );
  },

  findBlockingMoves: (gameState: GameState, targetGames: Set<number>) => {
    const opponent = gameState.currentPlayer === 'X' ? 'O' : 'X';
    const moves: StrategicMoveWithPriority[] = [];

    targetGames.forEach(gameIndex => {
      const threats = WinningAnalyzer.analyzeThreats(gameState.superBoard[gameIndex], opponent);
      threats.forEach((threat: Threat) => {
        moves.push({
          game: gameIndex,
          cell: threat.position,
          priority: threat.type === 'FORK' ? 2 : 1
        });
      });
    });
    return moves.sort((a, b) => b.priority - a.priority);
  }
};

// --- Phase Manager ---

const PhaseManager = {
  PHASE_THRESHOLDS: {
    ENDGAME_GAMES_THRESHOLD: 6,
    SACRIFICE_GAMES_THRESHOLD: 4,
    CONTROL_GAMES_THRESHOLD: 2,
    ENDGAME_CONTROL_THRESHOLD: 7,
    SACRIFICE_CONTROL_THRESHOLD: 5,
    CONTROL_CONTROL_THRESHOLD: 3
  },

  state: {
    currentPhase: null as string | null,
    phaseHistory: [] as any[],
    strategicTargets: new Set<number>(),
    phaseStartTime: null as number | null
  },

  determinePhase: (gameState: GameState) => {
    const metrics = PhaseManager.calculatePhaseMetrics(gameState);
    if (metrics.isEndgame) return AI_CONFIG.PHASES.ENDGAME;
    if (metrics.shouldSacrifice) return AI_CONFIG.PHASES.SACRIFICE;
    if (metrics.needsControl) return AI_CONFIG.PHASES.CONTROL;
    return AI_CONFIG.PHASES.SABOTAGE;
  },

  calculatePhaseMetrics: (gameState: GameState) => {
    const filledGames = gameState.gameOwnership.filter(owner => owner !== null).length;
    const opponentControl = PhaseManager.calculateOpponentControl(gameState);
    const boardStrength = PhaseManager.evaluateBoardStrength(gameState);

    return {
      isEndgame: filledGames >= PhaseManager.PHASE_THRESHOLDS.ENDGAME_GAMES_THRESHOLD ||
        opponentControl >= PhaseManager.PHASE_THRESHOLDS.ENDGAME_CONTROL_THRESHOLD,
      shouldSacrifice: filledGames >= PhaseManager.PHASE_THRESHOLDS.SACRIFICE_GAMES_THRESHOLD ||
        opponentControl >= PhaseManager.PHASE_THRESHOLDS.SACRIFICE_CONTROL_THRESHOLD,
      needsControl: filledGames >= PhaseManager.PHASE_THRESHOLDS.CONTROL_GAMES_THRESHOLD ||
        opponentControl >= PhaseManager.PHASE_THRESHOLDS.CONTROL_CONTROL_THRESHOLD,
      boardStrength,
      opponentControl,
      filledGames
    };
  },

  calculateOpponentControl: (gameState: GameState) => {
    const opponent = gameState.currentPlayer === 'X' ? 'O' : 'X';
    let controlScore = 0;

    gameState.superBoard.forEach((game, index) => {
      if (!gameState.gameOwnership[index]) {
        const gameStrength = WinningAnalyzer.evaluateBoardStrength(game, opponent);
        if (gameStrength.winningThreats > 0) controlScore++;
        if (gameStrength.forkPotential > 0) controlScore += 2;
      }
    });

    return controlScore;
  },

  evaluateBoardStrength: (gameState: GameState) => {
    const player = gameState.currentPlayer!;
    let strength = 0;
    const gameStage = PhaseManager.getGameStage(gameState);
    const phaseMultiplier = AI_CONFIG.WEIGHTS.PHASE_MULTIPLIERS[gameStage];

    gameState.superBoard.forEach((game, index) => {
      if (!gameState.gameOwnership[index]) {
        const gameStrength = WinningAnalyzer.evaluateBoardStrength(game, player);
        strength += gameStrength.winningThreats * 
          AI_CONFIG.WEIGHTS.IMMEDIATE_WIN * 0.2 * phaseMultiplier;
        strength += gameStrength.forkPotential * 
          AI_CONFIG.WEIGHTS.FORK_SETUP * 0.3 * phaseMultiplier;

        const dw = AI_CONFIG.DYNAMIC_WEIGHTS[gameStage];
        if (index === 4) strength += dw.CENTER_VALUE;
        else if ([0, 2, 6, 8].includes(index)) strength += dw.CORNER_VALUE;
        else strength += dw.EDGE_VALUE;
      }
    });
    return strength;
  },

  phaseStrategies: {
    [AI_CONFIG.PHASES.SABOTAGE]: {
      initialize: (gameState: GameState) => {
        const firstMoveGame = EnhancedAIEngine.findFirstMove(gameState);
        if (firstMoveGame === null) return null;
        return PhaseManager.phaseStrategies[AI_CONFIG.PHASES.SABOTAGE]
          .selectSabotagePattern(gameState, firstMoveGame);
      },
      selectSabotagePattern: (gameState: GameState, excludeGame: number) => {
        const patterns = AI_CONFIG.PATTERNS.WIN_PATTERNS
          .filter(pattern => !pattern.includes(excludeGame))
          .map(pattern => ({
            pattern,
            value: PhaseManager.phaseStrategies[AI_CONFIG.PHASES.SABOTAGE]
              .evaluatePatternStrength(gameState, pattern)
          }))
          .sort((a, b) => b.value - a.value);
        return patterns[0]?.pattern || null;
      },
      evaluatePatternStrength: (gameState: GameState, pattern: number[]) => {
        let strength = 0;
        pattern.forEach(gameIndex => {
          if (gameIndex === 4) strength += 3;
          if ([0, 2, 6, 8].includes(gameIndex)) strength += 2;
          const gameStrength = WinningAnalyzer.evaluateBoardStrength(
            gameState.superBoard[gameIndex],
            gameState.currentPlayer!
          );
          strength += gameStrength.winningThreats;
          strength += gameStrength.forkPotential * 2;
        });
        return strength;
      },
      evaluateMove: (gameState: GameState, move: Move) => {
        let score = 0;
        const pattern = PhaseManager.state.strategicTargets;
        if (pattern && pattern.has(move.game)) {
          score += AI_CONFIG.WEIGHTS.MAINTAIN_SABOTAGE;
          if (move.cell === 4) score += 200;
          if ([0, 2, 6, 8].includes(move.cell)) score += 150;
        }
        return score;
      }
    },
    [AI_CONFIG.PHASES.CONTROL]: {
      initialize: (gameState: GameState) => {
        const metrics = PhaseManager.calculatePhaseMetrics(gameState);
        return {
          controlTargets: new Set(PhaseManager.phaseStrategies[AI_CONFIG.PHASES.CONTROL]
            .identifyControlTargets(gameState, metrics))
        };
      },
      identifyControlTargets: (gameState: GameState, _metrics: any) => {
        const targets: any[] = [];
        gameState.superBoard.forEach((game, index) => {
          if (!gameState.gameOwnership[index]) {
            const strength = WinningAnalyzer.evaluateBoardStrength(game, gameState.currentPlayer!);
            if (strength.winningThreats > 0 || strength.forkPotential > 0) {
              targets.push({ index, priority: strength.winningThreats * 2 + strength.forkPotential * 3 });
            }
          }
        });
        return targets.sort((a, b) => b.priority - a.priority).slice(0, 3).map(t => t.index);
      },
      evaluateMove: (gameState: GameState, move: Move) => {
        let score = 0;
        const controlTargets = PhaseManager.state.strategicTargets;
        if (controlTargets && controlTargets.has(move.game)) {
          score += AI_CONFIG.WEIGHTS.CONTROL_PATTERN;
          const nextGameStrength = WinningAnalyzer.evaluateBoardStrength(
            gameState.superBoard[move.cell],
            gameState.currentPlayer!
          );
          if (nextGameStrength.winningThreats > 0) score += 300;
        }
        return score;
      }
    },
    [AI_CONFIG.PHASES.SACRIFICE]: {
      initialize: (gameState: GameState) => {
        return {
          sacrificeTargets: new Set(PhaseManager.phaseStrategies[AI_CONFIG.PHASES.SACRIFICE]
            .selectSacrificeGames(gameState))
        };
      },
      selectSacrificeGames: (gameState: GameState) => {
        const candidates: any[] = [];
        gameState.superBoard.forEach((game, index) => {
          if (!gameState.gameOwnership[index]) {
            const strength = WinningAnalyzer.evaluateBoardStrength(game, gameState.currentPlayer!);
            candidates.push({ index, value: strength.winningThreats + strength.forkPotential * 2 });
          }
        });
        return candidates.sort((a, b) => a.value - b.value).slice(0, 2).map(c => c.index);
      },
      evaluateMove: (gameState: GameState, move: Move) => {
        let score = 0;
        const sacrificeTargets = PhaseManager.state.strategicTargets;
        if (sacrificeTargets && sacrificeTargets.has(move.game)) {
          score += AI_CONFIG.WEIGHTS.SACRIFICE_VALUE;
          const nextGameValue = PhaseManager.evaluateBoardStrength(gameState) - PhaseManager.calculateOpponentControl(gameState);
          if (nextGameValue > 0) score += nextGameValue * 100;
        }
        return score;
      }
    },
    [AI_CONFIG.PHASES.ENDGAME]: {
      initialize: (gameState: GameState) => {
        return {
          criticalGames: new Set(PhaseManager.phaseStrategies[AI_CONFIG.PHASES.ENDGAME]
            .identifyCriticalGames(gameState))
        };
      },
      identifyCriticalGames: (gameState: GameState) => {
        const critical = new Set<number>();
        AI_CONFIG.PATTERNS.WIN_PATTERNS.forEach(pattern => {
          const [a, b, c] = pattern;
          const ownership = [gameState.gameOwnership[a], gameState.gameOwnership[b], gameState.gameOwnership[c]];
          if (ownership.filter(owner => owner === gameState.currentPlayer).length === 2 && ownership.includes(null)) {
            pattern.forEach(idx => { if (!gameState.gameOwnership[idx]) critical.add(idx); });
          }
        });
        return Array.from(critical);
      },
      evaluateMove: (gameState: GameState, move: Move) => {
        let score = 0;
        const criticalGames = PhaseManager.state.strategicTargets;
        if (criticalGames && criticalGames.has(move.game)) {
          score += AI_CONFIG.WEIGHTS.IMMEDIATE_WIN * 2;
          if (WinningAnalyzer.isWinningBoard([...gameState.superBoard[move.game]], gameState.currentPlayer!)) {
            score += AI_CONFIG.WEIGHTS.IMMEDIATE_WIN * 3;
          }
        }
        return score;
      }
    }
  } as Record<string, any>,

  transitionToPhase: (newPhase: string, gameState: GameState) => {
    if (newPhase === PhaseManager.state.currentPhase) return;
    PatternCache.clearCache();
    PhaseManager.state.phaseHistory.push({
      from: PhaseManager.state.currentPhase,
      to: newPhase,
      timestamp: Date.now()
    });
    const phaseStrategy = PhaseManager.phaseStrategies[newPhase];
    if (phaseStrategy && phaseStrategy.initialize) {
      const strategyState = phaseStrategy.initialize(gameState);
      PhaseManager.state.strategicTargets = new Set(
        strategyState?.sacrificeTargets || strategyState?.controlTargets || strategyState?.criticalGames || (Array.isArray(strategyState) ? strategyState : [])
      );
    }
    PhaseManager.state.currentPhase = newPhase;
    PhaseManager.state.phaseStartTime = Date.now();
  },

  evaluatePhaseMove: (gameState: GameState, move: Move) => {
    const currentPhase = PhaseManager.state.currentPhase;
    if (!currentPhase) return 0;
    const phaseStrategy = PhaseManager.phaseStrategies[currentPhase];
    return phaseStrategy?.evaluateMove?.(gameState, move) || 0;
  },

  getGameStage: (gameState: GameState) => {
    const filledSquares = gameState.superBoard.reduce((count, game) => 
      count + game.filter(cell => cell !== null).length, 0);
    const progress = (filledSquares / 81) * 100;
    if (progress < 25) return 'EARLY_GAME';
    if (progress < 50) return 'MID_GAME';
    return 'LATE_GAME';
  },

  shouldTransition: (gameState: GameState) => {
    const metrics = PhaseManager.calculatePhaseMetrics(gameState);
    const currentPhase = PhaseManager.state.currentPhase;
    if (metrics.isEndgame && currentPhase !== AI_CONFIG.PHASES.ENDGAME) {
      return { shouldTransition: true, nextPhase: AI_CONFIG.PHASES.ENDGAME, trigger: 'ENDGAME_THRESHOLD' };
    }
    if (metrics.shouldSacrifice && currentPhase !== AI_CONFIG.PHASES.SACRIFICE && currentPhase !== AI_CONFIG.PHASES.ENDGAME) {
      return { shouldTransition: true, nextPhase: AI_CONFIG.PHASES.SACRIFICE, trigger: 'SACRIFICE_THRESHOLD' };
    }
    if (metrics.needsControl && currentPhase === AI_CONFIG.PHASES.SABOTAGE) {
      return { shouldTransition: true, nextPhase: AI_CONFIG.PHASES.CONTROL, trigger: 'CONTROL_THRESHOLD' };
    }
    return { shouldTransition: false, nextPhase: currentPhase, trigger: null };
  },

  handleTransition: (newPhase: string, trigger: string | null) => {
    const transition = { from: PhaseManager.state.currentPhase, to: newPhase, trigger, timestamp: Date.now() };
    PhaseManager.state.phaseHistory.push(transition);
    return transition;
  }
};

// --- Enhanced AI Engine (Main) ---

const EnhancedAIEngine = {
  CONFIG: AI_CONFIG,

  state: {
    phase: null as string | null,
    sabotageGames: [] as number[],
    forbiddenSquares: new Set<number>(),
    sacrificeGames: new Set<number>(),
    targetedGames: new Set<number>(),
    initialized: false
  },

  calculateCumulativeWeight: (baseWeight: number, gameState: GameState, move: Move, options: { includePosition?: boolean, includePattern?: boolean } = {}) => {
    const gameStage = PhaseManager.getGameStage(gameState);
    const phaseMultiplier = AI_CONFIG.WEIGHTS.PHASE_MULTIPLIERS[gameStage] || 1;
    let weight = baseWeight * phaseMultiplier;

    try {
      const dw = AI_CONFIG.DYNAMIC_WEIGHTS[gameStage];
      if (options.includePosition !== false) {
        if (move.cell === 4) weight += dw.CENTER_VALUE;
        else if ([0, 2, 6, 8].includes(move.cell)) weight += dw.CORNER_VALUE;
        else weight += dw.EDGE_VALUE;
      }
      if (options.includePattern !== false) {
        const patterns = StrategicPatternAnalyzer.analyzePatterns(gameState);
        if (patterns.size > 0) weight += StrategicPatternAnalyzer.WEIGHTS.PATTERN_COMPLETION * (patterns.size / 3);
      }
    } catch (error) {
      console.error("Error in weight calculation:", error);
      return baseWeight;
    }
    return weight;
  },

  getValidMoves: (gameState: GameState) => {
    const moves: Move[] = [];
    const { activeGame, superBoard } = gameState;
    if (activeGame !== null && superBoard[activeGame].some(cell => cell === null)) {
      superBoard[activeGame].forEach((cell, idx) => { if (cell === null) moves.push({ game: activeGame, cell: idx }); });
      return moves;
    }
    superBoard.forEach((game, gameIdx) => {
      game.forEach((cell, cellIdx) => { if (cell === null) moves.push({ game: gameIdx, cell: cellIdx }); });
    });
    return moves;
  },

  simulateMove: (gameState: GameState, move: Move) => {
    const newState: GameState = JSON.parse(JSON.stringify(gameState));
    newState.superBoard[move.game][move.cell] = newState.currentPlayer;
    
    // Check if move wins the local game
    const winResult = WinningAnalyzer.isWinningBoard(newState.superBoard[move.game], newState.currentPlayer!);
    if (winResult) {
      newState.gameOwnership[move.game] = newState.currentPlayer;
    }

    newState.currentPlayer = newState.currentPlayer === 'X' ? 'O' : 'X';
    newState.activeGame = (newState.superBoard[move.cell].some(c => c === null)) ? move.cell : null;
    return newState;
  },

  evaluatePosition: (gameState: GameState, maximizingPlayer: string) => {
    let score = 0;
    const player = maximizingPlayer;
    const opponent = player === 'X' ? 'O' : 'X';

    if (gameState.superWinner === player) return 1000000;
    if (gameState.superWinner === opponent) return -1000000;

    gameState.superBoard.forEach((game, idx) => {
      const pStrength = WinningAnalyzer.evaluateBoardStrength(game, player);
      const oStrength = WinningAnalyzer.evaluateBoardStrength(game, opponent);
      
      score += (pStrength.winningThreats * 100 - oStrength.winningThreats * 100);
      if (gameState.gameOwnership[idx] === player) score += 500;
      if (gameState.gameOwnership[idx] === opponent) score -= 500;
    });

    return score;
  },

  findFirstMove: (gameState: GameState) => {
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        if (gameState.superBoard[i][j] !== null) return i;
      }
    }
    return null;
  },

  evaluateMove: (gameState: GameState) => {
    try {
      PatternCache.clearCache();
      MinimaxOptimizer.clearCache();

      if (!EnhancedAIEngine.state.initialized) {
        PhaseManager.phaseStrategies[AI_CONFIG.PHASES.SABOTAGE].initialize(gameState);
        EnhancedAIEngine.state.initialized = true;
      }

      const phase = PhaseManager.determinePhase(gameState);
      PhaseManager.transitionToPhase(phase, gameState);

      return iterativeDeepening(gameState, 1000, gameState.currentPlayer!);
    } catch (error) {
      console.error('Critical AI error:', error);
      const valid = EnhancedAIEngine.getValidMoves(gameState);
      return valid.length > 0 ? valid[0] : null;
    }
  }
};

const enhancedMinimax = (gameState: GameState, depth: number, alpha: number, beta: number, isMaximizing: boolean, maximizingPlayer: string): { score: number; move: Move | null } => {
  const cached = MinimaxOptimizer.getCachedEvaluation(gameState, depth);
  if (cached) return { score: cached.score, move: cached.move };

  if (depth === 0 || gameState.superWinner) {
    return { score: EnhancedAIEngine.evaluatePosition(gameState, maximizingPlayer), move: null };
  }

  const validMoves = EnhancedAIEngine.getValidMoves(gameState);
  if (validMoves.length === 0) return { score: 0, move: null };

  const orderedMoves = MinimaxOptimizer.orderMoves(gameState, validMoves);
  let bestMove = null;
  let bestScore = isMaximizing ? -Infinity : Infinity;

  for (const move of orderedMoves) {
    const nextState = EnhancedAIEngine.simulateMove(gameState, move);
    const result = enhancedMinimax(nextState, depth - 1, alpha, beta, !isMaximizing, maximizingPlayer);

    if (isMaximizing) {
      if (result.score > bestScore) { bestScore = result.score; bestMove = move; }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (result.score < bestScore) { bestScore = result.score; bestMove = move; }
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha) break;
  }

  MinimaxOptimizer.cacheEvaluation(gameState, depth, bestScore, bestMove);
  return { score: bestScore, move: bestMove };
};

const iterativeDeepening = (gameState: GameState, timeLimit: number, maximizingPlayer: string) => {
  const startTime = Date.now();
  let bestMove = null;
  let currentDepth = 1;
  const validMoves = EnhancedAIEngine.getValidMoves(gameState);

  if (validMoves.length === 1) return validMoves[0];
  if (validMoves.length === 0) return null;

  while (Date.now() - startTime < timeLimit && currentDepth <= AI_CONFIG.MAX_DEPTH) {
    try {
      const result = enhancedMinimax(gameState, currentDepth, -Infinity, Infinity, true, maximizingPlayer);
      if (result.move) bestMove = result.move;
      currentDepth++;
    } catch (_error) { break; }
  }
  return bestMove || validMoves[0];
};

export const cleanupEngine = () => {
  PatternCache.clearCache();
  MinimaxOptimizer.clearCache();
};

export default EnhancedAIEngine;
