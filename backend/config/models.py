# backend/config/models.py
# Pydantic models for simulation template configuration.

from pydantic import BaseModel, Field


class TransmitterSettings(BaseModel):
    """Transmitter configuration."""

    model_config = {"frozen": True}

    txw: float = Field(gt=0, description="Transmission power in Watts (>0)")
    bwi: float = Field(ge=0, description="Bandwidth in MHz (>=0)")


class ReceiverSettings(BaseModel):
    """Receiver configuration."""

    model_config = {"frozen": True}

    lat: float = Field(default=0.0, ge=-90, le=90)
    lon: float = Field(default=0.0, ge=-180, le=180)
    alt: int = Field(default=3, ge=0)
    rxg: float = Field(gt=0)
    rxs: int = Field(le=0, description="Receiver sensitivity in dBm (must be <= 0)")


class AntennaSettings(BaseModel):
    """Antenna configuration."""

    model_config = {"frozen": True}

    txg: float = Field(ge=0)
    fbr: float = Field(ge=0)


class TemplateSettings(BaseModel):
    """Complete simulation template (transmitter, receiver, and antenna)."""

    model_config = {"frozen": True}

    id: str
    nome: str
    frq: int = Field(ge=100, le=6000, description="Frequency in MHz (100–6000)")
    col: str
    site: str
    rxs: int
    transmitter: TransmitterSettings
    receiver: ReceiverSettings
    antenna: AntennaSettings
