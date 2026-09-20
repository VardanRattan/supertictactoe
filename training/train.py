import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import warnings
import logging
warnings.filterwarnings('ignore')
logging.getLogger('torch.onnx').setLevel(logging.ERROR)
import argparse
import random
import time
from collections import deque
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

from training.game import SuperTicTacToeGame, filter_tactical_moves
from training.model import SuperTicTacToeNet, export_to_onnx
from training.mcts import MCTS
from training.arena import evaluate_vs_js_bot

class AlphaZeroDataset(Dataset):
    def __init__(self, examples):
        self.examples = examples

    def __len__(self):
        return len(self.examples)

    def __getitem__(self, idx):
        tensor, pi, value = self.examples[idx]
        return tensor, torch.from_numpy(pi), torch.tensor([value], dtype=torch.float32)

def augment_symmetries(tensor: torch.Tensor, pi: np.ndarray):
    """
    Applies 8-fold dihedral group D4 symmetries (4 rotations x 2 flips)
    to both the (6, 9, 9) spatial tensor and the 81-length policy vector.
    """
    symmetries = []
    pi_2d = pi.reshape(9, 9)

    for i in range(4):
        rot_tensor = torch.rot90(tensor, k=i, dims=[1, 2])
        rot_pi = np.rot90(pi_2d, k=i)
        symmetries.append((rot_tensor, rot_pi.flatten()))

        # Flip horizontally
        flip_tensor = torch.flip(rot_tensor, dims=[2])
        flip_pi = np.fliplr(rot_pi)
        symmetries.append((flip_tensor, flip_pi.flatten()))

    return symmetries

import math

class BatchedNode:
    def __init__(self, prior: float = 0.0):
        self.prior = prior
        self.visit_count = 0
        self.total_value = 0.0
        self.children = {}
        self.is_expanded = False

    @property
    def value(self) -> float:
        return self.total_value / self.visit_count if self.visit_count > 0 else 0.0

def select_child_fast(node: BatchedNode, c_puct: float = 2.0):
    best_score = -float('inf')
    best_action = -1
    best_child = None
    sqrt_total = math.sqrt(max(1, node.visit_count))

    for action, child in node.children.items():
        q = child.value
        u = c_puct * child.prior * (sqrt_total / (1 + child.visit_count))
        score = q + u
        if score > best_score:
            best_score = score
            best_action = action
            best_child = child

    return best_action, best_child

