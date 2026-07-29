# backend/routers/kmz.py

from __future__ import annotations

import json
import logging
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

import simplekml
from fastapi import (
    APIRouter,
    UploadFile,
    File,
    HTTPException,
    BackgroundTasks,
    Form,
)
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.config import settings
from backend.services import kmz_parser, kmz_exporter
from backend.services.i18n_service import i18n_service
from backend.exceptions import FileParseError
from backend.routers.validators import ensure_valid_job_id, safe_filename

logger = logging.getLogger("irricontrol")

router = APIRouter(
    prefix="/kmz",
    tags=["KMZ Operations"],
)

# ---------------------------------------------------------------------------
# Configs de segurança/robustez
# ---------------------------------------------------------------------------
MAX_UPLOAD_MB: int = 50
CHUNK_SIZE: int = 1024 * 1024  # 1MB por chunk
ALLOWED_EXTS: set[str] = {".kmz", ".kml"}
ALLOWED_CTYPES: set[str] = {
    "application/vnd.google-earth.kmz",
    "application/octet-stream",
    "application/xml",
    "text/xml",
}
DEBUG: bool = bool(getattr(settings, "DEBUG", False))


# ---------------------------------------------------------------------------
# utils
# ---------------------------------------------------------------------------
def _ensure_dir(p: Path) -> None:
    """Cria diretório se não existir, ou lança HTTPException se falhar."""
    try:
        p.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.error("Failed to create directory '%s': %s", p, e, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao criar diretório '{p}': {type(e).__name__} - {str(e)}",
        )


async def _save_upload_stream(upload: UploadFile, dst: Path, max_mb: int) -> int:
    """
    Salva UploadFile em streaming, respeitando limite de tamanho.
    """
    total = 0
    _ensure_dir(dst.parent)
    try:
        upload.file.seek(0)
    except Exception:
        pass

    try:
        with open(dst, "wb") as f:
            while True:
                chunk = await upload.read(CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_mb * 1024 * 1024:
                    try:
                        f.close()
                    finally:
                        dst.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail=f"Arquivo excede {max_mb}MB")
                f.write(chunk)
    finally:
        await upload.close()
    return total


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/iniciar_job_vazio")
async def iniciar_job_vazio_endpoint() -> Dict[str, str]:
    """Cria job vazio com estrutura mínima de diretórios e JSON inicial."""
    job_id = str(uuid.uuid4())
    logger.info("New empty job started with ID: %s", job_id)

    job_input_dir = settings.ARQUIVOS_DIR_PATH / job_id
    job_images_dir = settings.IMAGENS_DIR_PATH / job_id
    _ensure_dir(job_input_dir)
    _ensure_dir(job_images_dir)

    parsed_data_path = job_input_dir / "parsed_data.json"
    parsed_content_vazio: Dict[str, list[Any]] = {"antenas": [], "pivos": [], "ciclos": [], "bombas": []}
    with open(parsed_data_path, "w", encoding="utf-8") as f:
        json.dump(parsed_content_vazio, f, ensure_ascii=False, indent=4)

    logger.info("  -> Estrutura de diretórios para job vazio '%s' criada.", job_id)
    return {"job_id": job_id}


class ExportPayload(BaseModel):
    job_id: str
    template_id: str
    language: str = "pt-br"
    antena_principal_data: Optional[Dict[str, Any]] = None
    imagem: Optional[str] = None
    bounds_file: Optional[str] = None
    pivos_data: List[Dict[str, Any]]
    ciclos_data: List[Dict[str, Any]]
    bombas_data: List[Dict[str, Any]]
    repetidoras_data: List[Dict[str, Any]]


