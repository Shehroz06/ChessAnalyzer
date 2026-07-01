"""
Chess Analysis API — FastAPI entry point.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from engine import engine_manager
from routes.analyze import router as analyze_router
from routes.play import router as play_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Chess Analysis API starting up")
    yield  # engine is lazily initialised on first request
    logger.info("Shutting down Stockfish engine")
    await engine_manager.close()


app = FastAPI(
    title="Chess Analysis API",
    description="Stockfish-powered chess game and position analysis",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router, prefix="/api", tags=["Analysis"])
app.include_router(play_router, prefix="/api", tags=["Play"])


@app.get("/", tags=["Health"])
async def root():
    return {"message": "Chess Analysis API", "docs": "/docs"}


@app.get("/api/health", tags=["Health"])
async def health():
    return {"status": "ok"}
