# Wide Event Request Context
# Copy this to src/logging/context.py and customize for your domain

from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Dict, Optional
import time
import uuid


@dataclass
class RequestContext:
    """Accumulates wide event data throughout request lifecycle.

    This dataclass collects all relevant context for a single request.
    Fields are progressively enriched by middleware, auth, database layers,
    and business logic. The complete event is emitted once at request completion.
    """

    # Request identification
    request_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    start_time: float = field(default_factory=time.perf_counter)

    # HTTP metadata
    method: str = ""
    path: str = ""
    route: str = ""  # Template path like /vendors/{vendor_id}
    query_params: Dict[str, str] = field(default_factory=dict)
    client_host: str = ""
    user_agent: str = ""

    # Response data
    status_code: int = 0
    response_size_bytes: int = 0

    # User context
    user_id: str = ""
    user_email: str = ""
    user_tier: str = ""
    org_id: str = ""
    org_name: str = ""

    # Authentication
    auth_method: str = ""  # api_key, oauth, session
    api_key_id: str = ""

    # Performance metrics
    db_query_count: int = 0
    db_query_duration_ms: float = 0.0
    cache_hits: int = 0
    cache_misses: int = 0
    external_api_calls: int = 0
    external_api_duration_ms: float = 0.0

    # Background tasks
    background_tasks_queued: int = 0

    # Feature flags
    feature_flags: Dict[str, bool] = field(default_factory=dict)

    # Error information
    error: bool = False
    error_type: str = ""
    error_message: str = ""
    error_code: str = ""  # Application-specific error code

    # Custom attributes for business context
    custom: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for logging, calculating final metrics."""
        duration_ms = (time.perf_counter() - self.start_time) * 1000

        return {
            # Core identifiers
            "request_id": self.request_id,
            "trace_id": self.trace_id,
            "span_id": self.span_id,

            # Timing
            "duration_ms": round(duration_ms, 2),

            # HTTP
            "http_method": self.method,
            "http_path": self.path,
            "http_route": self.route,
            "http_status": self.status_code,
            "http_response_size_bytes": self.response_size_bytes,
            "client_host": self.client_host,
            "user_agent": self.user_agent,

            # User context
            "user_id": self.user_id,
            "user_email": self.user_email,
            "user_tier": self.user_tier,
            "org_id": self.org_id,
            "org_name": self.org_name,

            # Auth
            "auth_method": self.auth_method,
            "api_key_id": self.api_key_id,

            # Performance
            "db_query_count": self.db_query_count,
            "db_query_duration_ms": round(self.db_query_duration_ms, 2),
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "external_api_calls": self.external_api_calls,
            "external_api_duration_ms": round(self.external_api_duration_ms, 2),
            "background_tasks_queued": self.background_tasks_queued,

            # Feature flags
            "feature_flags": self.feature_flags,

            # Error
            "error": self.error,
            "error_type": self.error_type if self.error else "",
            "error_message": self.error_message if self.error else "",
            "error_code": self.error_code if self.error else "",

            # Custom business attributes
            **self.custom,
        }


# Context variable for request-scoped storage
_request_context: ContextVar[RequestContext] = ContextVar("request_context")


def get_request_context() -> RequestContext:
    """Get current request context, creating if necessary."""
    try:
        return _request_context.get()
    except LookupError:
        ctx = RequestContext()
        _request_context.set(ctx)
        return ctx


def set_request_context(ctx: RequestContext) -> None:
    """Set the current request context."""
    _request_context.set(ctx)


def clear_request_context() -> None:
    """Clear the current request context."""
    try:
        _request_context.set(RequestContext())
    except LookupError:
        pass


# =============================================================================
# Convenience Functions for Enriching Context
# Call these from your handlers, middleware, and service layers
# =============================================================================

def set_user_context(
    user_id: str,
    email: str = "",
    tier: str = "",
    org_id: str = "",
    org_name: str = "",
) -> None:
    """Set user information on the current request context.

    Call this after authentication to enrich the wide event with user data.
    """
    ctx = get_request_context()
    ctx.user_id = user_id
    ctx.user_email = email
    ctx.user_tier = tier
    ctx.org_id = org_id
    ctx.org_name = org_name


def set_auth_context(method: str, api_key_id: str = "") -> None:
    """Set authentication information on the current request context.

    Args:
        method: Authentication method used (api_key, oauth, session, etc.)
        api_key_id: Masked API key identifier (last 4 chars only for security)
    """
    ctx = get_request_context()
    ctx.auth_method = method
    ctx.api_key_id = api_key_id


def add_db_metrics(query_count: int = 1, duration_ms: float = 0.0) -> None:
    """Add database query metrics to the current request context.

    Call this after each database query to track total queries and time.
    """
    ctx = get_request_context()
    ctx.db_query_count += query_count
    ctx.db_query_duration_ms += duration_ms


def add_cache_metrics(hits: int = 0, misses: int = 0) -> None:
    """Add cache metrics to the current request context."""
    ctx = get_request_context()
    ctx.cache_hits += hits
    ctx.cache_misses += misses


def add_external_api_metrics(calls: int = 1, duration_ms: float = 0.0) -> None:
    """Add external API call metrics to the current request context."""
    ctx = get_request_context()
    ctx.external_api_calls += calls
    ctx.external_api_duration_ms += duration_ms


def set_feature_flag(name: str, value: bool) -> None:
    """Record a feature flag value on the current request context.

    Track all feature flags evaluated during the request for A/B analysis.
    """
    ctx = get_request_context()
    ctx.feature_flags[name] = value


def set_error_context(
    error_type: str,
    error_message: str,
    error_code: str = "",
) -> None:
    """Set error information on the current request context.

    Call this when catching exceptions you want to add context to.
    The middleware will also capture uncaught exceptions automatically.
    """
    ctx = get_request_context()
    ctx.error = True
    ctx.error_type = error_type
    ctx.error_message = error_message[:500]  # Truncate for safety
    ctx.error_code = error_code


def set_custom_attribute(key: str, value: Any) -> None:
    """Set a custom attribute on the current request context.

    Use this for domain-specific data like:
    - vendor_id, vendor_status, risk_level
    - assessment_id, report_type
    - Any business-specific context
    """
    ctx = get_request_context()
    ctx.custom[key] = value


def increment_background_tasks(count: int = 1) -> None:
    """Track background tasks queued during this request."""
    ctx = get_request_context()
    ctx.background_tasks_queued += count
