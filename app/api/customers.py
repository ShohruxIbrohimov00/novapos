"""
NovaPOS — Customers Router v2.0
=================================
Tuzatilgan:
  ✅ get_current_employee — dependencies.py dan import (auth.py emas)
  ✅ get_customers — crud.search_customers, qarzga ko'ra sort
  ✅ get_customer_history — crud.get_customer_history (barcha sotuvlar)
  ✅ N+1 yo'q — item.product_name denormalized
  ✅ pay_debt — crud.create_debt_payment
  ✅ update_customer — yangi endpoint
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app import models, crud, schemas
from app.database import get_db
from app.dependencies import get_current_employee

router = APIRouter(tags=["Customers"])


# ─── Helper ───────────────────────────────────────────────────
def _fmt(c: models.Customer) -> dict:
    return {
        "id":                 c.id,
        "store_id":           c.store_id,
        "full_name":          c.full_name,
        "phone":              c.phone,
        "address":            c.address,
        "notes":              c.notes,
        "current_debt":       round(c.current_debt     or 0, 2),
        "total_debt_given":   round(c.total_debt_given or 0, 2),
        "total_debt_paid":    round(c.total_debt_paid  or 0, 2),
        "is_active":          c.is_active,
        "created_at":         c.created_at.isoformat()         if c.created_at         else None,
        "last_purchase_date": c.last_purchase_date.isoformat() if c.last_purchase_date else None,
    }


def _check_store(c: models.Customer, store_id: int) -> None:
    if not c or c.store_id != store_id:
        raise HTTPException(404, "Mijoz topilmadi")


# ─── Endpoints ────────────────────────────────────────────────

@router.get("/")
def get_customers(
    search:   Optional[str] = None,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Barcha mijozlar — qarzga ko'ra saralangan.
    ?search=Ali  →  ism yoki telefon bo'yicha filter
    """
    customers = crud.search_customers(db, employee.store_id, search or "")
    customers.sort(key=lambda c: c.current_debt or 0, reverse=True)
    return [_fmt(c) for c in customers]


@router.post("/", status_code=201)
def create_customer(
    data:     schemas.CustomerCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Yangi mijoz qo'shish"""
    return _fmt(crud.create_customer(db, data, employee.store_id))


@router.get("/search")
def search_customers(
    q:        str             = Query(..., min_length=1),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Qidiruv — ism yoki telefon"""
    return [_fmt(c) for c in crud.search_customers(db, employee.store_id, q)]


@router.get("/debtors")
def get_debtors(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Faqat qarzdor mijozlar — eng katta qarzdan boshlab"""
    return [_fmt(c) for c in crud.get_customers_with_debt(db, employee.store_id)]


@router.post("/payment")
def pay_debt(
    payment:  schemas.DebtPaymentCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Mijoz qarzini to'lash.
    ✅ crud.create_debt_payment — qarz to'g'ri kamaytiriladi
    """
    c = crud.get_customer(db, payment.customer_id)
    _check_store(c, employee.store_id)

    if payment.amount <= 0:
        raise HTTPException(400, "Summa 0 dan katta bo'lishi kerak")

    try:
        crud.create_debt_payment(db, payment, employee.id)
    except ValueError as e:
        raise HTTPException(400, str(e))

    db.refresh(c)
    return _fmt(c)


@router.get("/{customer_id}")
def get_customer(
    customer_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    c = crud.get_customer(db, customer_id)
    _check_store(c, employee.store_id)
    return _fmt(c)


@router.patch("/{customer_id}")
def update_customer(
    customer_id: int,
    data:        schemas.CustomerUpdate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    c = crud.get_customer(db, customer_id)
    _check_store(c, employee.store_id)
    updated = crud.update_customer(db, customer_id, data)
    return _fmt(updated)


@router.get("/{customer_id}/history")
def get_customer_history(
    customer_id: int,
    limit:       int          = Query(50, le=200),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Mijoz tarixi — barcha sotuvlar + qarz to'lovlari.
    ✅ crud.get_customer_history — birlashtirilgan, sanaga ko'ra tartib.
    ✅ N+1 yo'q — item.product_name (denormalized) ishlatiladi.
    """
    c = crud.get_customer(db, customer_id)
    _check_store(c, employee.store_id)
    return crud.get_customer_history(db, customer_id, limit)


@router.delete("/{customer_id}")
def delete_customer(
    customer_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Soft delete — qarz bo'lsa ruxsat yo'q"""
    c = crud.get_customer(db, customer_id)
    _check_store(c, employee.store_id)

    if abs(c.current_debt or 0) > 0.01:
        raise HTTPException(400, f"Qarzi bor: {c.current_debt:,.0f} so'm. Avval qarzingizni oling.")

    c.is_active = False
    db.commit()
    return {"message": f"'{c.full_name}' o'chirildi"}