"""
NovaPOS — Reports Router v2.0
================================
Tuzatilgan:
  ✅ get_current_employee — dependencies.py dan import
  ✅ create_expense — crud.create_expense (created_by saqlanadi)
  ✅ get_dashboard — payment_method faqat enum qiymatlari (karta/click yo'q)
  ✅ get_time_range — helper funksiya saqland
  ✅ top_products — qaytarilganlar hisobga olinadi (eski kod yaxshi edi)
  ✅ get_expenses — crud.get_store_expenses
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import Optional
from datetime import datetime, timezone, date, time, timedelta
from app.websocket_manager import ws_manager, WSEvent
from app import models, crud, schemas
from app.database import get_db
from app.dependencies import get_current_employee
from app.timezone_utils import now_tashkent

router = APIRouter(tags=["Reports"])


# ─── Helper ───────────────────────────────────────────────────
def _time_range(
    period:     str,
    start_date: Optional[date] = None,
    end_date:   Optional[date] = None,
) -> tuple[datetime, datetime]:
    # UTC emas, aynan Toshkent vaqtini olamiz
    tz_now = now_tashkent() 
    
    if start_date:
        actual_end = end_date if end_date else start_date
        # Sanalarni datetime ga o'girishda vaqt zonasi bilan o'giramiz
        return (
            datetime.combine(start_date, time.min).replace(tzinfo=None), # SQLite uchun
            datetime.combine(actual_end, time.max).replace(tzinfo=None),
        )

    if period == "week":
        return tz_now - timedelta(days=7), tz_now
    
    if period == "month":
        start = tz_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        return start, tz_now
        
    # DEFAULT: TODAY (Bugun 00:00 dan hozirgacha)
    # Toshkent vaqti bo'yicha bugunni boshlanishini topamiz
    today_start = tz_now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Muhim: Agar bazada vaqtlar UTC bo'lsa, solishtirishda muammo bo'lmasligi uchun
    # tzinfo'ni olib tashlaymiz (SQLite bilan ishlashda bu xavfsizroq)
    return today_start.replace(tzinfo=None), tz_now.replace(tzinfo=None)

# ─── Endpoints ────────────────────────────────────────────────

@router.get("/dashboard")
def get_dashboard(
    period:     str           = "today",
    start_date: Optional[date]= Query(None),
    end_date:   Optional[date]= Query(None),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    start_dt, end_dt = _time_range(period, start_date, end_date)
    store_id = employee.store_id

    # Asosiy savdo ko'rsatkichlari
    main = db.query(
        func.coalesce(func.sum(models.Sale.total_amount), 0).label("total_sales"),
        func.coalesce(func.sum(models.Sale.total_profit), 0).label("total_profit"),
        func.count(models.Sale.id).label("sales_count"),
    ).filter(
        models.Sale.store_id     == store_id,
        models.Sale.created_at   >= start_dt,
        models.Sale.created_at   <= end_dt,
        models.Sale.is_cancelled == False,
    ).first()

    # Qaytarilgan summa
    returns_sum = db.query(
        func.coalesce(func.sum(models.SaleReturn.refund_amount), 0)
    ).join(models.Sale).filter(
        models.Sale.store_id         == store_id,
        models.SaleReturn.created_at >= start_dt,
        models.SaleReturn.created_at <= end_dt,
    ).scalar() or 0.0

    # ✅ To'lov usullari — HAQIQATDA tushgan pul:
    #   naqd    = naqd sotuvlar + nasiya sotuvda oldindan berilgan pul + naqd qarz to'lovlari
    #   plastik = karta sotuvlar + karta orqali qarz to'lovlari
    #   nasiya  = shu davrda qarzga berilgan (to'lanmagan) qism
    period_sales = db.query(
        models.Sale.payment_method, models.Sale.total_amount, models.Sale.paid_amount,
    ).filter(
        models.Sale.store_id     == store_id,
        models.Sale.created_at   >= start_dt,
        models.Sale.created_at   <= end_dt,
        models.Sale.is_cancelled == False,
    ).all()

    breakdown = {"naqd": 0.0, "plastik": 0.0, "nasiya": 0.0}
    for pm, total, paid in period_sales:
        key   = pm.value if hasattr(pm, "value") else str(pm)
        total = float(total or 0)
        if key == "nasiya":
            upfront = min(max(float(paid or 0), 0.0), total)
            breakdown["naqd"]   += upfront
            breakdown["nasiya"] += total - upfront
        elif key in breakdown:
            breakdown[key] += total

    debt_payments = db.query(
        models.DebtPayment.payment_method,
        func.coalesce(func.sum(models.DebtPayment.amount), 0),
    ).join(models.Customer, models.Customer.id == models.DebtPayment.customer_id).filter(
        models.Customer.store_id          == store_id,
        models.DebtPayment.payment_date   >= start_dt,
        models.DebtPayment.payment_date   <= end_dt,
    ).group_by(models.DebtPayment.payment_method).all()
    for pm, amount in debt_payments:
        key = pm.value if hasattr(pm, "value") else str(pm)
        if key in ("naqd", "plastik"):
            breakdown[key] += float(amount or 0)

    # Ombor qiymati
    inv = db.query(
        func.coalesce(func.sum(models.Product.quantity * models.Product.price_in),  0).label("cost"),
        func.coalesce(func.sum(models.Product.quantity * models.Product.price_out), 0).label("sales_val"),
    ).filter(
        models.Product.store_id   == store_id,
        models.Product.is_deleted == False,
    ).first()

    # Chiqimlar
    expenses_sum = db.query(
        func.coalesce(func.sum(models.Expense.amount), 0)
    ).filter(
        models.Expense.store_id   == store_id,
        models.Expense.created_at >= start_dt,
        models.Expense.created_at <= end_dt,
    ).scalar() or 0.0

    # Ta'minotchi qarzi
    supplier_debt = db.query(
        func.coalesce(func.sum(models.Supplier.current_debt), 0)
    ).filter(models.Supplier.store_id == store_id).scalar() or 0.0

    # Mijoz qarzi
    customer_debt = db.query(
        func.coalesce(func.sum(models.Customer.current_debt), 0)
    ).filter(
        models.Customer.store_id  == store_id,
        models.Customer.is_active == True,
    ).scalar() or 0.0

    # ✅ Qaytarish sotuv summasidan allaqachon ayirilgan (crud.return_sale_item) —
    # bu yerda yana ayirilsa ikki marta hisoblanardi
    total_sales  = round(float(main.total_sales), 2)
    total_profit = round(float(main.total_profit), 2)

    return {
        "total_sales":       total_sales,
        "total_profit":      total_profit,
        "sales_count":       main.sales_count,
        "cash":              round(breakdown["naqd"],    2),
        "card":              round(breakdown["plastik"], 2),
        "debt":              round(breakdown["nasiya"],  2),
        "returns":           round(float(returns_sum),   2),
        "inventory_cost":    round(float(inv.cost),      2),
        "potential_profit":  round(float(inv.sales_val) - float(inv.cost), 2),
        "expenses":          round(float(expenses_sum),  2),
        "supplier_debt":     round(float(supplier_debt), 2),
        "customer_debt":     round(float(customer_debt), 2),
        "net_profit":        round(total_profit - float(expenses_sum), 2),
    }


@router.get("/top-products")
def get_top_products(
    period:     str           = "today",
    start_date: Optional[date]= Query(None),
    end_date:   Optional[date]= Query(None),
    limit:      int           = Query(10, le=50),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    start_dt, end_dt = _time_range(period, start_date, end_date)
    store_id = employee.store_id

    # Sotilgan mahsulotlar — ✅ qaytarilgan qism miqdor, summa va foydadan ayiriladi
    SI    = models.SaleItem
    net   = SI.quantity - func.coalesce(SI.returned_quantity, 0)
    share = net / func.nullif(SI.quantity, 0)
    sold = db.query(
        SI.product_id,
        SI.product_name.label("name"),
        func.coalesce(func.sum(net), 0).label("net_qty"),
        func.coalesce(func.sum(SI.final_amount * share), 0).label("total_amount"),
        func.coalesce(func.sum(SI.item_profit  * share), 0).label("total_profit"),
    ).join(models.Sale).filter(
        models.Sale.store_id     == store_id,
        models.Sale.created_at   >= start_dt,
        models.Sale.created_at   <= end_dt,
        models.Sale.is_cancelled == False,
    ).group_by(SI.product_id, SI.product_name).all()

    results = []
    for row in sold:
        net_qty = round(float(row.net_qty), 3)
        if net_qty > 0:
            results.append({
                "name":         row.name,
                "quantity":     net_qty,
                "total_amount": round(float(row.total_amount), 2),
                "total_profit": round(float(row.total_profit), 2),
            })

    results.sort(key=lambda x: x["quantity"], reverse=True)
    return results[:limit]


@router.get("/debtors")
def get_debtors(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Qarzdor mijozlar"""
    from app.api.customers import _fmt as _cfmt
    return [_cfmt(c) for c in crud.get_customers_with_debt(db, employee.store_id)]


