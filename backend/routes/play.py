"""
Routes for computer play and quick position evaluation.

POST /api/play-move  – get Stockfish's best reply to a given FEN
POST /api/evaluate   – quick positional eval (no move played)
WS   /api/ws/eval    – streaming evaluation while engine thinks
"""

import logging
from typing import Optional

import chess
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from engine import engine_manager

logger = logging.getLogger(__name__)
router = APIRouter()


# ── request models ────────────────────────────────────────────────────────────

class PlayMoveRequest(BaseModel):
    fen: str
    depth: int = 15
    elo: Optional[int] = None  # if set, override depth with ELO-calibrated depth


class EvalRequest(BaseModel):
    fen: str
    depth: int = 11


# ── helpers ───────────────────────────────────────────────────────────────────

def _elo_to_depth(elo: Optional[int]) -> int:
    """Fallback depth table when UCI_Elo is not supported."""
    if elo is None:
        return 15
    table = [(800, 2), (1000, 3), (1200, 5), (1400, 7), (1600, 9),
             (1800, 11), (2000, 13), (2200, 15), (2400, 17)]
    for cap, d in table:
        if elo <= cap:
            return d
    return 18


def _board_from_fen(fen: str) -> chess.Board:
    try:
        return chess.Board(fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid FEN string")


# ── routes ────────────────────────────────────────────────────────────────────

@router.post("/play-move")
async def play_move(req: PlayMoveRequest):
    """Return Stockfish's best move for the given position."""
    board = _board_from_fen(req.fen)

    if board.is_game_over():
        return {
            "move": None,
            "game_over": True,
            "result": board.result(),
            "eval_cp": None,
        }

    depth = _elo_to_depth(req.elo) if req.elo else req.depth

    # When an ELO is requested use the native Stockfish strength limiter;
    # otherwise use a single analyse() call and read the top PV move.
    if req.elo:
        best_uci = await engine_manager.get_move_at_elo(req.fen, req.elo)
        # Grab eval separately (cached, cheap)
        analysis = await engine_manager.analyze_position(req.fen, depth=depth, multipv=1)
        eval_cp: int = analysis[0]["eval_cp"] if analysis else 0
    else:
        analysis = await engine_manager.analyze_position(req.fen, depth=depth, multipv=1)
        if not analysis or not analysis[0].get("best_move_uci"):
            raise HTTPException(status_code=500, detail="Engine returned no move")
        best_uci = analysis[0]["best_move_uci"]
        eval_cp = analysis[0]["eval_cp"]

    board.push_uci(best_uci)
    return {
        "move": best_uci,
        "eval_cp": eval_cp,
        "eval": round(eval_cp / 100, 2),
        "fen_after": board.fen(),
        "game_over": board.is_game_over(),
        "result": board.result() if board.is_game_over() else None,
    }


@router.post("/evaluate")
async def evaluate_position(req: EvalRequest):
    """Quick position evaluation without making a move."""
    _board_from_fen(req.fen)  # validate

    analysis = await engine_manager.analyze_position(
        req.fen, depth=req.depth, multipv=1
    )
    if not analysis:
        return {"eval_cp": 0, "eval": 0.0, "best_move": None}

    top = analysis[0]
    return {
        "eval_cp": top["eval_cp"],
        "eval": top["eval"],
        "best_move": top["best_move_san"],
    }


@router.websocket("/ws/eval")
async def ws_eval(websocket: WebSocket):
    """
    WebSocket endpoint for live evaluation streaming.
    Client sends: { "fen": "<fen>", "depth": 12 }
    Server replies: { "eval_cp": 32, "eval": 0.32, "best_move": "Nf3" }
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            fen = data.get("fen", "")
            depth = int(data.get("depth", 12))
            try:
                analysis = await engine_manager.analyze_position(
                    fen, depth=depth, multipv=1
                )
                top = analysis[0] if analysis else {}
                await websocket.send_json(
                    {
                        "eval_cp": top.get("eval_cp", 0),
                        "eval": top.get("eval", 0.0),
                        "best_move": top.get("best_move_san"),
                    }
                )
            except Exception as exc:
                await websocket.send_json({"error": str(exc)})
    except WebSocketDisconnect:
        logger.debug("WS /ws/eval disconnected")
