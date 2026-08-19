#!/usr/bin/env bash
# One-click launcher: sets up (if needed) and starts backend + frontend together.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

# ── backend setup ────────────────────────────────────────────────────────────
if [ ! -d "$BACKEND/.venv" ]; then
    echo "==> Creating backend virtualenv"
    python3 -m venv "$BACKEND/.venv"
fi

source "$BACKEND/.venv/bin/activate"

if ! python -c "import fastapi" 2>/dev/null; then
    echo "==> Installing backend dependencies"
    pip install -q -r "$BACKEND/requirements.txt"
fi

if [ ! -f "$BACKEND/.env" ]; then
    echo "==> Creating backend/.env from .env.example"
    cp "$BACKEND/.env.example" "$BACKEND/.env"
    echo "    Edit backend/.env to set STOCKFISH_PATH / GEMINI_API_KEY if needed."
fi

if ! command -v stockfish >/dev/null 2>&1 && ! grep -q "^STOCKFISH_PATH=.\+" "$BACKEND/.env" 2>/dev/null; then
    echo "!! Stockfish not found on PATH and STOCKFISH_PATH is not set in backend/.env"
    echo "   Install it (sudo apt install stockfish / brew install stockfish) or set STOCKFISH_PATH."
fi

# ── frontend setup ───────────────────────────────────────────────────────────
if [ ! -d "$FRONTEND/node_modules" ]; then
    echo "==> Installing frontend dependencies"
    (cd "$FRONTEND" && npm install)
fi

# ── run both, tear down together ─────────────────────────────────────────────
cleanup() {
    echo
    echo "==> Stopping servers"
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
    wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "==> Starting backend  (http://localhost:8000)"
(cd "$BACKEND" && uvicorn main:app --reload --port 8000) &
BACKEND_PID=$!

echo "==> Starting frontend (http://localhost:5173)"
(cd "$FRONTEND" && npm run dev) &
FRONTEND_PID=$!

echo
echo "Chess Analyzer running — press Ctrl+C to stop."
wait
