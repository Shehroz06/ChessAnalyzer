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
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional
from urllib.parse import parse_qs, urlparse

import chess
import chess.pgn
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from analyzer import analyze_game
from engine import engine_manager

_OLLAMA_BASE = "http://localhost:11434"

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


class CommentaryRequest(BaseModel):
    fen_before:     str
    move_san:       str
    move_uci:       str
    classification: str
    cp_loss:        float
    best_move:      Optional[str]  = None
    pv_san:         List[str]      = []
    player:         str            = "white"
    is_sacrifice:   bool           = False


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

async def _search_archive_url(
    client: httpx.AsyncClient,
    archive_url: str,
    game_id: str,
    uuid: str = "",
) -> Optional[str]:
    """Fetch one archive URL and search it for the game. Returns PGN or None."""
    try:
        r = await client.get(archive_url, headers=_API_HEADERS, timeout=20)
        if r.status_code != 200:
            return None
        for g in r.json().get("games", []):
            g_url = g.get("url", "")
            if (uuid and g.get("uuid") == uuid) or re.search(rf"/{game_id}([/?]|$)", g_url):
                pgn = g.get("pgn", "").strip()
                if pgn:
                    logger.info("Game %s found at %s", game_id, archive_url)
                    return pgn
    except Exception as exc:
        logger.debug("Archive %s: %s", archive_url, exc)
    return None


async def _search_recent_months(
    client: httpx.AsyncClient,
    username: str,
    game_id: str,
    uuid: str = "",
    n_months: int = 3,
) -> Optional[str]:
    """
    Check the current month and the previous n_months-1 months in parallel.
    Returns the PGN as soon as any month contains the game, otherwise None.
    """
    now = datetime.now(timezone.utc)
    urls = []
    for i in range(n_months):
        d = now.replace(day=1) - timedelta(days=1) * (30 * i)
        d = d.replace(day=1)
        urls.append(
            f"https://api.chess.com/pub/player/{username}/games/{d.year}/{d.month:02d}"
        )

    results = await asyncio.gather(
        *[_search_archive_url(client, u, game_id, uuid) for u in urls],
        return_exceptions=True,
    )
    for r in results:
        if isinstance(r, str) and r:
            return r
    return None


async def _search_all_archives(
    client: httpx.AsyncClient,
    username: str,
    game_id: str,
    uuid: str = "",
    max_months: int = 6,
) -> Optional[str]:
    """
    Fetch the archive index then search recent months in parallel.
    """
    try:
        r = await client.get(
            f"https://api.chess.com/pub/player/{username}/games/archives",
            headers=_API_HEADERS,
            timeout=12,
        )
        if r.status_code != 200:
            return None
        archives: list[str] = r.json().get("archives", [])
    except Exception as exc:
        logger.debug("Archives list for %s failed: %s", username, exc)
        return None

    if not archives:
        return None

    recent = list(reversed(archives[-max_months:]))
    results = await asyncio.gather(
        *[_search_archive_url(client, u, game_id, uuid) for u in recent],
        return_exceptions=True,
    )
    for r in results:
        if isinstance(r, str) and r:
            return r
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

    Strategies run in order of speed, with parallelism where possible:

    Fast (parallel race):
      1a — Official pub/game API  (daily/correspondence games)
      1b — Recent-month archive   (current + last 2 months, parallel)

    Slow fallback (sequential):
      2  — Callback API → known-date archive → moveList decode
      3  — Full archive index search (parallel across recent 6 months)
      4  — HTML scraping
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=25) as client:

        # ── Fast parallel race: official API + recent archive months ──────────
        fast_tasks: list = [
            asyncio.create_task(
                _official_api(client, game_id)
            )
        ]
        if username_hint:
            fast_tasks.append(
                asyncio.create_task(
                    _search_recent_months(client, username_hint, game_id, n_months=3)
                )
            )

        fast_results = await asyncio.gather(*fast_tasks, return_exceptions=True)
        for r in fast_results:
            if isinstance(r, str) and r:
                logger.info("Game %s: found via fast path", game_id)
                return r

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

            # ── 2a — archive search (known date + all usernames, parallel) ───
            usernames: list[str] = []
            if username_hint:
                usernames.append(username_hint)
            for side in ("top", "bottom"):
                u = players.get(side, {}).get("username", "")
                if u and u.lower() not in [x.lower() for x in usernames]:
                    usernames.append(u)

            if date_str and len(date_str) >= 7:
                year, month = date_str[:4], date_str[5:7]
                archive_tasks = [
                    _search_archive_url(
                        client,
                        f"https://api.chess.com/pub/player/{uname}/games/{year}/{month}",
                        game_id,
                        uuid,
                    )
                    for uname in usernames
                ]
                if archive_tasks:
                    archive_results = await asyncio.gather(*archive_tasks, return_exceptions=True)
                    for r in archive_results:
                        if isinstance(r, str) and r:
                            logger.info("Game %s: found via callback+archive", game_id)
                            return r

            # ── 2b — decode Chess.com proprietary moveList ────────────────────
            if movelist and pgn_hdrs:
                logger.info("Game %s: decoding moveList (%d chars)", game_id, len(movelist))
                pgn = _decode_movelist(movelist, initial_fen, pgn_hdrs)
                if pgn:
                    return pgn

        # ── Strategy 3 — full archive index search (parallel) ────────────────
        all_usernames: list[str] = []
        if username_hint:
            all_usernames.append(username_hint)
        if callback_data:
            for side in ("top", "bottom"):
                u = callback_data.get("players", {}).get(side, {}).get("username", "")
                if u and u.lower() not in [x.lower() for x in all_usernames]:
                    all_usernames.append(u)

        for uname in all_usernames:
            pgn = await _search_all_archives(client, uname, game_id, max_months=6)
            if pgn:
                return pgn

        # ── Strategy 4 — HTML scraping ────────────────────────────────────────
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


