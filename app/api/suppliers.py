"""
NovaPOS — Suppliers Router v2.0
=================================
Tuzatilgan:
  ✅ get_current_employee — dependencies.py dan import
  ✅ create_supplier — crud.create_supplier
  ✅ pay_supplier — crud.create_supplier_payment (debt to'g'ri yangilanadi)
  ✅ receive_goods — SupplierPayment [KIRIM] emas, SupplyBatch yozish kerak emas
     (bu products/supply_batches orqali qilinadi — bu faqat manual qarz qayd)
  ✅ get_supplier_history — SupplyBatch + SupplierPayment birlashtirilgan
  ✅ delete_supplier — crud orqali
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field

from app import models, crud, schemas
from app.database import get_db
from app.dependencies import get_current_employee

router = APIRouter(tags=["Suppliers"])


# ─── Input schemas ────────────────────────────────────────────
class ReceiveGoodsInput(BaseModel):
    supplier_id: int
    amount:      float = Field(gt=0)
    notes:       Optional[str] = None


class SupplierPatchInput(BaseModel):
    name:    Optional[str] = None
    phone:   Optional[str] = None
    address: Optional[str] = None
    notes:   Optional[str] = None


# ─── Helper ───────────────────────────────────────────────────
def _fmt(s: models.Supplier) -> dict:
    return {
        "id":             s.id,
        "store_id":       s.store_id,
        "name":           s.name,
        "phone":          s.phone,
        "address":        s.address,
        "notes":          s.notes,
        "current_debt":   round(s.current_debt   or 0, 2),
        "total_supplied": round(s.total_supplied or 0, 2),
        "total_paid":     round(s.total_paid     or 0, 2),
        "is_active":      s.is_active,
        "created_at":     s.created_at.isoformat() if s.created_at else None,
    }


def _get_or_404(db: Session, supplier_id: int, store_id: int) -> models.Supplier:
    s = crud.get_supplier(db, supplier_id)
    if not s or s.store_id != store_id:
        raise HTTPException(404, "Ta'minotchi topilmadi")
    return s


# ─── Static routes (/{id} dan oldin) ─────────────────────────

@router.post("/payment")
def pay_supplier(
    data:     schemas.SupplierPaymentCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Ta'minotchiga to'lov — qarzni kamaytiradi"""
    _get_or_404(db, data.supplier_id, employee.store_id)
    try:
        crud.create_supplier_payment(db, data, employee.id)
    except ValueError as e:
        raise HTTPException(400, str(e))

    s = crud.get_supplier(db, data.supplier_id)
    return {"status": "success", "message": "To'lov saqlandi", "new_debt": s.current_debt}


@router.post("/receive-goods")
def receive_goods(
    data:     ReceiveGoodsInput,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Ta'minotchidan tovar qabul — qarzni OSHIRADI (manual qayd).
    Mahsulot qoldig'ini o'zgartirmaydi — buning uchun /products/supply_batches ishlatiladi.
    """
    s = _get_or_404(db, data.supplier_id, employee.store_id)

    # SupplierPayment ga [KIRIM] sifatida yozamiz
    payment = models.SupplierPayment(
        supplier_id    = data.supplier_id,
        amount         = data.amount,
        payment_method = models.PaymentMethod.naqd,
        payment_date   = datetime.now(timezone.utc).replace(tzinfo=None),
        paid_by        = employee.id,
        comment        = f"[KIRIM] {data.notes or 'Tovar qabul qilindi'}".strip(),
    )
    db.add(payment)
    s.current_debt   = round(s.current_debt   + data.amount, 2)
    s.total_supplied = round(s.total_supplied + data.amount, 2)
    db.commit()

    return {"status": "success", "message": "Kirim qayd etildi", "new_debt": s.current_debt}


# ─── CRUD ─────────────────────────────────────────────────────

@router.get("/")
def get_suppliers(
    search:   Optional[str] = None,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    suppliers = crud.get_store_suppliers(db, employee.store_id)
    if search:
        s = search.lower()
        suppliers = [
            x for x in suppliers
            if s in (x.name or "").lower() or s in (x.phone or "").lower()
        ]
    return [_fmt(x) for x in suppliers]


@router.post("/", status_code=201)
def create_supplier(
    data:     schemas.SupplierCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    # Nom bandligi
    exist = db.query(models.Supplier).filter(
        models.Supplier.store_id  == employee.store_id,
        models.Supplier.name      == data.name,
        models.Supplier.is_active == True,
    ).first()
    if exist:
        raise HTTPException(400, f"'{data.name}' nomli ta'minotchi allaqachon mavjud")

    return _fmt(crud.create_supplier(db, data, employee.store_id))


@router.get("/{supplier_id}")
def get_supplier(
    supplier_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    return _fmt(_get_or_404(db, supplier_id, employee.store_id))


@router.patch("/{supplier_id}")
def update_supplier(
    supplier_id: int,
    data:        SupplierPatchInput,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    s = _get_or_404(db, supplier_id, employee.store_id)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit(); db.refresh(s)
    return _fmt(s)


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Faqat admin o'chira oladi")

    s = _get_or_404(db, supplier_id, employee.store_id)
    if (s.current_debt or 0) > 0.01:
        raise HTTPException(400, f"Qarzi bor: {s.current_debt:,.0f} so'm. Avval to'lang.")

    s.is_active = False
    db.commit()
    return {"status": "success", "message": f"'{s.name}' o'chirildi"}


@router.get("/{supplier_id}/history")
def get_supplier_history(
    supplier_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Ta'minotchi tarixi — SupplierPayment + SupplyBatch birlashtirilgan
    type: 'payment' | 'supply'
    """
    _get_or_404(db, supplier_id, employee.store_id)
    history = []

    # 1. SupplierPayment (to'lovlar + manual kirimlar)
    payments = db.query(models.SupplierPayment).filter(
        models.SupplierPayment.supplier_id == supplier_id
    ).order_by(desc(models.SupplierPayment.payment_date)).all()

    for p in payments:
        comment   = p.comment or ""
        is_supply = comment.startswith("[KIRIM]")
        method    = p.payment_method.value if hasattr(p.payment_method, "value") else "naqd"
        history.append({
            "id":     p.id,
            "type":   "supply" if is_supply else "payment",
            "amount": p.amount,
            "date":   p.payment_date.isoformat() if p.payment_date else datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
            "note":   comment.replace("[KIRIM]", "").strip() or ("Tovar kirim" if is_supply else "To'lov"),
            "method": method,
        })

    # 2. SupplyBatch (mahsulot kirimi — products/supply_batches orqali)
    batches = db.query(models.SupplyBatch).filter(
        models.SupplyBatch.supplier_id == supplier_id
    ).order_by(desc(models.SupplyBatch.created_at)).all()

    for b in batches:
        price_str = int(b.supply_price) if b.supply_price and b.supply_price % 1 == 0 else b.supply_price
        history.append({
            "id":       b.id,
            "type":     "supply",
            "amount":   b.total_cost,
            "quantity": b.quantity_received,
            "date":     b.created_at.isoformat() if b.created_at else datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
            "note":     f"{b.quantity_received} dona × {price_str} so'm",
            "method":   "",
        })

    history.sort(key=lambda x: x["date"], reverse=True)
    return history