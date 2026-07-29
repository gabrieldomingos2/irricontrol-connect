# backend/services/kmz_exporter.py
# Builds a KML document structure and returns the list of image files to bundle into the KMZ.

import html
import json
import logging
import re
from datetime import datetime
from math import log10
from pathlib import Path
from shutil import copyfile
from typing import Any, Callable, Dict, List, Optional, Tuple

import simplekml
from geopy.distance import geodesic
from geopy.point import Point

from backend.config import settings
from backend.services.i18n_service import i18n_service

logger = logging.getLogger("irricontrol")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
LOGO_FILENAME = "IRRICONTROL.png"
TORRE_ICON_NAME = "cloudrf.png"
DEFAULT_ICON_URL = "http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_bounds(bounds: List[float] | Tuple[float, float, float, float]) -> Tuple[float, float, float, float]:
    """Normalises bounds to (S, W, N, E), swapping pairs if inverted."""
    s, w, n, e = bounds
    if s > n:
        s, n = n, s
    if w > e:
        w, e = e, w
    return float(s), float(w), float(n), float(e)


def _safe_rf_metrics(txw_watts: float, txg_dbi: float) -> Tuple[str, str]:
    """
    Converts RF parameters to ERP/EIRP (W and dBm).
    Returns 'N/A' strings if txw_watts <= 0.
    Returns a tuple: (erp_str, eirp_str).
    """
    try:
        if txw_watts and txw_watts > 0:
            tx_dbm = 10 * log10(txw_watts * 1000.0)  # W -> mW -> dBm
            eirp_dbm = tx_dbm + float(txg_dbi)
            erp_dbm = eirp_dbm - 2.15
            eirp_w = (10 ** (eirp_dbm / 10.0)) / 1000.0
            erp_w  = (10 ** (erp_dbm  / 10.0)) / 1000.0
            return f"{erp_w:.3f} W / {erp_dbm:.3f} dBm", f"{eirp_w:.3f} W / {eirp_dbm:.3f} dBm"
    except Exception as e:
        logger.warning("RF metric calculation failed (txw=%s, txg=%s): %s", txw_watts, txg_dbi, e)
    return "N/A", "N/A"


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _generate_sector_coords(lat, lon, radius_m, bearing_deg, arc_width_deg, steps=40) -> list:
    """Generates coordinates for a sector polygon (pizza-slice shape)."""
    coords = [(lon, lat, 0)]
    center_point = Point(latitude=lat, longitude=lon)
    start_angle = bearing_deg - (arc_width_deg / 2)
    for i in range(steps + 1):
        angle = start_angle + (i * arc_width_deg / steps)
        dest = geodesic(meters=radius_m).destination(center_point, angle)
        coords.append((dest.longitude, dest.latitude, 0))
    coords.append((lon, lat, 0))
    return coords


def _generate_pacman_coords(lat, lon, radius_m, start_angle_deg, end_angle_deg, steps=80) -> list:
    """Generates coordinates for an inverted-sector polygon (Pac-Man shape)."""
    coords = [(lon, lat, 0)]
    center_point = Point(latitude=lat, longitude=lon)

    start_angle = start_angle_deg
    end_angle = end_angle_deg
    if end_angle <= start_angle:
        end_angle += 360

    mouth_angle = end_angle - start_angle
    irrigated_angle = 360 - mouth_angle

    for i in range(steps + 1):
        current_angle = end_angle + (i * irrigated_angle / steps)
        dest = geodesic(meters=radius_m).destination(center_point, current_angle)
        coords.append((dest.longitude, dest.latitude, 0))

    coords.append((lon, lat, 0))
    return coords


# ---------------------------------------------------------------------------
# Name / label formatting
# ---------------------------------------------------------------------------

