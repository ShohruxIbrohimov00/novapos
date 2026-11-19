"""
NovaPOS — Auth Router v2.1
============================
Tuzatilgan:
  ✅ create_access_token — dependencies.py dan import
  ✅ get_current_employee — dependencies.py dan import
  ✅ Token payload: sub = employee_id (string), + store_id, role, full_name
  ✅ Rate limiting — login: 5/min, PIN: 10/min, register: 3/min
  ✅ async def + Request parametr — slowapi uchun shart
"""

from fastapi import APIRouter, Depends, HTTPException, Body, Request
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
import logging

from app import models, crud
from app.database import get_db
from app.dependencies import get_current_employee, create_access_token
from app.rate_limiter import limiter, login_limit, pin_limit, api_limit, reg_limit

logger = logging.getLogger(__name__)

def _now():
    """Har doim timezone-naive UTC datetime qaytaradi (SQLite bilan mos)"""
    return datetime.now(timezone.utc).replace(tzinfo=None)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


# ─── Subscription check (ichki helper) ───────────────────────
def _check_subscription(store: models.Store) -> None:
    """Obuna muddatini tekshirish. Super admin o'tkazib yuboriladi."""
    if not store or not store.subscription_expires_at:
        return
    if store.subscription_expires_at < _now():
        code = (
            "SUBSCRIPTION_EXPIRED_PENDING"
            if store.payment_status == "pending"
            else "SUBSCRIPTION_EXPIRED"
        )
        msg = (
            "Obuna muddati tugagan. To'lovingiz tekshirilmoqda (24 soat ichida)."
            if store.payment_status == "pending"
            else "Obuna muddati tugagan! Iltimos, to'lovni amalga oshiring."
        )
        raise HTTPException(402, {
            "code":       code,
            "message":    msg,
            "expires_at": store.subscription_expires_at.isoformat(),
        })


def _make_token_response(employee: models.Employee) -> dict:
    """Token + user_info response yasash"""
    store    = employee.store
    role_val = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    token    = create_access_token(employee, employee.store_id)

    return {
        "access_token": token,
        "token_type":   "bearer",
        "user_info": {
            "user_id":        employee.id,
            "store_id":       employee.store_id,
            "full_name":      employee.full_name,
            "username":       employee.username,
            "role":           role_val,
            "store_name":     store.name            if store else "",
            "payment_status": store.payment_status  if store else "active",
            "expires_at":     store.subscription_expires_at.isoformat()
                              if store and store.subscription_expires_at else None,
        },
    }


# ─── Endpoints ────────────────────────────────────────────────

@router.post("/register-store")
@reg_limit
async def register_store(
    request:    Request,
    store_name: str = Body(...),
    full_name:  str = Body(...),
    username:   str = Body(...),
    password:   str = Body(...),
    pin_code:   str = Body(...),
    phone:      str = Body(None),
    db: Session = Depends(get_db),
):
    """Yangi do'kon + admin (30 kunlik trial). Limit: 3/daqiqa."""
    store_name = store_name.strip()
    username   = username.strip().lower()

    if not store_name:
        raise HTTPException(400, "Do'kon nomi bo'sh bo'lishi mumkin emas")
    if len(password) < 4:
        raise HTTPException(400, "Parol kamida 4 belgi bo'lsin")
    if not pin_code.isdigit() or len(pin_code) < 4:
        raise HTTPException(400, "PIN kamida 4 ta raqamdan iborat bo'lsin")

    if db.query(models.Employee).filter(models.Employee.username == username).first():
        raise HTTPException(400, "Bu login band. Boshqa login tanlang.")

    try:
        store = models.Store(
            name                    = store_name,
            phone                   = phone,
            subscription_expires_at = _now() + timedelta(days=30),
            is_active               = True,
            payment_status          = "trial",
        )
        db.add(store); db.flush()

        employee = models.Employee(
            store_id        = store.id,
            full_name       = full_name.strip(),
            username        = username,
            hashed_password = crud.hash_password(password),
            pin_code        = crud.hash_pin(pin_code),
            role            = models.EmployeeRole.admin,
            is_active       = True,
        )
        db.add(employee); db.flush()
        db.commit()
        db.refresh(employee)
        db.refresh(store)
        employee.store = store

        resp = _make_token_response(employee)
        resp["message"] = "Do'kon yaratildi! 30 kunlik sinov davri berildi."
        resp["user_info"]["trial_ends"] = store.subscription_expires_at.isoformat()
        return resp

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"register_store error: {e}", exc_info=True)
        raise HTTPException(500, "Xatolik yuz berdi")


