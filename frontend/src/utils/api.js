import axios from 'axios';

const http = axios.create({
  baseURL: '/api',
  timeout: 180_000,
});

export async function analyzeGameStream({ url, gameId, pgn, depth = 15 }, onProgress) {
  const resp = await fetch('/api/analyze-game-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url:     url     || undefined,
      game_id: gameId  || undefined,
      pgn:     pgn     || undefined,
      depth,
    }),
  });

  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try { detail = (await resp.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const dataLine = chunk.split('\n').find(l => l.startsWith('data: '));
        if (!dataLine) continue;

        let event;
        try { event = JSON.parse(dataLine.slice(6)); } catch { continue; }

        if (event.type === 'progress' && onProgress) {
          onProgress(event.current, event.total);
        } else if (event.type === 'done') {
          return event.result;
        } else if (event.type === 'error') {
          throw new Error(event.detail || 'Analysis failed');
        }
      }
    }
  } finally {
    reader.cancel();
  }

  throw new Error('Stream ended unexpectedly');
}

export async function analyzePosition({ fen, depth = 15, multipv = 3 }) {
  const { data } = await http.post('/analyze-position', { fen, depth, multipv });
  return data;
}

export async function playMove({ fen, depth = 15, elo = null }) {
  const { data } = await http.post('/play-move', {
    fen,
    depth,
    elo: elo ?? undefined,
  });
  return data;
}

export async function evaluate({ fen, depth = 11 }) {
  const { data } = await http.post('/evaluate', { fen, depth });
  return data;
}

