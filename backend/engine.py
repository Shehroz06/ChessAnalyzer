"""
Stockfish engine manager.
Provides async position analysis with an LRU-style position cache.
"""

import asyncio
import hashlib
import logging
import os
import shutil
from typing import Any, Dict, List, Optional

import chess
import chess.engine

logger = logging.getLogger(__name__)

# Common installation paths, in priority order
_CANDIDATE_PATHS = [
    os.getenv("STOCKFISH_PATH", ""),   # env var (highest priority)
    "stockfish",                        # on $PATH
    "/usr/games/stockfish",             # Debian/Ubuntu apt
    "/usr/bin/stockfish",
    "/usr/local/bin/stockfish",
    "/opt/homebrew/bin/stockfish",      # macOS Homebrew
    "/snap/bin/stockfish",              # Snap
]


def _find_stockfish() -> str:
    """Return the first working Stockfish binary path, or raise FileNotFoundError."""
    for candidate in _CANDIDATE_PATHS:
        if not candidate:
            continue
        found = shutil.which(candidate) or (candidate if os.path.isfile(candidate) else None)
        if found:
            logger.info("Stockfish found at: %s", found)
            return found

    raise FileNotFoundError(
        "Stockfish engine not found. Install it, then restart the server.\n"
        "  Ubuntu/Debian : sudo apt install stockfish\n"
        "  macOS         : brew install stockfish\n"
        "  Windows       : https://stockfishchess.org/download/\n"
        "Or set STOCKFISH_PATH=/path/to/stockfish in backend/.env"
    )

DEFAULT_DEPTH = 15
DEFAULT_MULTIPV = 3
MAX_CACHE_SIZE = 2000


def _elo_to_depth(elo: int) -> int:
    table = [(800, 2), (1000, 3), (1200, 5), (1400, 7), (1600, 9),
             (1800, 11), (2000, 13), (2200, 15), (2400, 17)]
    for cap, d in table:
        if elo <= cap:
            return d
    return 18


class EngineManager:
    def __init__(self):
        self.stockfish_path: Optional[str] = None   # resolved lazily
        self._transport = None
        self._engine: Optional[chess.engine.UciProtocol] = None
        self._lock = asyncio.Lock()
        self._cache: Dict[str, List[Dict[str, Any]]] = {}

    async def _ensure_engine(self) -> chess.engine.UciProtocol:
        if self._engine is None:
            if self.stockfish_path is None:
                self.stockfish_path = _find_stockfish()
            logger.info("Starting Stockfish: %s", self.stockfish_path)
            try:
                self._transport, self._engine = await chess.engine.popen_uci(
                    self.stockfish_path
                )
            except FileNotFoundError:
                raise FileNotFoundError(
                    f"Could not start Stockfish at {self.stockfish_path!r}.\n"
                    "Run: sudo apt install stockfish   (or brew install stockfish on macOS)\n"
                    "Then set STOCKFISH_PATH in backend/.env if needed."
                )
            await self._engine.configure({"Hash": 128, "Threads": 2})
        return self._engine

    def _key(self, fen: str, depth: int, multipv: int) -> str:
        return hashlib.sha1(f"{fen}|{depth}|{multipv}".encode()).hexdigest()

    def _evict(self) -> None:
        while len(self._cache) >= MAX_CACHE_SIZE:
            self._cache.pop(next(iter(self._cache)))

    async def analyze_position(
        self,
        fen: str,
        depth: int = DEFAULT_DEPTH,
        multipv: int = DEFAULT_MULTIPV,
    ) -> List[Dict[str, Any]]:
        """Analyze a FEN and return top-N move evaluations (white's perspective)."""
        key = self._key(fen, depth, multipv)
        if key in self._cache:
            return self._cache[key]

        async with self._lock:
            if key in self._cache:
                return self._cache[key]

            engine = await self._ensure_engine()
            board = chess.Board(fen)

            info_list = await engine.analyse(
                board,
                chess.engine.Limit(depth=depth),
                multipv=multipv,
            )

            results = self._process(info_list, board)
            self._evict()
            self._cache[key] = results
            return results

    def _process(
        self,
        info_list: List[chess.engine.InfoDict],
        board: chess.Board,
    ) -> List[Dict[str, Any]]:
        results = []
        for info in info_list:
            score = info["score"].white()

            if score.is_mate():
                m = score.mate()
                eval_cp = 100_000 if m > 0 else -100_000
                eval_display: Any = f"M{m}"
            else:
                eval_cp = score.score(mate_score=100_000)
                eval_display = round(eval_cp / 100, 2)

            pv = info.get("pv", [])
            san_pv: List[str] = []
            tmp = board.copy()
            for mv in pv[:6]:
                try:
                    san_pv.append(tmp.san(mv))
                    tmp.push(mv)
                except Exception:
                    break

            results.append(
                {
                    "eval_cp": eval_cp,
                    "eval": eval_display,
                    "best_move_uci": str(pv[0]) if pv else None,
                    "best_move_san": san_pv[0] if san_pv else None,
                    "pv_san": san_pv,
                    "pv_uci": [str(m) for m in pv[:6]],
                    "depth": info.get("depth", 0),
                }
            )
        return results

    async def get_best_move(self, fen: str, depth: int = DEFAULT_DEPTH) -> str:
        """Kept for compatibility; prefer analyze_position + top PV move instead."""
        async with self._lock:
            engine = await self._ensure_engine()
            board = chess.Board(fen)
            result = await engine.play(board, chess.engine.Limit(depth=depth))
            return str(result.move)

    async def get_move_at_elo(self, fen: str, elo: int) -> str:
        """
        Use Stockfish's built-in ELO limiter (UCI_LimitStrength / UCI_Elo).
        This gives much more realistic weaker-player behaviour than depth tricks.
        Falls back to depth-based play if the engine doesn't support it.
        """
        async with self._lock:
            engine = await self._ensure_engine()
            board = chess.Board(fen)
            clamped_elo = max(1320, min(3190, elo))  # Stockfish's supported range
            try:
                await engine.configure({
                    "UCI_LimitStrength": True,
                    "UCI_Elo": clamped_elo,
                })
                result = await engine.play(board, chess.engine.Limit(time=0.1))
                # Restore unlimited play for analysis calls
                await engine.configure({"UCI_LimitStrength": False})
                return str(result.move)
            except Exception:
                # Engine doesn't support UCI_Elo — fall back to depth
                await engine.configure({"UCI_LimitStrength": False})
                depth = _elo_to_depth(elo)
                result = await engine.play(board, chess.engine.Limit(depth=depth))
                return str(result.move)

    async def close(self) -> None:
        if self._engine:
            try:
                await self._engine.quit()
            except Exception:
                pass
            finally:
                self._engine = None
                self._transport = None
                logger.info("Stockfish engine closed")


engine_manager = EngineManager()