def self_play_batched(
    model: SuperTicTacToeNet,
    num_episodes: int,
    num_sims: int,
    batch_size: int = 8,
    device: str = 'cuda',
    desc: str = "Self-Play"
):
    """
    Generates `num_episodes` self-play games using parallel Batched MCTS.
    Evaluates leaf nodes in parallel on GPU (8x faster than sequential).
    Returns list of D4-augmented training samples: (sym_tensor, sym_pi, value).
    """
    actual_batch = min(batch_size, num_episodes)
    games = [SuperTicTacToeGame() for _ in range(actual_batch)]
    episodes_data = [[] for _ in range(actual_batch)]
    augmented_data = []
    completed_count = 0

    pbar = tqdm(total=num_episodes, desc=desc)

    while completed_count < num_episodes:
        active_indices = [i for i, g in enumerate(games) if g is not None]
        if not active_indices:
            break

        # 1. Initialize roots for active games
        roots = []
        root_tensors = []
        root_legals = []

        for idx in active_indices:
            g = games[idx]
            legal = g.get_legal_moves()
            tensor = g.get_canonical_tensor()
            root_tensors.append(tensor)
            root_legals.append(torch.from_numpy(legal))
            roots.append(BatchedNode())

        batch_tensors = torch.stack(root_tensors).to(device)
        batch_legals = torch.stack(root_legals).to(device)

        with torch.inference_mode():
            batch_policies, _ = model.predict(batch_tensors, batch_legals)
        policies_np = batch_policies.cpu().numpy()

        for i, idx in enumerate(active_indices):
            root = roots[i]
            g = games[idx]
            legal = root_legals[i].numpy()
            policy = policies_np[i]

            # Tactical filter on root: prune suicide moves if safe alternatives exist
            tactical = filter_tactical_moves(g)
            if tactical and len(tactical) < 81:
                mask = np.zeros(81, dtype=bool)
                mask[tactical] = True
                policy[~mask] = 0.0

            # Dirichlet exploration noise on root
            legal_idx = np.where(policy > 0)[0] if np.any(policy > 0) else np.where(legal)[0]
            if len(legal_idx) > 0:
                noise = np.random.dirichlet([0.3] * len(legal_idx))
                policy[legal_idx] = 0.75 * policy[legal_idx] + 0.25 * noise

            for a in range(81):
                if legal[a]:
                    root.children[a] = BatchedNode(prior=policy[a])
            root.is_expanded = True

        # 2. Run MCTS simulations in parallel across all active games
        for _ in range(num_sims):
            sim_games = [games[idx].clone() for idx in active_indices]
            search_paths = []
            leaf_eval_needed = []

            for i, idx in enumerate(active_indices):
                node = roots[i]
                sim_g = sim_games[i]
                path = [node]

                while node.is_expanded and sim_g.winner is None:
                    action, next_node = select_child_fast(node)
                    sim_g.step(action)
                    node = next_node
                    path.append(node)

                search_paths.append(path)

                if sim_g.winner is not None:
                    # Terminal node
                    val = 0.0 if sim_g.winner == 0 else (1.0 if sim_g.winner == -sim_g.current_player else -1.0)
                    for p_node in reversed(path):
                        p_node.visit_count += 1
                        p_node.total_value += val
                        val = -val
                else:
                    leaf_eval_needed.append((i, sim_g, node))

            if leaf_eval_needed:
                eval_tensors = torch.stack([lg.get_canonical_tensor() for _, lg, _ in leaf_eval_needed]).to(device)
                eval_legals = torch.stack([torch.from_numpy(lg.get_legal_moves()) for _, lg, _ in leaf_eval_needed]).to(device)

                with torch.inference_mode():
                    e_policies, e_values = model.predict(eval_tensors, eval_legals)

                e_p_np = e_policies.cpu().numpy()
                e_v_np = e_values.cpu().numpy()

                for j, (local_i, lg, node) in enumerate(leaf_eval_needed):
                    legal = eval_legals[j].cpu().numpy()
                    pol = e_p_np[j]
                    val = float(e_v_np[j][0])

                    for a in range(81):
                        if legal[a]:
                            node.children[a] = BatchedNode(prior=pol[a])
                    node.is_expanded = True

                    path = search_paths[local_i]
                    for p_node in reversed(path):
                        p_node.visit_count += 1
                        p_node.total_value += val
                        val = -val

        # 3. Choose moves for active games
        for i, idx in enumerate(active_indices):
            g = games[idx]
            root = roots[i]

            visits = np.zeros(81, dtype=np.float64)
            for a, child in root.children.items():
                visits[a] = child.visit_count
            tot = np.sum(visits)
            if tot > 0:
                pi = visits / tot
            else:
                legal_idx = np.where(g.get_legal_moves())[0]
                pi = np.zeros(81, dtype=np.float64)
                if len(legal_idx) > 0:
                    pi[legal_idx] = 1.0 / len(legal_idx)

            # Tactical check: filter suicide moves and prioritize instant wins
            tactical = filter_tactical_moves(g)
            if tactical and len(tactical) < 81:
                mask = np.zeros(81, dtype=bool)
                mask[tactical] = True
                pi[~mask] = 0.0

            temp = 1.0 if len(g.history) < 15 else 0.2
            if temp != 1.0:
                pi_t = pi ** (1.0 / temp)
                s = np.sum(pi_t)
                if s > 0:
                    pi = pi_t / s

            pi_sum = np.sum(pi)
            if pi_sum > 0:
                pi = pi / pi_sum
            else:
                safe_choices = tactical if (tactical and len(tactical) > 0) else np.where(g.get_legal_moves())[0]
                pi = np.zeros(81, dtype=np.float64)
                pi[safe_choices] = 1.0 / len(safe_choices)

            episodes_data[idx].append((g.get_canonical_tensor(), pi.astype(np.float32), g.current_player))

            action = int(np.random.choice(len(pi), p=pi))
            g.step(action)

            # Check if game ended
            if g.winner is not None or len(g.history) >= 81:
                winner = g.winner if g.winner is not None else 0
                for tensor, step_pi, player in episodes_data[idx]:
                    val = 0.0 if winner == 0 else (1.0 if winner == player else -1.0)
                    for sym_tensor, sym_pi in augment_symmetries(tensor, step_pi):
                        augmented_data.append((sym_tensor, sym_pi, val))

                completed_count += 1
                pbar.update(1)
                episodes_data[idx] = []

                if completed_count + len([x for x in games if x is not None]) - 1 < num_episodes:
                    games[idx] = SuperTicTacToeGame()
                else:
                    games[idx] = None

    pbar.close()
    return augmented_data

