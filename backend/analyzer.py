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

# Opening phase: half-moves where an engine-top move may be classified as Book
_BOOK_HALF_MOVES = 16  # first 8 full moves

# Chess.com Expected Points logistic constant
_K = 0.00368208

# ΔQ thresholds (win-probability loss from mover's perspective)
_DQ_EXCELLENT  = 0.02
_DQ_GOOD       = 0.05
_DQ_INACCURACY = 0.10
_DQ_MISTAKE    = 0.20


def _win_prob(cp: float) -> float:
    """Win probability for White [0, 1] using chess.com's logistic model."""
    try:
        return 1.0 / (1.0 + math.exp(-_K * max(-5000.0, min(5000.0, float(cp)))))
    except (OverflowError, ValueError):
        return 0.0 if cp < 0 else 1.0


def _delta_q(eval_best_cp: int, eval_after_cp: int, player: str) -> float:
    """Win-probability loss for the mover (ΔQ), always ≥ 0."""
    wp_best  = _win_prob(eval_best_cp)
    wp_after = _win_prob(eval_after_cp)
    if player == "white":
        return max(0.0, wp_best - wp_after)
    else:                           # black: lower white eval = better for black
        return max(0.0, wp_after - wp_best)

# Approximate material values in centipawns (used for sacrifice detection)
_PIECE_VALUE = {
    chess.PAWN:   100,
    chess.KNIGHT: 305,
    chess.BISHOP: 333,
    chess.ROOK:   563,
    chess.QUEEN:  950,
    chess.KING:   20_000,
}

_ALL_CLASSIFICATIONS = [
    "Brilliant", "Great", "Book", "Best",
    "Excellent", "Good", "Inaccuracy", "Mistake", "Miss", "Blunder",
]


_MATE_THRESHOLD = 99_000  # centipawns treated as forced mate

def _material_label(cp: float) -> str:
    """Describe material in human terms, not raw centipawns."""
    if cp < 30:
        return "a tiny edge"
    if cp < 90:
        return "some initiative"
    if cp < 160:
        return "a pawn"
    if cp < 270:
        return "the exchange"
    if cp < 420:
        return "a piece"
    if cp < 700:
        return "a rook"
    if cp < 1100:
        return "the queen"
    return "decisive material"


def _position_label(cp: int) -> str:
    """Describe a position from the mover's perspective (positive cp = mover is better)."""
    if cp >= 600: return "a decisive advantage"
    if cp >= 300: return "a strong advantage"
    if cp >= 100: return "a clear edge"
    if cp >= 40:  return "a slight edge"
    if cp >= -40: return "an equal position"
    if cp >= -100: return "a slight disadvantage"
    if cp >= -300: return "a clear disadvantage"
    return "a losing position"


