"""
NovaPOS — Employees Router v2.0
==================================
Tuzatilgan:
  ✅ get_current_employee — dependencies.py dan import (auth.py emas)
  ✅ create_employee — crud.create_employee (hash_password, hash_pin ichida)
  ✅ update_employee — schemas.EmployeeUpdate + crud.update_employee
  ✅ reset_password — Pydantic input (dict emas)
  ✅ reset_pin — Pydantic input (dict emas)
  ✅ get_online — ws_manager.get_online_employees
  ✅ last_seen_at — _fmt da ko'rsatiladi
  ✅ stats — float() konversiya to'g'ri
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

from app import models, crud, schemas
from app.database import get_db
from app.dependencies import get_current_employee
from app.websocket_manager import ws_manager

router = APIRouter(tags=["Employees"])


# ─── Input schemas ────────────────────────────────────────────
class ResetPasswordInput(BaseModel):
    new_password: str = Field(..., min_length=4)


class ResetPinInput(BaseModel):
    new_pin: str = Field(..., min_length=4, max_length=8)


class EmployeePatchInput(BaseModel):
    full_name: Optional[str] = None
    username:  Optional[str] = None
    role:      Optional[str] = None


# ─── Helpers ──────────────────────────────────────────────────
def _require_admin(employee: models.Employee) -> None:
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Faqat admin bu amalni bajarishi mumkin")


def _fmt(e: models.Employee) -> dict:
    return {
        "id":           e.id,
        "store_id":     e.store_id,
        "full_name":    e.full_name,
        "username":     e.username,
        "role":         e.role.value if hasattr(e.role, "value") else str(e.role),
        "is_active":    e.is_active,
        "created_at":   e.created_at.isoformat()  if e.created_at   else None,
        "last_seen_at": e.last_seen_at.isoformat() if hasattr(e, "last_seen_at") and e.last_seen_at else None,
    }


def _get_emp_in_store(db: Session, emp_id: int, store_id: int) -> models.Employee:
    emp = db.query(models.Employee).filter(
        models.Employee.id       == emp_id,
        models.Employee.store_id == store_id,
    ).first()
    if not emp:
        raise HTTPException(404, "Xodim topilmadi")
    return emp


# ROLE MAP — bir joyda
_ROLE_MAP = {
    "admin":    models.EmployeeRole.admin,
    "sotuvchi": models.EmployeeRole.cashier,
}


# ─── Endpoints ────────────────────────────────────────────────

@router.get("/")
def get_employees(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Do'kondagi barcha xodimlar ro'yxati (faqat admin)"""
    _require_admin(employee)
    emps = db.query(models.Employee).filter(
        models.Employee.store_id == employee.store_id
    ).order_by(models.Employee.created_at).all()
    return [_fmt(e) for e in emps]