def _get_formatted_entity_name_for_backend(
    entity_data: dict,
    is_main_antenna: bool,
    t: Callable,
    for_pdf: bool = False,
) -> str:
    """
    Formats the antenna/repeater display name based on its 'type' for KMZ/PDF export.
    Uses translator `t` to resolve entity names.
    `for_pdf=True` simplifies the name for the PDF report.
    """
    # Effective height: default to 5 m when mounted on a pivot and no height is provided.
    altura_valor = entity_data.get("altura")
    if entity_data.get("sobre_pivo") and (altura_valor is None or altura_valor == ""):
        altura_valor = 5
    altura_str = (
        f"{altura_valor}m" if isinstance(altura_valor, (int, float))
        else (f"{altura_valor}" if altura_valor else "")
    )

    entity_type = entity_data.get("type")
    nome_original = entity_data.get("nome")

    if is_main_antenna:
        if entity_type == "central":
            return f"{t('entity_names.central')} - {altura_str}"
        elif entity_type == "central_repeater_combined":
            if for_pdf:
                return f"{t('entity_names.central')} - {altura_str}"
            return f"{t('entity_names.central_repeater_combined')} - {altura_str}"
        elif entity_type == "tower":
            return f"{t('entity_names.tower')} - {altura_str}"
        return nome_original or t("ui.labels.main_antenna_default")
    else:
        if entity_type == "central":
            return f"{t('entity_names.central')} - {altura_str}"
        elif entity_type == "central_repeater_combined":
            if for_pdf:
                return f"{t('entity_names.central')} - {altura_str}"
            return f"{t('entity_names.central_repeater_combined')} - {altura_str}"
        elif entity_type == "tower":
            return t("kml.repeaters.solar_type_repeater", type_name=t("entity_names.tower"), height=altura_str)
        elif entity_type == "pole":
            return t("kml.repeaters.solar_type_repeater", type_name=t("entity_names.pole"), height=altura_str)
        elif entity_type == "water_tank":
            return t("kml.repeaters.solar_type_repeater", type_name=t("entity_names.water_tank"), height=altura_str)
        else:
            if entity_data.get("sobre_pivo"):
                return t("kml.repeaters.solar_pivot_repeater", height=altura_str)
            return t("kml.repeaters.solar_repeater", height=altura_str)


# ---------------------------------------------------------------------------
# KML helpers
# ---------------------------------------------------------------------------

def _create_html_description_table(
    entity_data: dict, template: Any, file_id_info: str, colour_key_filename: str, t: Callable
) -> str:
    """Builds the HTML description table for a KML point using translated column headers."""
    txw = float(getattr(template.transmitter, "txw", 0) or 0)
    txg_dbi = float(getattr(template.antenna, "txg", 0) or 0)

    erp_str, eirp_str = _safe_rf_metrics(txw, txg_dbi)

    lat, lon = entity_data.get("lat"), entity_data.get("lon")
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        lat_str, lon_str = f"{lat:.6f}", f"{lon:.6f}"
    else:
        lat_str, lon_str = "N/A", "N/A"

    file_id_safe = html.escape(str(file_id_info))

    rx_alt = getattr(template.receiver, "alt", "N/A")
    rx_gain = getattr(template.receiver, "rxg", "N/A")
    rx_sens = getattr(template.receiver, "rxs", None) or getattr(getattr(template, "receiver", None), "rxs", None)
    if rx_sens is None:
        # Compatibility fallback: some older templates stored rxs at template level.
        rx_sens = getattr(template, "rxs", "N/A")

    return f"""<div style="font-family: Arial, sans-serif; font-size: 12px;">
    <table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse; width: 350px;">
        <tr><td bgcolor="#f2f2f2" style="width: 120px;"><b>{t("kml.table.frequency")}</b></td><td>{getattr(template, "frq", "N/A")} MHz</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.rf_power")}</b></td><td>{txw} W</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.tx_gain")}</b></td><td>{txg_dbi} dBi</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.erp")}</b></td><td>{erp_str}</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.eirp")}</b></td><td>{eirp_str}</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.tx_lat_lon")}</b></td><td>{lat_str}, {lon_str}</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.tx_height")}</b></td><td>{entity_data.get("altura", "N/A")}m</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.tx_antenna")}</b></td><td>Pattern: DIPOLE.ANT<br>Azimuth: 0°<br>Tilt: 0°<br>Polarisation: v<br>Gain: {txg_dbi} dBi</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.rx_height")}</b></td><td>{rx_alt}m</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.rx_sensitivity")}</b></td><td>{rx_sens} dBm</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.rx_gain")}</b></td><td>{rx_gain} dBi</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.modulation")}</b></td><td>CW</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.bandwidth")}</b></td><td>{getattr(template.transmitter, "bwi", "N/A")} MHz</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.file_id")}</b></td><td>{file_id_safe}</td></tr>
        <tr><td bgcolor="#f2f2f2"><b>{t("kml.table.colour_key")}</b></td><td><img src="{colour_key_filename}" alt="Legend" style="max-width: 120px;"></td></tr>
        <tr><td colspan="2" style="text-align: center;"><img src="{LOGO_FILENAME}" alt="Logo" style="width: 200px;"></td></tr>
    </table></div>"""


