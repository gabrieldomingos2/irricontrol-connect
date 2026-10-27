# backend/config/templates.py
# Template identifiers, i18n entity keywords, and default simulation templates.

from enum import Enum
from typing import Any


class TemplateID(str, Enum):
    """Unique identifiers for each simulation template."""

    BRAZIL_V6_100DBM = "Brazil_V6_100dBm"
    EUROPE_V6_XR = "Europe_V6_XR"
    BRAZIL_V6_90DBM = "Brazil_V6_90dBm"
    BRAZIL_V7_XBEE900HP_90DBM = "Brazil_V7_XBee900HP_90dBm"
    BRAZIL_V7_XBEE900HP_95DBM = "Brazil_V7_XBee900HP_95dBm"


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
        {
            "id": "Brazil_V6_100dBm",
            "nome": "Brazil V6 100dBm",
            "frq": 915,
            "col": "IRRICONTRO.dBm",
            "site": "Brazil_V6_100dBm",
            "rxs": -100,
            "transmitter": {"txw": 0.3, "bwi": 0.1},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 3, "rxs": -100},
            "antenna": {"txg": 3, "fbr": 3},
        },
        {
            "id": "Europe_V6_XR",
            "nome": "Europe V6 XR",
            "frq": 868,
            "col": "IRRIEUROPE.dBm",
            "site": "Europe_V6_XR",
            "rxs": -105,
            "transmitter": {"txw": 0.02, "bwi": 0.05},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 2.1, "rxs": -105},
            "antenna": {"txg": 2.1, "fbr": 2.1},
        },
        {
            "id": "Brazil_V6_90dBm",
            "nome": "Brazil V6 90dBm",
            "frq": 915,
            "col": "CONTROL90.dBm",
            "site": "Brazil_V6_90dBm",
            "rxs": -90,
            "transmitter": {"txw": 0.3, "bwi": 0.1},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 3, "rxs": -90},
            "antenna": {"txg": 3, "fbr": 3},
        },
        # XBee-PRO 900HP @ 200 kbps (sensibilidade -101 dBm)
        # Limiar -90 dBm = 11 dB de margem de seguranca
        {
            "id": "Brazil_V7_XBee900HP_90dBm",
            "nome": "Brazil V7 XBee 900HP 90dBm",
            "frq": 920,                      # versao Brasil do 900HP (915-928 MHz)
            "col": "CONTROL90.dBm",          # trocar pela escala de 3 faixas quando criar
            "site": "Brazil_V7_XBee900HP_90dBm",
            "rxs": -90,
            "transmitter": {"txw": 0.25, "bwi": 0.1},   # 24 dBm = max do 900HP
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 3, "rxs": -90},
            "antenna": {"txg": 3, "fbr": 3},
            "feeder": {"flt": 1, "fll": 5, "fcc": 2},   # AJUSTAR: cabo (m) e conectores reais
            "model": {"ter": 3, "cli": 2},              # Farmland + Continental subtropical
        },
        # XBee-PRO 900HP @ 200 kbps (sensibilidade -101 dBm)
        # Limiar -95 dBm = 6 dB de margem de seguranca (TESTE)
        {
            "id": "Brazil_V7_XBee900HP_95dBm",
            "nome": "Brazil V7 XBee 900HP 95dBm",
            "frq": 920,
            "col": "CONTROL90.dBm",          # escala de cores (ver obs. abaixo)
            "site": "Brazil_V7_XBee900HP_95dBm",
            "rxs": -95,
            "transmitter": {"txw": 0.25, "bwi": 0.1},
            "receiver": {"lat": 0, "lon": 0, "alt": 3, "rxg": 3, "rxs": -95},
            "antenna": {"txg": 3, "fbr": 3},
            "feeder": {"flt": 1, "fll": 5, "fcc": 2},
            "model": {"ter": 3, "cli": 2},
        },
    ]