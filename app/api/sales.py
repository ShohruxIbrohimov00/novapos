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

router = APIRouter(tags=["Sales"])


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
                "is_partially_returned": item.returned_quantity > 0
            })

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
    try:
        sale = crud.create_sale(db, sale_data, employee.id)
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
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Sotuvlar tarixi — filter bilan"""
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
    )
    return [_fmt(s) for s in sales]


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
        .filter(models.Sale.store_id == employee.store_id)

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

