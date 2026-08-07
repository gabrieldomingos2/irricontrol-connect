# backend/routers/simulation.py

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.config import settings
from backend.services import cloudrf_service, analysis_service
from backend.exceptions import CloudRFAPIError, DEMProcessingError
from backend.routers.validators import ensure_valid_job_id

logger = logging.getLogger("irricontrol")
router = APIRouter(prefix="/simulation", tags=["Simulation & Analysis"])

DEBUG = bool(getattr(settings, "DEBUG", False))


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class PivoData(BaseModel):
    nome: str
    lat: float
    lon: float
    tipo: Optional[str] = "pivo"
    fora: Optional[bool] = None
    raio: Optional[float] = None
    angulo_central: Optional[float] = None
    abertura_arco: Optional[float] = None
    angulo_inicio: Optional[float] = None
    angulo_fim: Optional[float] = None


class BombaData(BaseModel):
    nome: str
    lat: float
    lon: float
    type: Literal["bomba"] = "bomba"
    fora: Optional[bool] = None


class AntenaSimPayload(BaseModel):
    job_id: str
    lat: float
    lon: float
    altura: int
    altura_receiver: Optional[int] = 3
    nome: Optional[str] = "Antena Principal"
    template: str
    pivos_atuais: List[PivoData]
    bombas_atuais: List[BombaData]


class ManualSimPayload(BaseModel):
    job_id: str
    lat: float
    lon: float
    altura: float
    altura_receiver: float
    template: str
    pivos_atuais: List[PivoData]


class OverlayData(BaseModel):
    id: Optional[str] = None
    imagem: str
    bounds: Tuple[float, float, float, float]


class ReavaliarPayload(BaseModel):
    job_id: str
    pivos: List[PivoData]
    bombas: List[BombaData]
    overlays: List[OverlayData]
    signal_sources: Optional[List[Dict[str, float]]] = None


class PerfilPayload(BaseModel):
    pontos: List[Tuple[float, float]]
    altura_antena: float
    altura_receiver: float


class FindRepeaterSitesPayload(BaseModel):
    job_id: str
    target_pivot_lat: float
    target_pivot_lon: float
    target_pivot_nome: str
    altura_antena_repetidora_proposta: Optional[float] = 5.0
    altura_receiver_pivo: Optional[float] = 3.0
    active_overlays: List[OverlayData]
    pivot_polygons_coords: Optional[List[List[Tuple[float, float]]]] = None


class GeneratePivotPayload(BaseModel):
    job_id: str
    center: Tuple[float, float]
    pivos_atuais: List[PivoData]
    language: str = "pt-br"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _get_image_filepath_for_analysis(image_filename: str, job_id: str) -> Path:
    """Normalizes the filename and resolves it within the job folder. Prevents path traversal."""
    filename_only = Path(image_filename.split("?", 1)[0]).name
    return settings.IMAGENS_DIR_PATH / job_id / filename_only


def _build_served_url(job_id: str, filename: str) -> str:
    """Builds the public image URL. In dev mode, returns a relative path."""
    backend_url = ""
    if str(getattr(settings, "ENVIRONMENT", "")).lower() == "production":
        if getattr(settings, "BACKEND_PUBLIC_URL", None):
            backend_url = str(settings.BACKEND_PUBLIC_URL).rstrip("/")
    path_part = f"/{settings.STATIC_DIR_NAME}/{settings.IMAGENS_DIR_NAME}/{job_id}/{filename}"
    return f"{backend_url}{path_part}"


def _copy_cached_with_json(cached_image_path: Path, dest_image_path: Path) -> None:
    """Copies the image and its sibling JSON file; logs a warning if the JSON is absent."""
    dest_image_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(cached_image_path, dest_image_path)
    json_src, json_dst = cached_image_path.with_suffix(".json"), dest_image_path.with_suffix(".json")
    if json_src.exists():
        shutil.copy2(json_src, json_dst)
    else:
        logger.warning("Associated JSON file not found: %s", json_src)