def sparring_episodes(
    current_model: SuperTicTacToeNet,
    league_models: list,
    num_episodes: int,
    num_sims: int,
    device: str,
    desc: str = "League Sparring"
) -> list:
    """
    Generates training data where current_model spars against diverse historical champions.
    Alternates playing as Player 1 (X) and Player 2 (O) using tactical MCTS.
    100% Neural Network vs Neural Network.
    """
    if not league_models or num_episodes <= 0:
        return []

    augmented_data = []
    pbar = tqdm(total=num_episodes, desc=desc)
    current_mcts = MCTS(current_model, num_simulations=num_sims, device=device)

    for ep in range(num_episodes):
        opp_model = random.choice(league_models)
        opp_mcts = MCTS(opp_model, num_simulations=num_sims, device=device)

        current_as_p1 = (ep % 2 == 0)
        p1_mcts = current_mcts if current_as_p1 else opp_mcts
        p2_mcts = opp_mcts if current_as_p1 else current_mcts

        game = SuperTicTacToeGame()
        episode_data = []

        while game.winner is None and len(game.history) < 81:
            active_mcts = p1_mcts if game.current_player == 1 else p2_mcts
            pi = active_mcts.search(game, add_dirichlet_noise=(len(game.history) < 15))

            tactical = filter_tactical_moves(game)
            if tactical and len(tactical) < 81:
                mask = np.zeros(81, dtype=bool)
                mask[tactical] = True
                pi[~mask] = 0.0
                s = np.sum(pi)
                if s > 0:
                    pi /= s
                else:
                    pi[tactical] = 1.0 / len(tactical)

            episode_data.append((game.get_canonical_tensor(), pi.astype(np.float32), game.current_player))

            temp = 1.0 if len(game.history) < 10 else 0.2
            pi_t = pi ** (1.0 / temp)
            s = np.sum(pi_t)
            if s > 0:
                pi_t /= s
            else:
                pi_t = pi

            action = int(np.random.choice(len(pi_t), p=pi_t))
            game.step(action)

        winner = game.winner if game.winner is not None else 0
        for tensor, step_pi, player in episode_data:
            val = 0.0 if winner == 0 else (1.0 if winner == player else -1.0)
            for sym_tensor, sym_pi in augment_symmetries(tensor, step_pi):
                augmented_data.append((sym_tensor, sym_pi, val))

        pbar.update(1)

    pbar.close()
    return augmented_data