def _create_kml_styles() -> Tuple[simplekml.Style, simplekml.Style]:
    torre_style = simplekml.Style(
        iconstyle=simplekml.IconStyle(icon=simplekml.Icon(href=TORRE_ICON_NAME), scale=1.2),
        labelstyle=simplekml.LabelStyle(scale=1.1),
    )
    default_point_style = simplekml.Style(
        iconstyle=simplekml.IconStyle(icon=simplekml.Icon(href=DEFAULT_ICON_URL))
    )
    return torre_style, default_point_style


def _setup_main_antenna_structure(
    doc, antena, style, details_name, template, file_id, legend_name, t: Callable
) -> simplekml.Folder:
    folder_name = _get_formatted_entity_name_for_backend(antena, is_main_antenna=True, t=t, for_pdf=False)
    folder = doc.newfolder(name=folder_name)
    folder.style.liststyle.itemicon.href = TORRE_ICON_NAME
    subfolder = folder.newfolder(name=details_name)
    pnt = subfolder.newpoint(name=folder_name, coords=[(antena["lon"], antena["lat"])])
    pnt.description = _create_html_description_table(antena, template, file_id, legend_name, t)
    pnt.style = style
    return subfolder


def _add_repeaters(
    doc, data, style, img_dir, overlay_name, desc_name, template, ts_prefix, overlay_props, t: Callable
) -> list:
    files = []
    for i, item in enumerate(data):
        img_name = item.get("imagem")
        if not img_name:
            continue
        path_img = img_dir / img_name
        path_json = path_img.with_suffix(".json")
        if not path_json.exists():
            continue

        try:
            with open(path_json, "r", encoding="utf-8") as f:
                bounds = json.load(f).get("bounds")
        except Exception as e:
            logger.warning("Failed to read repeater bounds (%s): %s", path_json, e)
            continue

        if not bounds:
            continue
        s, w, n, e = _normalize_bounds(bounds)

        altura_repetidora = item.get("altura", 5)

        # Use the effective height (including 5 m fallback) when building the name.
        item_for_name = dict(item)
        if item_for_name.get("altura") is None or item_for_name.get("altura") == "":
            item_for_name["altura"] = altura_repetidora

        nome_formatado = _get_formatted_entity_name_for_backend(
            entity_data=item_for_name,
            is_main_antenna=False,
            t=t,
            for_pdf=False,
        )

        sub_nome = f"{ts_prefix}_Rep{i + 1:02d}_Irricontrol_{template.id}"

        folder = doc.newfolder(name=nome_formatado)
        folder.style.liststyle.itemicon.href = TORRE_ICON_NAME
        sub = folder.newfolder(name=sub_nome)

        lat, lon = (s + n) / 2.0, (w + e) / 2.0

        pnt = sub.newpoint(name=nome_formatado, coords=[(lon, lat)])
        pnt.description = _create_html_description_table(
            {"lat": lat, "lon": lon, "altura": altura_repetidora},
            template,
            f"{ts_prefix}{i + 1}_{template.id}",
            desc_name,
            t,
        )
        pnt.style = style

        ground = sub.newgroundoverlay(name=t("kml.overlays.coverage_for", name=nome_formatado))
        ground.icon.href = img_name
        ground.latlonbox.north, ground.latlonbox.south, ground.latlonbox.east, ground.latlonbox.west = n, s, e, w
        files.append((path_img, img_name))

        screen_rep = sub.newscreenoverlay(name=t("kml.colour_key_name"))
        screen_rep.icon.href = overlay_name
        screen_rep.overlayxy = simplekml.OverlayXY(**overlay_props["overlay_xy"])
        screen_rep.screenxy = simplekml.ScreenXY(**overlay_props["screen_xy"])
        screen_rep.size = simplekml.Size(**overlay_props["size"])

    return files


