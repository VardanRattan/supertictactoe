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
from training.arena import JSBotPlayer
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
    """Applies D4 dihedral group symmetries (8 variations)."""
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

def play_adversarial_episode(
    model: SuperTicTacToeNet,
    js_bot: JSBotPlayer,
    neural_player: int,  # 1 for X, -1 for O
    mcts_sims: int = 50,
    device: str = 'cuda',
    temperature: float = 1.0
) -> tuple[list, int, int]:
    """
    Plays a single high-speed match between AlphaZero and the 100k-Tuned JS Bot.
    Returns:
    - samples: list of (tensor, pi, reward)
    - winner: 1 (X win), -1 (O win), 0 (draw)
    - num_moves: total moves played
    """
    game = SuperTicTacToeGame()
    mcts = MCTS(model, num_simulations=mcts_sims, c_puct=2.0, device=device)
    
    episode_data = []  # (tensor, pi, player_who_moved)
    
    move_count = 0
    while game.winner is None and move_count < 81:
        curr_p = game.current_player
        is_neural = (curr_p == neural_player)
        canonical_tensor = game.get_canonical_tensor()
        
        if is_neural:
            legal = game.get_legal_moves()
            # AlphaZero move via MCTS
            pi = mcts.search(game, add_dirichlet_noise=True, dirichlet_alpha=0.3, dirichlet_epsilon=0.25)
            pi[~legal] = 0.0

            # Apply tactical pruning
            tactical = filter_tactical_moves(game)
            if tactical and len(tactical) < 81:
                mask = np.zeros(81, dtype=bool)
                mask[tactical] = True
                if np.any(mask & legal):
                    pi[~mask] = 0.0

            # Temperature scaling for move selection
            if move_count >= 15:
                # Exploitation
                temp = 0.2
                pi_t = pi ** (1.0 / temp)
                s = np.sum(pi_t)
                pi_choice = (pi_t / s) if s > 0 else pi
            else:
                pi_choice = pi

            s_choice = np.sum(pi_choice)
            if s_choice > 0:
                pi_choice = pi_choice / s_choice
            else:
                pi_choice = np.zeros(81, dtype=np.float32)
                pi_choice[legal] = 1.0 / np.sum(legal)

            action = int(np.random.choice(len(pi_choice), p=pi_choice))
            episode_data.append((canonical_tensor, pi.astype(np.float32), curr_p))
        else:
            # JS Bot move
            action = js_bot.get_action(game)
            # Record JS Bot move for imitation learning (one-hot policy)
            one_hot_pi = np.zeros(81, dtype=np.float32)
            one_hot_pi[action] = 1.0
            episode_data.append((canonical_tensor, one_hot_pi, curr_p))

        game.step(action)
        move_count += 1

    winner = game.winner if game.winner is not None else 0

    # Process samples with final rewards
    augmented_samples = []
    for tensor, pi, p in episode_data:
        if winner == 0:
            val = 0.0
        else:
            val = 1.0 if winner == p else -1.0

        for sym_tensor, sym_pi in augment_symmetries(tensor, pi):
            augmented_samples.append((sym_tensor, sym_pi, val))

    return augmented_samples, winner, move_count

def evaluate_against_js(
    model: SuperTicTacToeNet,
    js_bot: JSBotPlayer,
    num_games: int = 6,
    mcts_sims: int = 60,
    device: str = 'cuda'
) -> dict:
    """Evaluates candidate model in deterministic matches against JS Bot."""
    model.eval()
    mcts = MCTS(model, num_simulations=mcts_sims, c_puct=2.0, device=device)

    wins = 0
    draws = 0
    losses = 0
    total_moves = 0
    boards_captured = 0

    for i in range(num_games):
        neural_p = 1 if i % 2 == 0 else -1
        game = SuperTicTacToeGame()

        moves = 0
        while game.winner is None and moves < 81:
            if game.current_player == neural_p:
                legal = game.get_legal_moves()
                pi = mcts.search(game, add_dirichlet_noise=False)
                pi[~legal] = 0.0
                tactical = filter_tactical_moves(game)
                if tactical and len(tactical) < 81:
                    mask = np.zeros(81, dtype=bool)
                    mask[tactical] = True
                    if np.any(mask & legal):
                        pi[~mask] = 0.0

                if np.max(pi) > 0:
                    action = int(np.argmax(pi))
                else:
                    legal_indices = np.where(legal)[0]
                    action = int(legal_indices[0])
            else:
                action = js_bot.get_action(game)

            game.step(action)
            moves += 1
            
        total_moves += moves
        winner = game.winner if game.winner is not None else 0
        
        # Count sub-boards won by neural player
        neural_boards = np.sum(game.ownership == neural_p)
        boards_captured += neural_boards
        
        if winner == neural_p:
            wins += 1
        elif winner == 0:
            draws += 1
        else:
            losses += 1
            
    return {
        "wins": wins,
        "draws": draws,
        "losses": losses,
        "total_games": num_games,
        "win_rate": (wins + 0.5 * draws) / num_games,
        "avg_moves": total_moves / num_games,
        "avg_boards_captured": boards_captured / num_games
    }