# ---------------------------------------------------------------------------
# Template validation (includes temporarily disabled templates)
# ---------------------------------------------------------------------------
def _validate_template_id_with_override(template_id: str, allow_disabled: bool = True) -> None:
    available = set(settings.listar_templates_ids())
    allowed = set(settings.listar_templates_permitidos())
    if template_id not in available:
        raise HTTPException(status_code=400, detail=f"Template inválido: '{template_id}'")
    if not allow_disabled and template_id not in allowed:
        raise HTTPException(status_code=403, detail="Template desativado no momento. Fale com um administrador.")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/templates")
async def get_templates_endpoint():
    return {
        "templates": settings.listar_templates_ids(),
        "disabled": settings.TEMPLATES_DESABILITADOS,
        "default": settings.DEFAULT_TEMPLATE_ID.value,
    }


@router.get("/mapbox_token")
async def get_mapbox_token_endpoint() -> Dict[str, str]:
    """
    Serves the Mapbox access token to authenticated frontend sessions only
    (this router is mounted with require_auth in main.py). Keeps the token
    out of the public JS bundle/source control — see .env.example.
    """
    if not settings.MAPBOX_ACCESS_TOKEN:
        raise HTTPException(status_code=503, detail="Mapbox não configurado no servidor.")
    return {"token": settings.MAPBOX_ACCESS_TOKEN}


@router.post("/generate_pivot_in_circle")
async def generate_pivot_in_circle_endpoint(payload: GeneratePivotPayload):
    try:
        novo_pivo = analysis_service.generate_pivot_at_center(
            center_lat=payload.center[0],
            center_lon=payload.center[1],
            existing_pivos=[p.model_dump() for p in payload.pivos_atuais],
            lang=payload.language,
        )
        return {"novo_pivo": novo_pivo}
    except Exception as e:
        logger.error("Error in /generate_pivot_in_circle: %s", e, exc_info=True)
        msg = f"Erro ao gerar novo pivô: {e}" if DEBUG else "Erro interno ao gerar novo pivô."
        raise HTTPException(status_code=500, detail=msg)


@router.post("/run_main")
async def run_main_simulation_endpoint(payload: AntenaSimPayload, request: Request):
    try:
        ensure_valid_job_id(payload.job_id)
        _validate_template_id_with_override(payload.template, allow_disabled=True)
        logger.info("Starting main simulation for session: %s", payload.job_id)

        sim_result = await cloudrf_service.run_cloudrf_simulation(
            lat=payload.lat,
            lon=payload.lon,
            altura=payload.altura,
            altura_receiver=payload.altura_receiver,
            template_id=payload.template,
        )

        cached_image_path = Path(sim_result["imagem_local_path"])
        imagem_filename = sim_result["imagem_filename"]
        bounds = sim_result.get("bounds")
        if bounds is None:
            raise HTTPException(status_code=502, detail="Simulation response missing 'bounds'.")

        job_image_dir = settings.IMAGENS_DIR_PATH / payload.job_id
        dest_image_path = job_image_dir / Path(imagem_filename).name
        _copy_cached_with_json(cached_image_path, dest_image_path)

        imagem_servida_url = _build_served_url(payload.job_id, dest_image_path.name)
        overlay_info = {"imagem_path": dest_image_path, "bounds": bounds}
        signal_sources = [{"lat": payload.lat, "lon": payload.lon}]

        pivos_com_status, bombas_com_status = await asyncio.gather(
            analysis_service.verificar_cobertura_pivos(
                [p.model_dump() for p in payload.pivos_atuais], [overlay_info], signal_sources
            ),
            analysis_service.verificar_cobertura_bombas(
                [b.model_dump() for b in payload.bombas_atuais], [overlay_info], signal_sources
            ),
        )

        logger.info("Main simulation completed for session: %s", payload.job_id)
        return {
            "imagem_salva": imagem_servida_url,
            "imagem_filename": dest_image_path.name,
            "bounds": bounds,
            "pivos": pivos_com_status,
            "bombas": bombas_com_status,
        }

    except CloudRFAPIError as e:
        logger.error("CloudRF API failure for job %s: %s", payload.job_id, e)
        raise HTTPException(status_code=502, detail=f"External simulation service failed: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Internal error in /run_main for job %s: %s", payload.job_id, e)
        msg = f"Erro na simulação principal: {e}" if DEBUG else "Erro interno inesperado na simulação principal."
        raise HTTPException(status_code=500, detail=msg)