def _generate_commentary(
    classification: str,
    cp_loss: float,
    is_sac: bool,
    move_san: str,
    best_san: Optional[str],
    player: str,
    pv_san: List[str],
    eval_best_cp: int,
    eval_after_cp: int,
    eval_before_cp: int = 0,
) -> str:
    """Generate dynamic commentary describing what the move actually achieved."""
    mover    = "White" if player == "white" else "Black"
    opponent = "Black" if player == "white" else "White"
    sign     = 1 if player == "white" else -1

    # Mover-perspective evals (positive = mover is winning)
    m_before = sign * eval_before_cp
    m_after  = sign * eval_after_cp
    m_best   = sign * eval_best_cp

    lbl_before = _position_label(m_before)
    lbl_after  = _position_label(m_after)
    lbl_best   = _position_label(m_best)

    # Mate scenario detection
    best_is_mate  = abs(eval_best_cp)  >= _MATE_THRESHOLD
    after_is_mate = abs(eval_after_cp) >= _MATE_THRESHOLD
    mover_mated   = after_is_mate and m_after < 0
    missed_mate   = best_is_mate and not after_is_mate and m_best > 0

    # ── Brilliant ─────────────────────────────────────────────────────────
    if classification == "Brilliant":
        if is_sac:
            pv_str = f" Best continuation: {' '.join(pv_san[1:4])}." if len(pv_san) > 1 else ""
            return f"A brilliant sacrifice! {mover} gives up material to seize {lbl_after}.{pv_str}"
        return f"A brilliant move, converting {lbl_before} into {lbl_after} with precise calculation."

    # ── Great ─────────────────────────────────────────────────────────────
    if classification == "Great":
        if m_before < -40 and m_after >= -40:
            return f"A great defensive resource! {mover} escapes from {lbl_before} and reaches {lbl_after}."
        if m_after >= m_before + 150:
            return f"A great move that swings the position from {lbl_before} to {lbl_after}."
        return f"An excellent move that pushes {mover}'s advantage to {lbl_after}."

    # ── Book ──────────────────────────────────────────────────────────────
    if classification == "Book":
        return "A standard opening move, following established theory."

    # ── Best ──────────────────────────────────────────────────────────────
    if classification == "Best":
        if missed_mate and best_san:
            return f"The correct move. Note that {best_san} leads to a forced checkmate for {mover}."
        if m_after >= 300:
            return f"The best move, maintaining {lbl_after} for {mover}."
        if m_before < -40 and m_after >= -40:
            return f"The best defensive reply, holding to {lbl_after}."
        return f"The engine's top choice, keeping the position at {lbl_after}."

    # ── Excellent ─────────────────────────────────────────────────────────
    if classification == "Excellent":
        gap = m_best - m_after
        if gap <= 15:
            return f"Nearly perfect play, holding {lbl_after} for {mover}."
        return f"An excellent move, staying at {lbl_after} with only a {gap} cp gap to the engine's best."

    # ── Good ──────────────────────────────────────────────────────────────
    if classification == "Good":
        if best_san:
            return f"A solid move that keeps {lbl_after}. {best_san} was slightly stronger but this is fully playable."
        return f"A sensible move that maintains {lbl_after}."

    # ── Error classifications — describe the actual damage done ───────────
    material  = _material_label(cp_loss)
    best_hint = f" The better option was {best_san}." if best_san else ""

    # ── Inaccuracy ────────────────────────────────────────────────────────
    if classification == "Inaccuracy":
        if best_san:
            return (
                f"A slight inaccuracy. The position eases from {lbl_before} to {lbl_after}. "
                f"{best_san} would have kept {lbl_best}."
            )
        return f"A slight inaccuracy; the edge slips from {lbl_before} to {lbl_after}."

    # ── Miss ──────────────────────────────────────────────────────────────
    if classification == "Miss":
        if best_san:
            return (
                f"{mover} had {lbl_before} but missed the moment. "
                f"{best_san} keeps {lbl_best}, but now only {lbl_after} remains."
            )
        return f"{mover} had {lbl_before} but lets it slip to {lbl_after}."

    # ── Mistake ───────────────────────────────────────────────────────────
    if classification == "Mistake":
        if mover_mated:
            return f"A serious mistake that walks into a mating net.{best_hint}"
        if missed_mate:
            return (
                f"Missing a winning continuation. {best_san} delivers forced checkmate, "
                f"but now {opponent} escapes."
            )
        return f"A mistake. {mover} drops from {lbl_before} to {lbl_after}, giving away {material}.{best_hint}"

    # ── Blunder ───────────────────────────────────────────────────────────
    if classification == "Blunder":
        if mover_mated:
            pv_str = f" Forced: {' '.join(pv_san[:4])}." if pv_san else ""
            return f"A blunder that leads to checkmate!{best_hint}{pv_str}"
        if missed_mate:
            return (
                f"Missing a forced checkmate! {best_san} wins on the spot, "
                f"but now {opponent} survives and fights back."
            )
        return (
            f"A blunder that collapses the position from {lbl_before} to {lbl_after}, "
            f"dropping {material}.{best_hint}"
        )

    return ""


def _is_sacrifice(board: chess.Board, move: chess.Move) -> bool:
    """
    Return True when the mover gives away material: lands on a square where a
    less-valuable piece can immediately recapture AND the captured piece is worth
    less than the moving piece (so we're not simply winning material).
    Pawn and king moves excluded.
    """
    piece = board.piece_at(move.from_square)
    if not piece or piece.piece_type in (chess.PAWN, chess.KING):
        return False

    moving_value   = _PIECE_VALUE.get(piece.piece_type, 0)
    captured       = board.piece_at(move.to_square)
    captured_value = _PIECE_VALUE.get(captured.piece_type, 0) if captured else 0

    # If we're capturing a piece of equal or greater value, we're not sacrificing
    if captured_value >= moving_value:
        return False

    board_after = board.copy()
    board_after.push(move)

    for sq in board_after.attackers(not piece.color, move.to_square):
        attacker = board_after.piece_at(sq)
        if attacker and _PIECE_VALUE.get(attacker.piece_type, 0) < moving_value:
            return True
    return False