def _add_secondary_folders(doc, pivos, ciclos, bombas, style, t: Callable):
    if pivos:
        f_pivos = doc.newfolder(name=t("kml.folders.pivots_markers"))
        for p_data in pivos:
            f_pivos.newpoint(name=p_data["nome"], coords=[(p_data["lon"], p_data["lat"])]).style = style

    f_areas = None
    nomes_pivos_manuais = set()

    pivos_com_area_manual = [p for p in pivos if p.get("tipo") in ["setorial", "pacman"]]
    if pivos_com_area_manual:
        logger.info("Exporting %d manually-drawn pivot areas.", len(pivos_com_area_manual))
        for pivo_data in pivos_com_area_manual:
            coords_area = []
            pivo_nome = pivo_data.get("nome", "Unnamed")
            pivo_tipo = pivo_data.get("tipo")

            try:
                if pivo_tipo == "setorial":
                    coords_area = _generate_sector_coords(
                        lat=pivo_data["lat"], lon=pivo_data["lon"], radius_m=pivo_data["raio"],
                        bearing_deg=pivo_data["angulo_central"], arc_width_deg=pivo_data["abertura_arco"],
                    )
                elif pivo_tipo == "pacman":
                    coords_area = _generate_pacman_coords(
                        lat=pivo_data["lat"], lon=pivo_data["lon"], radius_m=pivo_data["raio"],
                        start_angle_deg=pivo_data["angulo_inicio"], end_angle_deg=pivo_data["angulo_fim"],
                    )

                if coords_area:
                    if f_areas is None:
                        f_areas = doc.newfolder(name=t("kml.folders.pivot_areas"))
                    pol = f_areas.newpolygon(name=t("kml.areas.pivot_area", name=pivo_nome))
                    pol.outerboundaryis = coords_area
                    pol.style.polystyle.fill = 0
                    pol.style.linestyle.color = simplekml.Color.red
                    pol.style.linestyle.width = 4
                    nomes_pivos_manuais.add(pivo_nome)
            except KeyError as e:
                logger.warning("Missing data for pivot area '%s': %s. Skipping.", pivo_nome, e)

    if ciclos:
        logger.info("Exporting %d circular pivot areas.", len(ciclos))
        for ciclo_data in ciclos:
            nome_ciclo_original = ciclo_data.get("nome_original_circulo", "")
            nome_pivo_associado = nome_ciclo_original.replace(t("kml.prefixes.cycle"), "").strip()

            if nome_pivo_associado in nomes_pivos_manuais:
                logger.info(" -> Skipping circle for '%s' (already has sector/pacman).", nome_pivo_associado)
                continue

            coords = ciclo_data.get("coordenadas")
            if coords and len(coords) > 2:
                if f_areas is None:
                    f_areas = doc.newfolder(name=t("kml.folders.pivot_areas"))
                nome_area = nome_ciclo_original.replace(t("kml.prefixes.cycle"), t("kml.prefixes.area")).strip()
                pol = f_areas.newpolygon(name=nome_area)
                pol.outerboundaryis = [(lon, lat, 0) for lat, lon in coords]
                pol.style.polystyle.fill = 0
                pol.style.linestyle.color = simplekml.Color.red
                pol.style.linestyle.width = 4

    if bombas:
        f_bombas = doc.newfolder(name=t("kml.folders.pumps"))
        for i, b_data in enumerate(bombas):
            nome_padronizado = f'{t("entity_names.irripump")} {i + 1}'
            f_bombas.newpoint(name=nome_padronizado, coords=[(b_data["lon"], b_data["lat"])]).style = style


# ---------------------------------------------------------------------------
# Main KML builder
# ---------------------------------------------------------------------------

