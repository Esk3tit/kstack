# Wide Event Middleware for FastAPI
# Copy this to src/logging/middleware.py

import sys
import time
import uuid
from typing import Callable, List, Optional

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Match
import structlog

from .context import (
    RequestContext,
    set_request_context,
    get_request_context,
    clear_request_context,
)


class WideEventMiddleware(BaseHTTPMiddleware):
    """Middleware that emits a single wide event per request.

    This middleware:
    1. Initializes RequestContext at request start
    2. Makes context available via get_request_context()
    3. Emits complete wide event in finally block (always runs)
    4. Never lets logging errors break requests

    Usage:
        app.add_middleware(
            WideEventMiddleware,
            excluded_paths=["/health", "/ready", "/metrics"]
        )
    """

    def __init__(
        self,
        app,
        excluded_paths: Optional[List[str]] = None,
        logger_name: str = "wide_event",
    ):
        """Initialize the middleware.

        Args:
            app: The FastAPI/Starlette application
            excluded_paths: Paths to skip (no wide event emitted)
            logger_name: Name for the structlog logger
        """
        super().__init__(app)
        self.excluded_paths = excluded_paths or ["/health", "/ready", "/metrics"]
        self.logger = structlog.get_logger(logger_name)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process request and emit wide event."""

        # Skip excluded paths (health checks, metrics, etc.)
        if request.url.path in self.excluded_paths:
            return await call_next(request)

        # Initialize request context
        ctx = RequestContext(
            request_id=request.headers.get("X-Request-ID", str(uuid.uuid4())),
            trace_id=request.headers.get("X-Trace-ID"),
            method=request.method,
            path=request.url.path,
            route=self._get_route_template(request),
            client_host=request.client.host if request.client else "",
            user_agent=request.headers.get("User-Agent", ""),
        )
        set_request_context(ctx)

        # Also bind to structlog contextvars for any interim logging
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=ctx.request_id,
            trace_id=ctx.trace_id,
        )

        try:
            response = await call_next(request)
            ctx.status_code = response.status_code

            # Try to get response size from headers
            content_length = response.headers.get("content-length")
            if content_length:
                ctx.response_size_bytes = int(content_length)

            return response

        except Exception as e:
            # Capture error details
            ctx.error = True
            ctx.error_type = type(e).__name__
            ctx.error_message = str(e)[:500]  # Truncate long messages
            ctx.status_code = 500
            raise

        finally:
            # ALWAYS emit the wide event, even on exception
            self._emit_wide_event(ctx)
            clear_request_context()

    def _get_route_template(self, request: Request) -> str:
        """Extract the route template (e.g., /vendors/{vendor_id}).

        This provides the parameterized path for grouping metrics,
        rather than the specific path with actual IDs.
        """
        for route in request.app.routes:
            match, _ = route.matches(request.scope)
            if match == Match.FULL:
                return getattr(route, "path", request.url.path)
        return request.url.path

    def _emit_wide_event(self, ctx: RequestContext) -> None:
        """Emit the wide event, handling any logging errors.

        CRITICAL: This method must NEVER raise an exception.
        Logging failures should not break application requests.
        """
        try:
            event_data = ctx.to_dict()

            # Choose log level based on status code
            if ctx.status_code >= 500:
                self.logger.error("request", **event_data)
            elif ctx.status_code >= 400:
                self.logger.warning("request", **event_data)
            else:
                self.logger.info("request", **event_data)

        except Exception as log_error:
            # Never let logging break the application
            # Write to stderr as a last resort
            sys.stderr.write(f"Failed to emit wide event: {log_error}\n")


# =============================================================================
# Optional: Sampling Middleware
# =============================================================================

class SampledWideEventMiddleware(WideEventMiddleware):
    """Wide event middleware with tail-based sampling.

    Use this variant to reduce log volume while keeping all important events.
    Sampling decisions are made AFTER request completion based on outcomes.
    """

    def __init__(
        self,
        app,
        excluded_paths: Optional[List[str]] = None,
        sample_rate: float = 0.05,
        enterprise_tiers: Optional[List[str]] = None,
        slow_threshold_ms: float = 1000.0,
    ):
        super().__init__(app, excluded_paths)
        self.sample_rate = sample_rate
        self.enterprise_tiers = enterprise_tiers or ["enterprise", "premium"]
        self.slow_threshold_ms = slow_threshold_ms

    def _should_sample(self, ctx: RequestContext) -> bool:
        """Determine if this request should be logged.

        Returns True if the request should be logged.
        """
        import random

        # ALWAYS keep errors
        if ctx.status_code >= 500:
            return True

        # ALWAYS keep client errors (may indicate bugs)
        if ctx.status_code >= 400:
            return True

        # ALWAYS keep slow requests
        duration_ms = (time.perf_counter() - ctx.start_time) * 1000
        if duration_ms > self.slow_threshold_ms:
            return True

        # ALWAYS keep enterprise users
        if ctx.user_tier in self.enterprise_tiers:
            return True

        # ALWAYS keep requests with feature flags
        if any(ctx.feature_flags.values()):
            return True

        # Sample successful, fast requests
        return random.random() < self.sample_rate

    def _emit_wide_event(self, ctx: RequestContext) -> None:
        """Emit wide event only if sampling criteria met."""
        if self._should_sample(ctx):
            super()._emit_wide_event(ctx)