@router.get("/online")
def get_online_employees(
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Hozir kassada kim ulangan (WebSocket orqali).
    ws_manager.get_online_employees() — real-time.
    """
    _require_admin(employee)
    return ws_manager.get_online_employees(employee.store_id)


@router.post("/", status_code=201)
def create_employee(
    data:     schemas.EmployeeCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Yangi xodim qo'shish.
    Limit: 4 ta xodim (1 admin + 3 sotuvchi).
    ✅ crud.create_employee — hash_password, hash_pin ichida hal bo'ladi.
    """
    _require_admin(employee)

    role_str = data.role.value if hasattr(data.role, "value") else str(data.role)

    if role_str == "super_admin":
        raise HTTPException(403, "Super admin rolini bu yerdan yaratib bo'lmaydi")

    if role_str not in _ROLE_MAP:
        raise HTTPException(400, f"Noto'g'ri rol: '{role_str}'. Faqat 'admin' yoki 'sotuvchi'")

    # Umumiy limit
    total = db.query(models.Employee).filter(
        models.Employee.store_id  == employee.store_id,
        models.Employee.is_active == True,
    ).count()
    if total >= 4:
        raise HTTPException(400, "Limit to'ldi: maks 4 ta xodim (1 Admin + 3 Sotuvchi)")

    # Sotuvchi limiti
    if role_str == "sotuvchi":
        cashier_cnt = db.query(models.Employee).filter(
            models.Employee.store_id  == employee.store_id,
            models.Employee.role      == models.EmployeeRole.cashier,
            models.Employee.is_active == True,
        ).count()
        if cashier_cnt >= 3:
            raise HTTPException(400, "Maksimal 3 ta sotuvchi bo'lishi mumkin")

    # Admin limiti
    if role_str == "admin":
        admin_cnt = db.query(models.Employee).filter(
            models.Employee.store_id  == employee.store_id,
            models.Employee.role      == models.EmployeeRole.admin,
            models.Employee.is_active == True,
        ).count()
        if admin_cnt >= 1:
            raise HTTPException(400, "Do'konda faqat 1 ta admin bo'lishi mumkin")

    # Username unikalligi
    username = data.username.strip().lower()
    if db.query(models.Employee).filter(models.Employee.username == username).first():
        raise HTTPException(400, f"'{username}' username allaqachon band")

    if not data.pin_code.isdigit() or len(data.pin_code) < 4:
        raise HTTPException(400, "PIN kamida 4 ta raqamdan iborat bo'lsin")

    if len(data.password) < 4:
        raise HTTPException(400, "Parol kamida 4 belgi bo'lsin")

    # Ma'lumotlarni to'g'irlab crud ga uzatish
    data.username  = username
    data.role      = _ROLE_MAP[role_str]
    data.store_id  = employee.store_id

    return _fmt(crud.create_employee(db, data))


@router.get("/{employee_id}")
def get_employee(
    employee_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Bitta xodim ma'lumoti"""
    _require_admin(employee)
    return _fmt(_get_emp_in_store(db, employee_id, employee.store_id))


@router.patch("/{employee_id}")
def update_employee(
    employee_id: int,
    data:        EmployeePatchInput,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Xodim ism, username, rolini yangilash.
    ✅ Pydantic input (dict emas)
    ✅ O'z rolini o'zgartira olmaydi
    """
    _require_admin(employee)
    target = _get_emp_in_store(db, employee_id, employee.store_id)

    if data.full_name:
        target.full_name = data.full_name.strip()

    if data.username:
        new_u = data.username.strip().lower()
        dup   = db.query(models.Employee).filter(
            models.Employee.username == new_u,
            models.Employee.id       != employee_id,
        ).first()
        if dup:
            raise HTTPException(400, f"'{new_u}' username allaqachon band")
        target.username = new_u

    if data.role is not None:
        if employee_id == employee.id:
            raise HTTPException(400, "O'z rolingizni o'zgartira olmaysiz")
        if data.role not in _ROLE_MAP:
            raise HTTPException(400, f"Noto'g'ri rol: '{data.role}'")
        target.role = _ROLE_MAP[data.role]

    db.commit(); db.refresh(target)
    return _fmt(target)


@router.post("/{employee_id}/reset-password")
def reset_password(
    employee_id: int,
    data:        ResetPasswordInput,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Admin xodimning parolini yangilaydi"""
    _require_admin(employee)
    target = _get_emp_in_store(db, employee_id, employee.store_id)
    target.hashed_password = crud.hash_password(data.new_password)
    db.commit()
    return {"status": "success", "message": "Parol yangilandi"}


@router.post("/{employee_id}/reset-pin")
def reset_pin(
    employee_id: int,
    data:        ResetPinInput,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Admin xodimning PINini yangilaydi.
    ✅ crud.hash_pin — SHA-256 (bcrypt emas, tezkor)
    """
    _require_admin(employee)
    if not data.new_pin.isdigit():
        raise HTTPException(400, "PIN faqat raqamlardan iborat bo'lsin")
    target = _get_emp_in_store(db, employee_id, employee.store_id)
    target.pin_code = crud.hash_pin(data.new_pin)
    db.commit()
    return {"status": "success", "message": "PIN yangilandi"}


@router.patch("/{employee_id}/toggle")
def toggle_employee(
    employee_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Xodimni faollashtirish / bloklash"""
    _require_admin(employee)

    if employee_id == employee.id:
        raise HTTPException(400, "O'zingizni bloklashingiz mumkin emas")

    target = _get_emp_in_store(db, employee_id, employee.store_id)

    # Faollashtirmoqchi bo'lsa — obunani tekshirish
    if not target.is_active:
        store = db.query(models.Store).filter(
            models.Store.id == employee.store_id
        ).first()
        if store and store.subscription_expires_at and store.subscription_expires_at < datetime.utcnow():
            raise HTTPException(
                400,
                "Obuna muddati tugagan. Avval obunani yangilang, so'ng xodimlarni faollashtiring."
            )
        # ✅ Faollashtirishda ham limit (avval bloklab-ochish orqali 3 tadan ko'p kassir qilish mumkin edi)
        active = db.query(models.Employee).filter(
            models.Employee.store_id == employee.store_id, models.Employee.is_active == True,  # noqa: E712
        )
        same_role = active.filter(models.Employee.role == target.role).count()
        if target.role == models.EmployeeRole.cashier and same_role >= 3:
            raise HTTPException(400, "Maksimal 3 ta faol sotuvchi bo'lishi mumkin. Avval boshqasini bloklang.")
        if target.role == models.EmployeeRole.admin and same_role >= 1:
            raise HTTPException(400, "Do'konda faqat 1 ta faol admin bo'lishi mumkin")
        if active.count() >= 4:
            raise HTTPException(400, "Limit to'ldi: maks 4 ta faol xodim (1 Admin + 3 Sotuvchi)")

    target.is_active = not target.is_active
    db.commit(); db.refresh(target)

    return {
        "status":    "success",
        "is_active": target.is_active,
        "message":   f"{'Faollashtirildi' if target.is_active else 'Bloklandi'}: {target.full_name}",
    }


@router.delete("/{employee_id}")
def delete_employee(
    employee_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Xodimni o'chirish (soft delete — tarix saqlanadi)"""
    _require_admin(employee)

    if employee_id == employee.id:
        raise HTTPException(400, "O'zingizni o'chira olmaysiz")

    target = _get_emp_in_store(db, employee_id, employee.store_id)
    target.is_active = False
    db.commit()
    return {
        "status":  "success",
        "message": f"'{target.full_name}' bloklandi. Tizimga kira olmaydi.",
    }


@router.get("/{employee_id}/stats")
def get_employee_stats(
    employee_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Xodimning savdo statistikasi"""
    _require_admin(employee)
    target = _get_emp_in_store(db, employee_id, employee.store_id)

    result = db.query(
        func.count(models.Sale.id).label("total_sales"),
        func.coalesce(func.sum(models.Sale.total_amount), 0).label("total_amount"),
        func.coalesce(func.sum(models.Sale.total_profit), 0).label("total_profit"),
    ).filter(
        models.Sale.employee_id  == employee_id,
        models.Sale.is_cancelled == False,
    ).first()

    return {
        **_fmt(target),
        "total_sales":  result.total_sales              if result else 0,
        "total_amount": float(result.total_amount or 0) if result else 0.0,
        "total_profit": float(result.total_profit or 0) if result else 0.0,
    }