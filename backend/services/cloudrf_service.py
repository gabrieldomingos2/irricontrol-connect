# backend/services/cloudrf_service.py

import asyncio
import json
import hashlib
import logging
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from backend.config import settings
from backend.exceptions import CloudRFAPIError

logger = logging.getLogger("irricontrol")


# ----------------- Helpers de HTTP (timeouts/limites/HTTP2) -----------------

def _timeout() -> httpx.Timeout:
    return httpx.Timeout(getattr(settings, "HTTP_TIMEOUT", 30))


def _limits() -> httpx.Limits:
    return httpx.Limits(
        max_connections=int(getattr(settings, "HTTP_MAX_CONNECTIONS", 100)),
        max_keepalive_connections=int(getattr(settings, "HTTP_MAX_KEEPALIVE", 20)),
    )


async def get_http_client() -> httpx.AsyncClient:
    """
    AsyncClient com HTTP/2 opcional (fallback para HTTP/1.1 se 'h2' não estiver instalado).
    """
    want_h2 = bool(getattr(settings, "HTTP_HTTP2", True))
    kwargs: Dict[str, Any] = {"timeout": _timeout(), "limits": _limits()}

    if want_h2:
        try:
            import h2  # noqa: F401
            kwargs["http2"] = True
        except Exception:
            logger.warning('HTTP/2 ativado mas pacote "h2" ausente. Fallback para HTTP/1.1. '
                            'Dica: pip install "httpx[http2]"')
            kwargs["http2"] = False

    return httpx.AsyncClient(**kwargs)


async def _request_with_retries(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    retries: int = 2,
    backoff: float = 0.6,
    **kwargs: Any,
) -> httpx.Response:
    """
    Faz request propagando TODOS os kwargs (headers/json/etc).
    Retry para timeouts/erros de transporte/HTTP 5xx e 429 (rate limit).
    """
    attempt = 0
    while True:
        try:
            resp = await client.request(method, url, **kwargs)  # <- KWARGS propagados
            # Re-tenta em 5xx ou 429 (rate limit)
            if resp.status_code == 429 or (500 <= resp.status_code < 600):
                raise httpx.HTTPStatusError(str(resp.status_code), request=resp.request, response=resp)
            return resp
        except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.RemoteProtocolError, httpx.TransportError):
            if attempt >= retries:
                raise
            await asyncio.sleep(backoff * (attempt + 1))
            attempt += 1
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if (status == 429 or 500 <= status < 600) and attempt < retries:
                await asyncio.sleep(backoff * (attempt + 1))
                attempt += 1
                continue
            raise


# ----------------- Utils -----------------

def format_coord(coord: float) -> str:
    """Formata coordenada para nome de arquivo."""
    return f"{coord:.6f}".replace(".", "_").replace("-", "m")


def save_bounds(bounds: list, local_image_path: Path) -> None:
    """Salva bounds em JSON ao lado da imagem."""
    json_path = local_image_path.with_suffix(".json")
    try:
        json_path.parent.mkdir(parents=True, exist_ok=True)
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({"bounds": bounds}, f, indent=4)
        logger.info("  -> Bounds saved to: %s", json_path)
    except Exception as e:
        logger.error("  -> Error saving bounds to %s: %s", json_path, e, exc_info=True)


async def download_image(url: str, local_image_path: Path) -> None:
    """Baixa a imagem da CloudRF e grava no caminho local (com retry)."""
    logger.info("  -> Downloading image: %s", url)
    local_image_path.parent.mkdir(parents=True, exist_ok=True)
    async with await get_http_client() as client:
        resp = await _request_with_retries(
            client, "GET", url,
            headers={"Accept": "image/png, image/*;q=0.8,*/*;q=0.5"}
        )
        resp.raise_for_status()
        with open(local_image_path, "wb") as f:
            f.write(resp.content)
    logger.info("  -> Image saved to: %s", local_image_path)


# ----------------- Payload CloudRF -----------------

def _build_cloudrf_payload(tpl: Any, lat: float, lon: float, altura: int, receiver_alt: float) -> dict:
    """
    Monta o payload para o endpoint /area da CloudRF.
    Tudo “linha a linha” para facilitar auditoria.
    """
    return {
        # Identificação / meta
        "version": "CloudRF-API-v3.24",
        "site": tpl.site,
        "network": "Irricontrol Signal Simulation",

        # Engine / sistema de coordenadas
        "engine": 2,          # ITM/Longley-Rice
        "coordinates": 1,     # 1 = WGS84 (lat/lon)

        # Transmissor (TX)
        "transmitter": {
            "lat": float(lat),
            "lon": float(lon),
            "alt": int(altura),               # altura TX (m)
            "frq": tpl.frq,                   # frequência (MHz)
            "txw": tpl.transmitter.txw,       # potência (W)
            "bwi": tpl.transmitter.bwi,       # largura de banda (MHz)
            "powerUnit": "W",
        },

        # Receptor (RX) — posição ignorada em /area; altura e ganhos importam
        "receiver": {
            "lat": 0,
            "lon": 0,
            "alt": float(receiver_alt),       # altura RX (m)
            "rxg": tpl.receiver.rxg,          # ganho RX (dBi)
            "rxs": tpl.receiver.rxs,          # sensibilidade (dBm)
        },

        # Perdas de feeder (cabos/conectores)
        "feeder": {
            "flt": 1,    # tipo de perda
            "fll": 0,    # comprimento (m)
            "fcc": 0,    # conectores
        },

        # Antena TX (template)
        "antenna": {
            "mode": "template",
            "txg": tpl.antenna.txg,   # ganho TX (dBi)
            "txl": 0,                 # perda adicional (dB)
            "ant": 1,                 # índice do template (se aplicável)
            "azi": 0,                 # azimute (°)
            "tlt": 0,                 # tilt (°)
            "hbw": 360,               # largura horizontal (°)
            "vbw": 90,                # largura vertical (°)
            "fbr": tpl.antenna.fbr,   # front-to-back (dB)
            "pol": "v",               # polarização
        },

        # Modelo de propagação
        "model": {
            "pm": 1,    # path loss model
            "pe": 2,    # environment
            "ked": 4,   # knife-edge diffraction
            "rel": 95,  # confiabilidade (%)
            "rcs": 1,   # random clutter seed
        },

        # Ambiente
        "environment": {
            "elevation": 1,        # usa MDT
            "landcover": 1,        # uso do solo
            "buildings": 0,        # prédios desligado
            "clt": "Minimal.clt",  # paleta
        },

        # Saída (raster WGS84)
        "output": {
            "units": "m",
            "col": tpl.col,   # paleta de cores
            "out": 2,         # 2 = PNG WGS84
            "ber": 1,
            "mod": 7,
            "nf": -120,
            "res": 30,
            "rad": 7,
        },
    }