@router.post("/login")
@login_limit
async def login(
    request:  Request,
    username: str = Body(...),
    password: str = Body(...),
    db: Session = Depends(get_db),
):
    # Username'ni tozalash va kichik harfga o'tkazish
    clean_username = username.strip().lower()
    
    # Bazadan qidirish
    employee = db.query(models.Employee).filter(models.Employee.username == clean_username).first()
    
    if not employee:
        logger.warning(f"Login failure: User {clean_username} not found")
        raise HTTPException(401, "Login yoki parol noto'g'ri")

    # Parolni tekshirish (crud.verify_password ishlatamiz)
    if not crud.verify_password(password, employee.hashed_password):
        logger.warning(f"Login failure: Wrong password for {clean_username}")
        raise HTTPException(401, "Login yoki parol noto'g'ri")
    if not employee.is_active:
        raise HTTPException(403, "Hisobingiz bloklangan. Do'kon admini bilan bog'laning.")

    # Obunani tekshirish
    role_val = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    # ✅ Obuna tugagan bo'lsa ham kirishga ruxsat beriladi — aks holda do'kon
    # egasi Sozlamalar sahifasiga kirib to'lov chekini yubora olmaydi.
    # Boshqa barcha API so'rovlari dependencies._check_store_subscription da 402 qaytaradi.
    return _make_token_response(employee)


@router.post("/login-pin")
@pin_limit
async def login_pin(
    request:  Request,
    username: str = Body(...),
    pin_code: str = Body(...),
    db: Session = Depends(get_db),
):
    """
    PIN kod bilan tezkor kirish.
    ✅ Rate limit: 10 ta urinish/daqiqa
    """
    employee = crud.verify_employee_pin(
        db, username.strip().lower(), pin_code
    )
    if not employee:
        raise HTTPException(401, "Username yoki PIN noto'g'ri")

    # ✅ Superadmin faqat parol bilan kiradi (avtomatik PIN 0000 edi — xavfli)
    if (employee.role.value if hasattr(employee.role, "value") else str(employee.role)) == "super_admin":
        raise HTTPException(401, "Username yoki PIN noto'g'ri")

    role_val = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    # ✅ Obuna tugagan bo'lsa ham kirishga ruxsat beriladi — aks holda do'kon
    # egasi Sozlamalar sahifasiga kirib to'lov chekini yubora olmaydi.
    # Boshqa barcha API so'rovlari dependencies._check_store_subscription da 402 qaytaradi.
    return _make_token_response(employee)


@router.get("/me")
async def get_me(
    request:  Request,
    employee: models.Employee = Depends(get_current_employee),
):
    """Joriy foydalanuvchi ma'lumotlari"""
    store     = employee.store
    role_val  = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    days_left = None
    if store and store.subscription_expires_at:
        days_left = (store.subscription_expires_at - _now()).days

    return {
        "id":        employee.id,
        "username":  employee.username,
        "full_name": employee.full_name,
        "role":      role_val,
        "store": {
            "id":             store.id             if store else None,
            "name":           store.name           if store else None,
            "payment_status": store.payment_status if store else "active",
            "expires_at":     store.subscription_expires_at.isoformat()
                              if store and store.subscription_expires_at else None,
            "days_left":      days_left,
        },
    }


@router.post("/change-password")
async def change_password(
    request:      Request,
    old_password: str = Body(...),
    new_password: str = Body(...),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    if not crud.verify_password(old_password, employee.hashed_password):
        raise HTTPException(400, "Eski parol noto'g'ri")
    if len(new_password) < 4:
        raise HTTPException(400, "Yangi parol kamida 4 belgi bo'lsin")
    employee.hashed_password = crud.hash_password(new_password)
    db.commit()
    return {"message": "Parol muvaffaqiyatli o'zgartirildi"}


@router.post("/change-pin")
async def change_pin(
    request:  Request,
    old_pin:  str = Body(...),
    new_pin:  str = Body(...),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    if not crud.verify_pin(old_pin, employee.pin_code):
        raise HTTPException(400, "Eski PIN noto'g'ri")
    if not new_pin.isdigit() or len(new_pin) < 4:
        raise HTTPException(400, "PIN kamida 4 ta raqamdan iborat bo'lsin")
    employee.pin_code = crud.hash_pin(new_pin)
    db.commit()
    return {"message": "PIN kod muvaffaqiyatli o'zgartirildi"}