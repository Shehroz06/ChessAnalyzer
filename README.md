# Chess Analyzer

A full-stack chess analysis app powered by **Stockfish 16**.

- Analyze any Chess.com game (by URL or PGN)
- Move classification: Brilliant · Best · Excellent · Good · Inaccuracy · Mistake · Blunder
- Accuracy percentages, evaluation graph, opening detection
- Play vs computer with adjustable difficulty
- Post-game full Stockfish review

---

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | React 18 · Vite · react-chessboard · Chart.js · TailwindCSS |
| Backend  | Python 3.12 · FastAPI · python-chess · Stockfish 16 |

---

## Quick Start

### 1 — Install Stockfish 

**Ubuntu / Debian**
```bash
sudo apt update && sudo apt install -y stockfish
```

**macOS**
```bash
brew install stockfish
```

**Windows** — Download from https://stockfishchess.org/download/ and note the path.

---

### 2 — Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# If Stockfish is not on PATH, set the env variable:
# export STOCKFISH_PATH=/path/to/stockfish

uvicorn main:app --reload --port 8000
```

API docs → http://localhost:8000/docs

---

### 3 — Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:5173
```

---

## Usage

### Analyze a Game
1. Open http://localhost:5173
2. Paste a Chess.com game URL or raw PGN
3. Click **Analyze Game**
4. Navigate moves with arrow keys or by clicking the move list

### Play vs Computer
1. Click **Play vs Computer** in the navbar
2. Choose your color and difficulty
3. Click a piece to select it, then click a destination square — or drag
4. Press **H** to toggle a move hint
5. After the game click **Review with Analysis** for a full Stockfish post-mortem

---

## Move Classifications

| Classification | Centipawn Loss | Symbol |
|---------------|----------------|--------|
| Brilliant      | Best move + sacrifice | !! |
| Best           | Matches engine top move | ★ |
| Excellent      | ≤ 10 cp | ! |
| Good           | ≤ 25 cp | ✓ |
| Inaccuracy     | ≤ 100 cp | ?! |
| Mistake        | ≤ 200 cp | ? |
| Blunder        | > 200 cp | ?? |

Accuracy is computed using a formula calibrated to Chess.com's win-probability model.

---

## Project Structure

```
Chess/
├── backend/
│   ├── main.py          # FastAPI app & CORS
│   ├── engine.py        # Stockfish wrapper (async, cached)
│   ├── analyzer.py      # Full-game analysis + Brilliant detection
│   ├── requirements.txt
│   └── routes/
│       ├── analyze.py   # /analyze-game-stream, /analyze-position
│       └── play.py      # /play-move, /evaluate
│
└── frontend/
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── App.jsx              # Routing, navbar, theme toggle
        ├── context/
        │   └── ThemeContext.jsx # Dark / light theme
        ├── pages/
        │   ├── Home.jsx         # URL / PGN input
        │   ├── AnalysisPage.jsx # Board + eval graph + move list
        │   └── PlayPage.jsx     # Play vs computer
        ├── components/
        │   ├── EvalBar.jsx
        │   ├── EvalGraph.jsx
        │   ├── MoveList.jsx
        │   └── GameSummary.jsx
        └── utils/
            ├── api.js           # HTTP client (axios + SSE fetch)
            ├── chess.js         # Classification metadata & helpers
            └── useBoardSize.js  # Responsive board size hook
```

---

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analyze-game-stream` | SSE stream — analysis progress + result |
| POST | `/api/analyze-position` | Multi-PV position evaluation |
| POST | `/api/play-move` | Stockfish best reply (optional ELO mode) |
| POST | `/api/evaluate` | Quick single-line evaluation |
