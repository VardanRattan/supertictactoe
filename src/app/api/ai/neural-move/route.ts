import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import * as ort from 'onnxruntime-node';

let cachedSession: ort.InferenceSession | null = null;
let lastMtime: number = 0;

async function getSession(): Promise<ort.InferenceSession> {
  const modelPath = path.join(process.cwd(), 'public', 'models', 'supertictactoe_alphazero.onnx');
  const stat = fs.statSync(modelPath);
  if (!cachedSession || stat.mtimeMs !== lastMtime) {
    const buffer = fs.readFileSync(modelPath);
    cachedSession = await ort.InferenceSession.create(buffer);
    lastMtime = stat.mtimeMs;
  }
  return cachedSession;
}

interface MoveRequest {
  superBoard: (string | null)[][];
  gameOwnership: (string | null)[];
  activeGame: number | null;
  myPlayer: 'X' | 'O';
}

function encodeBoard(
  superBoard: (string | null)[][],
  gameOwnership: (string | null)[],
  activeGame: number | null,
  myPlayer: 'X' | 'O'
) {
  const oppPlayer = myPlayer === 'X' ? 'O' : 'X';
  const tensor = new Float32Array(6 * 9 * 9);
  const legal = new Array(81).fill(false);

  if (activeGame !== null && superBoard[activeGame].some(c => c === null)) {
    for (let c = 0; c < 9; c++) {
      if (superBoard[activeGame][c] === null) legal[activeGame * 9 + c] = true;
    }
  } else {
    for (let g = 0; g < 9; g++) {
      if (superBoard[g].some(c => c === null)) {
        for (let c = 0; c < 9; c++) {
          if (superBoard[g][c] === null) legal[g * 9 + c] = true;
        }
      }
    }
  }

  for (let g = 0; g < 9; g++) {
    const brow = Math.floor(g / 3) * 3;
    const bcol = (g % 3) * 3;

    for (let c = 0; c < 9; c++) {
      const r = brow + Math.floor(c / 3);
      const col = bcol + (c % 3);
      const idx = r * 9 + col;

      const val = superBoard[g][c];
      if (val === myPlayer) tensor[0 * 81 + idx] = 1.0;
      else if (val === oppPlayer) tensor[1 * 81 + idx] = 1.0;

      if (legal[g * 9 + c]) tensor[4 * 81 + idx] = 1.0;

      if (activeGame === null || activeGame === g) {
        tensor[5 * 81 + idx] = 1.0;
      }
    }

    const owner = gameOwnership[g];
    if (owner === myPlayer || owner === oppPlayer) {
      const ch = owner === myPlayer ? 2 : 3;
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          const idx = (brow + dr) * 9 + (bcol + dc);
          tensor[ch * 81 + idx] = 1.0;
        }
      }
    }
  }

  return { tensor, legal };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MoveRequest;
    const { superBoard, gameOwnership, activeGame, myPlayer } = body;

    const session = await getSession();
    const { tensor, legal } = encodeBoard(superBoard, gameOwnership, activeGame, myPlayer);

    const inputTensor = new ort.Tensor('float32', tensor, [1, 6, 9, 9]);
    const results = await session.run({ input: inputTensor });

    const logits = results.policy_logits.data as Float32Array;
    const value = (results.value.data as Float32Array)[0];

    let bestAction = -1;
    let bestScore = -Infinity;
    for (let a = 0; a < 81; a++) {
      if (legal[a] && logits[a] > bestScore) {
        bestScore = logits[a];
        bestAction = a;
      }
    }

    if (bestAction === -1) {
      return NextResponse.json({ move: null, value: 0 });
    }

    const move = {
      game: Math.floor(bestAction / 9),
      cell: bestAction % 9
    };

    return NextResponse.json({ move, value });
  } catch (err: unknown) {
    console.error('Neural move route error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
