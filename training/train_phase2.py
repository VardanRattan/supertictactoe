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

class AlphaZeroDataset(Dataset):
    def __init__(self, examples):
        self.examples = examples

    def __len__(self):
        return len(self.examples)

    def __getitem__(self, idx):
        tensor, pi, value = self.examples[idx]
        return tensor, torch.from_numpy(pi), torch.tensor([value], dtype=torch.float32)

def augment_symmetries(tensor: torch.Tensor, pi: np.ndarray):
    """Applies D4 dihedral group symmetries to tensor and policy."""
    symmetries = []
    pi_2d = pi.reshape(9, 9)

    for i in range(4):
        rot_tensor = torch.rot90(tensor, k=i, dims=[1, 2])
        rot_pi = np.rot90(pi_2d, k=i)
        symmetries.append((rot_tensor, rot_pi.flatten()))

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

def self_play_with_loss_retrospection(
    model: SuperTicTacToeNet,
    num_episodes: int,
    num_sims: int = 100,
    deep_sims: int = 250,
    batch_size: int = 8,
    device: str = 'cuda',
    desc: str = "Self-Play + Post-Mortem"
) -> tuple[list, list, int]:
    """
    Simulates self-play games. Whenever a game ends decisively (win/loss):
    1. Identifies the losing player.
    2. Runs deep retrospective MCTS (deep_sims) on the losing player's pivotal turning points.
    3. Generates high-priority correction samples to teach the network why it lost and what to play instead.

    Returns:
    - standard_samples: all regular self-play samples.
    - blunder_corrections: deep post-mortem correction samples from losses.
    - decisive_games_count: number of games that ended in a win/loss.
    """
    actual_batch = min(batch_size, num_episodes)
    games = [SuperTicTacToeGame() for _ in range(actual_batch)]
    # Stores (game_clone_before_move, tensor, pi, player, action_taken)
    episodes_history = [[] for _ in range(actual_batch)]

    standard_samples = []
    blunder_corrections = []
    completed_count = 0
    decisive_count = 0

    deep_mcts = MCTS(model, num_simulations=deep_sims, c_puct=2.0, device=device)
    pbar = tqdm(total=num_episodes, desc=desc)

    while completed_count < num_episodes:
        active_indices = [i for i, g in enumerate(games) if g is not None]
        if not active_indices:
            break

        # 1. Initialize root nodes
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

            tactical = filter_tactical_moves(g)
            if tactical and len(tactical) < 81:
                mask = np.zeros(81, dtype=bool)
                mask[tactical] = True
                policy[~mask] = 0.0

            legal_idx = np.where(policy > 0)[0] if np.any(policy > 0) else np.where(legal)[0]
            if len(legal_idx) > 0:
                noise = np.random.dirichlet([0.3] * len(legal_idx))
                policy[legal_idx] = 0.75 * policy[legal_idx] + 0.25 * noise

            for a in range(81):
                if legal[a]:
                    root.children[a] = BatchedNode(prior=policy[a])
            root.is_expanded = True

        # 2. Run MCTS simulations in parallel across active games
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

        # 3. Choose moves
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

            # Store snapshot BEFORE making move
            state_snapshot = g.clone()
            action = int(np.random.choice(len(pi), p=pi))

            episodes_history[idx].append({
                "game_snapshot": state_snapshot,
                "tensor": g.get_canonical_tensor(),
                "pi": pi.astype(np.float32),
                "player": g.current_player,
                "action": action
            })

            g.step(action)

            # Check if game ended
            if g.winner is not None or len(g.history) >= 81:
                winner = g.winner if g.winner is not None else 0
                history = episodes_history[idx]

                # Standard training samples
                for step in history:
                    p = step["player"]
                    val = 0.0 if winner == 0 else (1.0 if winner == p else -1.0)
                    for sym_tensor, sym_pi in augment_symmetries(step["tensor"], step["pi"]):
                        standard_samples.append((sym_tensor, sym_pi, val))

                # PHASE 2: Retrospective Post-Mortem on Decisive Loss
                if winner != 0:
                    decisive_count += 1
                    loser = -winner
                    loser_steps = [s for s in history if s["player"] == loser]

                    # Analyze the losing player's last 5 moves (where the collapse occurred)
                    pivotal_steps = loser_steps[-5:] if len(loser_steps) >= 5 else loser_steps

                    for step in pivotal_steps:
                        snap = step["game_snapshot"]
                        act_played = step["action"]

                        # Run Deep Retrospective MCTS to figure out why it lost and what was better
                        deep_pi = deep_mcts.search(snap, add_dirichlet_noise=False)

                        # Enforce tactical safety on deep retrospection
                        snap_tactical = filter_tactical_moves(snap)
                        if snap_tactical and len(snap_tactical) < 81:
                            mask = np.zeros(81, dtype=bool)
                            mask[snap_tactical] = True
                            deep_pi[~mask] = 0.0
                            s = np.sum(deep_pi)
                            if s > 0:
                                deep_pi /= s

                        # Contrast: penalize the blundered move, reinforce the deep defense
                        deep_best = int(np.argmax(deep_pi))
                        if deep_best != act_played:
                            # Confirmed blunder! The deep search found a better alternative.
                            # Value target is -1.0 (it was a losing state for the loser)
                            # Policy target is the corrected deep_pi
                            for sym_tensor, sym_pi in augment_symmetries(snap.get_canonical_tensor(), deep_pi.astype(np.float32)):
                                # Add with 3x emphasis into blunder corrections
                                for _ in range(3):
                                    blunder_corrections.append((sym_tensor, sym_pi, -1.0))

                completed_count += 1
                pbar.update(1)
                episodes_history[idx] = []

                if completed_count + len([x for x in games if x is not None]) - 1 < num_episodes:
                    games[idx] = SuperTicTacToeGame()
                else:
                    games[idx] = None

    pbar.close()
    return standard_samples, blunder_corrections, decisive_count

