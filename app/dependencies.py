"""
NovaPOS — Dependencies v2.0
=============================
  ✅ get_current_employee — JWT → Employee (HTTP uchun)
  ✅ get_current_store    — store_id + payment check
  ✅ decode_ws_token      — WebSocket JWT validatsiya
  ✅ require_admin        — faqat admin/super_admin
  ✅ require_super_admin  — faqat super_admin
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from datetime import datetime, timezone
import os

from app.database import get_db
from app import models

# ─── Config ───────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "novapos-super-secret-change-in-production-2024")
ALGORITHM  = "HS256"

security = HTTPBearer()


# ─── HTTP: JWT → Employee ─────────────────────────────────────
async def get_current_employee(
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