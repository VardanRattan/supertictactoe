"use client";

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
  previousGame?: number | null;
  gameHistory?: number[];
}

const WIN_MASKS = [
  0b000000111,
  0b000111000,
  0b111000000,
  0b001001001,
  0b010010010,
  0b100100100,
  0b100010001,
  0b001010100
];

const WIN_PATTERNS_ARRAY = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const IS_WIN = new Uint8Array(512);
const WIN_MOVE_MASK = new Uint16Array(512);
const THREAT_COUNT = new Uint8Array(512);
const FORK_MASK = new Uint16Array(512);

(() => {
  for (let mask = 0; mask < 512; mask++) {
    let won = false;
    for (const w of WIN_MASKS) {
      if ((mask & w) === w) {
        won = true;
        break;
      }
    }
    IS_WIN[mask] = won ? 1 : 0;
  }

  for (let mask = 0; mask < 512; mask++) {
    if (IS_WIN[mask]) continue;

    let winMoves = 0;
    let threats = 0;

    for (let c = 0; c < 9; c++) {
      if ((mask & (1 << c)) === 0) {
        const nextMask = mask | (1 << c);
        if (IS_WIN[nextMask]) {
          winMoves |= (1 << c);
          threats++;
        }
      }
    }

    WIN_MOVE_MASK[mask] = winMoves;
    THREAT_COUNT[mask] = threats;
  }

  for (let mask = 0; mask < 512; mask++) {
    if (IS_WIN[mask]) continue;
    let forkMoves = 0;

    for (let c = 0; c < 9; c++) {
      if ((mask & (1 << c)) === 0) {
        const nextMask = mask | (1 << c);
        if (!IS_WIN[nextMask] && THREAT_COUNT[nextMask] >= 2) {
          forkMoves |= (1 << c);
        }
      }
    }
    FORK_MASK[mask] = forkMoves;
  }
})();

export type GamePhase = 'SABOTAGE' | 'CONTROL' | 'SACRIFICE' | 'ENDGAME';
export type ContingencyType = 'PRESERVE' | 'TRANSITION' | 'MITIGATE';

export interface BotWeights {
  macro2InLine: number;
  macro1InLine: number;
  boardOwned: number;
  targetBoardBonus: number;
  macroForkBonus: number;
  criticalBlockPenalty: number;
  myLocalThreat: number;
  oppLocalThreat: number;
  localFork: number;
  drawBlockerReward: number;
  centerBoardControl: number;
  diagonalDominance: number;
  antiSuicidePenalty: number;
}

export const DEFAULT_BOT_WEIGHTS: BotWeights = {
  macro2InLine: 3500,
  macro1InLine: 800,
  boardOwned: 1200,
  targetBoardBonus: 900,
  macroForkBonus: 1500,
  criticalBlockPenalty: 1400,
  myLocalThreat: 180,
  oppLocalThreat: 220,
  localFork: 300,
  drawBlockerReward: 1000,
  centerBoardControl: 400,
  diagonalDominance: 500,
  antiSuicidePenalty: 750,
};

let activeWeights: BotWeights = { ...DEFAULT_BOT_WEIGHTS };

export const setBotWeights = (w: Partial<BotWeights>) => {
  activeWeights = { ...activeWeights, ...w };
};

export const getBotWeights = (): BotWeights => ({ ...activeWeights });

export interface StrategicContext {
  phase: GamePhase;
  contingencyType: ContingencyType;
  riskLevel: number;
  targetBoardsMask: number;
  macroForkBoardsMask: number;
  criticalBlockBoardsMask: number;
  sacrificeBoardsMask: number;
  primaryWinningLine: number[];
  phaseWeightMultiplier: number;
}

interface PersistentBotState {
  currentPhase: GamePhase;
  primaryLine: number[] | null;
  phaseHistory: { from: GamePhase; to: GamePhase; timestamp: number }[];
  lastBreakTimestamp: number | null;
}