async def _official_api(client: httpx.AsyncClient, game_id: str) -> Optional[str]:
    """Try the official pub/game API (works for daily/correspondence games)."""
    try:
        r = await client.get(
            f"https://api.chess.com/pub/game/{game_id}", headers=_API_HEADERS, timeout=10
        )
        if r.status_code == 200:
            pgn = r.json().get("pgn", "").strip()
            if pgn:
                return pgn
    except Exception as exc:
        logger.debug("Official API failed: %s", exc)
    return None


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


async def _get_ollama_model(client: httpx.AsyncClient) -> Optional[str]:
    """Return the first available Ollama model name, or None if Ollama is not running."""
    try:
        r = await client.get(f"{_OLLAMA_BASE}/api/tags", timeout=3)
        if r.status_code == 200:
            models = r.json().get("models", [])
            if models:
                # Prefer llama models, then any model
                for m in models:
                    name = m.get("name", "")
                    if "llama" in name.lower():
                        return name
                return models[0].get("name")
    except Exception:
        pass
    return None


@router.post("/commentary")
async def generate_commentary(req: CommentaryRequest):
    """
    Generate AI commentary for a chess move using a local Ollama model.
    Falls back to a brief template message if Ollama is not available.
    """
    is_good = req.classification in ("Brilliant", "Best", "Excellent", "Good")
    prompt = (
        f"You are a chess coach. Explain in 2-3 plain sentences (no markdown, no bullet points) "
        f"why {req.move_san} by {'White' if req.player == 'white' else 'Black'} "
        f"is a {req.classification} move. "
        f"{'It involves a material sacrifice. ' if req.is_sacrifice else ''}"
        f"{'The stronger option was ' + req.best_move + '. ' if req.best_move and req.best_move != req.move_san else ''}"
        f"{'The best continuation runs: ' + ' '.join(req.pv_san[:4]) + '. ' if req.pv_san else ''}"
        f"Focus on the {'key tactical or positional strength' if is_good else 'concrete tactical or positional problem this creates'} "
        f"without mentioning centipawns or numeric scores."
    )

    async with httpx.AsyncClient() as client:
        model = await _get_ollama_model(client)
        if not model:
            raise HTTPException(
                status_code=503,
                detail="Ollama is not running. Start it with: ollama serve",
            )

        try:
            r = await client.post(
                f"{_OLLAMA_BASE}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
                timeout=30,
            )
            if r.status_code != 200:
                raise HTTPException(status_code=502, detail="Ollama returned an error")
            commentary = r.json().get("response", "").strip()
            return {"commentary": commentary, "model": model}
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Ollama timed out generating commentary")
