# Structlog Configuration for Wide Event Logging
# Copy this to src/logging/config.py

import logging
import sys
import structlog
from typing import List

from structlog.types import Processor


def get_processors(json_format: bool = True) -> List[Processor]:
    """Build structlog processor chain.

    Args:
        json_format: If True, output JSON (production). If False, pretty console output (development).

    Returns:
        List of structlog processors to apply to all log entries.
    """

    shared_processors: List[Processor] = [
        # Merge context variables (from contextvars) into log entries
        structlog.contextvars.merge_contextvars,

        # Filter by log level
        structlog.stdlib.filter_by_level,

        # Add logger name (module path)
        structlog.stdlib.add_logger_name,

        # Add log level (info, warning, error, etc.)
        structlog.stdlib.add_log_level,

        # Format positional arguments
        structlog.stdlib.PositionalArgumentsFormatter(),

        # Add ISO 8601 timestamp in UTC
        structlog.processors.TimeStamper(fmt="iso", utc=True),

        # Render stack info when requested
        structlog.processors.StackInfoRenderer(),

        # Decode Unicode strings
        structlog.processors.UnicodeDecoder(),
    ]

    if json_format:
        # Production: JSON output for log aggregators
        return shared_processors + [
            # Format exception info as string
            structlog.processors.format_exc_info,

            # Rename 'event' to 'message' for Datadog/ELK compatibility
            structlog.processors.EventRenamer("message"),

            # Render as JSON
            structlog.processors.JSONRenderer(),
        ]
    else:
        # Development: Pretty console output with colors
        return shared_processors + [
            structlog.dev.ConsoleRenderer(colors=True),
        ]


def configure_logging(
    log_level: str = "INFO",
    json_format: bool = None,
) -> None:
    """Configure structlog for production use.

    Call this once at application startup, typically in the FastAPI lifespan handler.

    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        json_format: Use JSON output. Defaults to True in non-TTY environments.

    Example:
        @asynccontextmanager
        async def lifespan(app: FastAPI):
            configure_logging(
                log_level=os.getenv("LOG_LEVEL", "INFO"),
                json_format=os.getenv("LOG_JSON_FORMAT", "").lower() == "true",
            )
            yield
    """

    # Auto-detect JSON format based on TTY
    if json_format is None:
        json_format = not sys.stderr.isatty()

    processors = get_processors(json_format)

    # Configure structlog
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Configure standard library logging
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, log_level.upper()),
    )

    # Silence noisy third-party loggers
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


# =============================================================================
# Optional: Custom Processors
# =============================================================================

def add_service_info(logger, method_name, event_dict):
    """Add service metadata to every log entry.

    Add this to the processor chain if you want service info in all logs.
    """
    import os
    event_dict["service_name"] = os.getenv("SERVICE_NAME", "unknown")
    event_dict["service_version"] = os.getenv("SERVICE_VERSION", "unknown")
    event_dict["environment"] = os.getenv("ENV", "development")
    return event_dict


def drop_health_checks(logger, method_name, event_dict):
    """Drop logs from health check endpoints.

    Add this to reduce log noise from k8s probes.
    """
    path = event_dict.get("http_path", "")
    if path in ("/health", "/ready", "/metrics"):
        raise structlog.DropEvent
    return event_dict


# =============================================================================
# FastAPI Integration Example
# =============================================================================

"""
# In your main.py:

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
import structlog

from src.logging.config import configure_logging
from src.logging.middleware import WideEventMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Configure logging on startup
    configure_logging(
        log_level=os.getenv("LOG_LEVEL", "INFO"),
        json_format=os.getenv("LOG_JSON_FORMAT", "").lower() == "true",
    )

    logger = structlog.get_logger()
    logger.info("application_started", version="1.0.0")

    yield

    logger.info("application_stopped")


app = FastAPI(lifespan=lifespan)

# Add wide event middleware
app.add_middleware(
    WideEventMiddleware,
    excluded_paths=["/health", "/ready", "/metrics", "/docs", "/openapi.json"],
)
"""