const botState: PersistentBotState = {
  currentPhase: 'SABOTAGE',
  primaryLine: null,
  phaseHistory: [],
  lastBreakTimestamp: null
};

const StrategicPatternAnalyzer = {
  findMacroForkBoards: (ownershipMe: number, ownershipOpp: number): number => {
    let forkBoards = 0;
    const viableLines: number[] = [];

    for (let i = 0; i < WIN_MASKS.length; i++) {
      const line = WIN_MASKS[i];
      if ((line & ownershipOpp) === 0) {
        viableLines.push(line);
      }
    }

    for (let i = 0; i < viableLines.length; i++) {
      for (let j = i + 1; j < viableLines.length; j++) {
        const shared = (viableLines[i] & viableLines[j]) & ~ownershipMe;
        if (shared !== 0) {
          forkBoards |= shared;
        }
      }
    }

    return forkBoards;
  },

  selectBestSuperLine: (ownershipMe: number, ownershipOpp: number, preferredBoard?: number | null): number[] => {
    let bestLine = WIN_PATTERNS_ARRAY[0];
    let bestScore = -Infinity;
    let fallbackLine = WIN_PATTERNS_ARRAY[0];
    let fallbackScore = -Infinity;

    for (const line of WIN_PATTERNS_ARRAY) {
      let myCount = 0;
      let oppCount = 0;

      for (const b of line) {
        if ((ownershipMe & (1 << b)) !== 0) myCount++;
        if ((ownershipOpp & (1 << b)) !== 0) oppCount++;
      }

      const fScore = myCount * 100 - oppCount * 120;
      if (fScore > fallbackScore) {
        fallbackScore = fScore;
        fallbackLine = line;
      }

      if (oppCount > 0) continue;

      let score = myCount * 300;
      if (line.includes(4)) score += 150;
      if (preferredBoard !== undefined && preferredBoard !== null && line.includes(preferredBoard)) {
        score += 200;
      }

      if (score > bestScore) {
        bestScore = score;
        bestLine = line;
      }
    }

    return bestScore > -Infinity ? bestLine : fallbackLine;
  }
};

const RecoverySystem = {
  assessStrategyBreak: (
    primaryLine: number[] | null,
    ownershipMe: number,
    ownershipOpp: number
  ): { riskLevel: number; isBroken: boolean; opponentThreatMask: number } => {
    let opponentThreatMask = 0;
    let maxOppThreatCount = 0;

    for (const line of WIN_PATTERNS_ARRAY) {
      let oppCount = 0;
      let emptyIdx = -1;

      for (const b of line) {
        if ((ownershipOpp & (1 << b)) !== 0) oppCount++;
        else if ((ownershipMe & (1 << b)) === 0) emptyIdx = b;
      }

      if (oppCount === 2 && emptyIdx !== -1) {
        opponentThreatMask |= (1 << emptyIdx);
        maxOppThreatCount++;
      }
    }

    let isBroken = false;
    if (primaryLine) {
      for (const b of primaryLine) {
        if ((ownershipOpp & (1 << b)) !== 0) {
          isBroken = true;
          break;
        }
      }
    } else {
      isBroken = true;
    }

    let riskLevel = 1;
    if (maxOppThreatCount >= 2) riskLevel = 4;
    else if (maxOppThreatCount === 1) riskLevel = 3;
    else if (isBroken) riskLevel = 2;

    return { riskLevel, isBroken, opponentThreatMask };
  },

  planContingency: (
    isBroken: boolean,
    riskLevel: number,
    primaryLine: number[] | null,
    ownershipMe: number,
    ownershipOpp: number,
    lastMoveGame?: number | null
  ): { contingencyType: ContingencyType; activeLine: number[] } => {
    if (riskLevel >= 3) {
      const activeLine = primaryLine || StrategicPatternAnalyzer.selectBestSuperLine(ownershipMe, ownershipOpp);
      return { contingencyType: 'MITIGATE', activeLine };
    }

    if (isBroken || !primaryLine) {
      const newLine = StrategicPatternAnalyzer.selectBestSuperLine(ownershipMe, ownershipOpp, lastMoveGame);
      return { contingencyType: 'TRANSITION', activeLine: newLine };
    }

    return { contingencyType: 'PRESERVE', activeLine: primaryLine };
  }
};