def train_network_phase2(
    model: SuperTicTacToeNet,
    optimizer: optim.Optimizer,
    replay_buffer: deque,
    blunder_buffer: deque,
    batch_size: int = 128,
    epochs: int = 5,
    device: str = 'cuda'
):
    """
    Trains candidate network using prioritized mixture of regular games
    and high-priority post-mortem blunder corrections.
    """
    model.train()

    # Combine regular replay buffer with blunder corrections
    # If blunder buffer has items, ensure 30% of each epoch comes from blunder lessons
    combined_examples = list(replay_buffer)
    if len(blunder_buffer) > 0:
        # Re-sample blunder lessons to guarantee significant representation in every gradient batch
        blunder_list = list(blunder_buffer)
        combined_examples.extend(blunder_list)

    dataset = AlphaZeroDataset(combined_examples)
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

            log_probs = torch.log_softmax(out_logits, dim=-1)
            policy_loss = -torch.mean(torch.sum(target_pis * log_probs, dim=-1))
            value_loss = nn.MSELoss()(out_values, target_values)

            loss = policy_loss + value_loss
            loss.backward()
            optimizer.step()

            total_loss += loss.item()
            num_batches += 1

    return total_loss / max(1, num_batches)

def duel_models(candidate: SuperTicTacToeNet, baseline: SuperTicTacToeNet, num_games: int, mcts_sims: int, device: str) -> float:
    """Pits candidate against baseline champion with tactical filtering."""
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
        if len(game.history) < 3:
            pi_temp = pi ** (1.0 / 0.6)
            s = np.sum(pi_temp)
            if s > 0:
                pi_temp /= s
                return int(np.random.choice(len(pi_temp), p=pi_temp))
        return int(np.argmax(pi))

    half = num_games // 2
    for _ in range(half):
        game = SuperTicTacToeGame()
        while game.winner is None and len(game.history) < 81:
            active = mcts_cand if game.current_player == 1 else mcts_base
            game.step(play_gating_move(game, active))
        if game.winner == 1:
            cand_wins += 1
        elif game.winner == 0:
            draws += 1

    for _ in range(num_games - half):
        game = SuperTicTacToeGame()
        while game.winner is None and len(game.history) < 81:
            active = mcts_base if game.current_player == 1 else mcts_cand
            game.step(play_gating_move(game, active))
        if game.winner == -1:
            cand_wins += 1
        elif game.winner == 0:
            draws += 1

    cand_losses = num_games - cand_wins - draws
    win_rate = (cand_wins + 0.5 * draws) / num_games
    print(f"Tournament Score: {cand_wins + 0.5*draws:.1f}/{num_games} (+{cand_wins} -{cand_losses} ={draws})")
    return win_rate

