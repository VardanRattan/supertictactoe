import json
import subprocess
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import torch
from training.game import SuperTicTacToeGame
from training.model import SuperTicTacToeNet
from training.mcts import MCTS

class JSBotPlayer:
    """Communicates with EnhancedAIEngine via persistent Node subprocess bridge."""

    def __init__(self, bridge_path: str = "training/bot_bridge.mjs"):
        self.process = subprocess.Popen(
            ["npx", "tsx", bridge_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )

    def close(self):
        if self.process:
            try:
                self.process.stdin.close()
                self.process.terminate()
                self.process.wait(timeout=2)
            except Exception:
                pass

    def get_action(self, game: SuperTicTacToeGame) -> int:
        b_me = [0] * 9
        b_opp = [0] * 9
        o_me = 0
        o_opp = 0
        p = game.current_player
        for g in range(9):
            m = 0
            op = 0
            row = game.board[g]
            for c in range(9):
                val = row[c]
                if val == p:
                    m |= (1 << c)
                elif val == -p:
                    op |= (1 << c)
            b_me[g] = m
            b_opp[g] = op
            owner = game.ownership[g]
            if owner == p:
                o_me |= (1 << g)
            elif owner == -p:
                o_opp |= (1 << g)

        payload = {
            "fast": True,
            "bMe": b_me,
            "bOpp": b_opp,
            "oMe": o_me,
            "oOpp": o_opp,
            "active": game.active_game if game.active_game != -1 else None,
            "history": list(game.history)[-10:],
            "maxDepth": 6,
            "maxTimeMs": 20
        }

        self.process.stdin.write(json.dumps(payload) + "\n")
        self.process.stdin.flush()

        response = self.process.stdout.readline()
        if not response:
            raise RuntimeError("JS Bot bridge closed unexpectedly")

        data = json.loads(response)
        if "error" in data:
            raise RuntimeError(f"JS Bot error: {data['error']}")

        return data["game"] * 9 + data["cell"]

from training.game import SuperTicTacToeGame, filter_tactical_moves

class NeuralPlayer:
    def __init__(self, model: SuperTicTacToeNet, mcts_sims: int = 50, device: str = 'cuda'):
        self.mcts = MCTS(model, num_simulations=mcts_sims, device=device)

    def get_action(self, game: SuperTicTacToeGame) -> int:
        policy = self.mcts.search(game, add_dirichlet_noise=False)
        tactical_actions = filter_tactical_moves(game)
        if tactical_actions and len(tactical_actions) < 81:
            mask = np.zeros(81, dtype=bool)
            mask[tactical_actions] = True
            policy[~mask] = -1e9
        return int(np.argmax(policy))

def play_match(player_x, player_o) -> int:
    """Plays 1 game. Returns winner: 1 (X won), -1 (O won), 0 (draw)."""
    game = SuperTicTacToeGame()
    move_count = 0

    while game.winner is None and move_count < 81:
        current_agent = player_x if game.current_player == 1 else player_o
        action = current_agent.get_action(game)

        # Validate legality
        legal = game.get_legal_moves()
        if not legal[action]:
            # Illegal move forfeit
            return -game.current_player

        game.step(action)
        move_count += 1

    return game.winner if game.winner is not None else 0

def evaluate_vs_js_bot(
    model: SuperTicTacToeNet,
    num_games: int = 10,
    mcts_sims: int = 50,
    device: str = 'cuda'
) -> dict:
    """
    Pits the Neural Network against the JavaScript Strategy Bot.
    Plays half games as Player X (first) and half as Player O (second).
    """
    print(f"\n--- ARENA DUEL: Neural Model vs JS Bot ({num_games} matches) ---")
    js_bot = JSBotPlayer()
    neural_player = NeuralPlayer(model, mcts_sims=mcts_sims, device=device)

    wins = 0
    losses = 0
    draws = 0

    try:
        # Half 1: Neural as X, JS Bot as O
        games_as_x = num_games // 2
        for i in range(games_as_x):
            outcome = play_match(neural_player, js_bot)
            if outcome == 1:
                wins += 1
                result_str = "WIN (Neural Model)"
            elif outcome == -1:
                losses += 1
                result_str = "LOSS (JS Bot won)"
            else:
                draws += 1
                result_str = "DRAW"
            print(f"Match {i+1}/{num_games} (Neural as X): {result_str}")

        # Half 2: JS Bot as X, Neural as O
        games_as_o = num_games - games_as_x
        for i in range(games_as_o):
            outcome = play_match(js_bot, neural_player)
            if outcome == -1:
                wins += 1
                result_str = "WIN (Neural Model)"
            elif outcome == 1:
                losses += 1
                result_str = "LOSS (JS Bot won)"
            else:
                draws += 1
                result_str = "DRAW"
            print(f"Match {games_as_x + i + 1}/{num_games} (Neural as O): {result_str}")

    finally:
        js_bot.close()

    win_rate = (wins / num_games) * 100.0
    print(f"\nFinal Arena Results: Wins={wins}, Losses={losses}, Draws={draws} -> Win Rate: {win_rate:.1f}%\n")
    return {"wins": wins, "losses": losses, "draws": draws, "win_rate": win_rate}

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Run Grand Duel: Neural Model vs JavaScript Strategy Bot")
    parser.add_argument("--games", type=int, default=10, help="Total matches to play (alternating X and O)")
    parser.add_argument("--sims", type=int, default=40, help="MCTS simulations per move for Neural model")
    parser.add_argument("--checkpoint", type=str, default=None, help="Path to .pt checkpoint file (default: loads latest)")
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")

    args = parser.parse_args()
    model = SuperTicTacToeNet().to(args.device)

    if args.checkpoint and os.path.exists(args.checkpoint):
        print(f"Loading checkpoint: {args.checkpoint}")
        ckpt = torch.load(args.checkpoint, map_location=args.device)
        model.load_state_dict(ckpt.get('model_state_dict', ckpt))
    else:
        # Check if checkpoints directory has any saved models
        ckpt_dir = "training/checkpoints"
        if os.path.exists(ckpt_dir):
            files = [f for f in os.listdir(ckpt_dir) if f.startswith("best_model_iter_") and f.endswith(".pt")]
            if files:
                files.sort(key=lambda x: int(x.split("_")[-1].split(".")[0]))
                latest = os.path.join(ckpt_dir, files[-1])
                print(f"Loading latest checkpoint: {latest}")
                ckpt = torch.load(latest, map_location=args.device)
                model.load_state_dict(ckpt.get('model_state_dict', ckpt))

    evaluate_vs_js_bot(model, num_games=args.games, mcts_sims=args.sims, device=args.device)

