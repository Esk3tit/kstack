# Example Usage in Endpoint Handlers
# Reference this file when implementing wide event logging in your handlers

import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# Import from your logging module
from src.logging.context import (
    set_user_context,
    set_auth_context,
    set_custom_attribute,
    add_db_metrics,
    add_cache_metrics,
    add_external_api_metrics,
    set_feature_flag,
    set_error_context,
    increment_background_tasks,
)

router = APIRouter()


# =============================================================================
# Example 1: Basic Handler with User Context
# =============================================================================

@router.get("/vendors/{vendor_id}")
async def get_vendor(
    vendor_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Example endpoint with full wide event context."""

    # 1. Set user context (call after authentication)
    set_user_context(
        user_id=current_user.id,
        email=current_user.email,
        tier=current_user.subscription_tier,
        org_id=current_user.org_id,
        org_name=current_user.org_name,
    )

    # 2. Set auth context
    set_auth_context(
        method="api_key",
        api_key_id=current_user.api_key_id[-4:] if current_user.api_key_id else "",
    )

    # 3. Record feature flags
    set_feature_flag("new_vendor_flow", is_feature_enabled("new_vendor_flow", current_user))

    # 4. Track database query with timing
    start = time.perf_counter()
    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    duration_ms = (time.perf_counter() - start) * 1000
    add_db_metrics(query_count=1, duration_ms=duration_ms)

    # 5. Handle not found with context
    if not vendor:
        set_custom_attribute("vendor_found", False)
        raise HTTPException(status_code=404, detail="Vendor not found")

    # 6. Add business-specific context
    set_custom_attribute("vendor_found", True)
    set_custom_attribute("vendor_status", vendor.status)
    set_custom_attribute("vendor_risk_level", vendor.risk_level)
    set_custom_attribute("vendor_resource_count", len(vendor.resources))

    return vendor
    # Wide event is automatically emitted by middleware


# =============================================================================
# Example 2: Handler with External API Call
# =============================================================================

@router.post("/vendors/{vendor_id}/scan")
async def scan_vendor(
    vendor_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Example with external API call tracking."""

    set_user_context(user_id=current_user.id, org_id=current_user.org_id)

    # Track external API call
    start = time.perf_counter()
    try:
        scan_result = await external_scanner.scan(vendor_id)
        add_external_api_metrics(calls=1, duration_ms=(time.perf_counter() - start) * 1000)
    except ExternalAPIError as e:
        add_external_api_metrics(calls=1, duration_ms=(time.perf_counter() - start) * 1000)
        set_error_context(
            error_type="ExternalAPIError",
            error_message=str(e),
            error_code="SCAN_FAILED",
        )
        raise HTTPException(status_code=502, detail="Scan service unavailable")

    # Track scan results
    set_custom_attribute("scan_status", scan_result.status)
    set_custom_attribute("vulnerabilities_found", scan_result.vulnerability_count)

    return scan_result


# =============================================================================
# Example 3: Handler with Caching
# =============================================================================

@router.get("/vendors")
async def list_vendors(
    page: int = 1,
    page_size: int = 20,
    cache = Depends(get_cache),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Example with cache metrics."""

    set_user_context(user_id=current_user.id, org_id=current_user.org_id)

    cache_key = f"vendors:{current_user.org_id}:{page}:{page_size}"

    # Check cache
    cached = await cache.get(cache_key)
    if cached:
        add_cache_metrics(hits=1)
        set_custom_attribute("cache_hit", True)
        return cached

    add_cache_metrics(misses=1)
    set_custom_attribute("cache_hit", False)

    # Query database
    start = time.perf_counter()
    vendors = db.query(Vendor).filter(Vendor.org_id == current_user.org_id).offset((page - 1) * page_size).limit(page_size).all()
    add_db_metrics(query_count=1, duration_ms=(time.perf_counter() - start) * 1000)

    # Cache result
    await cache.set(cache_key, vendors, ttl=300)

    set_custom_attribute("vendor_count", len(vendors))
    set_custom_attribute("page", page)

    return vendors


# =============================================================================
# Example 4: Handler with Background Tasks
# =============================================================================

@router.post("/vendors/{vendor_id}/notify")
async def notify_vendor(
    vendor_id: str,
    background_tasks,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Example with background task tracking."""

    set_user_context(user_id=current_user.id, org_id=current_user.org_id)

    # Queue background notifications
    background_tasks.add_task(send_email_notification, vendor_id)
    background_tasks.add_task(send_slack_notification, vendor_id)
    increment_background_tasks(count=2)

    set_custom_attribute("notification_type", "vendor_update")
    set_custom_attribute("vendor_id", vendor_id)

    return {"status": "notifications_queued"}


# =============================================================================
# Example 5: Error Handling Pattern
# =============================================================================

@router.delete("/vendors/{vendor_id}")
async def delete_vendor(
    vendor_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
):
    """Example of proper error handling with wide events.

    Key principle: Set error context, then let the exception propagate.
    The middleware will capture everything in the wide event.
    """

    set_user_context(user_id=current_user.id, org_id=current_user.org_id)
    set_custom_attribute("vendor_id", vendor_id)

    vendor = db.query(Vendor).filter(Vendor.id == vendor_id).first()
    if not vendor:
        # Set context before raising - middleware captures everything
        set_error_context(
            error_type="NotFoundError",
            error_message=f"Vendor {vendor_id} not found",
            error_code="VENDOR_NOT_FOUND",
        )
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Check permissions
    if vendor.org_id != current_user.org_id:
        set_error_context(
            error_type="PermissionDenied",
            error_message="User does not have access to this vendor",
            error_code="ACCESS_DENIED",
        )
        raise HTTPException(status_code=403, detail="Access denied")

    try:
        db.delete(vendor)
        db.commit()
        set_custom_attribute("deletion_successful", True)
    except Exception as e:
        db.rollback()
        set_error_context(
            error_type=type(e).__name__,
            error_message=str(e),
            error_code="DELETION_FAILED",
        )
        raise HTTPException(status_code=500, detail="Failed to delete vendor")

    return {"status": "deleted"}


# =============================================================================
# Example 6: Authentication Dependency Integration
# =============================================================================

async def get_current_user_with_logging(
    request,
    db: Session = Depends(get_db),
) -> User:
    """Authentication dependency that enriches wide event context.

    This pattern ensures user context is set for every authenticated endpoint.
    """

    # Extract and validate token
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        set_auth_context(method="none")
        raise HTTPException(status_code=401, detail="Missing authentication")

    user = await validate_token(token, db)
    if not user:
        set_auth_context(method="invalid_token")
        raise HTTPException(status_code=401, detail="Invalid token")

    # Set context for the wide event
    set_user_context(
        user_id=user.id,
        email=user.email,
        tier=user.subscription_tier,
        org_id=user.org_id,
        org_name=user.org_name,
    )
    set_auth_context(method="bearer_token")

    return user
