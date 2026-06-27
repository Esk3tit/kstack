# Wide Event Logging Reference Files

This directory contains complete, production-ready code templates for implementing wide event logging in Python/FastAPI applications.

## Files

| File | Purpose | Copy To |
|------|---------|---------|
| `context.py` | Request context dataclass and convenience functions | `src/logging/context.py` |
| `config.py` | Structlog configuration for dev/prod | `src/logging/config.py` |
| `middleware.py` | Wide event middleware with sampling | `src/logging/middleware.py` |
| `usage.py` | Example endpoint implementations | Reference only |
| `security.py` | Redaction and sanitization utilities | `src/logging/security.py` |

## Implementation Order

1. **Create logging module**: `mkdir -p src/logging`
2. **Copy context.py**: Provides `RequestContext` and helper functions
3. **Copy config.py**: Sets up structlog with JSON/console output
4. **Copy middleware.py**: Emits wide events per request
5. **Add middleware to app**: See config.py for FastAPI integration example
6. **Update handlers**: Use usage.py patterns in your endpoints
7. **Add redaction**: Copy security.py for sensitive data handling

## Quick Start

```python
# src/logging/__init__.py
from .context import (
    get_request_context,
    set_user_context,
    set_custom_attribute,
    add_db_metrics,
    set_feature_flag,
    set_error_context,
)
from .config import configure_logging
from .middleware import WideEventMiddleware

__all__ = [
    "get_request_context",
    "set_user_context",
    "set_custom_attribute",
    "add_db_metrics",
    "set_feature_flag",
    "set_error_context",
    "configure_logging",
    "WideEventMiddleware",
]
```

## Dependencies

Add to `requirements.txt`:
```
structlog>=24.0.0
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level (DEBUG, INFO, WARNING, ERROR) | INFO |
| `LOG_JSON_FORMAT` | Force JSON output (true/false) | Auto-detect TTY |
| `SERVICE_NAME` | Service identifier for logs | unknown |
| `SERVICE_VERSION` | Version string for logs | unknown |

## Output Examples

**Development (ConsoleRenderer):**
```
2025-01-14T10:30:45.123Z [info] request  request_id=abc-123 http_method=GET http_path=/vendors/123 http_status=200 duration_ms=52.3
```

**Production (JSONRenderer):**
```json
{
  "timestamp": "2025-01-14T10:30:45.123456Z",
  "level": "info",
  "message": "request",
  "request_id": "abc-123",
  "http_method": "GET",
  "http_path": "/vendors/123",
  "http_status": 200,
  "duration_ms": 52.3,
  "user_id": "usr_456",
  "org_id": "org_789",
  "db_query_count": 3
}
```

## Customization

### Adding Domain-Specific Fields

Extend `RequestContext` in `context.py`:

```python
@dataclass
class RequestContext:
    # ... existing fields ...

    # Add your domain fields
    vendor_id: str = ""
    assessment_id: str = ""
    risk_level: str = ""
```

### Adding Custom Processors

Add to processor chain in `config.py`:

```python
def add_deployment_info(logger, method_name, event_dict):
    event_dict["k8s_pod"] = os.getenv("HOSTNAME", "")
    event_dict["region"] = os.getenv("AWS_REGION", "")
    return event_dict

# Add to shared_processors list
shared_processors.append(add_deployment_info)
```

## Testing

Verify wide events are emitted correctly:

```python
import structlog
from io import StringIO

def test_wide_event_emitted():
    output = StringIO()
    structlog.configure(
        processors=[structlog.processors.JSONRenderer()],
        logger_factory=structlog.PrintLoggerFactory(file=output),
    )

    # Make request to your endpoint
    response = client.get("/vendors/123")

    # Parse and verify wide event
    log_line = output.getvalue()
    event = json.loads(log_line)

    assert event["http_method"] == "GET"
    assert event["http_status"] == 200
    assert "duration_ms" in event
    assert "request_id" in event
```

## References

- [loggingsucks.com](https://loggingsucks.com) - Core philosophy
- [Stripe: Canonical Log Lines](https://stripe.com/blog/canonical-log-lines)
- [Structlog Documentation](https://www.structlog.org/)
- [Honeycomb: Observability 2.0](https://www.honeycomb.io/blog/structured-events-basis-observability)