def build_kml_document_and_get_image_list(
    doc,
    lang: str,
    pivos_data,
    ciclos_data,
    bombas_data,
    repetidoras_selecionadas_data,
    generated_images_dir: Path,
    selected_template,
    antena_data: Optional[dict],
    imagem_principal_nome_relativo: Optional[str],
    bounds_principal_data: Optional[List[float] | Tuple[float, float, float, float]],
) -> List[Tuple[Path, str]]:
    """
    Builds the full KML document structure and returns the list of (source_path, zip_name)
    image pairs to be bundled into the KMZ archive.
    """
    logger.info("Building KML document structure (lang=%s).", lang)
    t = i18n_service.get_translator(lang)

    torre_style, default_point_style = _create_kml_styles()

    # Legend / colour-key files.
    key_desc_name = f"{selected_template.col}.key.png"
    key_overlay_name = f"{selected_template.col}.overlay.png"
    original_legend = settings.IMAGENS_DIR_PATH / key_desc_name
    overlay_legend = settings.IMAGENS_DIR_PATH / key_overlay_name
    if original_legend.exists() and not overlay_legend.exists():
        try:
            copyfile(original_legend, overlay_legend)
        except Exception as e:
            logger.warning("Could not create overlay legend: %s -> %s (%s)", original_legend, overlay_legend, e)

    files_for_kmz: List[Tuple[Path, str]] = []
    ts = datetime.now().strftime("%m%d%H%M%S")

    OVERLAY_PROPS = {
        "overlay_xy": {"x": 0, "y": 1, "xunits": simplekml.Units.fraction, "yunits": simplekml.Units.fraction},
        "screen_xy": {"x": 10, "y": 1, "xunits": simplekml.Units.pixels, "yunits": simplekml.Units.fraction},
        "size": {"x": -1, "y": -1, "xunits": simplekml.Units.pixels, "yunits": simplekml.Units.pixels},
    }

    # Main antenna folder.
    if antena_data and imagem_principal_nome_relativo and bounds_principal_data:
        logger.info(" -> Adding main antenna structure.")
        nome_antena = _get_formatted_entity_name_for_backend(
            entity_data=antena_data, is_main_antenna=True, t=t, for_pdf=False
        )
        sub_nome = f"{ts}_{re.sub(r'[^a-zA-Z0-9]', '_', nome_antena)}_{selected_template.id}"
        file_id = f"{ts[4:]}_{nome_antena.replace(' ', '')}_{selected_template.id}"

        folder = doc.newfolder(name=nome_antena)
        folder.style.liststyle.itemicon.href = TORRE_ICON_NAME
        sub = folder.newfolder(name=sub_nome)

        pnt = sub.newpoint(name=nome_antena, coords=[(antena_data["lon"], antena_data["lat"])])
        pnt.description = _create_html_description_table(antena_data, selected_template, file_id, key_desc_name, t)
        pnt.style = torre_style

        s, w, n, e = _normalize_bounds(bounds_principal_data)
        ground = sub.newgroundoverlay(name=t("kml.overlays.coverage_freq", freq=selected_template.frq))
        ground.icon.href = imagem_principal_nome_relativo
        ground.latlonbox.north, ground.latlonbox.south, ground.latlonbox.east, ground.latlonbox.west = n, s, e, w
        files_for_kmz.append((generated_images_dir / imagem_principal_nome_relativo, imagem_principal_nome_relativo))

        screen = folder.newscreenoverlay(name=t("kml.colour_key_name"))
        screen.icon.href = key_overlay_name
        screen.overlayxy = simplekml.OverlayXY(**OVERLAY_PROPS["overlay_xy"])
        screen.screenxy = simplekml.ScreenXY(**OVERLAY_PROPS["screen_xy"])
        screen.size = simplekml.Size(**OVERLAY_PROPS["size"])

    # Repeater folders.
    repeater_files = _add_repeaters(
        doc, repetidoras_selecionadas_data, torre_style, generated_images_dir,
        overlay_name=key_overlay_name, desc_name=key_desc_name,
        template=selected_template, ts_prefix=ts, overlay_props=OVERLAY_PROPS,
        t=t,
    )
    files_for_kmz.extend(repeater_files)

    # Pivots / cycles / pumps.
    _add_secondary_folders(doc, pivos_data, ciclos_data, bombas_data, default_point_style, t)

    # Common assets bundled into every KMZ.
    common_files = [
        (settings.IMAGENS_DIR_PATH / TORRE_ICON_NAME, TORRE_ICON_NAME),
        (settings.IMAGENS_DIR_PATH / key_desc_name, key_desc_name),
        (settings.IMAGENS_DIR_PATH / key_overlay_name, key_overlay_name),
        (settings.IMAGENS_DIR_PATH / LOGO_FILENAME, LOGO_FILENAME),
    ]
    for fpath, zip_name in common_files:
        if fpath.exists() and not any(item[1] == zip_name for item in files_for_kmz):
            files_for_kmz.append((fpath, zip_name))

    logger.info("KML document structure built successfully.")
    return files_for_kmz
