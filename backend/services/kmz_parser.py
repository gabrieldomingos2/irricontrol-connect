# backend/services/kmz_parser.py

from __future__ import annotations

import logging
import math
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from statistics import mean
from typing import List, Tuple, Dict, Optional, TypedDict, Union

from shapely.geometry import Polygon, Point
from shapely.ops import unary_union

from backend.config import settings
from backend.exceptions import FileParseError
from backend.services.i18n_service import i18n_service

logger = logging.getLogger("irricontrol")

KML_NAMESPACE = {"kml": "http://www.opengis.net/kml/2.2"}

# ---------------------------------------------------------------------------
# Keywords e constantes
# ---------------------------------------------------------------------------
PONTA_RETA_KEYWORDS: List[str] = ["ponta 1 reta", "ponta 2 reta"]
DEFAULT_RECEIVER_HEIGHT: int = 3
CIRCLE_CLOSENESS_THRESHOLD: float = 0.0005
# Circles/sectors need many vertices to approximate a curve; rectangles have 4-8.
CIRCLE_MIN_VERTICES: int = 15
# Direction change (degrees) between consecutive edges to count as a sharp corner.
CORNER_ANGLE_THRESHOLD: float = 30.0
# Max allowed sharp corners: circle=0, sector=1-3, rectangle=4, polygon=many.
CIRCLE_MAX_SHARP_CORNERS: int = 3
HEIGHT_REGEX = re.compile(r"[\s-]*(\d+)\s*(m|metros)\s*$", re.IGNORECASE)


# ---------------------------------------------------------------------------
# TypedDicts para tipagem
# ---------------------------------------------------------------------------
class CoordsDict(TypedDict):
    lat: float
    lon: float


class AntenaData(CoordsDict):
    altura: Optional[int]
    had_height_in_kmz: bool
    altura_receiver: int
    nome: str


class PivoData(CoordsDict):
    nome: str
    type: str
    tipo: Optional[str]
    coordenadas: Optional[List[List[float]]]


class CicloData(TypedDict):
    nome_original_circulo: str
    coordenadas: List[List[float]]


class BombaData(CoordsDict):
    nome: str
    type: str


# ---------------------------------------------------------------------------
# Funções auxiliares
# ---------------------------------------------------------------------------
def normalizar_nome(nome: str) -> str:
    """Normaliza string para comparação com keywords (lower, sem especiais, espaços únicos)."""
    if not nome:
        return ""
    nome_lower = nome.lower()
    nome_sem_especiais = re.sub(r"[^a-z0-9\sÀ-ÖØ-öø-ÿ]", "", nome_lower)
    return re.sub(r"\s+", " ", nome_sem_especiais).strip()


def calcular_meio_reta(p1: CoordsDict, p2: CoordsDict) -> Tuple[float, float]:
    return (p1["lat"] + p2["lat"]) / 2, (p1["lon"] + p2["lon"]) / 2


