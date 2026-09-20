import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import argparse
import numpy as np
import torch

from training.game import SuperTicTacToeGame
from training.model import SuperTicTacToeNet
from training.mcts import MCTS

def load_checkpoint_model(ckpt_path: str, device: str) -> SuperTicTacToeNet:
    model = SuperTicTacToeNet().to(device)
    saved = torch.load(ckpt_path, map_location=device)
    state = saved['model_state_dict'] if 'model_state_dict' in saved else saved
    model.load_state_dict(state)
    model.eval()
    return model

def play_match(
    mcts_x: MCTS,
    mcts_o: MCTS,
    opening_temp_moves: int = 2
) -> tuple[int, int]:
    """Plays 1 competitive game between two MCTS models. Returns (winner, move_count)."""
    game = SuperTicTacToeGame()

    while game.winner is None and len(game.history) < 81:
        active_mcts = mcts_x if game.current_player == 1 else mcts_o
        pi = active_mcts.search(game, add_dirichlet_noise=False)

        # Diverse openings for first few moves
        if len(game.history) < opening_temp_moves:
            pi_temp = pi ** (1.0 / 0.6)
            s = np.sum(pi_temp)
            if s > 0:
                pi_temp /= s
                action = int(np.random.choice(len(pi_temp), p=pi_temp))
            else:
                action = int(np.argmax(pi))
        else:
            action = int(np.argmax(pi))

        game.step(action)

    winner = game.winner if game.winner is not None else 0
    return winner, len(game.history)

def run_duel(
    model_a: SuperTicTacToeNet,
    name_a: str,
    model_b: SuperTicTacToeNet,
    name_b: str,
    num_games: int = 6,
    sims: int = 60,
    device: str = 'cuda'
):
    mcts_a = MCTS(model_a, num_simulations=sims, c_puct=2.0, device=device)
    mcts_b = MCTS(model_b, num_simulations=sims, c_puct=2.0, device=device)

    a_wins = 0
    b_wins = 0
    draws = 0
    lengths = []

    half = num_games // 2

    # Half 1: A as X, B as O
    for _ in range(half):
        w, moves = play_match(mcts_a, mcts_b)
        lengths.append(moves)
        if w == 1:
            a_wins += 1
        elif w == -1:
            b_wins += 1
        else:
            draws += 1

    # Half 2: B as X, A as O
    for _ in range(num_games - half):
        w, moves = play_match(mcts_b, mcts_a)
        lengths.append(moves)
        if w == -1:
            a_wins += 1
        elif w == 1:
            b_wins += 1
        else:
            draws += 1

    score_a = (a_wins + 0.5 * draws) / num_games
    score_b = (b_wins + 0.5 * draws) / num_games
    avg_len = np.mean(lengths)

    return {
        "a_wins": a_wins,
        "b_wins": b_wins,
        "draws": draws,
        "score_a": score_a * 100.0,
        "score_b": score_b * 100.0,
        "avg_len": avg_len
    }

def run_mirror_match(
    model: SuperTicTacToeNet,
    num_games: int = 6,
    sims: int = 60,
    device: str = 'cuda'
):
    mcts = MCTS(model, num_simulations=sims, c_puct=2.0, device=device)
    x_wins = 0
    o_wins = 0
    draws = 0
    lengths = []

    for _ in range(num_games):
        w, moves = play_match(mcts, mcts)
        lengths.append(moves)
        if w == 1:
            x_wins += 1
        elif w == -1:
            o_wins += 1
        else:
            draws += 1

    return {
        "x_wins": x_wins,
        "o_wins": o_wins,
        "draws": draws,
        "avg_len": np.mean(lengths) if lengths else 0
    }