@router.post("/expenses", status_code=201)
async def create_expense(
    amount:   float           = Body(..., gt=0),
    category: str             = Body(...),
    notes:    Optional[str]   = Body(None),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Chiqim qo'shish va barchaga xabar berish. ✅ Faqat admin."""
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    if role not in ("admin", "super_admin"):
        raise HTTPException(403, "Chiqimni faqat admin qo'sha oladi")
    category = (category or "").strip()[:100] or "Boshqa"
    data = schemas.ExpenseCreate(amount=amount, category=category, notes=notes)
    exp  = crud.create_expense(db, data, employee.store_id, employee.id)
    
    # WebSocket orqali xabar yuboramiz (Analitika yangilanishi uchun)
    await ws_manager.broadcast(
        store_id=employee.store_id,
        event="expense_added",
        data={"amount": exp.amount, "category": exp.category}
    )
    
    return {
        "id":         exp.id,
        "amount":     exp.amount,
        "category":   exp.category,
        "notes":      exp.notes,
        "created_at": exp.created_at.isoformat() if exp.created_at else None,
    }

@router.get("/expenses-list")
def get_expenses(
    period:     str           = "today",
    start_date: Optional[date]= Query(None),
    end_date:   Optional[date]= Query(None),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    start_dt, end_dt = _time_range(period, start_date, end_date)
    expenses = crud.get_store_expenses(db, employee.store_id, start_dt, end_dt)
    return [
        {
            "id":         e.id,
            "amount":     e.amount,
            "category":   e.category,
            "notes":      e.notes,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in expenses
    ]


@router.delete("/expenses/{expense_id}")
def delete_expense(
    expense_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    exp = db.query(models.Expense).filter(
        models.Expense.id       == expense_id,
        models.Expense.store_id == employee.store_id,
    ).first()
    if not exp:
        raise HTTPException(404, "Chiqim topilmadi")
    db.delete(exp)
    db.commit()
    return {"message": "Chiqim o'chirildi"}