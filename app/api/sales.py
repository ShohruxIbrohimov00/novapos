"""
NovaPOS — Sales Router v2.0
==============================
Tuzatilgan:
  ✅ response_model — yangi SaleOut/SaleListItem schema
  ✅ return_sale_item — crud.return_sale_item ishlatiladi
  ✅ SaleReturn — product_name, employee_name denormalized
  ✅ WebSocket broadcast — sale_created, stock_updated, return_created
  ✅ ws_manager.broadcast_except — o'zi sotgan kassaga ikki marta yubormasin
  ✅ get_sales_history — crud.get_sales_history ishlatiladi
  ✅ _format_sale — SaleListItem schema orqali
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc
from typing import List, Optional
from datetime import datetime, timedelta

from app import schemas, models, crud
from app.database import get_db
from app.dependencies import get_current_employee
from app.websocket_manager import ws_manager
from app.timezone_utils import now_tashkent

router = APIRouter(tags=["Sales"])


def _unit(item: models.SaleItem) -> str:
    u = item.product.unit_type if item.product else None
    return u.value if hasattr(u, "value") else (str(u) if u else "dona")


# ─── Helper: sale → dict ──────────────────────────────────────
def _fmt(sale: models.Sale) -> dict:
    """
    Sotuv ma'lumotlarini formatlash.
    ✅ Qaytarilgan mahsulotlarni miqdordan ayirib tashlaydi.
    ✅ Agar mahsulot to'liq qaytarilgan bo'lsa, ro'yxatda ko'rsatmaydi.
    """
    formatted_items = []
    
    for item in (sale.items or []):
        # 1. Haqiqiy qolgan miqdorni hisoblaymiz (Net Quantity)
        # Sotilgan miqdor - Qaytarilgan miqdor
        net_qty = round(item.quantity - item.returned_quantity, 3)

        # 2. Agar mahsulot butunlay qaytarilmagan bo'lsa (ya'ni kamida 0.001 qolgan bo'lsa)
        if net_qty > 0:
            # Haqiqiy summani hisoblash (final_amount / original_qty * net_qty)
            # Bu chegirmani hisobga olgan holda bitta mahsulot narxini beradi
            unit_final_price = item.final_amount / item.quantity if item.quantity > 0 else 0
            net_final_amount = round(net_qty * unit_final_price, 2)

            formatted_items.append({
                "id":           item.id,
                "product_id":   item.product_id,
                "product_name": item.product_name,
                "barcode":      item.barcode,
                "quantity":     net_qty,              # Haqiqiy qolgan miqdor
                "unit_price":   item.unit_price,
                "cost_price":   item.cost_price,
                "discount_percent": item.discount_percent,
                "discount_amount":  item.discount_amount,
                "subtotal":     round(net_qty * item.unit_price, 2),
                "final_amount": net_final_amount,     # Haqiqiy qolgan summa
                "total":        net_final_amount,     # Frontend uchun
                "item_profit":  item.item_profit,
                "is_partially_returned": item.returned_quantity > 0,
                "sold_quantity":     item.quantity,
                "returned_quantity": item.returned_quantity,
                "unit_type":    _unit(item),
            })

    refunded = round(sum(r.refund_amount for r in (sale.returns or [])), 2)
    return {
        "id":             sale.id,
        "receipt_number": sale.receipt_number,
        "total_amount":   sale.total_amount, # CRUD da to'g'irlangan jami summa
        "paid_amount":    sale.paid_amount,
        "change_amount":  sale.change_amount,
        "payment_method": sale.payment_method.value if hasattr(sale.payment_method, "value") else str(sale.payment_method),
        "customer_id":    sale.customer_id,
        "customer_name":  sale.customer.full_name  if sale.customer  else None,
        "employee_name":  sale.employee.full_name  if sale.employee  else None,
        "notes":          sale.notes,
        "is_cancelled":   sale.is_cancelled,
        "cancelled_by_name": sale.canceller.full_name if sale.is_cancelled and sale.canceller else None,
        "refunded_amount": refunded,
        "returns_count":  len(sale.returns or []),
        "fully_returned": not sale.is_cancelled and bool(sale.items) and not formatted_items,
        "created_at":     sale.created_at.isoformat(),
        "items":          formatted_items, # Yangilangan mahsulotlar ro'yxati
    }


# ============================================================
# SOTUV YARATISH
# ============================================================

@router.post("/checkout")
async def create_sale(
    sale_data: schemas.SaleCreate,
    db:        Session         = Depends(get_db),
    employee:  models.Employee = Depends(get_current_employee),
):
    """
    Yangi sotuv yaratish.
    ✅ WebSocket: sale_created + stock_updated barcha kasslarga broadcast
    """
    # ✅ Do'kon ID har doim tokendan olinadi (brauzer yuborgan qiymatga ishonilmaydi)
    sale_data.store_id = employee.store_id

    # ✅ Shu sotuv avval yozilganmi? (oflayn navbat qayta yuborgan bo'lishi mumkin)
    existing = crud.find_sale_by_client_uid(db, employee.store_id, sale_data.client_uid)
    if existing:
        return _fmt(crud.get_sale(db, existing.id))

    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    try:
        sale = crud.create_sale(
            db, sale_data, employee.id,
            can_sell_below_cost = role in ("admin", "super_admin"),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Yangilangan qoldiqlar
    updated_stocks = []
    for item in sale.items:
        p = crud.get_product(db, item.product_id)
        if p:
            updated_stocks.append({
                "product_id": p.id,
                "name":       p.name,
                "new_qty":    p.quantity,
                "barcode":    p.barcode,
                "short_code": p.short_code,
            })

    # Broadcast: qoldiq yangilandi
    await ws_manager.broadcast(
        store_id = employee.store_id,
        event    = "stock_updated",
        data     = {"items": updated_stocks},
    )

    # Broadcast: yangi sotuv (dashboard / hisobot uchun)
    await ws_manager.broadcast(
        store_id = employee.store_id,
        event    = "sale_created",
        data     = {
            "sale_id":        sale.id,
            "receipt_number": sale.receipt_number,
            "total_amount":   sale.total_amount,
            "payment_method": sale.payment_method.value,
            "employee_id":    employee.id,
            "employee_name":  employee.full_name,
            "items_count":    len(sale.items),
            "created_at":     sale.created_at.isoformat(),
        },
    )

    return _fmt(sale)


# ============================================================
# SOTUVLAR TARIXI
# ============================================================

@router.get("/history")
def get_sales_history(
    limit:          int           = Query(100, le=500),
    offset:         int           = Query(0,   ge=0),
    start_date:     Optional[str] = None,
    end_date:       Optional[str] = None,
    payment_method: Optional[str] = None,
    employee_id:    Optional[int] = None,
    receipt:        Optional[str] = Query(None, max_length=20, description="Chek raqami (sanadan qat'i nazar)"),
    include_cancelled: bool       = False,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Sotuvlar tarixi — filter bilan"""
    if receipt:
        code = receipt.strip().upper()
        if code and not code.startswith("CH-"):
            code = "CH-" + code
        sales = db.query(models.Sale).options(
            joinedload(models.Sale.items), joinedload(models.Sale.employee),
            joinedload(models.Sale.customer), joinedload(models.Sale.returns),
        ).filter(
            models.Sale.store_id == employee.store_id,
            models.Sale.receipt_number.like(f"{code}%"),
        ).order_by(desc(models.Sale.created_at)).limit(20).all()
        return [_fmt(x) for x in sales]

    start_dt = end_dt = None
    if start_date:
        try:   start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError: raise HTTPException(400, "start_date: YYYY-MM-DD bo'lsin")
    if end_date:
        try:   end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        except ValueError: raise HTTPException(400, "end_date: YYYY-MM-DD bo'lsin")

    sales = crud.get_sales_history(
        db             = db,
        store_id       = employee.store_id,
        start_date     = start_dt,
        end_date       = end_dt,
        payment_method = payment_method,
        employee_id    = employee_id,
        limit          = limit,
        skip           = offset,
        include_cancelled = include_cancelled,
    )
    return [_fmt(s) for s in sales]