def ponto_central_da_reta_maior(
    coords_list: List[List[float]],
) -> Tuple[float, float, List[float], List[float]]:
    """
    Recebe coords em formato [lat, lon] e encontra o par mais distante (reta maior).
    Retorna o ponto médio e as duas pontas.
    """
    if not coords_list or len(coords_list) < 2:
        raise FileParseError("Dados de geometria inválidos: são necessários pelo menos dois pontos para calcular a reta maior.")
    max_dist_sq = 0.0
    ponta1_final, ponta2_final = coords_list[0], coords_list[1]
    for i in range(len(coords_list)):
        for j in range(i + 1, len(coords_list)):
            p1, p2 = coords_list[i], coords_list[j]
            dist_sq = (p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2
            if dist_sq > max_dist_sq:
                max_dist_sq, ponta1_final, ponta2_final = dist_sq, p1, p2
    return (
        (ponta1_final[0] + ponta2_final[0]) / 2,
        (ponta1_final[1] + ponta2_final[1]) / 2,
        ponta1_final,
        ponta2_final,
    )


def eh_um_circulo(coords_list: List[List[float]], threshold: float = CIRCLE_CLOSENESS_THRESHOLD) -> bool:
    """
    Considers a shape a circle when the first and last points are very close (closed).
    """
    if len(coords_list) < 3:
        return False
    p0 = Point(coords_list[0][1], coords_list[0][0])
    pn = Point(coords_list[-1][1], coords_list[-1][0])
    return p0.distance(pn) < threshold


def _eh_forma_circular(coords_list: List[List[float]]) -> bool:
    """
    Returns True if the shape is likely a circle or pivot sector.

    Three checks applied in order of cost (cheapest first):
    1. Minimum vertex count — circles/sectors use 15-128 pts to approximate a
        curve; rectangles and simple land boundaries have 4-10.
    2. Sharp-corner count — measures how many times the boundary direction
        changes by more than CORNER_ANGLE_THRESHOLD degrees.
        circle=0, sector=1-3, rectangle=4, irregular polygon=many.
        Rejects anything with more than CIRCLE_MAX_SHARP_CORNERS corners.
        This is the key filter for rectangles/squares, which pass the
        circularity test because a square has isoperimetric quotient ~0.785.
    3. Isoperimetric quotient (4pi * area / perimeter^2) >= 0.45 — catches
        elongated or very irregular shapes that slipped through.
        Reference: full circle ~1.0, 270-deg sector ~0.66, 30-deg sector ~0.52.
    """
    if len(coords_list) < CIRCLE_MIN_VERTICES:
        return False

    # -- Check 2: sharp-corner count (cheap, no shapely) ---------------------
    sharp_corners = 0
    n = len(coords_list)
    for i in range(1, n - 1):
        p0, p1, p2 = coords_list[i - 1], coords_list[i], coords_list[i + 1]
        v1 = (p1[0] - p0[0], p1[1] - p0[1])
        v2 = (p2[0] - p1[0], p2[1] - p1[1])
        mag1 = math.hypot(v1[0], v1[1])
        mag2 = math.hypot(v2[0], v2[1])
        if mag1 < 1e-10 or mag2 < 1e-10:
            continue
        cos_a = (v1[0] * v2[0] + v1[1] * v2[1]) / (mag1 * mag2)
        angle_change = math.degrees(math.acos(max(-1.0, min(1.0, cos_a))))
        if angle_change > CORNER_ANGLE_THRESHOLD:
            sharp_corners += 1
            if sharp_corners > CIRCLE_MAX_SHARP_CORNERS:
                return False

    # -- Check 3: isoperimetric quotient (shapely) ----------------------------
    try:
        poly = Polygon([(lon, lat) for lat, lon in coords_list])
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.area == 0 or poly.length == 0:
            return False
        circularity = (4 * math.pi * poly.area) / (poly.length ** 2)
        return circularity >= 0.45
    except Exception:
        return False


def gerar_nome_pivo_sequencial_unico(
    lista_de_nomes_existentes_normalizados: set[str], nome_base: str
) -> str:
    """Gera nome sequencial não colidente a partir de um base."""
    contador = 1
    while True:
        nome_candidato = f"{nome_base} {contador}"
        if normalizar_nome(nome_candidato) not in lista_de_nomes_existentes_normalizados:
            return nome_candidato
        contador += 1


def _consolidate_pivos(
    pivos_de_pontos: List[PivoData],
    ciclos_parsed: List[CicloData],
    pontas_retas_map: Dict[str, CoordsDict],
    nome_base_pivo: str,
) -> List[PivoData]:
    """
    Associa pivôs (pontos) a ciclos (polígonos) e cria pivôs para ciclos órfãos.
    """
    final_pivos_list: List[PivoData] = []
    ciclos_ja_associados = set()

    for pivo in pivos_de_pontos:
        pivo_geom = Point(pivo["lon"], pivo["lat"])
        ciclo_associado = None
        indice_ciclo_associado = -1

        for i, ciclo in enumerate(ciclos_parsed):
            if i in ciclos_ja_associados:
                continue
            try:
                poligono_ciclo = Polygon([(lon, lat) for lat, lon in ciclo["coordenadas"]])
                if not poligono_ciclo.is_valid:
                    continue
            except Exception:
                continue

            # Uses covers() to include points on the polygon boundary (avoids duplicate pivot).
            if poligono_ciclo.covers(pivo_geom):
                ciclo_associado = ciclo
                indice_ciclo_associado = i
                break

        pivo_final = pivo.copy()
        if ciclo_associado:
            pivo_final["tipo"] = "custom"
            pivo_final["coordenadas"] = ciclo_associado["coordenadas"]
            ciclos_ja_associados.add(indice_ciclo_associado)
            ciclo_associado["nome_original_circulo"] = f"Ciclo {pivo['nome']}"
            logger.info("  -> Pivot '%s' associated with an existing circle polygon.", pivo["nome"])
        final_pivos_list.append(pivo_final)

    nomes_pivos_existentes_normalizados = {normalizar_nome(p["nome"]) for p in final_pivos_list}
    for i, ciclo_info in enumerate(ciclos_parsed):
        if i in ciclos_ja_associados:
            continue

        coordenadas_ciclo = ciclo_info["coordenadas"]
        centro_lat: Optional[float] = None
        centro_lon: Optional[float] = None

        nome_ciclo_norm = normalizar_nome(ciclo_info["nome_original_circulo"])
        ponta1 = pontas_retas_map.get(f"ponta 1 reta {nome_ciclo_norm}")
        ponta2 = pontas_retas_map.get(f"ponta 2 reta {nome_ciclo_norm}")
        if not (ponta1 and ponta2):
            ponta1 = pontas_retas_map.get("ponta 1 reta")
            ponta2 = pontas_retas_map.get("ponta 2 reta")

        if ponta1 and ponta2:
            centro_lat, centro_lon = calcular_meio_reta(ponta1, ponta2)
        elif len(coordenadas_ciclo) >= 2:
            try:
                centro_lat, centro_lon, _, _ = ponto_central_da_reta_maior(coordenadas_ciclo)
            except (FileParseError, Exception):  # Captura o erro específico e outros genéricos
                if coordenadas_ciclo:
                    centro_lat = mean([c[0] for c in coordenadas_ciclo])
                    centro_lon = mean([c[1] for c in coordenadas_ciclo])

        if centro_lat is not None and centro_lon is not None:
            nome_pivo_gerado = gerar_nome_pivo_sequencial_unico(
                nomes_pivos_existentes_normalizados, nome_base=nome_base_pivo
            )
            pivo_dict: PivoData = {
                "nome": nome_pivo_gerado, "lat": centro_lat, "lon": centro_lon,
                "type": "pivo", "tipo": "custom", "coordenadas": coordenadas_ciclo,
            }
            final_pivos_list.append(pivo_dict)
            nomes_pivos_existentes_normalizados.add(normalizar_nome(nome_pivo_gerado))
            ciclo_info["nome_original_circulo"] = f"Ciclo {nome_pivo_gerado}"
            logger.info("  -> 🛰️ Pivô de ciclo órfão adicionado como '%s'.", nome_pivo_gerado)

    return final_pivos_list


def _estimate_arc_center(coords_list: List[List[float]]) -> Optional[Tuple[float, float]]:
    """
    Estimates the pivot center (tower location) of a circle or sector polygon.

    Strategy: exclude sharp-corner points (straight edges of sectors), then
    compute the circumcenter of three evenly-spaced arc points.  The
    circumcenter is the exact center of the circle the arc belongs to, making
    this invariant to radius — concentric circles and sectors of any size all
    converge to the same pivot center.

    Falls back to the polygon centroid if the arc has fewer than 3 usable
    points or the three sampled points are nearly collinear.
    """
    n = len(coords_list)
    if n < 3:
        return None

    # Identify corner regions to exclude (straight edges of sectors).
    corner_indices: set[int] = set()
    for i in range(1, n - 1):
        p0, p1, p2 = coords_list[i - 1], coords_list[i], coords_list[i + 1]
        v1 = (p1[0] - p0[0], p1[1] - p0[1])
        v2 = (p2[0] - p1[0], p2[1] - p1[1])
        mag1 = math.hypot(v1[0], v1[1])
        mag2 = math.hypot(v2[0], v2[1])
        if mag1 < 1e-10 or mag2 < 1e-10:
            continue
        cos_a = (v1[0] * v2[0] + v1[1] * v2[1]) / (mag1 * mag2)
        if math.degrees(math.acos(max(-1.0, min(1.0, cos_a)))) > CORNER_ANGLE_THRESHOLD:
            for k in range(max(0, i - 2), min(n, i + 3)):
                corner_indices.add(k)

    arc_indices = [i for i in range(n) if i not in corner_indices]

    def _circumcenter(
        pa: List[float], pb: List[float], pc: List[float]
    ) -> Optional[Tuple[float, float]]:
        """Returns circumcenter (lat, lon) of three points, or None if collinear."""
        ax, ay = pa[1], pa[0]
        bx, by = pb[1], pb[0]
        cx, cy = pc[1], pc[0]
        d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        if abs(d) < 1e-14:
            return None
        a2 = ax * ax + ay * ay
        b2 = bx * bx + by * by
        c2 = cx * cx + cy * cy
        ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
        uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
        return (uy, ux)  # (lat, lon)

    if len(arc_indices) >= 3:
        step = len(arc_indices) // 3
        pa = coords_list[arc_indices[0]]
        pb = coords_list[arc_indices[step]]
        pc = coords_list[arc_indices[2 * step]]
        center = _circumcenter(pa, pb, pc)
        if center is not None:
            return center

    # Fallback: polygon centroid.
    try:
        poly = Polygon([(lon, lat) for lat, lon in coords_list])
        c = poly.centroid
        return (c.y, c.x)
    except Exception:
        return None


def _deduplicate_concentric_shapes(
    ciclos: List[CicloData],
    center_threshold_deg: float = 0.001,
) -> List[CicloData]:
    """
    Groups circles/sectors by pivot-center proximity and keeps only the largest.

    Uses _estimate_arc_center() to find the actual pivot tower location instead
    of the polygon centroid.  This makes deduplication radius-invariant: a full
    circle, a D-shape, and a pacman of any size all resolve to the same pivot
    center if they share the same tower, so concentric shapes are correctly
    grouped regardless of how different their radii are.

    Args:
        ciclos: List of parsed circle/sector polygons.
        center_threshold_deg: Max pivot-center distance (degrees) to group two
            shapes as concentric.  0.001 deg ~ 110 m — comfortably below the
            minimum spacing between adjacent pivots (~600 m+), and large enough
            to absorb circumcenter numerical noise.

    Returns:
        Deduplicated list with only the largest shape per concentric group.
    """
    if not ciclos:
        return ciclos

    entries: List[Tuple] = []
    for ciclo in ciclos:
        center = _estimate_arc_center(ciclo["coordenadas"])
        try:
            poly = Polygon([(lon, lat) for lat, lon in ciclo["coordenadas"]])
            if not poly.is_valid:
                poly = poly.buffer(0)
            area = poly.area
        except Exception:
            area = 0.0
        entries.append((ciclo, center, area))

    used: set[int] = set()
    result: List[CicloData] = []

    for i, (ciclo_i, center_i, _) in enumerate(entries):
        if i in used:
            continue
        if center_i is None:
            result.append(ciclo_i)
            used.add(i)
            continue

        ci_pt = Point(center_i[1], center_i[0])
        group = [(i, entries[i][2], ciclo_i)]
        for j in range(i + 1, len(entries)):
            if j in used:
                continue
            _, center_j, area_j = entries[j]
            if center_j is None:
                continue
            if ci_pt.distance(Point(center_j[1], center_j[0])) < center_threshold_deg:
                group.append((j, area_j, entries[j][0]))

        _, _, best_ciclo = max(group, key=lambda x: x[1])
        result.append(best_ciclo)
        for idx, _, _ in group:
            used.add(idx)

    removed = len(ciclos) - len(result)
    if removed > 0:
        logger.info(
            "  -> Deduplicated %d concentric shape(s) — kept only the largest per group.",
            removed,
        )

    return result


def _reconstruct_wedge_pivots(
    fragments_coords: List[List[List[float]]],
    min_group_size: int = 2,
) -> List[CicloData]:
    """
    Merges adjacent unnamed polygon fragments into full pivot circles.

    Some third-party CAD tools (e.g. Metrica TOPO CAD) export a pivot as
    several unnamed wedge-shaped slices instead of one point + one circle.
    Each slice fails the standalone circularity check on its own, so this
    groups touching/overlapping fragments (union-find) and unions each group
    into a single shape that behaves like a normal orphan circle downstream.

    Groups with fewer than `min_group_size` fragments are ignored — a lone
    stray polygon is more likely a farm boundary than a pivot slice.
    """
    polys: List[Optional[Polygon]] = []
    for coords in fragments_coords:
        try:
            poly = Polygon([(lon, lat) for lat, lon in coords])
            if not poly.is_valid:
                poly = poly.buffer(0)
            polys.append(poly if not poly.is_empty else None)
        except Exception:
            polys.append(None)

    n = len(polys)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i in range(n):
        if polys[i] is None:
            continue
        for j in range(i + 1, n):
            if polys[j] is None:
                continue
            try:
                if polys[i].intersects(polys[j]):
                    union(i, j)
            except Exception:
                continue

    groups: Dict[int, List[int]] = {}
    for i in range(n):
        if polys[i] is None:
            continue
        groups.setdefault(find(i), []).append(i)

    reconstructed: List[CicloData] = []
    for group_idx, indices in enumerate(groups.values()):
        if len(indices) < min_group_size:
            continue
        try:
            merged = unary_union([polys[i] for i in indices])
        except Exception:
            continue
        if merged.is_empty:
            continue
        if merged.geom_type == "MultiPolygon":
            merged = max(merged.geoms, key=lambda g: g.area)
        if merged.geom_type != "Polygon":
            continue

        merged_coords = [[lat, lon] for lon, lat in merged.exterior.coords]
        reconstructed.append({
            "nome_original_circulo": f"Pivo reconstruido {group_idx + 1}",
            "coordenadas": merged_coords,
        })

    return reconstructed


def _extract_kml_from_zip(caminho_kmz: Path, pasta_extracao: Path) -> Path:
    """
    Extrai o primeiro .kml encontrado dentro do .kmz.
    """
    try:
        pasta_extracao.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(caminho_kmz, "r") as kmz_file:
            kml_file_name = next((f for f in kmz_file.namelist() if f.lower().endswith(".kml")), None)
            if not kml_file_name:
                raise FileParseError("Nenhum arquivo .kml encontrado dentro do KMZ.")
            kmz_file.extract(kml_file_name, path=pasta_extracao)
            caminho_kml_extraido = pasta_extracao / kml_file_name
            logger.info("  -> Arquivo KML '%s' extraído para '%s'", kml_file_name, caminho_kml_extraido)
            return caminho_kml_extraido
    except zipfile.BadZipFile:
        raise FileParseError(f"Arquivo KMZ '{caminho_kmz.name}' inválido ou corrompido.")


def _parse_placemark_data(placemark_node: ET.Element) -> Optional[Dict[str, Union[str, List[List[float]]]]]:
    """
    Extrai nome, tipo de geometria e coordenadas de um Placemark.
    """
    nome_tag = placemark_node.find("kml:name", KML_NAMESPACE)
    nome_original = nome_tag.text.strip() if nome_tag is not None and nome_tag.text else ""
    data: Dict[str, Union[str, List[List[float]]]] = {"nome_original": nome_original}
    geometry_type: Optional[str] = None
    coords_text: Optional[str] = None

    point = placemark_node.find(".//kml:Point/kml:coordinates", KML_NAMESPACE)
    linestring = placemark_node.find(".//kml:LineString/kml:coordinates", KML_NAMESPACE)
    polygon = placemark_node.find(".//kml:Polygon/kml:outerBoundaryIs/kml:LinearRing/kml:coordinates", KML_NAMESPACE)

    if point is not None and point.text:
        coords_text, geometry_type = point.text.strip(), "Point"
    elif linestring is not None and linestring.text:
        coords_text, geometry_type = linestring.text.strip(), "LineString"
    elif polygon is not None and polygon.text:
        coords_text, geometry_type = polygon.text.strip(), "Polygon"

    if not coords_text or not geometry_type:
        return None
    data["geometry_type"] = geometry_type

    try:
        parsed_coords: List[List[float]] = []
        for token in coords_text.split():
            parts = token.split(",")
            if len(parts) >= 2:
                lon = float(parts[0])
                lat = float(parts[1])
                parsed_coords.append([lat, lon])
        if not parsed_coords:
            return None
        data["coordenadas_lista"] = parsed_coords
        return data
    except (ValueError, IndexError):
        logger.warning(
            "Não foi possível parsear coordenadas para o placemark '%s'. Texto: '%s'",
            nome_original,
            coords_text,
        )
        return None


def parse_gis_file(
    caminho_gis_str: str, pasta_extracao_str: str, lang: str = "pt-br"
) -> Tuple[List[AntenaData], List[PivoData], List[CicloData], List[BombaData]]:
    """
    Lê um KML/KMZ, identifica entidades e retorna listas de dados.

    COMPORTAMENTO:
    - Continua funcionando igual para KMZ simples (fazenda manda pivôs desenhados).
    """
    t = i18n_service.get_translator(lang)
    caminho_gis = Path(caminho_gis_str)
    pasta_extracao = Path(pasta_extracao_str)
    pasta_extracao.mkdir(parents=True, exist_ok=True)

    antenas_list: List[AntenaData] = []
    pivos_de_pontos_list: List[PivoData] = []
    ciclos_list: List[CicloData] = []
    bombas_list: List[BombaData] = []
    pontas_retas_map: Dict[str, CoordsDict] = {}
    polygon_fragments_list: List[List[List[float]]] = []

    caminho_kml_a_ser_lido: Optional[Path] = None
    kml_extraido_path_temp: Optional[Path] = None

    antena_kws = settings.ENTITY_KEYWORDS["ANTENA"]
    pivo_kws = settings.ENTITY_KEYWORDS["PIVO"]
    bomba_kws = settings.ENTITY_KEYWORDS["BOMBA"]

    logger.info("Usando keywords para Antenas: %s", antena_kws)
    logger.info("Usando keywords para Pivôs: %s", pivo_kws)
    logger.info("Usando keywords para Bombas: %s", bomba_kws)

    try:
        if caminho_gis.suffix.lower() == ".kmz":
            logger.info("Processando arquivo KMZ: %s", caminho_gis.name)
            kml_extraido_path_temp = _extract_kml_from_zip(caminho_gis, pasta_extracao)
            caminho_kml_a_ser_lido = kml_extraido_path_temp
        elif caminho_gis.suffix.lower() == ".kml":
            logger.info("Processando arquivo KML direto: %s", caminho_gis.name)
            caminho_kml_a_ser_lido = caminho_gis
        else:
            raise FileParseError("Formato de arquivo não suportado. Envie um arquivo .kml ou .kmz.")

        try:
            tree = ET.parse(str(caminho_kml_a_ser_lido))
        except ET.ParseError as e:
            raise FileParseError(f"Arquivo KML mal formatado ou corrompido: {e}")

        root = tree.getroot()

        pivot_num_regex = re.compile(r"(?:piv(?:o|ô|ot)?)\s*(\d+)", re.IGNORECASE)
        bomba_name_regex = re.compile(r"^(casa\s+de\s+bomba|pump\s+house|bomba\s*\d*)$", re.IGNORECASE)

        for placemark_node in root.findall(".//kml:Placemark", KML_NAMESPACE):
            parsed_data = _parse_placemark_data(placemark_node)
            if not parsed_data:
                continue

            nome_original = str(parsed_data["nome_original"])
            coords = parsed_data["coordenadas_lista"]
            geo_type = str(parsed_data["geometry_type"])

            match = HEIGHT_REGEX.search(nome_original)
            if match:
                altura = int(match.group(1))
                had_height = True
                nome_limpo_para_keywords = nome_original[: match.start()].strip()
            else:
                altura = None
                had_height = False
                nome_limpo_para_keywords = nome_original

            nome_norm = normalizar_nome(nome_limpo_para_keywords)

            if geo_type == "Point" and coords:
                lat, lon = coords[0][0], coords[0][1]
                if any(kw in nome_norm for kw in antena_kws):
                    antenas_list.append({
                        "lat": lat, "lon": lon, "altura": altura,
                        "had_height_in_kmz": had_height, "altura_receiver": DEFAULT_RECEIVER_HEIGHT,
                        "nome": nome_original,
                    })
                elif any(kw in nome_norm for kw in pivo_kws) or pivot_num_regex.search(nome_original):
                    final_pivo_name = nome_original
                    match_pivot_num = pivot_num_regex.search(nome_original)
                    if match_pivot_num:
                        pivo_num = match_pivot_num.group(1)
                        final_pivo_name = f"{t('entity_names.pivot')} {pivo_num}"
                    pivos_de_pontos_list.append({
                        "nome": final_pivo_name, "lat": lat, "lon": lon,
                        "type": "pivo", "tipo": None, "coordenadas": None,
                    })
                elif any(kw in nome_norm for kw in bomba_kws) or bomba_name_regex.search(nome_original):
                    final_bomba_name = t("entity_names.irripump")
                    bombas_list.append({"nome": final_bomba_name, "lat": lat, "lon": lon, "type": "bomba"})
                elif any(kw in nome_norm for kw in PONTA_RETA_KEYWORDS):
                    pontas_retas_map[nome_norm] = {"lat": lat, "lon": lon}

            elif geo_type in ["LineString", "Polygon"] and len(coords) >= 3:
                is_circular = _eh_forma_circular(coords)
                if not is_circular:
                    if geo_type == "Polygon":
                        # Not circular alone — may be one slice of a pivot that
                        # third-party CAD tools export as several adjacent wedges.
                        polygon_fragments_list.append(coords)
                    logger.debug(
                        "  -> Skipping shape '%s' (%d vertices) — failed circularity check.",
                        nome_original,
                        len(coords),
                    )
                elif geo_type == "LineString":
                    # LineString must also close on itself to be a circle/arc
                    if eh_um_circulo(coords):
                        ciclos_list.append({"nome_original_circulo": nome_original, "coordenadas": coords})
                else:  # Polygon
                    ciclos_list.append({"nome_original_circulo": nome_original, "coordenadas": coords})

        if polygon_fragments_list:
            reconstructed_ciclos = _reconstruct_wedge_pivots(polygon_fragments_list)
            if reconstructed_ciclos:
                logger.info(
                    "  -> Reconstructed %d pivot(s) from %d unnamed polygon fragment(s) "
                    "(e.g. sector exports from third-party CAD tools).",
                    len(reconstructed_ciclos),
                    len(polygon_fragments_list),
                )
                ciclos_list.extend(reconstructed_ciclos)

        # ------------------------------
        # Fluxo normal (KMZ simples)
        # ------------------------------
        ciclos_list = _deduplicate_concentric_shapes(ciclos_list)

        nome_base_pivo_traduzido = t("entity_names.pivot")
        pivos_finais_list = _consolidate_pivos(
            pivos_de_pontos_list, ciclos_list, pontas_retas_map, nome_base_pivo_traduzido
        )

        logger.info(
            "File processing complete (simple parser): %d antennas, %d pivots, %d cycles, %d pumps.",
            len(antenas_list), len(pivos_finais_list), len(ciclos_list), len(bombas_list),
        )
        return antenas_list, pivos_finais_list, ciclos_list, bombas_list

    finally:
        if kml_extraido_path_temp and kml_extraido_path_temp.exists():
            kml_extraido_path_temp.unlink(missing_ok=True)