def train_network(
    model: SuperTicTacToeNet,
    dataset: list,
    epochs: int = 5,
    batch_size: int = 64,
    lr: float = 1e-3,
    device: str = 'cuda'
) -> float:
    """Trains network using mixed-precision GPU acceleration for maximum compute efficiency."""
    model.train()
    loader = DataLoader(AlphaZeroDataset(dataset), batch_size=batch_size, shuffle=True, drop_last=True)
    
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scaler = torch.cuda.amp.GradScaler(enabled=(device == 'cuda'))
    
    total_loss_accum = 0.0
    steps = 0
    
    for epoch in range(epochs):
        for tensors, pis, values in loader:
            tensors = tensors.to(device)
            pis = pis.to(device)
            values = values.to(device)
            
            optimizer.zero_grad(set_to_none=True)
            
            with torch.cuda.amp.autocast(enabled=(device == 'cuda')):
                p_logits, v = model(tensors)
                # Cross-entropy policy loss with log_softmax
                log_probs = torch.log_softmax(p_logits, dim=1)
                policy_loss = -torch.mean(torch.sum(pis * log_probs, dim=1))
                # Mean squared error value loss
                value_loss = nn.MSELoss()(v, values)
                total_loss = policy_loss + value_loss
                
            scaler.scale(total_loss).backward()
            scaler.unscale_(optimizer)
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            scaler.step(optimizer)
            scaler.update()
            
            total_loss_accum += total_loss.item()
            steps += 1
            
    return total_loss_accum / max(1, steps)