const PhaseManager = {
  determinePhase: (
    filledBoardsCount: number,
    riskLevel: number,
    ownershipMe: number,
    ownershipOpp: number
  ): GamePhase => {
    let nearEndgame = false;
    for (const line of WIN_PATTERNS_ARRAY) {
      let myC = 0, oppC = 0, nullC = 0;
      for (const b of line) {
        if ((ownershipMe & (1 << b)) !== 0) myC++;
        else if ((ownershipOpp & (1 << b)) !== 0) oppC++;
        else nullC++;
      }
      if ((myC === 2 && nullC === 1) || (oppC === 2 && nullC === 1)) {
        nearEndgame = true;
        break;
      }
    }

    if (nearEndgame || filledBoardsCount >= 6) return 'ENDGAME';
    if (riskLevel >= 3 || filledBoardsCount >= 4) return 'SACRIFICE';
    if (filledBoardsCount >= 2) return 'CONTROL';
    return 'SABOTAGE';
  },

  identifySacrificeBoards: (
    activeLine: number[],
    ownershipMe: number,
    ownershipOpp: number,
    occupiedBoards: number[]
  ): number => {
    let sacrificeMask = 0;
    for (let b = 0; b < 9; b++) {
      if (!activeLine.includes(b) && (ownershipMe & (1 << b)) === 0 && (ownershipOpp & (1 << b)) === 0) {
        if (occupiedBoards[b] !== 0x1FF) {
          sacrificeMask |= (1 << b);
        }
      }
    }
    return sacrificeMask;
  }
};

function compileStrategicContext(
  ownershipMe: number,
  ownershipOpp: number,
  occupiedBoards: number[],
  lastMoveGame: number | null
): StrategicContext {
  let filledBoardsCount = 0;
  for (let i = 0; i < 9; i++) {
    if ((ownershipMe & (1 << i)) !== 0 || (ownershipOpp & (1 << i)) !== 0 || occupiedBoards[i] === 0x1FF) {
      filledBoardsCount++;
    }
  }

  const assessment = RecoverySystem.assessStrategyBreak(botState.primaryLine, ownershipMe, ownershipOpp);
  const contingency = RecoverySystem.planContingency(
    assessment.isBroken,
    assessment.riskLevel,
    botState.primaryLine,
    ownershipMe,
    ownershipOpp,
    lastMoveGame
  );

  botState.primaryLine = contingency.activeLine;

  const phase = PhaseManager.determinePhase(
    filledBoardsCount,
    assessment.riskLevel,
    ownershipMe,
    ownershipOpp
  );

  if (phase !== botState.currentPhase) {
    botState.phaseHistory.push({ from: botState.currentPhase, to: phase, timestamp: Date.now() });
    botState.currentPhase = phase;
  }

  const macroForkBoardsMask = StrategicPatternAnalyzer.findMacroForkBoards(ownershipMe, ownershipOpp);

  let targetBoardsMask = 0;
  for (const b of contingency.activeLine) {
    if ((ownershipMe & (1 << b)) === 0 && (ownershipOpp & (1 << b)) === 0) {
      targetBoardsMask |= (1 << b);
    }
  }

  const sacrificeBoardsMask = phase === 'SACRIFICE' 
    ? PhaseManager.identifySacrificeBoards(contingency.activeLine, ownershipMe, ownershipOpp, occupiedBoards)
    : 0;

  const phaseWeightMultiplier = phase === 'ENDGAME' ? 2.5 :
    phase === 'SACRIFICE' ? 1.8 :
    phase === 'CONTROL' ? 1.4 : 1.1;

  return {
    phase,
    contingencyType: contingency.contingencyType,
    riskLevel: assessment.riskLevel,
    targetBoardsMask,
    macroForkBoardsMask,
    criticalBlockBoardsMask: assessment.opponentThreatMask,
    sacrificeBoardsMask,
    primaryWinningLine: contingency.activeLine,
    phaseWeightMultiplier
  };
}