def _is_favorable_exchange(board: chess.Board, move: chess.Move) -> bool:
    """
    Return True when the mover captures a piece worth significantly more than their
    own (net material gain ≥ 200 cp), indicating a winning tactical capture.
    Used to detect Great moves like Bxh6 (bishop takes rook).
    """
    piece = board.piece_at(move.from_square)
    if not piece or piece.piece_type in (chess.PAWN, chess.KING):
        return False
    captured = board.piece_at(move.to_square)
    if not captured:
        return False
    net_gain = _PIECE_VALUE.get(captured.piece_type, 0) - _PIECE_VALUE.get(piece.piece_type, 0)
    return net_gain >= 200


def classify_move(
    dq: float,
    is_best: bool,
    is_sac: bool,
    is_favorable_exch: bool,
    half_move: int,
    book_active: bool,
    player: str,
    eval_best_cp: int,
    eval_after_cp: int,
    prev_eval_cp: int,
    prev_opp_was_blunder: bool = False,
) -> str:
    """
    Classify a move using the chess.com Expected Points model (ΔQ thresholds).

    dq                   – win-probability loss for the mover [0, 1]
    is_favorable_exch    – mover captures a piece worth ≥ 200 cp more than their own
    book_active          – True while the opening book sequence is unbroken
    prev_eval_cp         – position eval (White's perspective) BEFORE this move
    prev_opp_was_blunder – whether the opponent's immediately preceding move was a Blunder
    """
    is_white = player == "white"

    # Brilliant — engine top move AND material sacrifice (giving material, not taking)
    if is_best and is_sac:
        return "Brilliant"

    # Book — any near-optimal move (ΔQ < 2%) during an unbroken opening sequence.
    if book_active and half_move <= _BOOK_HALF_MOVES and dq < _DQ_EXCELLENT:
        return "Book"

    # Great — engine top AND one of:
    #   • tactical material win (captures a piece worth ≥ 200 cp more than own) from a
    #     position that wasn't already overwhelming (mover ≤ +300 cp)
    #   • defensive save: was losing, finds the only way to keep fighting
    #   • equal-to-winning swing: finds a decisive tactic from a balanced position
    if is_best:
        mover_prev = prev_eval_cp if is_white else -prev_eval_cp
        mover_best = eval_best_cp if is_white else -eval_best_cp
        tactical_capture = is_favorable_exch and mover_prev <= 300 and mover_best >= 100
        defensive_save   = mover_prev < -50 and mover_best >= -50
        equal_to_win     = abs(mover_prev) <= 100 and mover_best >= 200
        if tactical_capture or defensive_save or equal_to_win:
            return "Great"
        return "Best"

    # Miss — mover had a clear advantage (≥ +150 cp) but failed to capitalise on the
    # opponent's preceding Blunder.  Requires opponent's last move to be a Blunder so
    # that the "failed opportunity" story is accurate.
    mover_best  = eval_best_cp  if is_white else -eval_best_cp
    mover_after = eval_after_cp if is_white else -eval_after_cp
    if (prev_opp_was_blunder
            and mover_best >= 150
            and dq >= _DQ_INACCURACY
            and mover_after >= -200):
        return "Miss"

    # Standard ΔQ thresholds
    if dq < _DQ_EXCELLENT:
        return "Excellent"
    if dq < _DQ_GOOD:
        return "Good"
    if dq < _DQ_INACCURACY:
        return "Inaccuracy"
    if dq < _DQ_MISTAKE:
        return "Mistake"
    return "Blunder"


