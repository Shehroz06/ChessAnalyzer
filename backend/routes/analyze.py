"""
Routes for game and position analysis.

POST /api/analyze-game         – full game analysis from URL, game ID, or raw PGN
POST /api/analyze-game-stream  – same, but streams progress via Server-Sent Events
POST /api/analyze-position     – single-position analysis by FEN
"""

import asyncio
import json
import logging
import re
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

import chess
import chess.pgn
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from analyzer import analyze_game
from engine import engine_manager

logger = logging.getLogger(__name__)
router = APIRouter()

# ── HTTP headers ──────────────────────────────────────────────────────────────

_API_HEADERS = {
    "User-Agent": "ChessAnalyzer/1.0 (github.com/chess-analyzer)"
}

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.chess.com/",
    "Origin": "https://www.chess.com",
}

# Chess.com proprietary move-list alphabet (index = square 0-63)
_ML_ALPHA = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?"
_ML_C2I   = {c: i for i, c in enumerate(_ML_ALPHA)}


# ── request models ────────────────────────────────────────────────────────────

class AnalyzeGameRequest(BaseModel):
    game_id: Optional[str] = None
    url:     Optional[str] = None
    pgn:     Optional[str] = None
    depth:   int = 15


class AnalyzePositionRequest(BaseModel):
    fen:     str
    depth:   int = 15
    multipv: int = 3


# ── URL helpers ───────────────────────────────────────────────────────────────

def _parse_chess_com_url(url: str) -> tuple[Optional[str], Optional[str]]:
    """
    Parse a Chess.com game URL and return (game_id, username).

    Handles both bare IDs and full URLs including the ?username= query param
    that Chess.com adds when you open a game from your profile:
      https://www.chess.com/game/live/170862691918?username=000topg000
    """
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    username = (params.get("username") or params.get("user") or [None])[0]
    if username:
        username = username.strip().lower()

    # Path: /game/live/<id>  or  /game/daily/<id>  or just a bare numeric string
    m = re.search(r"/game/(?:live|daily|chess960)/(\d+)", parsed.path)
    if m:
        return m.group(1), username

    # Bare numeric (user pasted just the ID)
    m = re.search(r"(\d{6,})", parsed.path or url)
    return (m.group(1) if m else None), username


# ── player archive helpers ────────────────────────────────────────────────────

async def _search_archive_month(
    client: httpx.AsyncClient,
    username: str,
    year: str,
    month: str,
    game_id: str,
    uuid: str = "",
) -> Optional[str]:
    """Search one month's archive for a specific game, returning its PGN."""
    try:
        r = await client.get(
            f"https://api.chess.com/pub/player/{username}/games/{year}/{month}",
            headers=_API_HEADERS,
            timeout=30,
        )
        if r.status_code != 200:
            return None
        for g in r.json().get("games", []):
            g_url = g.get("url", "")
            if (uuid and g.get("uuid") == uuid) or re.search(rf"/{game_id}([/?]|$)", g_url):
                if g.get("pgn", "").strip():
                    return g["pgn"]
    except Exception as exc:
        logger.debug("Archive %s/%s/%s: %s", username, year, month, exc)
    return None


async def _search_all_archives(
    client: httpx.AsyncClient,
    username: str,
    game_id: str,
    uuid: str = "",
    max_months: int = 12,
) -> Optional[str]:
    """
    Fetch the player's archive index and search the most recent months.
    Searches newest-first so recent games are found quickly.
    """
    try:
        r = await client.get(
            f"https://api.chess.com/pub/player/{username}/games/archives",
            headers=_API_HEADERS,
            timeout=15,
        )
        if r.status_code != 200:
            logger.debug("Archives list for %s: HTTP %s", username, r.status_code)
            return None
        archives: list[str] = r.json().get("archives", [])
    except Exception as exc:
        logger.debug("Archives list for %s failed: %s", username, exc)
        return None

    for archive_url in reversed(archives[-max_months:]):
        # archive_url looks like: https://api.chess.com/pub/player/user/games/2026/06
        try:
            r = await client.get(archive_url, headers=_API_HEADERS, timeout=30)
            if r.status_code != 200:
                continue
            for g in r.json().get("games", []):
                g_url = g.get("url", "")
                if (uuid and g.get("uuid") == uuid) or re.search(rf"/{game_id}([/?]|$)", g_url):
                    if g.get("pgn", "").strip():
                        logger.info("Game %s found in archive %s", game_id, archive_url)
                        return g["pgn"]
        except Exception as exc:
            logger.debug("Archive %s: %s", archive_url, exc)

    return None


# ── moveList decoder ──────────────────────────────────────────────────────────

