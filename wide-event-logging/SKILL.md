---
name: wide-event-logging
description: Implement wide event logging (canonical log lines) in Python/FastAPI applications. Use when adding logging to a new service, refactoring existing logging, implementing observability, or when user mentions logging, structured logging, canonical logs, wide events, or observability.
---

# Wide Event Logging

Implement the wide event logging paradigm based on loggingsucks.com principles, Stripe's canonical log lines, and Honeycomb's Observability 2.0.

## Core Philosophy

**Emit one comprehensive, context-rich event per request per service** instead of scattered log statements.

Traditional logging is optimized for writing, not querying. Wide events flip this: capture everything relevant once, query flexibly later.

```
# Traditional (BAD) - 5 scattered lines
2025-01-14 10:30:45 INFO  Starting request handling
2025-01-14 10:30:45 DEBUG Authenticated user usr_123
2025-01-14 10:30:45 DEBUG Database query took 45ms
2025-01-14 10:30:45 INFO  Request completed

# Wide Event (GOOD) - 1 comprehensive event
{"request_id": "req_abc", "http_method": "GET", "http_status": 200,
 "duration_ms": 52.3, "user_id": "usr_123", "db_query_count": 3,
 "db_query_duration_ms": 45.2, "user_tier": "enterprise"}
```

## When to Use This Skill

- Adding logging to a new Python/FastAPI service
- Refactoring existing scattered logging
- Implementing observability or monitoring
- User mentions: logging, structured logging, canonical logs, wide events
- Improving debugging or incident response capabilities

## Implementation Checklist

Follow these steps in order. Mark each complete before proceeding.

### Phase 1: Setup Logging Infrastructure

1. Create logging module structure:
   ```
   src/logging/
     __init__.py
     config.py      # Structlog configuration
     context.py     # Request context dataclass
     middleware.py  # Wide event middleware
   ```

2. Implement `RequestContext` dataclass (see `references/context.py`)
   - Include all essential fields: request_id, timing, HTTP, user, performance, errors
   - Add convenience functions: `set_user_context()`, `add_db_metrics()`, etc.

3. Configure structlog (see `references/config.py`)
   - JSON format for production, ConsoleRenderer for development
   - Include timestamp, log level, stack info processors

4. Create `WideEventMiddleware` (see `references/middleware.py`)
   - Initialize context at request start
   - Emit single event in `finally` block
   - Never let logging break requests

### Phase 2: Integrate with Application

5. Add middleware to FastAPI app:
   ```python
   app.add_middleware(
       WideEventMiddleware,
       excluded_paths=["/health", "/ready", "/metrics"]
   )
   ```

6. Update authentication dependencies to call `set_user_context()`

7. Update database layer to track query metrics with `add_db_metrics()`

8. Add `set_custom_attribute()` calls for business context in handlers

### Phase 3: Validation

9. Verify wide events are emitted for all request paths
10. Confirm error cases capture full context
11. Check no sensitive data is logged (passwords, tokens, PII)
12. Measure performance impact (<5ms overhead acceptable)

## Five Core Principles

1. **One Event Per Request** - Single canonical log line at request completion
2. **Build Progressively, Emit Once** - Accumulate context throughout, emit at end
3. **High Cardinality** - Include user_id, request_id, org_id (not just method, status)
4. **Always Emit** - Use finally blocks; emit even on exceptions
5. **Never Break Requests** - Wrap logging in try/except

## Essential Wide Event Fields

| Always Include | Strongly Recommended | Business Context |
|----------------|---------------------|------------------|
| request_id | user_id, org_id | domain-specific IDs |
| timestamp | user_tier | entity statuses |
| duration_ms | auth_method | feature flags |
| http_method/path/status | db_query_count/duration | transaction data |
| service_name | cache_hits/misses | business metrics |

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Scattered logs | Multiple lines per request | Single wide event at completion |
| Low cardinality only | Can't debug specific users | Include user_id, request_id |
| Missing business context | Technical data only | Add domain-specific fields |
| Log-and-throw | Duplicate error logging | Let middleware handle errors |
| F-string in logs | Performance overhead | Use lazy %s formatting |
| Logging sensitive data | Security risk | Implement redaction |

## Sampling Strategy

Never use uniform random sampling. Use tail-based sampling after request completion:

| Category | Sample Rate | Rationale |
|----------|-------------|-----------|
| 5xx errors | 100% | Critical debugging |
| 4xx errors | 100% | May indicate bugs |
| Slow requests (>p99) | 100% | Performance issues |
| Enterprise users | 100% | VIP customers |
| Feature flag rollouts | 100% | A/B analysis |
| Normal successful | 5% | Cost control |
| Health checks | 0% | No value |

## Security Requirements

- Never log: passwords, full API keys, JWTs, session tokens
- Redact: emails, PII, sensitive request bodies
- Truncate: error messages (500 chars max)
- Sanitize: user input to prevent log injection

## Bundled Resources

**references/** - Code templates loaded when implementing:
- `context.py` - Full RequestContext dataclass with all fields
- `config.py` - Structlog configuration for dev/prod
- `middleware.py` - Complete WideEventMiddleware implementation
- `usage.py` - Example endpoint handler integration
- `sampling.py` - Tail-based sampling implementation
- `security.py` - Redaction and sanitization utilities

## Quick Start Example

```python
# In endpoint handler
from src.logging.context import (
    set_user_context, add_db_metrics, set_custom_attribute
)

@router.get("/vendors/{vendor_id}")
async def get_vendor(vendor_id: str, user = Depends(get_current_user)):
    # Enrich wide event with user context
    set_user_context(user_id=user.id, tier=user.tier, org_id=user.org_id)

    # Track DB metrics
    start = time.perf_counter()
    vendor = db.query(Vendor).filter_by(id=vendor_id).first()
    add_db_metrics(query_count=1, duration_ms=(time.perf_counter()-start)*1000)

    # Add business context
    set_custom_attribute("vendor_status", vendor.status)
    set_custom_attribute("vendor_risk_level", vendor.risk_level)

    return vendor
    # Middleware emits complete wide event automatically
```

## References

- [loggingsucks.com](https://loggingsucks.com) - Core philosophy
- [Stripe: Canonical Log Lines](https://stripe.com/blog/canonical-log-lines)
- [Charity Majors: Observability 2.0](https://charity.wtf/tag/observability-2-0/)
- [Structlog Documentation](https://www.structlog.org/)