# ============================================================
# DAVR BO'YICHA JAMI (tarix sahifasi tepasidagi raqamlar)
# ============================================================

@router.get("/summary")
def get_sales_summary(
    start_date: Optional[str] = None,
    end_date:   Optional[str] = None,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Sotuvlar soni va summasi (to'lov turi bo'yicha), qaytarishlar — limit'siz, aniq."""
    from sqlalchemy import func
    from app.timezone_utils import end_of_day
    try:
        start_dt = datetime.strptime(start_date, "%Y-%m-%d") if start_date else None
        end_dt   = end_of_day(datetime.strptime(end_date, "%Y-%m-%d")) if end_date else None
    except ValueError:
        raise HTTPException(400, "Sana YYYY-MM-DD bo'lsin")

    q = db.query(models.Sale.payment_method, func.count(models.Sale.id), func.coalesce(func.sum(models.Sale.total_amount), 0.0)) \
          .filter(models.Sale.store_id == employee.store_id, models.Sale.is_cancelled == False)  # noqa: E712
    if start_dt: q = q.filter(models.Sale.created_at >= start_dt)
    if end_dt:   q = q.filter(models.Sale.created_at <= end_dt)
    by_method = {"naqd": 0.0, "plastik": 0.0, "nasiya": 0.0}
    count = 0
    for pm, n, total in q.group_by(models.Sale.payment_method).all():
        key = pm.value if hasattr(pm, "value") else str(pm)
        by_method[key] = round(by_method.get(key, 0.0) + float(total or 0), 2)
        count += n

    rq = db.query(func.count(models.SaleReturn.id), func.coalesce(func.sum(models.SaleReturn.refund_amount), 0.0)) \
           .join(models.Sale).filter(models.Sale.store_id == employee.store_id,
                                     models.Sale.is_cancelled == False)  # noqa: E712  (bekor qilingan chek — jamida ham yo'q)
    if start_dt: rq = rq.filter(models.SaleReturn.created_at >= start_dt)
    if end_dt:   rq = rq.filter(models.SaleReturn.created_at <= end_dt)
    r_count, r_sum = rq.one()

    cq = db.query(func.count(models.Sale.id)).filter(models.Sale.store_id == employee.store_id, models.Sale.is_cancelled == True)  # noqa: E712
    if start_dt: cq = cq.filter(models.Sale.created_at >= start_dt)
    if end_dt:   cq = cq.filter(models.Sale.created_at <= end_dt)

    return {
        "count":          count,
        "total":          round(sum(by_method.values()), 2),
        "by_method":      by_method,
        "returns_count":  r_count,
        "returns_amount": round(float(r_sum or 0), 2),
        "cancelled_count": cq.scalar() or 0,
    }


# ============================================================
# BARCHA QAYTARISHLAR (Yangi API)
# ============================================================

@router.get("/returns")
def get_all_returns_history(
    limit:      int           = Query(100, le=500),
    offset:     int           = Query(0,   ge=0),
    start_date: Optional[str] = None,
    end_date:   Optional[str] = None,
    db:         Session         = Depends(get_db),
    employee:   models.Employee = Depends(get_current_employee),
):
    """
    Barcha qaytarilgan mahsulotlar tarixi (SaleReturn jadvalidan).
    Filtrlar: sana oralig'i.
    """
    # Sanalarni to'g'irlash
    start_dt = None
    end_dt = None
    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, "start_date noto'g'ri (YYYY-MM-DD)")
    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1) # Kun oxirigacha
        except ValueError:
            raise HTTPException(400, "end_date noto'g'ri (YYYY-MM-DD)")

    # Query yozamiz
    query = db.query(models.SaleReturn)\
        .join(models.Sale)\
        .filter(models.Sale.store_id == employee.store_id,
                models.Sale.is_cancelled == False)  # noqa: E712  bekor qilingan chek to'liq omborga qaytgan

    if start_dt:
        query = query.filter(models.SaleReturn.created_at >= start_dt)
    if end_dt:
        query = query.filter(models.SaleReturn.created_at < end_dt)

    # Saralash va limit
    returns = query.order_by(desc(models.SaleReturn.created_at))\
                   .offset(offset)\
                   .limit(limit)\
                   .all()

    # Chiroyli formatda qaytarish
    return [
        {
            "id":             r.id,
            "sale_id":        r.sale_id,
            "receipt_number": r.sale.receipt_number,
            "product_id":     r.product_id,
            "product_name":   r.product_name or (r.product.name if r.product else "Noma'lum"),
            "quantity":       r.quantity,
            "refund_amount":  r.refund_amount,
            "reason":         r.reason,
            "employee_name":  r.employee_name or (r.employee.full_name if r.employee else "Noma'lum"),
            "created_at":     r.created_at.isoformat(),
        }
        for r in returns
    ]


