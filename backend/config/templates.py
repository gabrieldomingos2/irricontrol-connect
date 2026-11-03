# backend/config/templates.py
# Template identifiers, i18n entity keywords, and default simulation templates.

from enum import Enum
from typing import Any


class TemplateID(str, Enum):
    """Unique identifiers for each simulation template."""

    # Teste interno (bloqueado; liberar com Shift+A)
    BRAZIL_V6_100DBM = "Brazil_V6_100dBm"
    # Perfis oficiais de estudo de sinal (email 03/11/2026)
    XBEE_PRO_900HP_90DBM = "XBEE_PRO_900HP_90dBm"
    XBEE_PRO_900HP_95DBM = "XBEE_PRO_900HP_95dBm"
    XBEE_SX_868_95DBM = "XBEE_SX_868_95dBm"
    XBEE_SX_868_100DBM = "XBEE_SX_868_100dBm"
    XBEE_XR_868_96DBM = "XBEE_XR_868_96dBm"
    XBEE_XR_868_101DBM = "XBEE_XR_868_101dBm"


# ---------------------------------------------------------------------------
# I18n keyword map — used by the KMZ parser to classify entities by name.
# Keys are entity type constants; values map language codes to keyword lists.
# ---------------------------------------------------------------------------
I18N_KEYWORDS: dict[str, dict[str, list[str]]] = {
    "ANTENA": {
        "pt": ["antena", "torre", "central", "base", "repetidora", "barracão", "galpão", "sede", "silo", "caixa", "caixa d'água", "poste"],
        "en": ["antenna", "tower", "base", "station", "repeater", "radio", "site", "shed", "warehouse", "silo", "water tank", "pole", "post"],
        "es": ["antena", "torre", "base", "estación", "repetidora", "radio", "cobertizo", "galpón", "almacén", "silo", "tanque de agua", "depósito de agua", "poste"],
        "de": ["antenne", "turm", "basisstation", "repeater", "funkmast", "schuppen", "lagerhalle", "silo", "wassertank", "mast", "pfosten"],
        "ru": ["антенна", "башня", "станция", "репитер", "радиостанция", "сарай", "ангар", "склад", "силос", "водяной бак", "водонапорная башня", "столб", "мачта"],
    },
    "PIVO": {
        "pt": ["pivô", "pivo"],
        "en": ["pivot", "sprinkler"],
        "es": ["pivote", "aspersor"],
        "de": ["pivot", "drehpunkt", "beregnung"],
        "ru": ["пивот", "ороситель", "спринклер"],
    },
    "BOMBA": {
        "pt": ["bomba", "irripump", "pump", "captação", "poço"],
        "en": ["pump", "pumping station", "irripump", "water intake", "well"],
        "es": ["bomba", "estación de bombeo", "irripump", "captación", "toma de agua", "pozo"],
        "de": ["pumpe", "pumpstation", "irripump", "wasserentnahme", "brunnen"],
        "ru": ["насос", "насосная станция", "irripump", "водозабор", "колодец", "скважина"],
    },
}


# ---------------------------------------------------------------------------
# Default templates
# ---------------------------------------------------------------------------
def default_templates() -> list[dict[str, Any]]:
    """Returns the list of default simulation templates as raw dicts."""
    return [
        # TESTE INTERNO — bloqueado no select (TEMPLATES_DESABILITADOS), liberar com Shift+A
        {
            "id": "Brazil_V6_100dBm",
            "nome": "Brazil V6 100dBm",
            "frq": 915,
            "col": "HP900_100.dBm",
            "site": "Brazil_V6_100dBm",
            "rxs": -100,
            "transmitter": {"txw": 0.3, "bwi": 0.1},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 3, "rxs": -100},
            "antenna": {"txg": 3, "fbr": 3},
        },
        # -------------------------------------------------------------------
        # Perfis oficiais (email 03/11/2026). NAO alterar os limiares (rxs).
        # Escalas de cor (col): uma por perfil, terminando no limiar (rxs).
        # Principal = 11 dB de margem sobre a sensibilidade do datasheet.
        # Alternativo = 6 dB; so quando o principal exigir repetidoras demais.
        # -------------------------------------------------------------------
        # XBee-PRO 900HP — sensibilidade -101 dBm
        {
            "id": "XBEE_PRO_900HP_90dBm",
            "nome": "XBEE PRO 900HP -90dBm",
            "frq": 915,
            "col": "HP900_90.dBm",
            "site": "XBEE_PRO_900HP_90dBm",
            "rxs": -90,
            "transmitter": {"txw": 0.25, "bwi": 0.1},   # 24 dBm = max do 900HP
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 3, "rxs": -90},
            "antenna": {"txg": 3, "fbr": 3},
        },
        {
            "id": "XBEE_PRO_900HP_95dBm",
            "nome": "XBEE PRO 900HP -95dBm",
            "frq": 915,
            "col": "HP900_95.dBm",
            "site": "XBEE_PRO_900HP_95dBm",
            "rxs": -95,
            "transmitter": {"txw": 0.25, "bwi": 0.1},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 3, "rxs": -95},
            "antenna": {"txg": 3, "fbr": 3},
        },
        # XBee SX 868 — sensibilidade -106 dBm
        {
            "id": "XBEE_SX_868_95dBm",
            "nome": "XBEE SX 868 -95dBm",
            "frq": 868,
            "col": "SX868_95.dBm",
            "site": "XBEE_SX_868_95dBm",
            "rxs": -95,
            "transmitter": {"txw": 0.02, "bwi": 0.05},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 2.1, "rxs": -95},
            "antenna": {"txg": 2.1, "fbr": 2.1},
        },
        {
            "id": "XBEE_SX_868_100dBm",
            "nome": "XBEE SX 868 -100dBm",
            "frq": 868,
            "col": "SX868_100.dBm",
            "site": "XBEE_SX_868_100dBm",
            "rxs": -100,
            "transmitter": {"txw": 0.02, "bwi": 0.05},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 2.1, "rxs": -100},
            "antenna": {"txg": 2.1, "fbr": 2.1},
        },
        # XBee XR 868 — sensibilidade -107 dBm
        {
            "id": "XBEE_XR_868_96dBm",
            "nome": "XBEE XR 868 -96dBm",
            "frq": 868,
            "col": "XR868_96.dBm",
            "site": "XBEE_XR_868_96dBm",
            "rxs": -96,
            "transmitter": {"txw": 0.02, "bwi": 0.05},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 2.1, "rxs": -96},
            "antenna": {"txg": 2.1, "fbr": 2.1},
        },
        {
            "id": "XBEE_XR_868_101dBm",
            "nome": "XBEE XR 868 -101dBm",
            "frq": 868,
            "col": "XR868_101.dBm",
            "site": "XBEE_XR_868_101dBm",
            "rxs": -101,
            "transmitter": {"txw": 0.02, "bwi": 0.05},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 2.1, "rxs": -101},
            "antenna": {"txg": 2.1, "fbr": 2.1},
        },
    ]