"""
Game analysis logic.
Runs Stockfish on every position in a PGN and classifies each move.
"""

import io
import logging
import math
from typing import Any, Callable, Coroutine, Dict, List, Optional

import chess
import chess.pgn

from engine import engine_manager

logger = logging.getLogger(__name__)

# Centipawn-loss thresholds for move classification (Best / Brilliant handled separately)
_THRESHOLDS = [
    (10,       "Excellent"),
    (25,       "Good"),
    (100,      "Inaccuracy"),
    (200,      "Mistake"),
    (math.inf, "Blunder"),
]

# Approximate material values in centipawns (used for sacrifice detection)
_PIECE_VALUE = {
    chess.PAWN:   100,
    chess.KNIGHT: 305,
    chess.BISHOP: 333,
    chess.ROOK:   563,
    chess.QUEEN:  950,
    chess.KING:   20_000,
}

_ALL_CLASSIFICATIONS = ["Brilliant", "Best", "Excellent", "Good", "Inaccuracy", "Mistake", "Blunder"]


def _is_sacrifice(board: chess.Board, move: chess.Move) -> bool:
    """
    Return True when the moving piece lands on a square where a less-valuable
    opponent piece can immediately recapture it.  Pawn and king moves are excluded
    because pawns capturing forward is normal and kings never sacrifice themselves.
    """
    piece = board.piece_at(move.from_square)
    if not piece or piece.piece_type in (chess.PAWN, chess.KING):
        return False

    board_after = board.copy()
    board_after.push(move)

    mover_value = _PIECE_VALUE.get(piece.piece_type, 0)
    for sq in board_after.attackers(not piece.color, move.to_square):
        attacker = board_after.piece_at(sq)
        if attacker and _PIECE_VALUE.get(attacker.piece_type, 0) < mover_value:
            return True
    return False


def classify_move(cp_loss: float, is_best: bool, is_sac: bool = False) -> str:
    """
    Classify a move by centipawn loss and engine agreement.
    Brilliant = engine's top choice AND a material sacrifice.
    """
    if is_best and is_sac:
        return "Brilliant"
    if is_best:
        return "Best"
    for limit, label in _THRESHOLDS:
        if cp_loss <= limit:
            return label
    return "Blunder"


def calculate_accuracy(cp_losses: List[float]) -> float:
    """
    Approximate Chess.com accuracy formula:
    accuracy = 103.1668 * e^(-0.04354 * avg_loss) - 3.1668
    """
    if not cp_losses:
        return 100.0
    avg = sum(cp_losses) / len(cp_losses)
    accuracy = 103.1668 * math.exp(-0.04354 * avg) - 3.1668
    return round(max(0.0, min(100.0, accuracy)), 1)


def _clamp_eval(eval_cp: int, cap: int = 1000) -> float:
    """Clamp centipawns to ±cap and convert to pawns for graph display."""
    return max(-cap, min(cap, eval_cp)) / 100


async def analyze_game(
    pgn_str: str,
    depth: int = 15,
    on_progress: Optional[Callable[[int, int], Coroutine]] = None,
) -> Dict[str, Any]:
    """
    Analyze every move of a PGN game with Stockfish.

    Args:
        pgn_str:     PGN text.
        depth:       Stockfish search depth (default 15; use 18-20 for deep analysis).
        on_progress: Optional async callback(current, total) called after each move.

    Returns per-move data plus aggregate accuracy and count stats.
    """
    game = chess.pgn.read_game(io.StringIO(pgn_str))
    if not game:
        raise ValueError("Invalid or empty PGN")

    headers = dict(game.headers)
    board = game.board()
    all_moves = list(game.mainline_moves())
    total = len(all_moves)

    # Evaluate the starting position so the graph starts correctly
    init = await engine_manager.analyze_position(board.fen(), depth=depth, multipv=1)
    prev_eval_cp: int = init[0]["eval_cp"] if init else 0

    moves_out: List[Dict[str, Any]] = []
    white_losses: List[float] = []
    black_losses: List[float] = []

    counts: Dict[str, Dict[str, int]] = {
        "white": {k: 0 for k in _ALL_CLASSIFICATIONS},
        "black": {k: 0 for k in _ALL_CLASSIFICATIONS},
    }

    for i, move in enumerate(all_moves):
        is_white = board.turn == chess.WHITE
        player = "white" if is_white else "black"
        fen_before = board.fen()
        move_san = board.san(move)

        # Engine suggestion BEFORE this move (multipv=3 for alternatives)
        analysis_before = await engine_manager.analyze_position(
            fen_before, depth=depth, multipv=3
        )

        if analysis_before:
            best_uci     = analysis_before[0]["best_move_uci"]
            best_san     = analysis_before[0]["best_move_san"]
            eval_best_cp = analysis_before[0]["eval_cp"]
            alternatives = [
                {"move": a["best_move_san"], "eval": a["eval"]}
                for a in analysis_before[1:]
                if a.get("best_move_san") and a["best_move_san"] != move_san
            ]
        else:
            best_uci = best_san = None
            eval_best_cp = prev_eval_cp
            alternatives = []

        # Sacrifice check must happen BEFORE the move is pushed onto the board
        is_sac = _is_sacrifice(board, move)

        board.push(move)
        fen_after = board.fen()

        # Engine eval AFTER the move
        analysis_after = await engine_manager.analyze_position(
            fen_after, depth=depth, multipv=1
        )
        eval_after_cp: int = analysis_after[0]["eval_cp"] if analysis_after else prev_eval_cp

        # Centipawn loss = best possible eval – actual eval (from the mover's perspective)
        if is_white:
            cp_loss = max(0.0, eval_best_cp - eval_after_cp)
        else:
            cp_loss = max(0.0, eval_after_cp - eval_best_cp)

        is_best        = move.uci() == best_uci
        classification = classify_move(cp_loss, is_best, is_sac)

        (white_losses if is_white else black_losses).append(cp_loss)
        counts[player][classification] += 1

        moves_out.append(
            {
                "move_number":    i // 2 + 1,
                "half_move":      i + 1,
                "player":         player,
                "move":           move_san,
                "move_uci":       move.uci(),
                "eval":           _clamp_eval(eval_after_cp),
                "eval_cp":        eval_after_cp,
                "best_move":      best_san,
                "best_move_uci":  best_uci,
                "cp_loss":        round(cp_loss, 1),
                "classification": classification,
                "is_sacrifice":   is_sac and is_best,
                "fen_before":     fen_before,
                "fen_after":      fen_after,
                "alternatives":   alternatives[:2],
            }
        )

        prev_eval_cp = eval_after_cp

        if on_progress:
            await on_progress(i + 1, total)

    return {
        "moves":           moves_out,
        "accuracy_white":  calculate_accuracy(white_losses),
        "accuracy_black":  calculate_accuracy(black_losses),
        "counts_white":    counts["white"],
        "counts_black":    counts["black"],
        "opening":         headers.get("Opening", "Unknown Opening"),
        "eco":             headers.get("ECO", ""),
        "headers":         headers,
        "initial_eval":    _clamp_eval(init[0]["eval_cp"] if init else 0),
    }
