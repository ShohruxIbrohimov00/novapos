"""
NovaPOS — Rate Limiting v1.1
==============================
ENVIRONMENT=test bo'lsa barcha limitlar o'chiriladi.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from fastapi.responses import JSONResponse
import os

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
IS_TEST     = ENVIRONMENT == "test"

# ─── Limiter instance ─────────────────────────────────────────
limiter = Limiter(
    key_func       = get_remote_address,
    default_limits = ["200/minute"],
    enabled        = not IS_TEST,   # ← test muhitida TO'LIQ O'CHIRILADI
)

# ─── Limit decoratorlar ───────────────────────────────────────
# IS_TEST=True bo'lsa "9999/minute" — amalda cheksiz
_login_rate  = "9999/minute" if IS_TEST else os.getenv("RATE_LIMIT_LOGIN", "5/minute")
_pin_rate    = "9999/minute" if IS_TEST else "10/minute"
_api_rate    = "9999/minute" if IS_TEST else "200/minute"
_upload_rate = "9999/minute" if IS_TEST else "3/minute"
_ai_rate     = "9999/minute" if IS_TEST else "10/minute"
_reg_rate    = "9999/minute" if IS_TEST else "3/minute"
_clerr_rate  = "9999/minute" if IS_TEST else "10/minute"

login_limit  = limiter.limit(_login_rate)
pin_limit    = limiter.limit(_pin_rate)
api_limit    = limiter.limit(_api_rate)
upload_limit = limiter.limit(_upload_rate)
ai_limit     = limiter.limit(_ai_rate)
reg_limit    = limiter.limit(_reg_rate)
client_error_limit = limiter.limit(_clerr_rate)


# ─── Exception handler ────────────────────────────────────────
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code = 429,
        content     = {
            "detail":      "Juda ko'p so'rov yuborildi. Biroz kuting.",
            "retry_after": str(exc.retry_after) if hasattr(exc, "retry_after") else "60",
        },
    )