export class FastBoardState {
  boardsMe: Uint16Array;
  boardsOpp: Uint16Array;
  occupied: Uint16Array;
  ownershipMe: number;
  ownershipOpp: number;
  activeGame: number | null;
  history: number[];

  constructor() {
    this.boardsMe = new Uint16Array(9);
    this.boardsOpp = new Uint16Array(9);
    this.occupied = new Uint16Array(9);
    this.ownershipMe = 0;
    this.ownershipOpp = 0;
    this.activeGame = null;
    this.history = [];
  }

  swapPerspective(): void {
    const tmpB = this.boardsMe;
    this.boardsMe = this.boardsOpp;
    this.boardsOpp = tmpB;

    const tmpO = this.ownershipMe;
    this.ownershipMe = this.ownershipOpp;
    this.ownershipOpp = tmpO;
  }

  static fromGameState(gameState: GameState, myPlayer: string): FastBoardState {
    const state = new FastBoardState();
    const oppPlayer = myPlayer === 'X' ? 'O' : 'X';

    for (let g = 0; g < 9; g++) {
      let maskMe = 0;
      let maskOpp = 0;
      const subBoard = gameState.superBoard[g];

      for (let c = 0; c < 9; c++) {
        const val = subBoard[c];
        if (val === myPlayer) maskMe |= (1 << c);
        else if (val === oppPlayer) maskOpp |= (1 << c);
      }

      state.boardsMe[g] = maskMe;
      state.boardsOpp[g] = maskOpp;
      state.occupied[g] = maskMe | maskOpp;

      const owner = gameState.gameOwnership[g];
      if (owner === myPlayer) state.ownershipMe |= (1 << g);
      else if (owner === oppPlayer) state.ownershipOpp |= (1 << g);
    }

    state.activeGame = gameState.activeGame;
    state.history = gameState.gameHistory ? [...gameState.gameHistory] : [];
    return state;
  }

