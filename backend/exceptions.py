# backend/exceptions.py
# Custom exception hierarchy for the application.


class AppBaseError(Exception):
    """Base class for all custom application errors."""


class CloudRFAPIError(AppBaseError):
    """Raised when communication with the CloudRF API fails."""


class DEMProcessingError(AppBaseError):
    """Raised when processing a Digital Elevation Model (DEM) file fails."""


class FileParseError(AppBaseError):
    """Raised when parsing an input file (e.g. KMZ) fails."""


class PDFGenerationError(AppBaseError):
    """Raised when generating a PDF report fails."""