def _idx_to_sq(idx: int) -> str:
    """Convert a 0-63 index (rank-major, a1=0) to a square name like 'e4'."""
    return "abcdefgh"[idx % 8] + str(idx // 8 + 1)


def _decode_movelist(movelist: str, initial_fen: str, pgn_headers: dict) -> Optional[str]:
    """
    Decode Chess.com's proprietary moveList encoding into a PGN string.

    Chess.com encodes each half-move as two characters from a 64-char alphabet
    where each character maps directly to a board square (0=a1 … 63=h8).
    Promotions default to queen (covers 99%+ of games).
    """
    try:
        board = chess.Board(initial_fen or chess.STARTING_FEN)
    except Exception:
        board = chess.Board()

    game = chess.pgn.Game()

    # Populate PGN headers (skip the FEN/SetUp for standard positions)
    for k, v in pgn_headers.items():
        if k in ("FEN", "SetUp") and str(v) in (chess.STARTING_FEN, "1", ""):
            continue
        game.headers[str(k)] = str(v)

    node = game
    i = 0
    while i + 1 < len(movelist):
        fi = _ML_C2I.get(movelist[i])
        ti = _ML_C2I.get(movelist[i + 1])
        i += 2

        if fi is None or ti is None:
            continue  # unknown character — skip

        from_sq = _idx_to_sq(fi)
        to_sq   = _idx_to_sq(ti)

        # Detect pawn promotion and default to queen
        promo: Optional[chess.PieceType] = None
        piece = board.piece_at(chess.parse_square(from_sq))
        if piece and piece.piece_type == chess.PAWN:
            to_rank = int(to_sq[1])
            if (piece.color == chess.WHITE and to_rank == 8) or \
               (piece.color == chess.BLACK and to_rank == 1):
                promo = chess.QUEEN

        uci = from_sq + to_sq + (chess.piece_symbol(promo) if promo else "")
        try:
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                break   # encoding ended (resignation / timeout) or decode error
            node = node.add_variation(move)
            board.push(move)
        except Exception:
            break

    pgn_str = str(game)
    return pgn_str if pgn_str.strip() else None


# ── HTML fallback ─────────────────────────────────────────────────────────────

def _find_pgn_in_json(data: Any, depth: int = 0) -> Optional[str]:
    if depth > 8:
        return None
    if isinstance(data, dict):
        pgn = data.get("pgn")
        if isinstance(pgn, str) and pgn.strip():
            return pgn
        for v in data.values():
            r = _find_pgn_in_json(v, depth + 1)
            if r:
                return r
    elif isinstance(data, list):
        for item in data:
            r = _find_pgn_in_json(item, depth + 1)
            if r:
                return r
    return None


def _extract_pgn_from_html(html: str) -> Optional[str]:
    """Scan Chess.com HTML for embedded PGN data (last-resort strategy)."""
    # Pattern: "pgn":"..." inside any JSON blob
    for m in re.finditer(r'"pgn"\s*:\s*"((?:[^"\\]|\\.)+)"', html):
        pgn = m.group(1).replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
        if "[Event" in pgn or "[White" in pgn:
            return pgn

    # __NEXT_DATA__ / server-side JSON
    for pattern in [
        r'id="__NEXT_DATA__"[^>]*>(.*?)</script>',
        r'window\.__NEXT_DATA__\s*=\s*({.*?});\s*</script>',
    ]:
        m = re.search(pattern, html, re.DOTALL)
        if m:
            try:
                pgn = _find_pgn_in_json(json.loads(m.group(1)))
                if pgn:
                    return pgn
            except Exception:
                pass
    return None


# ── main fetch orchestrator ───────────────────────────────────────────────────

async def _fetch_pgn(game_id: str, username_hint: Optional[str] = None) -> str:
    """
    Multi-strategy PGN fetcher for Chess.com live and daily games.

    Strategy 1  — Official daily-game API  (fast, works for correspondence games)
    Strategy 1b — Player archive via username_hint  (when the URL has ?username=)
    Strategy 2  — Callback API → 2a archive search → 2b moveList decode
    Strategy 3  — HTML scraping (last resort)
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=25) as client:

        # ── Strategy 1 — official API (daily / correspondence) ────────────────
        try:
            r = await client.get(
                f"https://api.chess.com/pub/game/{game_id}", headers=_API_HEADERS
            )
            if r.status_code == 200:
                pgn = r.json().get("pgn", "").strip()
                if pgn:
                    logger.info("Game %s: fetched via official API", game_id)
                    return pgn
        except Exception as exc:
            logger.debug("Strategy 1 failed: %s", exc)

        # ── Strategy 1b — archive search using URL's ?username= hint ──────────
        # Chess.com adds ?username=XYZ to game links from a player's profile.
        # Use that to jump straight to the correct player's archive.
        if username_hint:
            logger.info("Game %s: searching archive of hint user %s", game_id, username_hint)
            pgn = await _search_all_archives(client, username_hint, game_id, max_months=24)
            if pgn:
                return pgn

        # ── Strategy 2 — Callback API (live games) ────────────────────────────
        callback_data: Optional[dict] = None
        try:
            r = await client.get(
                f"https://www.chess.com/callback/live/game/{game_id}",
                headers=_BROWSER_HEADERS,
            )
            if r.status_code == 200:
                callback_data = r.json()
                logger.info("Game %s: callback API OK", game_id)
        except Exception as exc:
            logger.debug("Strategy 2 callback failed: %s", exc)

        if callback_data:
            game_obj    = callback_data.get("game", {})
            players     = callback_data.get("players", {})
            pgn_hdrs    = game_obj.get("pgnHeaders", {})
            uuid        = game_obj.get("uuid", "")
            date_str    = str(pgn_hdrs.get("Date", ""))
            movelist    = game_obj.get("moveList", "")
            initial_fen = (
                pgn_hdrs.get("FEN")
                or game_obj.get("initialSetup")
                or chess.STARTING_FEN
            )

            # ── 2a — archive search (uses known date + all player usernames) ──
            usernames: list[str] = []
            if username_hint and username_hint not in usernames:
                usernames.append(username_hint)
            for side in ("top", "bottom"):
                u = players.get(side, {}).get("username", "")
                if u and u.lower() not in [x.lower() for x in usernames]:
                    usernames.append(u)

            if date_str and len(date_str) >= 7:
                year, month = date_str[:4], date_str[5:7]
                for uname in usernames:
                    pgn = await _search_archive_month(client, uname, year, month, game_id, uuid)
                    if pgn:
                        logger.info("Game %s: found in %s archive %s/%s", game_id, uname, year, month)
                        return pgn

            # ── 2b — decode Chess.com proprietary moveList ────────────────────
            if movelist and pgn_hdrs:
                logger.info("Game %s: decoding moveList (%d chars)", game_id, len(movelist))
                pgn = _decode_movelist(movelist, initial_fen, pgn_hdrs)
                if pgn:
                    return pgn

        # ── Strategy 3 — HTML scraping ────────────────────────────────────────
        for path in (f"game/live/{game_id}", f"game/daily/{game_id}"):
            try:
                r = await client.get(
                    f"https://www.chess.com/{path}",
                    headers={**_BROWSER_HEADERS, "Accept": "text/html,*/*"},
                )
                if r.status_code == 200:
                    pgn = _extract_pgn_from_html(r.text)
                    if pgn:
                        logger.info("Game %s: fetched via HTML scraping", game_id)
                        return pgn
            except Exception as exc:
                logger.debug("HTML scrape %s: %s", path, exc)

    raise HTTPException(
        status_code=404,
        detail=(
            f"Could not fetch game {game_id} automatically. "
            "Open the game on Chess.com → Share → Copy PGN, "
            "then paste it using the 'Paste PGN' tab."
        ),
    )


# ── shared PGN resolver ───────────────────────────────────────────────────────

async def _resolve_pgn(req: AnalyzeGameRequest) -> str:
    """Extract or fetch the PGN from the request (raises HTTPException on failure)."""
    if req.pgn and req.pgn.strip():
        return req.pgn.strip()

    if req.url or req.game_id:
        game_id = req.game_id
        username_hint: Optional[str] = None
        if req.url:
            game_id, username_hint = _parse_chess_com_url(req.url)
            if not game_id:
                raise HTTPException(status_code=400, detail="Could not parse a game ID from that URL.")
        return await _fetch_pgn(game_id, username_hint=username_hint)

    raise HTTPException(status_code=400, detail="Provide one of: url, game_id, or pgn.")


# ── routes ────────────────────────────────────────────────────────────────────

@router.post("/analyze-game")
async def analyze_game_route(req: AnalyzeGameRequest):
    """Full game analysis (blocking). Accepts a Chess.com URL, game ID, or raw PGN."""
    pgn_str = await _resolve_pgn(req)
    try:
        return await analyze_game(pgn_str, depth=req.depth)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")


@router.post("/analyze-game-stream")
async def analyze_game_stream_endpoint(req: AnalyzeGameRequest):
    """
    Stream per-move analysis progress via Server-Sent Events.

    Event types sent to the client:
      {"type": "progress", "current": N, "total": M}  — after each move
      {"type": "done",     "result": {...}}             — final payload
      {"type": "error",    "detail": "..."}             — on failure
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def _run() -> None:
        try:
            pgn_str = await _resolve_pgn(req)
        except HTTPException as exc:
            await queue.put({"type": "error", "detail": exc.detail})
            return
        except Exception as exc:
            await queue.put({"type": "error", "detail": str(exc)})
            return

        async def _progress(current: int, total: int) -> None:
            await queue.put({"type": "progress", "current": current, "total": total})

        try:
            result = await analyze_game(pgn_str, depth=req.depth, on_progress=_progress)
            await queue.put({"type": "done", "result": result})
        except Exception as exc:
            logger.exception("Streaming analysis failed")
            await queue.put({"type": "error", "detail": str(exc)})

    task = asyncio.create_task(_run())

    async def _stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=600.0)
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type': 'error', 'detail': 'Analysis timed out'})}\n\n"
                    break
                yield f"data: {json.dumps(event)}\n\n"
                if event["type"] in ("done", "error"):
                    break
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/analyze-position")
async def analyze_position_route(req: AnalyzePositionRequest):
    """Evaluate a single FEN position and return the top N moves."""
    try:
        results = await engine_manager.analyze_position(
            req.fen, depth=req.depth, multipv=req.multipv
        )
        return {"fen": req.fen, "analysis": results}
    except Exception as exc:
        logger.exception("Position analysis failed")
        raise HTTPException(status_code=500, detail=str(exc))