  findValidGame(targetGame: number | null, fallbackGame: number | null): number | null {
    const isGamePlayable = (idx: number | null): boolean => {
      if (idx === null || idx < 0 || idx > 8) return false;
      return this.occupied[idx] !== 0x1FF;
    };

    if (targetGame !== null && isGamePlayable(targetGame)) {
      return targetGame;
    }

    if (fallbackGame !== null && isGamePlayable(fallbackGame)) {
      return fallbackGame;
    }

    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i];
      if (isGamePlayable(h)) return h;
    }

    for (let i = 0; i < 9; i++) {
      if (isGamePlayable(i)) return i;
    }

    return null;
  }

  getValidMoves(): number[] {
    const moves: number[] = [];
    const active = this.activeGame;

    if (active !== null && this.occupied[active] !== 0x1FF) {
      const occ = this.occupied[active];
      for (let c = 0; c < 9; c++) {
        if ((occ & (1 << c)) === 0) {
          moves.push((active << 4) | c);
        }
      }
      return moves;
    }

    for (let g = 0; g < 9; g++) {
      if (this.occupied[g] !== 0x1FF) {
        const occ = this.occupied[g];
        for (let c = 0; c < 9; c++) {
          if ((occ & (1 << c)) === 0) {
            moves.push((g << 4) | c);
          }
        }
      }
    }

    return moves;
  }

  makeMove(move: number, isMe: boolean): {
    move: number;
    prevActive: number | null;
    prevOwnershipMe: number;
    prevOwnershipOpp: number;
    superWon: boolean;
  } {
    const g = move >> 4;
    const c = move & 0xF;
    const bit = 1 << c;

    const prevActive = this.activeGame;
    const prevOwnershipMe = this.ownershipMe;
    const prevOwnershipOpp = this.ownershipOpp;

    if (isMe) {
      this.boardsMe[g] |= bit;
      this.occupied[g] |= bit;
      if ((this.ownershipMe & (1 << g)) === 0 && (this.ownershipOpp & (1 << g)) === 0) {
        if (IS_WIN[this.boardsMe[g]]) {
          this.ownershipMe |= (1 << g);
        }
      }
    } else {
      this.boardsOpp[g] |= bit;
      this.occupied[g] |= bit;
      if ((this.ownershipMe & (1 << g)) === 0 && (this.ownershipOpp & (1 << g)) === 0) {
        if (IS_WIN[this.boardsOpp[g]]) {
          this.ownershipOpp |= (1 << g);
        }
      }
    }

    this.history.push(g);

    const superWon = IS_WIN[this.ownershipMe] === 1 || IS_WIN[this.ownershipOpp] === 1;

    if (!superWon) {
      this.activeGame = this.findValidGame(c, g);
    } else {
      this.activeGame = null;
    }

    return { move, prevActive, prevOwnershipMe, prevOwnershipOpp, superWon };
  }

  unmakeMove(token: {
    move: number;
    prevActive: number | null;
    prevOwnershipMe: number;
    prevOwnershipOpp: number;
  }, isMe: boolean) {
    const g = token.move >> 4;
    const c = token.move & 0xF;
    const mask = ~(1 << c);

    if (isMe) {
      this.boardsMe[g] &= mask;
    } else {
      this.boardsOpp[g] &= mask;
    }
    this.occupied[g] = this.boardsMe[g] | this.boardsOpp[g];
    this.ownershipMe = token.prevOwnershipMe;
    this.ownershipOpp = token.prevOwnershipOpp;
    this.activeGame = token.prevActive;
    this.history.pop();
  }
}

function evaluatePosition(state: FastBoardState, context: StrategicContext, weights: BotWeights = activeWeights): number {
  if (IS_WIN[state.ownershipMe]) return 1000000;
  if (IS_WIN[state.ownershipOpp]) return -1000000;

  let score = 0;

  const myOwnership = state.ownershipMe;
  const oppOwnership = state.ownershipOpp;

  for (const line of WIN_MASKS) {
    const myCount = (line & myOwnership) !== 0 ? ((line & myOwnership) & ((line & myOwnership) - 1) ? 2 : 1) : 0;
    const oppCount = (line & oppOwnership) !== 0 ? ((line & oppOwnership) & ((line & oppOwnership) - 1) ? 2 : 1) : 0;

    if (myCount > 0 && oppCount === 0) {
      score += myCount === 2 ? weights.macro2InLine : weights.macro1InLine;
    } else if (oppCount > 0 && myCount === 0) {
      score -= oppCount === 2 ? weights.macro2InLine : weights.macro1InLine;
    }
  }

  for (let g = 0; g < 9; g++) {
    const bit = 1 << g;
    const isOwnedByMe = (myOwnership & bit) !== 0;
    const isOwnedByOpp = (oppOwnership & bit) !== 0;

    if (isOwnedByMe) {
      score += weights.boardOwned;
      if ((context.targetBoardsMask & bit) !== 0) score += weights.targetBoardBonus;
      if ((context.macroForkBoardsMask & bit) !== 0) score += weights.macroForkBonus;
    } else if (isOwnedByOpp) {
      score -= weights.boardOwned;
      if ((context.criticalBlockBoardsMask & bit) !== 0) score -= weights.criticalBlockPenalty;
    } else {
      const myThreats = THREAT_COUNT[state.boardsMe[g]];
      const oppThreats = THREAT_COUNT[state.boardsOpp[g]];
      score += (myThreats * weights.myLocalThreat - oppThreats * weights.oppLocalThreat);

      const myForks = FORK_MASK[state.boardsMe[g]];
      if (myForks !== 0) score += weights.localFork;

      if (state.occupied[g] === 0x1FF) {
        if ((context.criticalBlockBoardsMask & bit) !== 0) {
          score += weights.drawBlockerReward;
        }
      }
    }
  }

  if ((myOwnership & (1 << 4)) !== 0) score += weights.centerBoardControl;
  if ((oppOwnership & (1 << 4)) !== 0) score -= weights.centerBoardControl;

  const myDiag1 = myOwnership & 0b100010001;
  const myDiag2 = myOwnership & 0b001010100;
  if ((myDiag1 & (myDiag1 - 1)) !== 0) score += weights.diagonalDominance;
  else if (myDiag1 !== 0) score += weights.diagonalDominance * 0.4;
  if ((myDiag2 & (myDiag2 - 1)) !== 0) score += weights.diagonalDominance;
  else if (myDiag2 !== 0) score += weights.diagonalDominance * 0.4;

  const oppDiag1 = oppOwnership & 0b100010001;
  const oppDiag2 = oppOwnership & 0b001010100;
  if ((oppDiag1 & (oppDiag1 - 1)) !== 0) score -= weights.diagonalDominance;
  else if (oppDiag1 !== 0) score -= weights.diagonalDominance * 0.4;
  if ((oppDiag2 & (oppDiag2 - 1)) !== 0) score -= weights.diagonalDominance;
  else if (oppDiag2 !== 0) score -= weights.diagonalDominance * 0.4;

  if (state.activeGame !== null) {
    const dest = state.activeGame;
    if ((myOwnership & (1 << dest)) === 0 && (oppOwnership & (1 << dest)) === 0) {
      const oppThreats = THREAT_COUNT[state.boardsOpp[dest]];
      if (oppThreats > 0) {
        score -= weights.antiSuicidePenalty;
      }
    }
  }

  return score * context.phaseWeightMultiplier;
}

