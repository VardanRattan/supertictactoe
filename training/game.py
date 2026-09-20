import numpy as np
import torch

WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
]

class SuperTicTacToeGame:
    """
    Super Tic-Tac-Toe environment with exact canonical rule fidelity:
    - 9 local 3x3 boards arranged in a 3x3 super-grid (81 cells total).
    - Playing in an already-won sub-board IS legal until all 9 cells are full.
    - Fallback routing: target -> previous board -> history reverse -> 0..8 sequential.
    - Action space: 81 discrete actions (action = game * 9 + cell).
    """

    def __init__(self):
        self.reset()

    def reset(self):
        # 9 sub-boards, each with 9 cells: 0 = empty, 1 = Player 1, -1 = Player 2
        self.board = np.zeros((9, 9), dtype=np.int8)
        # Ownership of each sub-board: 0 = unclaimed, 1 = Player 1, -1 = Player 2
        self.ownership = np.zeros(9, dtype=np.int8)
        self.current_player = 1  # 1 (Player 1 / X) or -1 (Player 2 / O)
        self.active_game = -1   # -1 denotes free choice across all uncompleted boards
        self.history = []
        self.last_move = None
        self.winner = None      # None (ongoing), 1 (P1 win), -1 (P2 win), 0 (draw)
        return self

    def clone(self):
        new_game = SuperTicTacToeGame()
        new_game.board = self.board.copy()
        new_game.ownership = self.ownership.copy()
        new_game.current_player = self.current_player
        new_game.active_game = self.active_game
        new_game.history = list(self.history)
        new_game.last_move = self.last_move
        new_game.winner = self.winner
        return new_game

    def get_legal_moves(self) -> np.ndarray:
        """Returns a boolean array of shape (81,) indicating legal actions."""
        legal = np.zeros(81, dtype=bool)
        if self.winner is not None:
            return legal

        if self.active_game != -1 and np.any(self.board[self.active_game] == 0):
            g = self.active_game
            for c in range(9):
                if self.board[g, c] == 0:
                    legal[g * 9 + c] = True
            return legal

        # Free move: can play in any board that has at least one empty cell
        for g in range(9):
            if np.any(self.board[g] == 0):
                for c in range(9):
                    if self.board[g, c] == 0:
                        legal[g * 9 + c] = True

        return legal

    def _is_board_won(self, b: np.ndarray, player: int) -> bool:
        for x, y, z in WIN_LINES:
            if b[x] == player and b[y] == player and b[z] == player:
                return True
        return False

    def _find_valid_game(self, target: int, fallback: int) -> int:
        """Canonical routing matching pre-game-screen.tsx."""
        def is_playable(g: int) -> bool:
            return 0 <= g < 9 and np.any(self.board[g] == 0)

        if is_playable(target):
            return target
        if is_playable(fallback):
            return fallback
        for h in reversed(self.history):
            if is_playable(h):
                return h
        for g in range(9):
            if is_playable(g):
                return g
        return -1

    def step(self, action: int):
        """
        Executes action (0..80) for current_player.
        Returns: (reward, done) from perspective of current_player before step.
        """
        g = action // 9
        c = action % 9

        if self.board[g, c] != 0 or self.winner is not None:
            raise ValueError(f"Illegal move {action} (game={g}, cell={c})")

        p = self.current_player
        self.board[g, c] = p
        self.history.append(g)
        self.last_move = (g, c)

        # 1. Local board win check (ownership is permanent once won)
        if self.ownership[g] == 0:
            if self._is_board_won(self.board[g], p):
                self.ownership[g] = p

        # 2. Super board win check
        if self._is_board_won(self.ownership, p):
            self.winner = p
            self.active_game = -1
            return 1.0, True

        # 3. Super board draw check (all 81 cells full)
        if np.all(self.board != 0):
            self.winner = 0
            self.active_game = -1
            return 0.0, True

        # 4. Route next active board
        self.active_game = self._find_valid_game(c, g)
        if self.active_game == -1:
            # Check if any moves exist anywhere
            if not np.any(self.board == 0):
                self.winner = 0
                return 0.0, True

        self.current_player = -self.current_player
        return 0.0, False

    def get_canonical_tensor(self) -> torch.Tensor:
        """
        Encodes the board state from the perspective of current_player into
        a (6, 9, 9) spatial tensor suitable for a Convolutional ResNet.

        Channels:
        0: Current player's pieces (1 if mine, 0 otherwise)
        1: Opponent's pieces (1 if opponent, 0 otherwise)
        2: Sub-board ownership: current player (1 in full 3x3 block if owned, 0 otherwise)
        3: Sub-board ownership: opponent (1 in full 3x3 block if owned, 0 otherwise)
        4: Legal moves mask (1 where playable, 0 otherwise)
        5: Active board mask (1 on playable sub-board, or all 1s if free move)
        """
        tensor = np.zeros((6, 9, 9), dtype=np.float32)
        p = self.current_player
        opp = -p

        # Reshape local boards into 9x9 spatial grid
        # Board indices 0..8 mapped to 3x3 macro blocks:
        # Board 0 is rows 0..2, cols 0..2
        # Board 1 is rows 0..2, cols 3..5, etc.
        for g in range(9):
            brow = (g // 3) * 3
            bcol = (g % 3) * 3
            for c in range(9):
                r = brow + (c // 3)
                col = bcol + (c % 3)

                val = self.board[g, c]
                if val == p:
                    tensor[0, r, col] = 1.0
                elif val == opp:
                    tensor[1, r, col] = 1.0

            # Sub-board ownership
            owner = self.ownership[g]
            if owner == p:
                tensor[2, brow:brow+3, bcol:bcol+3] = 1.0
            elif owner == opp:
                tensor[3, brow:brow+3, bcol:bcol+3] = 1.0

        # Legal moves mask
        legal = self.get_legal_moves()
        for a in range(81):
            if legal[a]:
                g = a // 9
                c = a % 9
                r = (g // 3) * 3 + (c // 3)
                col = (g % 3) * 3 + (c % 3)
                tensor[4, r, col] = 1.0

        # Active board mask
        if self.active_game != -1:
            brow = (self.active_game // 3) * 3
            bcol = (self.active_game % 3) * 3
            tensor[5, brow:brow+3, bcol:bcol+3] = 1.0
        else:
            tensor[5, :, :] = 1.0

        return torch.from_numpy(tensor)

def get_macro_threat_boards(ownership: np.ndarray, board: np.ndarray, opp_player: int) -> set:
    """
    Returns set of board indices (0..8) where opp_player can win that board in 1 move,
    and winning that board immediately wins the entire match (3-in-a-row on macro board).
    """
    threat_boards = set()
    for line in WIN_LINES:
        opp_count = sum(1 for b in line if ownership[b] == opp_player)
        empty_boards = [b for b in line if ownership[b] == 0]
        if opp_count == 2 and len(empty_boards) == 1:
            target_b = empty_boards[0]
            b_state = board[target_b]
            for sub_line in WIN_LINES:
                sub_opp = sum(1 for c in sub_line if b_state[c] == opp_player)
                sub_empty = [c for c in sub_line if b_state[c] == 0]
                if sub_opp == 2 and len(sub_empty) == 1:
                    threat_boards.add(target_b)
                    break
    return threat_boards

def filter_tactical_moves(game: SuperTicTacToeGame, legal_actions: np.ndarray = None) -> list[int]:
    """
    Filters legal actions by:
    1. If any action wins the match immediately, returns ONLY the winning action(s).
    2. Otherwise, prunes suicide moves (moves that route opponent to a board where
       opponent can win the match on their next turn), provided safe alternatives exist.
    """
    if legal_actions is None:
        legal_actions = np.where(game.get_legal_moves())[0]

    if len(legal_actions) <= 1:
        return list(legal_actions)

    p = game.current_player
    opp = -p

    # 1. Instant match win check
    instant_wins = []
    for a in legal_actions:
        test_g = game.clone()
        test_g.step(a)
        if test_g.winner == p:
            instant_wins.append(a)

    if instant_wins:
        return instant_wins

    # 2. Anti-suicide check
    threats = get_macro_threat_boards(game.ownership, game.board, opp)
    if not threats:
        return list(legal_actions)

    safe_actions = []
    for a in legal_actions:
        test_g = game.clone()
        test_g.step(a)
        is_suicide = (test_g.active_game in threats) or (test_g.active_game == -1 and len(threats) > 0)
        if not is_suicide:
            safe_actions.append(a)

    return safe_actions if safe_actions else list(legal_actions)