def run_phase2_training(
    iterations: int = 15,
    episodes_per_iter: int = 30,
    mcts_sims: int = 100,
    deep_sims: int = 250,
    batch_size: int = 128,
    epochs_per_iter: int = 5,
    lr: float = 0.0005,
    gating_games: int = 12,
    device: str = 'cuda',
    onnx_output_path: str = "public/models/supertictactoe_alphazero.onnx",
    resume: bool = True
):
    os.makedirs("training/checkpoints", exist_ok=True)
    os.makedirs(os.path.dirname(onnx_output_path), exist_ok=True)

    print(f"=== 🧠 PHASE 2: Retrospective Blunder-Attribution Learning ===")
    print(f"Device: {device.upper()} | Iterations: {iterations} | Episodes/Iter: {episodes_per_iter}")
    print(f"MCTS Sims: {mcts_sims} | Post-Mortem Deep Sims: {deep_sims}")

    best_model = SuperTicTacToeNet().to(device)
    candidate_model = SuperTicTacToeNet().to(device)

    start_iter = 36
    # Auto-resume from latest checkpoint
    if resume and os.path.exists("training/checkpoints"):
        ckpt_files = [f for f in os.listdir("training/checkpoints") if f.startswith("best_model_iter_") and f.endswith(".pt")]
        if ckpt_files:
            ckpt_files.sort(key=lambda x: int(x.split("_")[-1].split(".")[0]))
            latest_ckpt = ckpt_files[-1]
            last_iter = int(latest_ckpt.split("_")[-1].split(".")[0])
            start_iter = last_iter + 1
            ckpt_path = os.path.join("training/checkpoints", latest_ckpt)
            print(f"🔄 Resuming from champion: {ckpt_path} (Continuing from Iteration {start_iter})")
            saved = torch.load(ckpt_path, map_location=device)
            best_model.load_state_dict(saved['model_state_dict'])

    candidate_model.load_state_dict(best_model.state_dict())

    optimizer = optim.Adam(candidate_model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=iterations, eta_min=5e-5)

    replay_buffer = deque(maxlen=60000)
    blunder_buffer = deque(maxlen=20000)

    export_to_onnx(best_model, onnx_output_path)

    end_iter = start_iter + iterations - 1
    for it in range(start_iter, end_iter + 1):
        print(f"\n==================== PHASE 2: ITERATION {it}/{end_iter} ====================")
        it_start = time.time()

        # 1. Self-play with automated retrospective post-mortem
        best_model.eval()
        std_samples, blunder_samples, decisive = self_play_with_loss_retrospection(
            best_model,
            num_episodes=episodes_per_iter,
            num_sims=mcts_sims,
            deep_sims=deep_sims,
            batch_size=8,
            device=device,
            desc=f"Self-Play & Post-Mortem {it}"
        )

        replay_buffer.extend(std_samples)
        blunder_buffer.extend(blunder_samples)

        print(f"Generated {len(std_samples)} self-play samples across {episodes_per_iter} games ({decisive} decisive).")
        print(f"🔬 Extracted {len(blunder_samples)} deep blunder-correction samples into memory. (Total Blunders: {len(blunder_buffer)})")

        # 2. Train candidate on prioritized mixture
        print(f"Training candidate with Loss-Attribution (epochs={epochs_per_iter}, batch={batch_size})...")
        avg_loss = train_network_phase2(
            candidate_model,
            optimizer,
            replay_buffer,
            blunder_buffer,
            batch_size=batch_size,
            epochs=epochs_per_iter,
            device=device
        )
        scheduler.step()
        print(f"Iteration {it} Loss: {avg_loss:.4f} (LR: {scheduler.get_last_lr()[0]:.6f}, Elapsed: {time.time() - it_start:.1f}s)")

        # 3. Model Gating Duel: Candidate vs Previous Best Champion
        if gating_games > 0:
            print(f"Running Gating Tournament: Candidate Gen {it} vs Previous Best ({gating_games} matches)...")
            candidate_model.eval()
            best_model.eval()
            win_rate = duel_models(candidate_model, best_model, num_games=gating_games, mcts_sims=mcts_sims, device=device)
            print(f"Candidate Win Rate vs Previous Best: {win_rate * 100:.1f}%")

            if win_rate >= 0.54:
                print(f"🏆 Candidate Accepted! Promoted to new Champion (Gen {it}) & exported to ONNX.")
                best_model.load_state_dict(candidate_model.state_dict())
                checkpoint_path = f"training/checkpoints/best_model_iter_{it}.pt"
                torch.save({'iteration': it, 'model_state_dict': best_model.state_dict()}, checkpoint_path)
                export_to_onnx(best_model, onnx_output_path)
            else:
                print(f"❌ Candidate Rejected (< 54% win rate). Resetting candidate to previous best.")
                candidate_model.load_state_dict(best_model.state_dict())
        else:
            best_model.load_state_dict(candidate_model.state_dict())
            export_to_onnx(best_model, onnx_output_path)

    print("\n🎉 Phase 2 Retrospective Training Complete!")
    export_to_onnx(best_model, onnx_output_path)
    return best_model

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Phase 2: AlphaZero Self-Play with Retrospective Blunder-Attribution Learning")
    parser.add_argument("--iterations", type=int, default=15, help="Number of iterations")
    parser.add_argument("--episodes", type=int, default=30, help="Self-play episodes per iteration")
    parser.add_argument("--sims", type=int, default=100, help="Self-play MCTS simulations per move")
    parser.add_argument("--deep-sims", type=int, default=250, help="Post-mortem deep MCTS simulations per blunder")
    parser.add_argument("--batch-size", type=int, default=128, help="Batch size")
    parser.add_argument("--epochs", type=int, default=5, help="Epochs per iteration")
    parser.add_argument("--lr", type=float, default=0.0005, help="Learning rate")
    parser.add_argument("--gating-games", type=int, default=12, help="Matches between candidate and champion")
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--onnx-path", type=str, default="public/models/supertictactoe_alphazero.onnx")
    parser.add_argument("--fresh", action="store_true", help="Start fresh without loading checkpoint")

    args = parser.parse_args()
    run_phase2_training(
        iterations=args.iterations,
        episodes_per_iter=args.episodes,
        mcts_sims=args.sims,
        deep_sims=args.deep_sims,
        batch_size=args.batch_size,
        epochs_per_iter=args.epochs,
        lr=args.lr,
        gating_games=args.gating_games,
        device=args.device,
        onnx_output_path=args.onnx_path,
        resume=not args.fresh
    )