@router.post("/run_manual")
async def run_manual_simulation_endpoint(payload: ManualSimPayload, request: Request):
    try:
        ensure_valid_job_id(payload.job_id)
        _validate_template_id_with_override(payload.template, allow_disabled=True)
        logger.info("Starting manual simulation for session: %s", payload.job_id)

        sim_result = await cloudrf_service.run_cloudrf_simulation(
            lat=payload.lat,
            lon=payload.lon,
            altura=int(payload.altura),
            altura_receiver=int(payload.altura_receiver),
            template_id=payload.template,
            is_repeater=True,
        )

        cached_image_path = Path(sim_result["imagem_local_path"])
        imagem_filename = Path(sim_result["imagem_filename"]).name
        bounds = sim_result.get("bounds")
        if bounds is None:
            raise HTTPException(status_code=502, detail="Simulation response missing 'bounds'.")

        job_image_dir = settings.IMAGENS_DIR_PATH / payload.job_id
        dest_image_path = job_image_dir / imagem_filename
        _copy_cached_with_json(cached_image_path, dest_image_path)

        imagem_servida_url = _build_served_url(payload.job_id, imagem_filename)
        logger.info("Manual simulation completed for session: %s", payload.job_id)

        return {
            "imagem_salva": imagem_servida_url,
            "imagem_filename": imagem_filename,
            "bounds": bounds,
            "status": "Simulação manual concluída",
        }

    except CloudRFAPIError as e:
        logger.error("CloudRF API failure for job %s: %s", payload.job_id, e)
        raise HTTPException(status_code=502, detail=f"External simulation service failed: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Internal error in /simulation/run_manual for job %s: %s", payload.job_id, e)
        msg = f"Erro na simulação manual: {e}" if DEBUG else "Erro interno inesperado na simulação manual."
        raise HTTPException(status_code=500, detail=msg)


@router.post("/reevaluate")
async def reevaluate_pivots_endpoint(payload: ReavaliarPayload):
    """Reevaluates pivot and pump coverage based on active signal overlays."""
    try:
        ensure_valid_job_id(payload.job_id)
        logger.info("Reevaluating coverage for session %s with %d overlays.", payload.job_id, len(payload.overlays))

        overlays_para_analise = []
        for o_data in payload.overlays or []:
            imagem_path_servidor = _get_image_filepath_for_analysis(o_data.imagem, payload.job_id)
            if not imagem_path_servidor.is_file():
                logger.warning("Image file '%s' not found (session %s). Skipping.", o_data.imagem, payload.job_id)
                continue
            overlays_para_analise.append({
                "id": o_data.id or f"overlay_{Path(o_data.imagem.split('?', 1)[0]).stem}",
                "imagem_path": imagem_path_servidor,
                "bounds": o_data.bounds,
            })

        pivos_atualizados = [p.model_dump() for p in payload.pivos]
        bombas_atualizadas = [b.model_dump() for b in payload.bombas]

        if not overlays_para_analise and not payload.signal_sources:
            for pivo in pivos_atualizados:
                pivo["fora"] = True
            for bomba in bombas_atualizadas:
                bomba["fora"] = True
            return {"pivos": pivos_atualizados, "bombas": bombas_atualizadas}

        tasks, signal_sources = [], payload.signal_sources or []
        if pivos_atualizados:
            tasks.append(analysis_service.verificar_cobertura_pivos(pivos_atualizados, overlays_para_analise, signal_sources))
        if bombas_atualizadas:
            tasks.append(analysis_service.verificar_cobertura_bombas(bombas_atualizadas, overlays_para_analise, signal_sources))

        if tasks:
            results = await asyncio.gather(*tasks)
            if pivos_atualizados:
                pivos_atualizados = results[0]
            if bombas_atualizadas and len(results) > 1:
                bombas_atualizadas = results[1]

        logger.info("Coverage reevaluation completed for session %s.", payload.job_id)
        return {"pivos": pivos_atualizados, "bombas": bombas_atualizadas}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error in /simulation/reevaluate (session %s): %s", payload.job_id, e, exc_info=True)
        msg = f"Erro ao reavaliar cobertura: {e}" if DEBUG else "Erro interno ao reavaliar cobertura."
        raise HTTPException(status_code=500, detail=msg)