# ----------------- Simulação + Cache -----------------

async def run_cloudrf_simulation(
    lat: float,
    lon: float,
    altura: int,
    altura_receiver: Optional[float],
    template_id: str,
    is_repeater: bool = False
) -> dict:
    """
    Executa simulação de cobertura na CloudRF com cache em disco.
    O cache é canônico (independente de job_id).
    """
    tpl = settings.obter_template(template_id)
    rx_alt = altura_receiver if altura_receiver is not None else tpl.receiver.alt

    cache_key_string = f"lat:{lat:.6f}-lon:{lon:.6f}-alt:{altura}-rx_alt:{rx_alt}-tpl:{template_id}"
    cache_hash = hashlib.sha256(cache_key_string.encode()).hexdigest()
    cache_file_path = settings.SIMULATIONS_CACHE_PATH / f"{cache_hash}.json"

    try:
        cache_file_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    if cache_file_path.exists():
        logger.info("CACHE HIT: %s", cache_hash[:12])
        with open(cache_file_path, "r", encoding="utf-8") as f:
            cached = json.load(f)
        imgp = Path(cached["imagem_local_path"])
        if imgp.exists() and imgp.with_suffix(".json").exists():
            return cached
        logger.warning("CACHE corrompido (arquivos ausentes). Re-simulando.")

    return await _perform_simulation_and_save_to_cache(
        lat, lon, altura, rx_alt, template_id, is_repeater, tpl, cache_file_path
    )


async def _perform_simulation_and_save_to_cache(
    lat: float,
    lon: float,
    altura: int,
    receiver_alt: float,
    template_id: str,
    is_repeater: bool,
    tpl: Any,
    cache_file_path: Path
) -> dict:
    logger.info(
        "CACHE MISS: Simulação CloudRF (tpl=%s, lat=%.6f, lon=%.6f, alt=%dm, rx=%.2f)",
        tpl.id, lat, lon, altura, receiver_alt
    )

    if not settings.CLOUDRF_API_KEY:
        raise ValueError("CLOUDRF_API_KEY ausente no settings (.env).")

    payload = _build_cloudrf_payload(tpl, lat, lon, altura, receiver_alt)

    headers = {
        "key": settings.CLOUDRF_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    async with await get_http_client() as client:
        try:
            resp = await _request_with_retries(
                client, "POST", str(settings.CLOUDRF_API_URL),
                headers=headers, json=payload
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as e:
            logger.error("  -> CloudRF HTTP error: %s - %s", e.response.status_code, e.response.text, exc_info=True)
            raise CloudRFAPIError(f"API respondeu com erro ({e.response.status_code}): {e.response.text}")
        except Exception as e:
            logger.error("  -> Error calling CloudRF: %s", e, exc_info=True)
            raise CloudRFAPIError(f"Erro de comunicação com a API CloudRF: {e}")

    img_url = data.get("PNG_WGS84")
    bounds = data.get("bounds")
    if not img_url or not bounds:
        raise CloudRFAPIError("Resposta inválida da CloudRF (faltou PNG_WGS84 ou bounds).")

    # Nome canônico da imagem no cache
    lat_str, lon_str = format_coord(lat), format_coord(lon)
    prefix = "repetidora" if is_repeater else "principal"
    template_name_safe = tpl.id.lower().replace(" ", "_")
    imagem_filename = f"{prefix}_{template_name_safe}_tx{altura}m_rx{receiver_alt:.1f}m_lat{lat_str}_lon{lon_str}.png"
    local_img = settings.SIMULATIONS_CACHE_PATH / imagem_filename

    # Baixar imagem e salvar bounds
    await download_image(img_url, local_img)
    save_bounds(bounds, local_img)

    # Persistir JSON do cache
    cached = {
        "imagem_local_path": str(local_img),
        "imagem_filename": imagem_filename,
        "bounds": bounds,
    }
    with open(cache_file_path, "w", encoding="utf-8") as f:
        json.dump(cached, f, indent=4)
    logger.info(" -> Result saved to cache: %s", cache_file_path.name)

    return cached