const TT_SIZE = 131072;
const TT_FLAG_EXACT = 0;
const TT_FLAG_LOWER = 1;
const TT_FLAG_UPPER = 2;

interface TTEntry {
  hashKey: number;
  depth: number;
  score: number;
  flag: number;
  bestMove: number | null;
}

const transpositionTable: (TTEntry | null)[] = new Array(TT_SIZE).fill(null);
const killerMoves: number[][] = Array.from({ length: 20 }, () => [0, 0]);
const historyHeuristic = new Int32Array(144);

function computeHash(state: FastBoardState, isMe: boolean): number {
  let h = isMe ? 0x811c9dc5 : 0x9e3779b9;
  for (let g = 0; g < 9; g++) {
    h = Math.imul(h ^ state.boardsMe[g], 0xcc9e2d51);
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h ^ state.boardsOpp[g], 0x1b873593);
    h = (h << 15) | (h >>> 17);
  }
  h = Math.imul(h ^ (state.activeGame ?? 15), 0x85ebca6b);
  return h >>> 0;
}

function scoreMove(
  move: number,
  state: FastBoardState,
  depth: number,
  ttBestMove: number | null,
  context: StrategicContext
): number {
  if (move === ttBestMove) return 2000000;
  let score = 0;

  if (killerMoves[depth]) {
    if (killerMoves[depth][0] === move) score += 500000;
    else if (killerMoves[depth][1] === move) score += 400000;
  }

  const g = move >> 4;
  const c = move & 0xF;
  const bit = 1 << c;

  if ((WIN_MOVE_MASK[state.boardsMe[g]] & bit) !== 0) score += 200000;
  if ((WIN_MOVE_MASK[state.boardsOpp[g]] & bit) !== 0) score += 150000;

  if ((context.targetBoardsMask & (1 << g)) !== 0) score += 50000;
  if ((context.macroForkBoardsMask & (1 << g)) !== 0) score += 40000;

  if (c === 4) score += 10000;
  else if (c === 0 || c === 2 || c === 6 || c === 8) score += 5000;

  score += historyHeuristic[move];
  return score;
}