def train_network(
    model: SuperTicTacToeNet,
    optimizer: optim.Optimizer,
    replay_buffer: deque,
    batch_size: int = 128,
    epochs: int = 5,
    device: str = 'cuda'
):
    model.train()
    dataset = AlphaZeroDataset(list(replay_buffer))
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=False)

    total_loss = 0.0
    num_batches = 0

    for _ in range(epochs):
        for tensors, target_pis, target_values in loader:
            tensors = tensors.to(device)
            target_pis = target_pis.to(device)
            target_values = target_values.to(device)

            optimizer.zero_grad()
            out_logits, out_values = model(tensors)

            # Cross entropy loss on policy: -sum(pi * log_softmax(logits))
            log_probs = torch.log_softmax(out_logits, dim=-1)
            policy_loss = -torch.mean(torch.sum(target_pis * log_probs, dim=-1))

            # Mean squared error on value head
            value_loss = nn.MSELoss()(out_values, target_values)

            loss = policy_loss + value_loss
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            num_batches += 1

    return total_loss / max(1, num_batches)

def duel_models(candidate: SuperTicTacToeNet, baseline: SuperTicTacToeNet, num_games: int, mcts_sims: int, device: str) -> float:
    """
    Pits candidate network against baseline network.
    Returns candidate win rate (fraction in [0.0, 1.0]).
    """
    mcts_cand = MCTS(candidate, num_simulations=mcts_sims, device=device)
    mcts_base = MCTS(baseline, num_simulations=mcts_sims, device=device)

    cand_wins = 0
    draws = 0

    def play_gating_move(game: SuperTicTacToeGame, mcts: MCTS) -> int:
        pi = mcts.search(game, add_dirichlet_noise=False)
        tactical = filter_tactical_moves(game)
        if tactical and len(tactical) < 81:
            mask = np.zeros(81, dtype=bool)
            mask[tactical] = True
            pi[~mask] = -1e9
        # Small temperature for first 3 moves ensures diverse opening paths across tournament games
        if len(game.history) < 3:
            pi_temp = pi ** (1.0 / 0.6)
            s = np.sum(pi_temp)
            if s > 0:
                pi_temp /= s
                return int(np.random.choice(len(pi_temp), p=pi_temp))
        return int(np.argmax(pi))

    # Half 1: Candidate as Player 1 (X)
    games_as_p1 = num_games // 2
    for _ in range(games_as_p1):
        game = SuperTicTacToeGame()
        while game.winner is None and len(game.history) < 81:
            active_mcts = mcts_cand if game.current_player == 1 else mcts_base
            action = play_gating_move(game, active_mcts)
            game.step(action)
        if game.winner == 1:
            cand_wins += 1
        elif game.winner == 0:
            draws += 1

    # Half 2: Candidate as Player 2 (O)
    games_as_p2 = num_games - games_as_p1
    for _ in range(games_as_p2):
        game = SuperTicTacToeGame()
        while game.winner is None and len(game.history) < 81:
            active_mcts = mcts_base if game.current_player == 1 else mcts_cand
            action = play_gating_move(game, active_mcts)
            game.step(action)
        if game.winner == -1:
            cand_wins += 1
        elif game.winner == 0:
            draws += 1

    cand_losses = num_games - cand_wins - draws
    win_rate = (cand_wins + 0.5 * draws) / num_games
    print(f"Tournament Score: {cand_wins + 0.5*draws:.1f}/{num_games} (+{cand_wins} -{cand_losses} ={draws})")
    return win_rate