def calculate_accuracy(delta_qs: List[float]) -> float:
    """
    Accuracy score based on average ΔQ (win-probability loss per move).
    Calibrated to mirror chess.com's accuracy scale: 0 ΔQ → 100%, ~0.1 ΔQ → ~75%.
    """
    if not delta_qs:
        return 100.0
    avg_dq = sum(delta_qs) / len(delta_qs)
    accuracy = 103.1668 * math.exp(-3.0 * avg_dq) - 3.1668
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
    white_dqs: List[float] = []
    black_dqs: List[float] = []

    counts: Dict[str, Dict[str, int]] = {
        "white": {k: 0 for k in _ALL_CLASSIFICATIONS},
        "black": {k: 0 for k in _ALL_CLASSIFICATIONS},
    }

    # Once any move breaks the book sequence, no future move can be Book
    book_sequence_active = True
    prev_classification: str | None = None   # classification of the immediately preceding half-move

    for i, move in enumerate(all_moves):
        is_white = board.turn == chess.WHITE
        player = "white" if is_white else "black"
        fen_before = board.fen()
        move_san = board.san(move)
        position_prev_eval_cp = prev_eval_cp  # eval before this move (White's perspective)

        # Engine suggestion BEFORE this move (multipv=3 for alternatives)
        analysis_before = await engine_manager.analyze_position(
            fen_before, depth=depth, multipv=3
        )

        if analysis_before:
            best_uci     = analysis_before[0]["best_move_uci"]
            best_san     = analysis_before[0]["best_move_san"]
            eval_best_cp = analysis_before[0]["eval_cp"]
            pv_san       = analysis_before[0].get("pv_san", [])
            pv_uci       = analysis_before[0].get("pv_uci", [])
            alternatives = [
                {"move": a["best_move_san"], "eval": a["eval"]}
                for a in analysis_before[1:]
                if a.get("best_move_san") and a["best_move_san"] != move_san
            ]
        else:
            best_uci = best_san = None
            eval_best_cp = prev_eval_cp
            pv_san = pv_uci = []
            alternatives = []

        # Both checks must happen BEFORE the move is pushed onto the board
        is_sac             = _is_sacrifice(board, move)
        is_favorable_exch  = _is_favorable_exchange(board, move)

        board.push(move)
        fen_after = board.fen()

        # Engine eval AFTER the move
        analysis_after = await engine_manager.analyze_position(
            fen_after, depth=depth, multipv=1
        )
        eval_after_cp: int = analysis_after[0]["eval_cp"] if analysis_after else prev_eval_cp

        # Centipawn loss (mover's perspective) — kept for commentary
        if is_white:
            cp_loss = max(0.0, eval_best_cp - eval_after_cp)
        else:
            cp_loss = max(0.0, eval_after_cp - eval_best_cp)

        # Win-probability loss (ΔQ) — used for classification
        dq = _delta_q(eval_best_cp, eval_after_cp, player)

        # Treat any move with zero WP loss as "best" — handles multi-move ties
        is_best        = (move.uci() == best_uci) or (dq == 0.0)
        classification = classify_move(
            dq=dq,
            is_best=is_best,
            is_sac=is_sac,
            is_favorable_exch=is_favorable_exch,
            half_move=i + 1,
            book_active=book_sequence_active,
            player=player,
            eval_best_cp=eval_best_cp,
            eval_after_cp=eval_after_cp,
            prev_eval_cp=position_prev_eval_cp,
            prev_opp_was_blunder=(prev_classification == "Blunder"),
        )
        is_sacrifice = is_sac and is_best

        # Once any move is not Book, the opening sequence is broken
        if classification != "Book":
            book_sequence_active = False

        prev_classification = classification

        commentary = _generate_commentary(
            classification, cp_loss, is_sacrifice, move_san,
            best_san, player, pv_san,
            eval_best_cp, eval_after_cp,
            eval_before_cp=position_prev_eval_cp,
        )

        # Book moves are opening theory — exclude from CAPS2 accuracy
        if classification != "Book":
            (white_dqs if is_white else black_dqs).append(dq)
        counts[player][classification] += 1

        win_prob_after = round(_win_prob(eval_after_cp), 4)

        moves_out.append(
            {
                "move_number":    i // 2 + 1,
                "half_move":      i + 1,
                "player":         player,
                "move":           move_san,
                "move_uci":       move.uci(),
                "eval":           _clamp_eval(eval_after_cp),
                "eval_cp":        eval_after_cp,
                "win_prob":       win_prob_after,
                "delta_q":        round(dq, 4),
                "best_move":      best_san,
                "best_move_uci":  best_uci,
                "cp_loss":        round(cp_loss, 1),
                "classification": classification,
                "is_sacrifice":   is_sacrifice,
                "fen_before":     fen_before,
                "fen_after":      fen_after,
                "alternatives":   alternatives[:2],
                "pv_san":         pv_san[:6],
                "pv_uci":         pv_uci[:6],
                "eval_best_cp":   eval_best_cp,
                "commentary":     commentary,
            }
        )

        prev_eval_cp = eval_after_cp

        if on_progress:
            await on_progress(i + 1, total)

    initial_eval_cp = init[0]["eval_cp"] if init else 0
    return {
        "moves":              moves_out,
        "accuracy_white":     calculate_accuracy(white_dqs),
        "accuracy_black":     calculate_accuracy(black_dqs),
        "counts_white":       counts["white"],
        "counts_black":       counts["black"],
        "opening":            headers.get("Opening", "Unknown Opening"),
        "eco":                headers.get("ECO", ""),
        "headers":            headers,
        "initial_eval":       _clamp_eval(initial_eval_cp),
        "initial_win_prob":   round(_win_prob(initial_eval_cp), 4),
    }