@router.post("/elevation_profile")
async def get_elevation_profile_endpoint(payload: PerfilPayload):
    try:
        logger.info("Calculating elevation profile for %d points.", len(payload.pontos))
        resultado = await analysis_service.obter_perfil_elevacao(
            pontos=payload.pontos, alt1=payload.altura_antena, alt2=payload.altura_receiver
        )
        logger.info("Elevation profile calculated.")
        return resultado
    except DEMProcessingError as e:
        logger.error("Failed to process elevation data: %s", e)
        raise HTTPException(status_code=500, detail=f"Erro ao processar dados de terreno: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in /simulation/elevation_profile: %s", e)
        msg = f"Erro ao buscar perfil de elevação: {e}" if DEBUG else "Erro interno ao buscar perfil de elevação."
        raise HTTPException(status_code=500, detail=msg)


@router.post("/find_repeater_sites")
async def find_repeater_sites_endpoint(payload: FindRepeaterSitesPayload):
    try:
        ensure_valid_job_id(payload.job_id)
        logger.info(
            "Searching repeater sites for pivot '%s' in session %s.",
            payload.target_pivot_nome, payload.job_id,
        )

        active_overlays_for_analysis = [
            {
                "id": ov.id,
                "imagem_path": _get_image_filepath_for_analysis(ov.imagem, payload.job_id),
                "bounds": ov.bounds,
            }
            for ov in payload.active_overlays
            if _get_image_filepath_for_analysis(ov.imagem, payload.job_id).is_file()
        ]
        if not active_overlays_for_analysis:
            return {"candidate_sites": []}

        candidate_sites = await analysis_service.encontrar_locais_altos_para_repetidora(
            alvo_lat=payload.target_pivot_lat,
            alvo_lon=payload.target_pivot_lon,
            alvo_nome=payload.target_pivot_nome,
            altura_antena_repetidora_proposta=payload.altura_antena_repetidora_proposta,
            altura_receptor_pivo=payload.altura_receiver_pivo,
            active_overlays_data=active_overlays_for_analysis,
            pivot_polygons_coords_data=payload.pivot_polygons_coords,
        )
        logger.info(
            "Repeater site search completed (session %s). %d candidates.",
            payload.job_id, len(candidate_sites),
        )
        return {"candidate_sites": candidate_sites}
    except DEMProcessingError as e:
        logger.error("Failed to find repeater sites due to DEM error for job %s: %s", payload.job_id, e)
        raise HTTPException(status_code=500, detail=f"Não foi possível analisar o terreno para encontrar locais: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Internal error in /find_repeater_sites for job %s: %s", payload.job_id, e)
        msg = f"Erro ao buscar locais para repetidora: {e}" if DEBUG else "Erro interno ao buscar locais para repetidora."
        raise HTTPException(status_code=500, detail=msg)
