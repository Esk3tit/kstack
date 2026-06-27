# Security Utilities for Wide Event Logging
# Redaction, sanitization, and security best practices

import re
from typing import Any, Dict, List, Tuple


# =============================================================================
# Sensitive Data Patterns
# =============================================================================

# Patterns to redact from log data
SENSITIVE_KEY_PATTERNS = [
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "authorization",
    "auth_token",
    "access_token",
    "refresh_token",
    "private_key",
    "credential",
    "ssn",
    "social_security",
    "credit_card",
    "card_number",
]

# Regex patterns for sensitive values
SENSITIVE_VALUE_PATTERNS: List[Tuple[str, str]] = [
    # JSON field patterns
    (r'"password"\s*:\s*"[^"]*"', '"password": "[REDACTED]"'),
    (r'"api_key"\s*:\s*"[^"]*"', '"api_key": "[REDACTED]"'),
    (r'"secret"\s*:\s*"[^"]*"', '"secret": "[REDACTED]"'),
    (r'"authorization"\s*:\s*"[^"]*"', '"authorization": "[REDACTED]"'),
    (r'"token"\s*:\s*"[^"]*"', '"token": "[REDACTED]"'),

    # Email addresses
    (r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL_REDACTED]'),

    # Credit card numbers (basic pattern)
    (r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b', '[CARD_REDACTED]'),

    # SSN patterns
    (r'\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b', '[SSN_REDACTED]'),

    # Bearer tokens in headers
    (r'Bearer\s+[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]*', 'Bearer [TOKEN_REDACTED]'),

    # AWS-style keys
    (r'AKIA[0-9A-Z]{16}', '[AWS_KEY_REDACTED]'),

    # Generic long hex/base64 strings that look like secrets
    (r'[a-fA-F0-9]{32,}', '[HEX_REDACTED]'),
]


# =============================================================================
# Redaction Functions
# =============================================================================

def redact_sensitive_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively redact sensitive information from log data.

    Args:
        data: Dictionary to redact

    Returns:
        New dictionary with sensitive values redacted
    """
    result = {}

    for key, value in data.items():
        key_lower = key.lower()

        # Check if key is sensitive
        if any(pattern in key_lower for pattern in SENSITIVE_KEY_PATTERNS):
            result[key] = "[REDACTED]"
        elif isinstance(value, str):
            # Apply regex patterns to string values
            result[key] = redact_string(value)
        elif isinstance(value, dict):
            # Recursively process nested dicts
            result[key] = redact_sensitive_data(value)
        elif isinstance(value, list):
            # Process list items
            result[key] = [
                redact_sensitive_data(item) if isinstance(item, dict)
                else redact_string(item) if isinstance(item, str)
                else item
                for item in value
            ]
        else:
            result[key] = value

    return result


def redact_string(value: str) -> str:
    """Apply redaction patterns to a string value.

    Args:
        value: String to redact

    Returns:
        Redacted string
    """
    redacted = value
    for pattern, replacement in SENSITIVE_VALUE_PATTERNS:
        redacted = re.sub(pattern, replacement, redacted, flags=re.IGNORECASE)
    return redacted


def mask_api_key(api_key: str) -> str:
    """Mask an API key, showing only last 4 characters.

    Args:
        api_key: Full API key

    Returns:
        Masked string like "...abc1"
    """
    if not api_key or len(api_key) < 4:
        return "[REDACTED]"
    return f"...{api_key[-4:]}"


# =============================================================================
# Log Injection Prevention
# =============================================================================

def sanitize_user_input(value: str, max_length: int = 500) -> str:
    """Sanitize user input to prevent log injection attacks.

    Prevents:
    - Log forging via newline injection
    - DoS via extremely long strings
    - Control character injection

    Args:
        value: User-provided string
        max_length: Maximum allowed length

    Returns:
        Sanitized string safe for logging
    """
    if not isinstance(value, str):
        value = str(value)

    # Remove newlines and carriage returns (prevents log forging)
    value = value.replace("\n", "\\n").replace("\r", "\\r")

    # Remove other control characters
    value = "".join(char for char in value if ord(char) >= 32 or char in "\t")

    # Truncate to prevent DoS
    if len(value) > max_length:
        value = value[:max_length] + "...[truncated]"

    return value


def sanitize_dict_for_logging(data: Dict[str, Any], max_value_length: int = 500) -> Dict[str, Any]:
    """Sanitize an entire dictionary for safe logging.

    Combines redaction and input sanitization.

    Args:
        data: Dictionary to sanitize
        max_value_length: Maximum length for string values

    Returns:
        Sanitized and redacted dictionary
    """
    # First redact sensitive data
    redacted = redact_sensitive_data(data)

    # Then sanitize all string values
    def sanitize_value(v: Any) -> Any:
        if isinstance(v, str):
            return sanitize_user_input(v, max_value_length)
        elif isinstance(v, dict):
            return {k: sanitize_value(val) for k, val in v.items()}
        elif isinstance(v, list):
            return [sanitize_value(item) for item in v]
        return v

    return {k: sanitize_value(v) for k, v in redacted.items()}


# =============================================================================
# Structlog Processor for Automatic Redaction
# =============================================================================

def redaction_processor(logger, method_name, event_dict):
    """Structlog processor that automatically redacts sensitive data.

    Add this to your structlog processor chain:

        structlog.configure(
            processors=[
                structlog.contextvars.merge_contextvars,
                redaction_processor,  # Add here
                structlog.processors.JSONRenderer(),
            ]
        )
    """
    return sanitize_dict_for_logging(event_dict)


# =============================================================================
# Security Best Practices Checklist
# =============================================================================

"""
SECURITY CHECKLIST FOR WIDE EVENT LOGGING

NEVER LOG:
- [ ] Passwords (user passwords, database passwords)
- [ ] Full API keys (only log last 4 chars with mask_api_key())
- [ ] JWTs or session tokens
- [ ] OAuth tokens (access, refresh)
- [ ] Private keys or certificates
- [ ] Credit card numbers
- [ ] Social Security Numbers
- [ ] Full request bodies (may contain sensitive data)

ALWAYS REDACT:
- [ ] Email addresses in logs
- [ ] PII (names, addresses, phone numbers)
- [ ] Authentication headers
- [ ] Query parameters with sensitive data

ALWAYS SANITIZE:
- [ ] User-provided input before logging
- [ ] Error messages (may contain sensitive data)
- [ ] Request paths with user data

ACCESS CONTROL:
- [ ] Implement role-based access to logs
- [ ] Encrypt logs at rest
- [ ] Encrypt logs in transit (TLS)
- [ ] Audit access to log systems
- [ ] Set appropriate retention policies

ADDITIONAL:
- [ ] Never log to stdout/stderr in production without JSON
- [ ] Use structured logging (not string concatenation)
- [ ] Test redaction regularly
- [ ] Monitor for PII leaks in logs
"""


# =============================================================================
# Example: Secure Request Context
# =============================================================================

def set_user_context_secure(
    user_id: str,
    email: str = "",
    tier: str = "",
    org_id: str = "",
    org_name: str = "",
) -> None:
    """Set user context with automatic email redaction.

    Use this instead of the standard set_user_context to automatically
    redact email addresses in logs.
    """
    from .context import get_request_context

    ctx = get_request_context()
    ctx.user_id = user_id
    # Redact email - only log domain
    if email and "@" in email:
        domain = email.split("@")[1]
        ctx.user_email = f"***@{domain}"
    else:
        ctx.user_email = "[REDACTED]"
    ctx.user_tier = tier
    ctx.org_id = org_id
    ctx.org_name = org_name
