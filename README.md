# Chess Analyzer

A full-stack chess analysis app powered by **Stockfish 18**.

- Analyze any Chess.com game (by URL or PGN)
- Move classification: Brilliant · Best · Excellent · Good · Inaccuracy · Mistake · Blunder
- Accuracy percentages, evaluation graph, opening detection
- Play vs computer with adjustable difficulty
- Post-game full Stockfish review
- Optional AI commentary via local Ollama (Llama)

---

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | React 18 · Vite · react-chessboard · Chart.js · TailwindCSS |
| Backend  | Python 3.12 · FastAPI · python-chess · Stockfish 18 |

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

### 4 — (Optional) AI Commentary with Ollama / Llama

The app can generate natural-language move commentary using a locally running Llama model via **Ollama**. Without Ollama the app works fine — commentary falls back to template descriptions.

#### Install Ollama

**Ubuntu / Debian / WSL**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**macOS**
```bash
brew install ollama
```

**Windows** — Download the installer from https://ollama.com/download

#### Download a model

Ollama is installed but you still need to pull a model. Recommended options (choose one):

```bash
# Lightweight — fast on CPU, good quality (recommended to start)
ollama pull llama3.2

# Larger — better reasoning, needs more RAM
ollama pull llama3.1

# Smallest / fastest — minimal RAM, still useful
ollama pull llama3.2:1b
```

To see all available models: https://ollama.com/library

#### Start Ollama

```bash
ollama serve
```

Ollama runs at `http://localhost:11434`. The backend auto-detects it on each request — no restart needed. The app will prefer any model whose name contains "llama"; otherwise it uses the first model found.

#### Verify it works

```bash
ollama list          # shows downloaded models
ollama run llama3.2  # test a prompt interactively
```

In the app, click any move in the analysis view then press **"🦙 Get AI Commentary"** to generate a chess-coach explanation for that move.

---

## Usage

### Analyze a Game
1. Open http://localhost:5173
2. Paste a Chess.com game URL or raw PGN
3. Click **Analyze Game**
4. Navigate moves with arrow keys or by clicking the move list
5. Click **🦙 Get AI Commentary** on any move for a deeper explanation (requires Ollama)

### Play vs Computer
1. Click **Play vs Computer** in the navbar
2. Choose your color and difficulty (Beginner → Master)
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
│   ├── analyzer.py      # Full-game analysis + Brilliant detection + commentary
│   ├── requirements.txt
│   └── routes/
│       ├── analyze.py   # /analyze-game-stream, /analyze-position, /commentary
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
        │   ├── AnalysisPage.jsx # Board + eval graph + move list + AI commentary
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
| POST | `/api/analyze-game-stream` | SSE stream - analysis progress + result |
| POST | `/api/analyze-position` | Multi-PV position evaluation |
| POST | `/api/commentary` | AI move commentary via Ollama (optional) |
| POST | `/api/play-move` | Stockfish best reply (optional ELO mode) |
| POST | `/api/evaluate` | Quick single-line evaluation |