def run_championship(sims: int = 60, games_per_duel: int = 6, device: str = 'cuda'):
    ckpt_dir = "training/checkpoints"
    if not os.path.exists(ckpt_dir):
        print("No checkpoints found!")
        return

    files = [f for f in os.listdir(ckpt_dir) if f.startswith("best_model_iter_") and f.endswith(".pt")]
    if not files:
        print("No checkpoints found!")
        return

    files.sort(key=lambda x: int(x.split("_")[-1].split(".")[0]))
    gens = [int(f.split("_")[-1].split(".")[0]) for f in files]

    champ_file = files[-1]
    champ_gen = gens[-1]
    champ_path = os.path.join(ckpt_dir, champ_file)

    print("=" * 75)
    print("   🏆 ALPHAZERO GENERATIONAL CHAMPIONSHIP: PROVING MASTERY 🏆")
    print("=" * 75)
    print(f"Reigning Champion: Generation {champ_gen} ({champ_file})")
    print(f"Available Generations: {gens}")
    print(f"Games per Matchup: {games_per_duel} (alternating X and O) | MCTS Sims: {sims} | Device: {device.upper()}")
    print("=" * 75)

    champ_model = load_checkpoint_model(champ_path, device)
    results = []

    # 1. Ladder Duels: Champion vs each historical generation
    for f, g in zip(files, gens):
        if g == champ_gen:
            continue
        challenger_path = os.path.join(ckpt_dir, f)
        challenger_model = load_checkpoint_model(challenger_path, device)

        print(f"\n⚔️ Duel: Generation {champ_gen} (Champion) vs. Generation {g} (Challenger)...")
        res = run_duel(champ_model, f"Gen {champ_gen}", challenger_model, f"Gen {g}", num_games=games_per_duel, sims=sims, device=device)

        status = "🌟 CHAMPION DOMINATES" if res['score_a'] >= 60 else ("🤝 COMPETITIVE" if res['score_a'] >= 50 else "⚠️ CHALLENGER WON")
        print(f"   Score: Gen {champ_gen} -> {res['a_wins']}W - {res['b_wins']}L - {res['draws']}D ({res['score_a']:.1f}%) | Avg Moves: {res['avg_len']:.1f} | {status}")

        results.append({
            "opponent": f"Generation {g}",
            "wins": res['a_wins'],
            "losses": res['b_wins'],
            "draws": res['draws'],
            "win_rate": res['score_a'],
            "avg_len": res['avg_len']
        })

    # 2. Grand Mirror Match: Champion vs Champion (Self vs Self at Peak Skill)
    print(f"\n👑 Grand Mirror Match: Generation {champ_gen} (X) vs. Generation {champ_gen} (O)...")
    res_mirror = run_mirror_match(champ_model, num_games=games_per_duel, sims=sims, device=device)
    print(f"   Mirror Score: {res_mirror['x_wins']} (X wins) - {res_mirror['o_wins']} (O wins) - {res_mirror['draws']} (Draws) | Avg Moves: {res_mirror['avg_len']:.1f}")

    # Summary Table
    print("\n" + "=" * 75)
    print("                 📊 FINAL CHAMPIONSHIP REPORT CARD 📊")
    print("=" * 75)
    print(f"{'Opponent':<20} | {'Record (W-L-D)':<16} | {'Gen ' + str(champ_gen) + ' Score':<14} | {'Avg Game Length'}")
    print("-" * 75)
    for r in results:
        rec = f"{r['wins']}W - {r['losses']}L - {r['draws']}D"
        print(f"{r['opponent']:<20} | {rec:<16} | {r['win_rate']:>5.1f}%        | {r['avg_len']:.1f} moves")
    print("-" * 75)
    mirror_rec = f"{res_mirror['x_wins']}X - {res_mirror['o_wins']}O - {res_mirror['draws']}D"
    print(f"{'Gen ' + str(champ_gen) + ' Mirror Match':<20} | {mirror_rec:<16} | {'N/A (Mirror)':<14} | {res_mirror['avg_len']:.1f} moves")
    print("=" * 75)

    total_champ_wins = sum(r['wins'] for r in results)
    total_champ_losses = sum(r['losses'] for r in results)
    total_champ_draws = sum(r['draws'] for r in results)
    total_matches = total_champ_wins + total_champ_losses + total_champ_draws
    overall_score = ((total_champ_wins + 0.5 * total_champ_draws) / max(1, total_matches)) * 100.0

    print(f"Overall Championship Record: {total_champ_wins} Wins, {total_champ_losses} Losses, {total_champ_draws} Draws ({overall_score:.1f}% Score)")
    if overall_score >= 70.0:
        print(f"🏆 VERDICT: Generation {champ_gen} is the UNDISPUTED CHAMPION. Ready for the JS Bot Boss Battle!")
    else:
        print(f"⚖️ VERDICT: Generation {champ_gen} holds solid ground, showing generational progression.")
    print("=" * 75)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AlphaZero Generational Championship")
    parser.add_argument("--games", type=int, default=6, help="Matches per generational matchup")
    parser.add_argument("--sims", type=int, default=60, help="MCTS simulations per move")
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    run_championship(sims=args.sims, games_per_duel=args.games, device=args.device)
