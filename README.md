# Super Tic Tac Toe

A strategic, multi-layered version of Tic Tac Toe built with Next.js, TypeScript, and Tailwind CSS. Challenge a friend in Pass & Play mode or test your skills against our advanced AI Duel engine.

## 🎮 Game Modes

- **Pass & Play:** Play locally with a friend on the same device.
- **AI Duel:** Face off against an advanced AI that uses minimax optimization and strategic phase analysis.

## 📜 How to Play (Rules)

Super Tic Tac Toe consists of nine individual Tic Tac Toe games arranged in a 3x3 grid (the "Super Board").

### The Basics
- Your goal is to win three connected games (horizontal, vertical, or diagonal) to claim victory on the Super Board.

### Strategic Movement
- The first player can place their mark (O/X) anywhere on any board.
- **The Twist:** Your move determines where your opponent must play next. If you play in the top-right square of an individual game, your opponent must make their next move in the top-right game of the Super Board.

### Winning Games
- Win individual games by connecting three of your marks within that 3x3 grid.
- Once a game is won, it belongs to that player. However, you can still be sent to a won game; playing there still directs your opponent's next move.

### Special Rules
- If you are sent to a game that is already full, you are allowed to play in the game where your opponent previously marked.

## 🤖 AI Engine Features

- **Minimax Algorithm:** Optimized search for the best possible moves.
- **Phase-Based Strategy:** The AI adapts its playstyle (Sabotage, Control, Sacrifice, Endgame) based on the current board state.
- **Iterative Deepening:** Balances calculation depth with response time.
- **Heuristic Evaluation:** Sophisticated scoring based on board strength, fork potential, and center/corner control.

## 🚀 Live Demo

Check out the live game here: [https://VardanRattan.github.io/supertictactoe/](https://VardanRattan.github.io/supertictactoe/)

## 🛠️ Tech Stack

- **Framework:** Next.js 15
- **Language:** TypeScript
- **Styling:** Tailwind CSS 4
- **Icons:** Lucide React
- **Audio:** Custom sound effects for moves and victories

## 🛠️ Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

---
Created by [Vardan Rattan](https://github.com/VardanRattan)