function orderMoves(
  moves: number[],
  state: FastBoardState,
  depth: number,
  ttBestMove: number | null,
  context: StrategicContext
): number[] {
  const scores = moves.map(m => scoreMove(m, state, depth, ttBestMove, context));
  const indices = moves.map((_, i) => i);
  indices.sort((i, j) => scores[j] - scores[i]);
  return indices.map(i => moves[i]);
}

let searchDeadline = 0;

function alphaBeta(
  state: FastBoardState,
  depth: number,
  alpha: number,
  beta: number,
  isMe: boolean,
  context: StrategicContext,
  weights: BotWeights = activeWeights
): { score: number; bestMove: number | null } {
  if (Date.now() > searchDeadline) {
    throw new Error("SearchTimeout");
  }

  if (IS_WIN[state.ownershipMe]) return { score: 1000000 + depth, bestMove: null };
  if (IS_WIN[state.ownershipOpp]) return { score: -1000000 - depth, bestMove: null };

  if (depth <= 0) {
    return { score: evaluatePosition(state, context, weights), bestMove: null };
  }

  const hashKey = computeHash(state, isMe);
  const ttIndex = hashKey & (TT_SIZE - 1);
  const ttEntry = transpositionTable[ttIndex];

  if (ttEntry && ttEntry.hashKey === hashKey && ttEntry.depth >= depth) {
    if (ttEntry.flag === TT_FLAG_EXACT) return { score: ttEntry.score, bestMove: ttEntry.bestMove };
    if (ttEntry.flag === TT_FLAG_LOWER && ttEntry.score >= beta) return { score: ttEntry.score, bestMove: ttEntry.bestMove };
    if (ttEntry.flag === TT_FLAG_UPPER && ttEntry.score <= alpha) return { score: ttEntry.score, bestMove: ttEntry.bestMove };
  }

  const validMoves = state.getValidMoves();
  if (validMoves.length === 0) {
    return { score: 0, bestMove: null };
  }

  const sortedMoves = orderMoves(validMoves, state, depth, ttEntry?.bestMove ?? null, context);

  let bestScore = isMe ? -Infinity : Infinity;
  let bestMove: number | null = sortedMoves[0];
  const originalAlpha = alpha;

  for (const move of sortedMoves) {
    const token = state.makeMove(move, isMe);
    let resultScore: number;

    try {
      const child = alphaBeta(state, depth - 1, alpha, beta, !isMe, context, weights);
      resultScore = child.score;
    } finally {
      state.unmakeMove(token, isMe);
    }

    if (isMe) {
      if (resultScore > bestScore) {
        bestScore = resultScore;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestScore);
    } else {
      if (resultScore < bestScore) {
        bestScore = resultScore;
        bestMove = move;
      }
      beta = Math.min(beta, bestScore);
    }

    if (beta <= alpha) {
      if (killerMoves[depth]) {
        killerMoves[depth][1] = killerMoves[depth][0];
        killerMoves[depth][0] = move;
      }
      historyHeuristic[move] += depth * depth;
      break;
    }
  }

  let flag = TT_FLAG_EXACT;
  if (isMe) {
    if (bestScore <= originalAlpha) flag = TT_FLAG_UPPER;
    else if (bestScore >= beta) flag = TT_FLAG_LOWER;
  } else {
    if (bestScore >= beta) flag = TT_FLAG_LOWER;
    else if (bestScore <= alpha) flag = TT_FLAG_UPPER;
  }

  transpositionTable[ttIndex] = {
    hashKey,
    depth,
    score: bestScore,
    flag,
    bestMove
  };

  return { score: bestScore, bestMove };
}