def run_training(
    iterations: int = 20,
    episodes_per_iter: int = 40,
    mcts_sims: int = 120,
    batch_size: int = 128,
    epochs_per_iter: int = 5,
    lr: float = 0.001,
    gating_games: int = 12,
    league_sparring: bool = True,
    device: str = 'cuda',
    onnx_output_path: str = "public/models/supertictactoe_alphazero.onnx",
    resume: bool = True
):
    os.makedirs("training/checkpoints", exist_ok=True)
    os.makedirs(os.path.dirname(onnx_output_path), exist_ok=True)

    print(f"=== Starting Deep AlphaZero Generational League (100% Neural Network vs Model) ===")
    print(f"Device: {device.upper()} | Iterations to run: {iterations} | Episodes/Iter: {episodes_per_iter} | MCTS Sims: {mcts_sims}")

    best_model = SuperTicTacToeNet().to(device)
    candidate_model = SuperTicTacToeNet().to(device)

    start_iter = 1
    last_iter = 0
    # Auto-resume from latest checkpoint if available
    if resume and os.path.exists("training/checkpoints"):
        ckpt_files = [f for f in os.listdir("training/checkpoints") if f.startswith("best_model_iter_") and f.endswith(".pt")]
        if ckpt_files:
            ckpt_files.sort(key=lambda x: int(x.split("_")[-1].split(".")[0]))
            latest_ckpt = ckpt_files[-1]
            last_iter = int(latest_ckpt.split("_")[-1].split(".")[0])
            start_iter = last_iter + 1
            ckpt_path = os.path.join("training/checkpoints", latest_ckpt)
            print(f"🔄 Resuming from checkpoint: {ckpt_path} (Continuing from Iteration {start_iter})")
            saved = torch.load(ckpt_path, map_location=device)
            best_model.load_state_dict(saved['model_state_dict'])

    candidate_model.load_state_dict(best_model.state_dict())

    # Load historical champions for Generational League Sparring (Pure Neural Pool)
    league_models = []
    if league_sparring and os.path.exists("training/checkpoints"):
        historical_ckpts = [
            f for f in os.listdir("training/checkpoints")
            if f.startswith("best_model_iter_") and f.endswith(".pt") and f != f"best_model_iter_{last_iter}.pt"
        ]
        historical_ckpts.sort(key=lambda x: int(x.split("_")[-1].split(".")[0]))
        if len(historical_ckpts) > 4:
            indices = [0, len(historical_ckpts)//3, 2*len(historical_ckpts)//3, len(historical_ckpts)-1]
            selected = [historical_ckpts[i] for i in indices]
        else:
            selected = historical_ckpts

        for ckpt_name in selected:
            h_path = os.path.join("training/checkpoints", ckpt_name)
            h_model = SuperTicTacToeNet().to(device)
            h_saved = torch.load(h_path, map_location=device)
            h_model.load_state_dict(h_saved.get('model_state_dict', h_saved))
            h_model.eval()
            league_models.append(h_model)
            print(f"🏛️ Loaded League Sparring Champion: {ckpt_name}")

    optimizer = optim.Adam(candidate_model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=iterations, eta_min=1e-4)
    # Refreshed replay buffer: collects exclusively master-grade tactical games
    replay_buffer = deque(maxlen=100000)

    # Export baseline
    export_to_onnx(best_model, onnx_output_path)

    end_iter = start_iter + iterations - 1
    for it in range(start_iter, end_iter + 1):
        print(f"\n==================== ITERATION {it}/{end_iter} ====================")
        it_start = time.time()

        # 1. Data Generation: 70% Batched Self-Play + 30% Generational League Sparring
        best_model.eval()
        if league_models:
            sp_episodes = max(1, int(episodes_per_iter * 0.7))
            spar_episodes = max(0, episodes_per_iter - sp_episodes)
        else:
            sp_episodes = episodes_per_iter
            spar_episodes = 0

        print(f"Generating {sp_episodes} self-play + {spar_episodes} generational sparring games ({mcts_sims} MCTS sims)...")
        sp_samples = self_play_batched(
            best_model,
            num_episodes=sp_episodes,
            num_sims=mcts_sims,
            batch_size=8,
            device=device,
            desc=f"Self-Play Iter {it}"
        )
        replay_buffer.extend(sp_samples)

        if league_models and spar_episodes > 0:
            spar_samples = sparring_episodes(
                best_model,
                league_models,
                num_episodes=spar_episodes,
                num_sims=mcts_sims,
                device=device,
                desc=f"Sparring Iter {it}"
            )
            replay_buffer.extend(spar_samples)
            new_samples = len(sp_samples) + len(spar_samples)
        else:
            new_samples = len(sp_samples)

        print(f"Generated {new_samples} tactical augmented samples. Replay buffer: {len(replay_buffer)}")

        # 2. Train Candidate Network on Replay Buffer
        print(f"Training candidate network for {epochs_per_iter} epochs (batch_size={batch_size})...")
        avg_loss = train_network(
            candidate_model,
            optimizer,
            replay_buffer,
            batch_size=batch_size,
            epochs=epochs_per_iter,
            device=device
        )
        scheduler.step()
        print(f"Iteration {it} Loss: {avg_loss:.4f} (LR: {scheduler.get_last_lr()[0]:.6f}, Elapsed: {time.time() - it_start:.1f}s)")

        # 3. Model Gating Duel: Candidate vs Previous Best Model
        if gating_games > 0:
            print(f"Running Gating Tournament: Candidate Gen {it} vs Previous Best ({gating_games} matches)...")
            candidate_model.eval()
            best_model.eval()
            win_rate = duel_models(candidate_model, best_model, num_games=gating_games, mcts_sims=mcts_sims, device=device)
            print(f"Candidate Win Rate vs Previous Best: {win_rate * 100:.1f}%")

            if win_rate >= 0.54:
                print(f"🏆 Candidate Accepted! Promoted to new Best Model (Gen {it}) & exported to ONNX.")
                # Add defeated champion to the league pool
                old_champ = SuperTicTacToeNet().to(device)
                old_champ.load_state_dict(best_model.state_dict())
                old_champ.eval()
                league_models.append(old_champ)

                best_model.load_state_dict(candidate_model.state_dict())
                checkpoint_path = f"training/checkpoints/best_model_iter_{it}.pt"
                torch.save({'iteration': it, 'model_state_dict': best_model.state_dict()}, checkpoint_path)
                export_to_onnx(best_model, onnx_output_path)
            else:
                print(f"❌ Candidate Rejected (< 54% win rate). Resetting candidate to previous best.")
                candidate_model.load_state_dict(best_model.state_dict())
        else:
            # If gating skipped, update best_model unconditionally
            best_model.load_state_dict(candidate_model.state_dict())
            export_to_onnx(best_model, onnx_output_path)

    print("\n🎉 AlphaZero Generational League Training Complete!")
    export_to_onnx(best_model, onnx_output_path)
    return best_model

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train AlphaZero for Super Tic-Tac-Toe via Generational League")
    parser.add_argument("--iterations", type=int, default=15, help="Number of training iterations")
    parser.add_argument("--episodes", type=int, default=36, help="Total episodes per iteration (self-play + sparring)")
    parser.add_argument("--sims", type=int, default=120, help="MCTS simulations per move")
    parser.add_argument("--batch-size", type=int, default=128, help="Training batch size")
    parser.add_argument("--epochs", type=int, default=5, help="Epochs per iteration")
    parser.add_argument("--lr", type=float, default=0.001, help="Learning rate")
    parser.add_argument("--gating-games", type=int, default=12, help="Matches between candidate and previous best")
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--onnx-path", type=str, default="public/models/supertictactoe_alphazero.onnx")
    parser.add_argument("--fresh", action="store_true", help="Start fresh training ignoring existing checkpoints")
    parser.add_argument("--no-league", action="store_true", help="Disable generational league sparring")

    args = parser.parse_args()
    run_training(
        iterations=args.iterations,
        episodes_per_iter=args.episodes,
        mcts_sims=args.sims,
        batch_size=args.batch_size,
        epochs_per_iter=args.epochs,
        lr=args.lr,
        gating_games=args.gating_games,
        league_sparring=not args.no_league,
        device=args.device,
        onnx_output_path=args.onnx_path,
        resume=not args.fresh
    )
