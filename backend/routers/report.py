# backend/routers/report.py

from __future__ import annotations

import logging
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.config import settings
from backend.services import pdf_service
from backend.services.i18n_service import i18n_service
from backend.exceptions import PDFGenerationError
from backend.routers.kmz import ExportPayload, build_kmz_file
from backend.routers.validators import ensure_valid_job_id

logger = logging.getLogger("irricontrol")

router = APIRouter(
    prefix="/report",
    tags=["Report Operations"],
)


# ---------------------------------------------------------------------------
# Payload for exporting PDF reports
# ---------------------------------------------------------------------------
class PdfExportPayload(BaseModel):
    job_id: str
    language: str = "pt-br"
    antena_principal_data: Optional[Dict[str, Any]] = None
    pivos_data: List[Dict[str, Any]]
    bombas_data: List[Dict[str, Any]]
    repetidoras_data: List[Dict[str, Any]]
    template_id: str
    map_image_base64: Optional[str] = None


# ---------------------------------------------------------------------------
# Payload for exporting the combined PDF + KMZ bundle
# ---------------------------------------------------------------------------
class BundleExportPayload(BaseModel):
    job_id: str
    language: str = "pt-br"
    template_id: str
    antena_principal_data: Optional[Dict[str, Any]] = None
    imagem: Optional[str] = None
    bounds_file: Optional[str] = None
    pivos_data: List[Dict[str, Any]]
    ciclos_data: List[Dict[str, Any]]
    bombas_data: List[Dict[str, Any]]
    repetidoras_data: List[Dict[str, Any]]
    repetidoras_data_kmz: List[Dict[str, Any]]
    map_image_base64: Optional[str] = None


# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------
@router.post("/pdf_export")
async def export_pdf_report_endpoint(
    payload: PdfExportPayload, background_tasks: BackgroundTasks
):
    """
    Generates a PDF report from an existing job.
    - Uses `pdf_service.PDFReportGenerator` to compose the report.
    - The file is named with a translated prefix + timestamp.
    - The temporary PDF is scheduled for removal after sending.
    """
    DEBUG = bool(getattr(settings, "DEBUG", False))

    try:
        logger.info(
            "Starting PDF report export for session: %s in language: '%s'",
            payload.job_id,
            payload.language,
        )

        pdf_generator = pdf_service.PDFReportGenerator(lang=payload.language)

        pdf_path = await run_in_threadpool(
            pdf_generator.generate_report,
            antena_principal_data=payload.antena_principal_data,
            pivos_data=payload.pivos_data,
            bombas_data=payload.bombas_data,
            repetidoras_data=payload.repetidoras_data,
            template_id=payload.template_id,
            map_image_base64=payload.map_image_base64,
        )

        pdf_path = Path(pdf_path)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        t = i18n_service.get_translator(payload.language)
        filename_prefix = t("kml.filename_prefix") or "estudo"
        nome_pdf_final = f"{filename_prefix}_report_{timestamp}.pdf"
        background_tasks.add_task(pdf_path.unlink, missing_ok=True)

        logger.info("PDF report for session %s ready for download.", payload.job_id)
        return FileResponse(
            str(pdf_path),
            media_type="application/pdf",
            filename=nome_pdf_final,
            background=background_tasks,
        )

    except PDFGenerationError as e:
        logger.error(
            "Failed to generate PDF for session %s: %s",
            payload.job_id,
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate PDF report: {e}",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Internal error in /report/pdf_export for session %s: %s",
            payload.job_id,
            e,
            exc_info=True,
        )
        if DEBUG:
            raise HTTPException(
                status_code=500,
                detail=f"Error generating PDF report: {type(e).__name__} - {str(e)}",
            )
        raise HTTPException(
            status_code=500,
            detail="Internal error generating PDF report.",
        )


# ---------------------------------------------------------------------------
# Combined PDF + KMZ bundle endpoint
# ---------------------------------------------------------------------------
@router.post("/export_bundle")
async def export_bundle_endpoint(
    payload: BundleExportPayload, background_tasks: BackgroundTasks
):
    """
    Generates the PDF report and the KMZ study for a job and returns both
    packed together in a single .zip file.
    """
    DEBUG = bool(getattr(settings, "DEBUG", False))

    try:
        job_id = ensure_valid_job_id(payload.job_id)
        logger.info(
            "Starting PDF+KMZ bundle export for session: %s in language: '%s'",
            job_id,
            payload.language,
        )

        pdf_generator = pdf_service.PDFReportGenerator(lang=payload.language)

        pdf_path = await run_in_threadpool(
            pdf_generator.generate_report,
            antena_principal_data=payload.antena_principal_data,
            pivos_data=payload.pivos_data,
            bombas_data=payload.bombas_data,
            repetidoras_data=payload.repetidoras_data,
            template_id=payload.template_id,
            map_image_base64=payload.map_image_base64,
        )
        pdf_path = Path(pdf_path)

        kmz_payload = ExportPayload(
            job_id=payload.job_id,
            template_id=payload.template_id,
            language=payload.language,
            antena_principal_data=payload.antena_principal_data,
            imagem=payload.imagem,
            bounds_file=payload.bounds_file,
            pivos_data=payload.pivos_data,
            ciclos_data=payload.ciclos_data,
            bombas_data=payload.bombas_data,
            repetidoras_data=payload.repetidoras_data_kmz,
        )
        kmz_path, kmz_filename = await run_in_threadpool(build_kmz_file, kmz_payload)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        t = i18n_service.get_translator(payload.language)
        filename_prefix = t("kml.filename_prefix") or "estudo"
        pdf_filename = f"{filename_prefix}_report_{timestamp}.pdf"
        nome_zip_final = f"{filename_prefix}_{timestamp}.zip"

        job_input_dir = settings.ARQUIVOS_DIR_PATH / job_id
        caminho_zip_final = job_input_dir / nome_zip_final

        def _build_zip_sync() -> None:
            with zipfile.ZipFile(str(caminho_zip_final), "w", zipfile.ZIP_DEFLATED) as bundle_zip:
                bundle_zip.write(str(pdf_path), pdf_filename)
                bundle_zip.write(str(kmz_path), kmz_filename)

        await run_in_threadpool(_build_zip_sync)

        background_tasks.add_task(pdf_path.unlink, missing_ok=True)
        background_tasks.add_task(kmz_path.unlink, missing_ok=True)
        background_tasks.add_task(caminho_zip_final.unlink, missing_ok=True)

        logger.info("PDF+KMZ bundle for session %s ready for download.", payload.job_id)
        return FileResponse(
            str(caminho_zip_final),
            media_type="application/zip",
            filename=nome_zip_final,
            background=background_tasks,
        )

    except PDFGenerationError as e:
        logger.error(
            "Failed to generate PDF for bundle (session %s): %s",
            payload.job_id,
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate PDF report: {e}",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Internal error in /report/export_bundle for session %s: %s",
            payload.job_id,
            e,
            exc_info=True,
        )
        if DEBUG:
            raise HTTPException(
                status_code=500,
                detail=f"Error generating export bundle: {type(e).__name__} - {str(e)}",
            )
        raise HTTPException(
            status_code=500,
            detail="Internal error generating export bundle.",
        )