const EnhancedAIEngine = {
  getValidMoves: (gameState: GameState): Move[] => {
    const moves: Move[] = [];
    const { activeGame, superBoard } = gameState;

    if (activeGame !== null && superBoard[activeGame].some(c => c === null)) {
      superBoard[activeGame].forEach((c, idx) => {
        if (c === null) moves.push({ game: activeGame, cell: idx });
      });
      return moves;
    }

    superBoard.forEach((game, gameIdx) => {
      if (game.some(c => c === null)) {
        game.forEach((cell, cellIdx) => {
          if (cell === null) moves.push({ game: gameIdx, cell: cellIdx });
        });
      }
    });

    return moves;
  },

  evaluateMove: (
    gameState: GameState,
    customWeights?: BotWeights,
    maxTimeMs: number = 750,
    overrideMaxDepth?: number
  ): Move | null => {
    try {
      const myPlayer = gameState.currentPlayer || 'O';
      const state = FastBoardState.fromGameState(gameState, myPlayer);
      const validMoves = state.getValidMoves();

      if (validMoves.length === 0) return null;
      if (validMoves.length === 1) {
        return { game: validMoves[0] >> 4, cell: validMoves[0] & 0xF };
      }

      const weights = customWeights || activeWeights;
      const lastMoveGame = gameState.lastMove ? gameState.lastMove.game : null;
      const occupiedArray = Array.from(state.occupied);
      const context = compileStrategicContext(
        state.ownershipMe,
        state.ownershipOpp,
        occupiedArray,
        lastMoveGame
      );

      for (let i = 0; i < 144; i++) historyHeuristic[i] >>= 1;

      searchDeadline = Date.now() + maxTimeMs;

      let bestPackedMove = validMoves[0];
      const maxDepth = overrideMaxDepth ?? (context.phase === 'ENDGAME' ? 10 : 8);

      for (let depth = 1; depth <= maxDepth; depth++) {
        try {
          const result = alphaBeta(state, depth, -Infinity, Infinity, true, context, weights);
          if (result.bestMove !== null) {
            bestPackedMove = result.bestMove;
          }
          if (result.score >= 900000) break;
        } catch (e: unknown) {
          if (e instanceof Error && e.message === "SearchTimeout") {
            break;
          }
          throw e;
        }
      }

      return {
        game: bestPackedMove >> 4,
        cell: bestPackedMove & 0xF
      };
    } catch (err) {
      console.error("Critical AI error:", err);
      const fallback = EnhancedAIEngine.getValidMoves(gameState);
      return fallback.length > 0 ? fallback[0] : null;
    }
  }
};

export function evaluateFastMove(
  state: FastBoardState,
  weights: BotWeights = activeWeights,
  maxTimeMs: number = 10,
  maxDepthOverride?: number,
  lastMoveGame: number | null = null
): number | null {
  const validMoves = state.getValidMoves();
  if (validMoves.length === 0) return null;
  if (validMoves.length === 1) return validMoves[0];

  const occupiedArray = Array.from(state.occupied);
  const context = compileStrategicContext(
    state.ownershipMe,
    state.ownershipOpp,
    occupiedArray,
    lastMoveGame
  );

  for (let i = 0; i < 144; i++) historyHeuristic[i] >>= 1;

  searchDeadline = Date.now() + maxTimeMs;
  let bestPackedMove = validMoves[0];
  const maxDepth = maxDepthOverride ?? (context.phase === 'ENDGAME' ? 8 : 5);

  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const result = alphaBeta(state, depth, -Infinity, Infinity, true, context, weights);
      if (result.bestMove !== null) {
        bestPackedMove = result.bestMove;
      }
      if (result.score >= 900000) break;
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "SearchTimeout") {
        break;
      }
      throw e;
    }
  }

  return bestPackedMove;
}

export const cleanupEngine = () => {
  transpositionTable.fill(null);
  killerMoves.forEach(k => { k[0] = 0; k[1] = 0; });
  historyHeuristic.fill(0);
  botState.currentPhase = 'SABOTAGE';
  botState.primaryLine = null;
  botState.phaseHistory = [];
};

export default EnhancedAIEngine;
