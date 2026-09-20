import math
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import torch
from training.game import SuperTicTacToeGame
from training.model import SuperTicTacToeNet

class MCTSNode:
    def __init__(self, prior: float = 0.0):
        self.prior = prior
        self.visit_count = 0
        self.total_value = 0.0
        self.children = {}  # action -> MCTSNode
        self.is_expanded = False

    @property
    def value(self) -> float:
        if self.visit_count == 0:
            return 0.0
        return self.total_value / self.visit_count

class MCTS:
    """
    Monte Carlo Tree Search with PUCT exploration formula for AlphaZero.
    """

    def __init__(
        self,
        model: SuperTicTacToeNet,
        num_simulations: int = 100,
        c_puct: float = 2.0,
        device: str = 'cuda'
    ):
        self.model = model
        self.num_simulations = num_simulations
        self.c_puct = c_puct
        self.device = device

    def search(
        self,
        game: SuperTicTacToeGame,
        add_dirichlet_noise: bool = False,
        dirichlet_alpha: float = 0.3,
        dirichlet_epsilon: float = 0.25
    ) -> np.ndarray:
        """
        Runs `num_simulations` MCTS simulations from the current state of `game`.
        Returns visit count distribution over all 81 actions.
        """
        root = MCTSNode()

        # Initial expansion of root
        legal_mask = game.get_legal_moves()
        tensor = game.get_canonical_tensor().unsqueeze(0).to(self.device)
        legal_tensor = torch.from_numpy(legal_mask).unsqueeze(0).to(self.device)

        policy_probs, _ = self.model.predict(tensor, legal_tensor)
        policy = policy_probs[0].cpu().numpy()

        # Add Dirichlet noise to root priors during self-play for exploration
        if add_dirichlet_noise:
            legal_indices = np.where(legal_mask)[0]
            if len(legal_indices) > 0:
                noise = np.random.dirichlet([dirichlet_alpha] * len(legal_indices))
                policy[legal_indices] = (
                    (1.0 - dirichlet_epsilon) * policy[legal_indices] +
                    dirichlet_epsilon * noise
                )

        for a in range(81):
            if legal_mask[a]:
                root.children[a] = MCTSNode(prior=policy[a])
        root.is_expanded = True

        # Run simulations
        for _ in range(self.num_simulations):
            sim_game = game.clone()
            node = root
            search_path = [node]
            actions_taken = []

            # 1. Selection
            while node.is_expanded and not sim_game.winner is not None:
                action, next_node = self._select_child(node)
                actions_taken.append(action)
                sim_game.step(action)
                node = next_node
                search_path.append(node)

            # 2. Evaluation & Expansion
            if sim_game.winner is not None:
                # Terminal node: value from perspective of player who made the last move
                if sim_game.winner == 0:
                    value = 0.0
                else:
                    # If the winner is the player who just moved, value is +1
                    # Since step() toggles current_player, winner == -current_player means previous player won!
                    value = 1.0 if sim_game.winner == -sim_game.current_player else -1.0
            else:
                # Leaf node: evaluate with neural network
                sim_legal = sim_game.get_legal_moves()
                sim_tensor = sim_game.get_canonical_tensor().unsqueeze(0).to(self.device)
                sim_legal_tensor = torch.from_numpy(sim_legal).unsqueeze(0).to(self.device)

                sim_policy, sim_value = self.model.predict(sim_tensor, sim_legal_tensor)
                policy_np = sim_policy[0].cpu().numpy()
                value = float(sim_value.item())

                # Expand leaf node
                for a in range(81):
                    if sim_legal[a]:
                        node.children[a] = MCTSNode(prior=policy_np[a])
                node.is_expanded = True

            # 3. Backpropagation
            # The value returned is from perspective of sim_game.current_player at the leaf.
            # As we traverse up the search path, each step switches perspective (multiply by -1).
            for i in range(len(search_path) - 1, -1, -1):
                path_node = search_path[i]
                path_node.visit_count += 1
                path_node.total_value += value
                value = -value

        # Build policy distribution from root visit counts
        action_visits = np.zeros(81, dtype=np.float32)
        for a, child in root.children.items():
            action_visits[a] = child.visit_count

        total_visits = np.sum(action_visits)
        if total_visits > 0:
            return action_visits / total_visits
        return action_visits

    def _select_child(self, node: MCTSNode):
        """Selects child maximizing PUCT formula."""
        best_score = -float('inf')
        best_action = -1
        best_child = None

        sqrt_total_visits = math.sqrt(max(1, node.visit_count))

        for action, child in node.children.items():
            # Q value (exploitation)
            q_value = child.value

            # U value (exploration)
            u_value = (
                self.c_puct * child.prior * (sqrt_total_visits / (1 + child.visit_count))
            )

            score = q_value + u_value
            if score > best_score:
                best_score = score
                best_action = action
                best_child = child

        return best_action, best_child