@router.post("/processar")
async def processar_kmz_endpoint(
    file: UploadFile = File(...), language: str = Form("pt-br")
) -> Dict[str, Any]:
    """Processa upload de KMZ/KML, parseia dados e retorna JSON com entidades."""
    job_id = str(uuid.uuid4())
    logger.info(
        "New GIS file processing job (%s) started with ID: %s for language: '%s'",
        file.filename,
        job_id,
        language,
    )

    job_input_dir = settings.ARQUIVOS_DIR_PATH / job_id
    job_images_dir = settings.IMAGENS_DIR_PATH / job_id
    _ensure_dir(job_input_dir)
    _ensure_dir(job_images_dir)

    nome_seguro = Path(file.filename).name
    input_file_path = job_input_dir / nome_seguro

    ext = Path(nome_seguro).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="Arquivo deve ser .kmz ou .kml")

    ctype = (file.content_type or "").lower()
    if ctype and ctype not in ALLOWED_CTYPES:
        logger.warning("Content-Type inesperado para %s: %s", nome_seguro, ctype)

    try:
        total_bytes = await _save_upload_stream(file, input_file_path, MAX_UPLOAD_MB)
        logger.info(
            "  -> Arquivo de entrada salvo em: %s (%0.2f MB)",
            input_file_path,
            total_bytes / (1024 * 1024),
        )

        antenas, pivos, ciclos, bombas = await run_in_threadpool(
            kmz_parser.parse_gis_file,
            str(input_file_path), str(job_input_dir), lang=language
        )

        parsed_data_path = job_input_dir / "parsed_data.json"
        parsed_content = {"antenas": antenas, "pivos": pivos, "ciclos": ciclos, "bombas": bombas}
        with open(parsed_data_path, "w", encoding="utf-8") as f:
            json.dump(parsed_content, f, ensure_ascii=False, indent=4)

        logger.info("  -> Dados parseados salvos para o job em: %s", parsed_data_path)
        return {"job_id": job_id, **parsed_content}

    except FileParseError as e:
        logger.error("File parse error (job: %s): %s", job_id, e, exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Internal error in /kmz/processar (job: %s): %s", job_id, e, exc_info=True)
        if DEBUG:
            raise HTTPException(
                status_code=500,
                detail=f"Erro interno ao processar o arquivo: {type(e).__name__} - {str(e)}",
            )
        raise HTTPException(status_code=500, detail="Erro interno ao processar o arquivo.")


def build_kmz_file(payload: ExportPayload) -> tuple[Path, str]:
    """
    Constrói o arquivo KMZ a partir do payload de exportação e devolve
    (caminho_do_arquivo, nome_do_arquivo). Função síncrona, reutilizada
    tanto pelo endpoint `/kmz/exportar` quanto pelo bundle PDF+KMZ.
    """
    job_id = ensure_valid_job_id(payload.job_id)
    job_input_dir = settings.ARQUIVOS_DIR_PATH / job_id
    job_images_dir = settings.IMAGENS_DIR_PATH / job_id
    _ensure_dir(job_input_dir)
    _ensure_dir(job_images_dir)

    bounds_principal_data: Optional[Dict[str, Any]] = None

    if payload.antena_principal_data and payload.imagem and payload.bounds_file:
        logger.info(" -> Antena principal detectada no payload. Verificando arquivos...")
        caminho_imagem_principal = job_images_dir / safe_filename(payload.imagem)
        caminho_bounds_principal = job_images_dir / safe_filename(payload.bounds_file)
        if not caminho_imagem_principal.exists() or not caminho_bounds_principal.exists():
            raise HTTPException(status_code=404, detail=f"Arquivos da antena principal não encontrados para o job '{payload.job_id}'.")

        with open(caminho_bounds_principal, "r", encoding="utf-8") as f:
            bounds_principal_data = json.load(f).get("bounds")
    else:
        logger.info(" -> Nenhuma antena principal no payload. Exportando sem ela.")

    selected_template = settings.obter_template(payload.template_id)

    t = i18n_service.get_translator(payload.language)
    kml = simplekml.Kml(name=t("kml.main_name"))

    caminho_kml_temp = job_input_dir / "estudo_temp.kml"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename_prefix = t("kml.filename_prefix")
    nome_kmz_final = f"{filename_prefix}-{timestamp}.kmz"
    caminho_kmz_final = job_input_dir / nome_kmz_final

    arquivos_de_imagem_para_kmz = kmz_exporter.build_kml_document_and_get_image_list(
        doc=kml.document, lang=payload.language,
        antena_data=payload.antena_principal_data,
        pivos_data=payload.pivos_data, ciclos_data=payload.ciclos_data,
        bombas_data=payload.bombas_data,
        imagem_principal_nome_relativo=payload.imagem,
        bounds_principal_data=bounds_principal_data,
        generated_images_dir=job_images_dir,
        selected_template=selected_template,
        repetidoras_selecionadas_data=payload.repetidoras_data,
    )

    kml.save(str(caminho_kml_temp))
    logger.info("  -> KML temporário salvo em: %s", caminho_kml_temp)

    logger.info("  -> Criando KMZ final: %s", caminho_kmz_final)
    with zipfile.ZipFile(str(caminho_kmz_final), "w", zipfile.ZIP_DEFLATED) as kmz_zip:
        kmz_zip.write(str(caminho_kml_temp), "doc.kml")
        added_to_zip: set[str] = set()
        for src_path, dest_name in arquivos_de_imagem_para_kmz:
            if dest_name not in added_to_zip and Path(src_path).exists():
                kmz_zip.write(str(src_path), dest_name)
                added_to_zip.add(dest_name)
            else:
                logger.warning("      -> Image '%s' not found or duplicate, not added to KMZ.", src_path)

    caminho_kml_temp.unlink(missing_ok=True)
    return caminho_kmz_final, nome_kmz_final


@router.post("/exportar")
async def exportar_kmz_endpoint(payload: ExportPayload, background_tasks: BackgroundTasks):
    """Exporta os dados parseados em um KMZ pronto para Google Earth."""
    logger.info("Starting KMZ export for job: %s in language: '%s'", payload.job_id, payload.language)

    try:
        caminho_kmz_final, nome_kmz_final = await run_in_threadpool(build_kmz_file, payload)

        logger.info("  -> Exportação KMZ concluída.")

        return FileResponse(
            str(caminho_kmz_final),
            media_type="application/vnd.google-earth.kmz",
            filename=nome_kmz_final,
            background=background_tasks,
        )

    except FileNotFoundError as fnfe:
        logger.error("File not found during export (job: %s): %s", payload.job_id, fnfe, exc_info=True)
        raise HTTPException(status_code=404, detail=f"Arquivo necessário não encontrado: {str(fnfe)}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Internal error in /kmz/exportar (job: %s): %s", payload.job_id, e, exc_info=True)
        if DEBUG:
            raise HTTPException(status_code=500, detail=f"Erro ao exportar KMZ: {type(e).__name__} - {str(e)}")
        raise HTTPException(status_code=500, detail="Erro interno ao exportar KMZ.")


@router.get("/icone-torre")
async def get_icone_torre():
    """Serve o ícone da torre (cloudrf.png) se existir, senão 404."""
    caminho_icone = settings.IMAGENS_DIR_PATH / "cloudrf.png"
    if caminho_icone.is_file():
        return FileResponse(str(caminho_icone), media_type="image/png")
    logger.warning("Ícone da torre não encontrado no caminho base: %s", caminho_icone)
    raise HTTPException(status_code=404, detail="Ícone 'cloudrf.png' não encontrado.")