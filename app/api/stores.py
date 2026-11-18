"""
NovaPOS — Stores Router v2.0
==============================
Tuzatilgan:
  ✅ get_current_employee — dependencies.py dan import
  ✅ require_admin — dependencies.py dan (role tekshiruv)
  ✅ update_my_store — schemas.StoreBase orqali typed input (dict emas)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from typing import Optional
from pydantic import BaseModel

from app import models, crud
from app.database import get_db
from app.dependencies import get_current_employee

router = APIRouter(tags=["Stores"])


# ─── Input schema ─────────────────────────────────────────────
class StoreUpdateInput(BaseModel):
    name:    Optional[str] = None
    phone:   Optional[str] = None
    address: Optional[str] = None


# ─── Helper ───────────────────────────────────────────────────
def _fmt(s: models.Store) -> dict:
    now       = datetime.utcnow()
    days_left = None
    if s.subscription_expires_at:
        days_left = (s.subscription_expires_at - now).days

    return {
        "id":                      s.id,
        "name":                    s.name,
        "phone":                   s.phone,
        "address":                 s.address,
        "is_active":               s.is_active,
        "payment_status":          s.payment_status,
        "subscription_expires_at": s.subscription_expires_at.isoformat()
                                   if s.subscription_expires_at else None,
        "days_left":               days_left,
        "created_at":              s.created_at.isoformat() if s.created_at else None,
    }


# ─── Endpoints ────────────────────────────────────────────────

@router.get("/me")
def get_my_store(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    store = crud.get_store(db, employee.store_id)
    if not store:
        raise HTTPException(404, "Do'kon topilmadi")
    return _fmt(store)


@router.patch("/me")
def update_my_store(
    data:     StoreUpdateInput,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Do'kon ma'lumotlarini yangilash — faqat admin"""
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Faqat admin do'kon ma'lumotlarini o'zgartira oladi")

    store = crud.get_store(db, employee.store_id)
    if not store:
        raise HTTPException(404, "Do'kon topilmadi")

    updates = data.model_dump(exclude_unset=True)

    if "name" in updates:
        name = (updates["name"] or "").strip()
        if not name:
            raise HTTPException(400, "Do'kon nomi bo'sh bo'lishi mumkin emas")
        updates["name"] = name

    if "phone" in updates:
        updates["phone"] = (updates["phone"] or "").strip() or None

    if "address" in updates:
        updates["address"] = (updates["address"] or "").strip() or None

    crud.update_store(db, employee.store_id, updates)
    db.refresh(store)
    return _fmt(store)