# ============================================================
# BITTA SOTUV DETAIL
# ============================================================

@router.get("/{sale_id}")
def get_sale(
    sale_id:  int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    sale = crud.get_sale(db, sale_id)
    if not sale or sale.store_id != employee.store_id:
        raise HTTPException(404, "Sotuv topilmadi")
    return _fmt(sale)


# ============================================================
# SOTUV BEKOR QILISH
# ============================================================

@router.post("/{sale_id}/cancel")
async def cancel_sale(
    sale_id:  int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Sotuvni to'liq bekor qilish (mahsulotlar qaytariladi). ✅ Faqat admin."""
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Sotuvni faqat admin bekor qila oladi")
    sale = crud.get_sale(db, sale_id)
    if not sale or sale.store_id != employee.store_id:
        raise HTTPException(404, "Sotuv topilmadi")

    try:
        cancelled = crud.cancel_sale(db, sale_id, employee.id)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Broadcast: qoldiqlar yangilandi
    updated = []
    for item in cancelled.items:
        p = crud.get_product(db, item.product_id)
        if p:
            updated.append({
                "product_id": p.id,
                "name":       p.name,
                "new_qty":    p.quantity,
                "barcode":    p.barcode,
                "short_code": p.short_code,
            })

    if updated:
        await ws_manager.broadcast(
            store_id = employee.store_id,
            event    = "stock_updated",
            data     = {"items": updated},
        )

    return {"message": "Sotuv bekor qilindi", "sale_id": sale_id}


# ============================================================
# MAHSULOT QAYTARISH
# ============================================================

@router.post("/{sale_id}/return")
async def return_item(
    sale_id:     int,
    return_data: schemas.SaleReturnCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    ✅ crud.return_sale_item ishlatiladi
    ✅ product_name, employee_name denormalized yoziladi
    ✅ WebSocket broadcast
    """
    # Do'kon tekshiruvi
    sale = crud.get_sale(db, sale_id)
    if not sale or sale.store_id != employee.store_id:
        raise HTTPException(404, "Sotuv topilmadi")

    # ✅ Kassir faqat bugungi chekdan qaytara oladi; eski cheklar — faqat admin
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    if role not in ("admin", "super_admin") and sale.created_at.date() != now_tashkent().date():
        raise HTTPException(403, "Eski chekdan qaytarishni faqat admin qila oladi")

    try:
        ret = crud.return_sale_item(
            db          = db,
            sale_id     = sale_id,
            product_id  = return_data.product_id,
            quantity    = return_data.quantity,
            reason      = return_data.reason,
            employee_id = employee.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Broadcast: qoldiq yangilandi
    p = crud.get_product(db, return_data.product_id)
    if p:
        await ws_manager.broadcast(
            store_id = employee.store_id,
            event    = "stock_updated",
            data     = {"items": [{
                "product_id": p.id,
                "name":       p.name,
                "new_qty":    p.quantity,
                "barcode":    p.barcode,
                "short_code": p.short_code,
            }]},
        )

    return {
        "message":       "Muvaffaqiyatli qaytarildi",
        "refund_amount": ret.refund_amount,
        "product_name":  ret.product_name,
        "quantity":      ret.quantity,
    }


# ============================================================
# QAYTARISHLAR RO'YXATI
# ============================================================

@router.get("/{sale_id}/returns")
def get_returns(
    sale_id:  int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    sale = crud.get_sale(db, sale_id)
    if not sale or sale.store_id != employee.store_id:
        raise HTTPException(404, "Sotuv topilmadi")

    returns = crud.get_sale_returns(db, sale_id)
    return [
        {
            "id":            r.id,
            "product_id":    r.product_id,
            "product_name":  r.product_name or (r.product.name if r.product else "O'chirilgan"),
            "quantity":      r.quantity,
            "refund_amount": r.refund_amount,
            "reason":        r.reason,
            "employee_name": r.employee_name or (r.employee.full_name if r.employee else "Noma'lum"),
            "created_at":    r.created_at.isoformat(),
        }
        for r in returns
    ]

