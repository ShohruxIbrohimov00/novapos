"""
NovaPOS — Dependencies v2.0
=============================
  ✅ get_current_employee — JWT → Employee (HTTP uchun)
  ✅ get_current_store    — store_id + payment check
  ✅ decode_ws_token      — WebSocket JWT validatsiya
  ✅ require_admin        — faqat admin/super_admin
  ✅ require_super_admin  — faqat super_admin
"""

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from datetime import datetime, timezone
import os

from app.database import get_db
from app import models

# ─── Config ───────────────────────────────────────────────────
_DEFAULT_SECRET = "novapos-super-secret-change-in-production-2024"
SECRET_KEY = os.getenv("SECRET_KEY", _DEFAULT_SECRET)
if SECRET_KEY == _DEFAULT_SECRET:
    import logging as _logging
    _logging.getLogger(__name__).warning(
        "⚠️  SECRET_KEY .env da berilmagan! Standart kalit ishlatilmoqda — "
        "bu bilan istalgan odam soxta token yasay oladi. Serverda albatta o'rnating."
    )
ALGORITHM  = "HS256"

security = HTTPBearer()


# ─── HTTP: JWT → Employee ─────────────────────────────────────
# Obuna tugagan bo'lsa ham ochiq qoladigan yo'llar (to'lov qilish va holatni ko'rish uchun)
_SUBSCRIPTION_FREE_PREFIXES = (
    "/api/auth/",
    "/api/subscriptions/",
    "/api/superadmin/payment-settings",
    "/api/superadmin/settings/payment",
    "/api/stores/me",
)


def _check_store_subscription(employee: models.Employee, path: str) -> None:
    """
    ✅ Obuna HAR BIR so'rovda tekshiriladi (avval faqat login paytida edi,
    token esa 30 kun amal qilgani uchun to'lamagan do'kon ishlayverardi).
    """
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    if role == "super_admin" or path.startswith(_SUBSCRIPTION_FREE_PREFIXES):
        return
    store = employee.store
    if not store:
        return
    if not store.is_active:
        raise HTTPException(403, "Do'kon bloklangan. Administrator bilan bog'laning.")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if store.subscription_expires_at and store.subscription_expires_at < now:
        code = ("SUBSCRIPTION_EXPIRED_PENDING" if store.payment_status == "pending"
                else "SUBSCRIPTION_EXPIRED")
        raise HTTPException(402, {
            "code":       code,
            "message":    "Obuna muddati tugagan! Iltimos, to'lovni amalga oshiring.",
            "expires_at": store.subscription_expires_at.isoformat(),
        })


async def get_current_employee(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> models.Employee:
    token = credentials.credentials
    exc   = HTTPException(
        status_code = status.HTTP_401_UNAUTHORIZED,
        detail      = "Token noto'g'ri yoki muddati o'tgan",
        headers     = {"WWW-Authenticate": "Bearer"},
    )
    try:
        payload     = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        employee_id = payload.get("sub")
        if not employee_id:
            raise exc
    except JWTError:
        raise exc

    employee = db.query(models.Employee).filter(
        models.Employee.id        == int(employee_id),
        models.Employee.is_active == True,
    ).first()

    if not employee:
        raise exc

    _check_store_subscription(employee, request.url.path)

    # last_seen_at yangilash (background task sifatida — endpoint ni sekinlashtirmaydi)
    try:
        employee.last_seen_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
    except Exception:
        pass

    return employee


# ─── HTTP: Store (payment check bilan) ───────────────────────
async def get_current_store(
    employee: models.Employee = Depends(get_current_employee),
    db: Session = Depends(get_db),
) -> models.Store:
    store = db.query(models.Store).filter(
        models.Store.id        == employee.store_id,
        models.Store.is_active == True,
    ).first()

    if not store:
        raise HTTPException(404, "Do'kon topilmadi")

    # Super admin uchun payment check yo'q
    role = employee.role.value if hasattr(employee.role, "value") else employee.role
    if role == "super_admin":
        return store

    # Payment check
    if store.payment_status in ("pending", "expired"):
        raise HTTPException(402, {
            "detail": "Obuna muddati tugagan",
            "code":   store.payment_status,
        })

    return store


# ─── Rolga asoslangan dependency ─────────────────────────────
def require_admin(
    employee: models.Employee = Depends(get_current_employee),
) -> models.Employee:
    role = employee.role.value if hasattr(employee.role, "value") else employee.role
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Faqat admin uchun")
    return employee


def require_super_admin(
    employee: models.Employee = Depends(get_current_employee),
) -> models.Employee:
    role = employee.role.value if hasattr(employee.role, "value") else employee.role
    if role != "super_admin":
        raise HTTPException(403, "Faqat super admin uchun")
    return employee


# ─── WebSocket: JWT token decode ──────────────────────────────
def decode_ws_token(token: str, expected_store_id: int) -> dict:
    """
    WebSocket ulanishida token tekshiruv.
    Qaytaradi: { employee_id, full_name, role, store_id }
    Xato bo'lsa: Exception
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        raise ValueError(f"JWT xato: {e}")

    employee_id = payload.get("sub")
    store_id    = payload.get("store_id")
    role        = payload.get("role", "cashier")
    full_name   = payload.get("full_name", "Noma'lum")

    if not employee_id:
        raise ValueError("Token ichida employee_id yo'q")

    # Super admin istalgan do'konga kirishi mumkin
    if role != "super_admin" and store_id != expected_store_id:
        raise ValueError(
            f"Token store_id ({store_id}) != URL store_id ({expected_store_id})"
        )

    return {
        "employee_id": int(employee_id),
        "store_id":    store_id,
        "full_name":   full_name,
        "role":        role,
    }


# ─── JWT yaratish (auth.py da ishlatiladi) ───────────────────
def create_access_token(employee: models.Employee, store_id: int) -> str:
    from datetime import timedelta
    from jose import jwt as _jwt

    expire = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)
    data   = {
        "sub":       str(employee.id),
        "store_id":  store_id,
        "role":      employee.role.value if hasattr(employee.role, "value") else employee.role,
        "full_name": employee.full_name,
        "exp":       expire,
    }
    return _jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)