def main():
    parser = argparse.ArgumentParser(description="Phase 3: Ultra-Optimized Adversarial Sparring with 100k-Tuned JS Bot")
    parser.add_argument("--generations", type=int, default=2, help="Number of generations to run (default: 2)")
    parser.add_argument("--target-gen", type=int, default=None, help="Target generation number to reach (e.g. 75)")
    parser.add_argument("--episodes", type=int, default=16, help="Episodes per generation (default: 16)")
    parser.add_argument("--sims", type=int, default=50, help="MCTS simulations per turn (default: 50)")
    parser.add_argument("--epochs", type=int, default=5, help="Training epochs per generation (default: 5)")
    parser.add_argument("--batch-size", type=int, default=64, help="Mini-batch size (default: 64)")
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--checkpoint-dir", type=str, default="training/checkpoints")
    args = parser.parse_args()

    os.makedirs(args.checkpoint_dir, exist_ok=True)

    # Load latest available checkpoint
    ckpts = [f for f in os.listdir(args.checkpoint_dir) if f.startswith("best_model_iter_") and f.endswith(".pt")]
    if ckpts:
        ckpts.sort(key=lambda x: int(x.split("_")[-1].replace(".pt", "")))
        init_ckpt = os.path.join(args.checkpoint_dir, ckpts[-1])
    else:
        init_ckpt = os.path.join(args.checkpoint_dir, "best_model_iter_50.pt")

    start_gen = int(os.path.basename(init_ckpt).split("_")[-1].replace(".pt", ""))
    if args.target_gen is not None:
        args.generations = max(1, args.target_gen - start_gen)

    print(f"\n=======================================================")
    print(f"🚀 PHASE 3: ULTRA-SUPER OPTIMIZED ADVERSARIAL SPARRING")
    print(f"Target: Direct Sparring with 100k-Tuned JS Strategy Bot")
    print(f"Device: {args.device.upper()} | Precision: AMP FP16 | Budget: {args.generations} Generations (Gen {start_gen + 1} -> Gen {start_gen + args.generations})")
    print(f"Episodes/Gen: {args.episodes} ({args.episodes//2} as X, {args.episodes//2} as O) | MCTS Sims: {args.sims}")
    print(f"=======================================================\n")

    print(f"📦 Loaded Base Champion Checkpoint: {init_ckpt} (Generation {start_gen})")

    model = SuperTicTacToeNet().to(args.device)
    ckpt = torch.load(init_ckpt, map_location=args.device)
    model.load_state_dict(ckpt["model_state_dict"])
    
    # Initialize Persistent JS Bot Bridge (Bitboard Protocol)
    js_bot = JSBotPlayer()
    
    replay_buffer = deque(maxlen=25000)

    try:
        for g_step in range(1, args.generations + 1):
            current_gen = start_gen + g_step
            print(f"\n-------------------------------------------------------")
            print(f"⚡ GENERATION {current_gen} (Phase 3 Sparring Step {g_step}/{args.generations})")
            print(f"-------------------------------------------------------")
            
            t0 = time.time()
            gen_samples = []
            results = {"X_wins": 0, "O_wins": 0, "draws": 0, "neural_wins": 0}
            game_lengths = []
            
            pbar = tqdm(total=args.episodes, desc=f"Sparring Gen {current_gen} vs JS Bot")
            for ep in range(args.episodes):
                # Alternate playing as X and O
                neural_player = 1 if ep % 2 == 0 else -1
                samples, winner, moves = play_adversarial_episode(
                    model=model,
                    js_bot=js_bot,
                    neural_player=neural_player,
                    mcts_sims=args.sims,
                    device=args.device
                )
                
                gen_samples.extend(samples)
                game_lengths.append(moves)
                
                if winner == 1:
                    results["X_wins"] += 1
                elif winner == -1:
                    results["O_wins"] += 1
                else:
                    results["draws"] += 1
                    
                if winner == neural_player:
                    results["neural_wins"] += 1
                    
                pbar.update(1)
            pbar.close()
            
            # Update replay buffer
            replay_buffer.extend(gen_samples)
            sparring_time = time.time() - t0
            
            print(f"📊 Sparring Summary: {args.episodes} games in {sparring_time:.1f}s ({sparring_time/args.episodes:.2f}s/game)")
            print(f"   AlphaZero Wins: {results['neural_wins']} | Draws: {results['draws']} | Total Samples (Augmented): {len(gen_samples)}")
            print(f"   Avg Game Length: {np.mean(game_lengths):.1f} moves")
            
            # Learning rate schedule with smooth decay
            lr = max(1e-4, 5e-4 * (0.95 ** (g_step - 1)))
            print(f"🧠 Training Neural Network on GPU (FP16 AMP, lr={lr:.6f}, Buffer: {len(replay_buffer)})...")
            t_train = time.time()
            loss = train_network(
                model=model,
                dataset=list(replay_buffer),
                epochs=args.epochs,
                batch_size=args.batch_size,
                lr=lr,
                device=args.device
            )
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            print(f"   Training completed in {time.time() - t_train:.1f}s | Average Loss: {loss:.4f}")

            # Save Checkpoint
            new_ckpt_path = os.path.join(args.checkpoint_dir, f"best_model_iter_{current_gen}.pt")
            torch.save({
                "iteration": current_gen,
                "model_state_dict": model.state_dict(),
                "training_loss": loss
            }, new_ckpt_path)
            print(f"💾 Checkpoint Saved: {new_ckpt_path}")

            # Benchmark Evaluation Tournament vs JS Bot (4 games regular, 8 games on final)
            is_final_gen = (current_gen == start_gen + args.generations)
            num_eval = 8 if is_final_gen else 4
            print(f"⚔️ Evaluation Tournament ({num_eval} Games vs JS Bot, {num_eval//2} as X, {num_eval//2} as O)...")
            t_eval = time.time()
            eval_metrics = evaluate_against_js(
                model=model,
                js_bot=js_bot,
                num_games=num_eval,
                mcts_sims=args.sims + 10,
                device=args.device
            )
            print(f"   Evaluation took {time.time() - t_eval:.1f}s")
            print(f"   Score: {eval_metrics['wins']} Wins, {eval_metrics['draws']} Draws, {eval_metrics['losses']} Losses")
            print(f"   Win Rate: {eval_metrics['win_rate']*100:.1f}% | Avg Survival Depth: {eval_metrics['avg_moves']:.1f} moves | Avg Boards Won: {eval_metrics['avg_boards_captured']:.2f}")
            if eval_metrics['wins'] > 0:
                print(f"   🏆 SENSATIONAL BREAKTHROUGH: AlphaZero defeated 100k-Tuned JS Bot in {eval_metrics['wins']} evaluation games!")

        # Final ONNX Export
        print(f"\n📦 Exporting Final Generation {start_gen + args.generations} Champion to ONNX...")
        export_to_onnx(model, "public/models/supertictactoe_alphazero.onnx")
        print(f"✅ ONNX model successfully updated at public/models/supertictactoe_alphazero.onnx!")
        print(f"🎉 Phase 3 Training Complete in record time!\n")

    finally:
        js_bot.close()

if __name__ == "__main__":
    main()
