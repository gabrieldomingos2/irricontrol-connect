# backend/routers/tiles.py

from __future__ import annotations

import asyncio
import logging
import random
from pathlib import Path

import anyio
import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from backend.config import settings

logger = logging.getLogger("irricontrol")

router = APIRouter(
    prefix="/tiles",
    tags=["Tile Proxy"],
)

GOOGLE_SATELLITE_SUBDOMAINS = ["mt0", "mt1", "mt2", "mt3"]

TILE_CACHE_DIR = settings.ARQUIVOS_DIR_PATH / "cache" / "tiles"

# Reused across requests instead of opening a new HTTPS connection to Google
# per tile — with 20-30+ tiles in a single map view, a fresh TLS handshake
# each time was slow enough that the frontend's PDF-export snapshot would
# fire before every tile had finished loading, leaving visible gaps.
_client: httpx.AsyncClient | None = None

# Rapid zoom on the Leaflet map can fire dozens of tile requests in a single
# burst. Each request used to do blocking disk I/O directly on the event
# loop, which stalled Uvicorn long enough for Render's HTTP/2 edge to reset
# the connection (surfaced in the browser as ERR_HTTP2_PROTOCOL_ERROR). The
# semaphore caps how many tiles are fetched/read concurrently so the loop
# keeps servicing other requests instead of queuing behind disk/network I/O.
_CONCURRENCY_LIMIT = 16
_tile_semaphore = asyncio.Semaphore(_CONCURRENCY_LIMIT)


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=10.0,
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
        )
    return _client


def _read_cache(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _write_cache(path: Path, content: bytes) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    except OSError as e:
        logger.warning("Failed to cache tile %s: %s", path, e)


@router.get("/satellite/{z}/{x}/{y}")
async def get_satellite_tile(request: Request, z: int, x: int, y: int) -> Response:
    """
    Proxies Google satellite tiles and re-serves them with a permissive CORS
    header. The map's tile provider (Google) does not send CORS headers of
    its own, which taints any <canvas> that draws those tiles — blocking
    client-side screenshots (html2canvas) used for the PDF report's map
    snapshot. Fetching through our own origin sidesteps that restriction
    without changing what the map looks like.

    Tiles are cached to disk on first fetch, since the same area is typically
    requested again seconds later (once when the user pans/zooms, again when
    the PDF export re-fits and re-screenshots the map).
    """
    cache_path = TILE_CACHE_DIR / str(z) / str(x) / f"{y}.jpg"

    async with _tile_semaphore:
        if await request.is_disconnected():
            raise HTTPException(status_code=499, detail="Cliente desconectado.")

        cached = await anyio.to_thread.run_sync(_read_cache, cache_path)
        if cached is not None:
            return Response(
                content=cached,
                media_type="image/jpeg",
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=86400",
                },
            )

        if await request.is_disconnected():
            raise HTTPException(status_code=499, detail="Cliente desconectado.")

        subdomain = random.choice(GOOGLE_SATELLITE_SUBDOMAINS)
        url = f"https://{subdomain}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"

        try:
            resp = await _get_client().get(url)
        except httpx.HTTPError as e:
            logger.warning("Tile proxy fetch failed for z=%s x=%s y=%s: %s", z, x, y, e)
            raise HTTPException(status_code=502, detail="Falha ao buscar tile do provedor.")

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="Tile não encontrado.")

        if await request.is_disconnected():
            raise HTTPException(status_code=499, detail="Cliente desconectado.")

        await anyio.to_thread.run_sync(_write_cache, cache_path, resp.content)

        return Response(
            content=resp.content,
            media_type=resp.headers.get("content-type", "image/jpeg"),
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=86400",
            },
        )
