"""
NovaPOS — Products Router v2.0
================================
Tuzatilgan:
  ✅ create_product — crud.create_product (SupplyBatch ham yoziladi)
  ✅ create_supply_batch — crud.create_supply_batch (supplier debt yangilanadi)
  ✅ /supply-history — store_id filter to'g'ri (SupplyBatch.store_id)
  ✅ /search va / — birlashtirildi (?search= param)
  ✅ update_product — .model_dump() Pydantic v2
  ✅ WebSocket broadcast — product_added, product_edited, product_deleted
  ✅ soft_delete — crud.soft_delete_product
  ✅ adjust_stock — inventarizatsiya endpoint
"""

import os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from fastapi.responses import JSONResponse
from app import schemas, models, crud
from app.database import get_db
from app.dependencies import get_current_employee
from app.websocket_manager import ws_manager

router = APIRouter(tags=["Products"])


# ─── Helper: product → dict ───────────────────────────────────
def _fmt(p: models.Product) -> dict:
    return {
        "id":              p.id,
        "store_id":        p.store_id,
        "name":            p.name,
        "barcode":         p.barcode,
        "short_code":      p.short_code,
        "sku":             p.sku,
        "unit_type":       p.unit_type.value if hasattr(p.unit_type, "value") else str(p.unit_type),
        "price_in":        p.price_in,
        "price_out":       p.price_out,
        "quantity":        p.quantity,
        "min_stock_limit": p.min_stock_limit,
        "max_stock_limit": p.max_stock_limit,
        "category_id":     p.category_id,
        "category_name":   p.category.name if p.category else "Kategoriyasiz",
        "description":     p.description,
        "image_url":       p.image_url,
        "is_deleted":      p.is_deleted,
        "created_at":      p.created_at.isoformat() if p.created_at else None,
        "updated_at":      p.updated_at.isoformat() if p.updated_at else None,
    }


# ============================================================
# MAHSULOTLAR RO'YXATI + QIDIRUV
# ============================================================

def _is_admin(employee: models.Employee) -> bool:
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    return role in ("admin", "super_admin")


def _check_category(db: Session, category_id: Optional[int], store_id: int) -> None:
    """Boshqa do'konning kategoriyasini biriktirib bo'lmaydi"""
    if category_id is None:
        return
    ok = db.query(models.Category.id).filter(
        models.Category.id == category_id, models.Category.store_id == store_id,
    ).first()
    if not ok:
        raise HTTPException(404, "Kategoriya topilmadi")


def _require_admin(employee: models.Employee, what: str) -> None:
    if not _is_admin(employee):
        raise HTTPException(403, f"{what} faqat admin uchun")


@router.get("/")
async def get_products(
    request:  Request,
    search:   Optional[str] = None,
    mode:     Optional[str] = None,      # ✅ Rejim (masalan: 'low')
    category: Optional[str] = None,      # ✅ Kategoriya nomi
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    # Asosiy query
    query = db.query(models.Product).filter(
        models.Product.store_id == employee.store_id,
        models.Product.is_deleted == False
    )

    # 1. Qidiruv
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            (models.Product.name.ilike(search_filter)) |
            (models.Product.barcode == search) |
            (models.Product.short_code == search)
        )

    # 2. Rejim bo'yicha filtr (Kam qolganlar)
    if mode == "low":
        query = query.filter(models.Product.quantity <= models.Product.min_stock_limit)

    # 3. Kategoriya bo'yicha filtr
    if category in ("Kategoriyasiz", "Boshqa"):
        query = query.filter(models.Product.category_id == None)   # noqa: E711
    elif category:
        query = query.join(models.Category).filter(models.Category.name == category)

    products = query.options(joinedload(models.Product.category)).order_by(models.Product.name).all()
    return JSONResponse([_fmt(p) for p in products])


# ============================================================
# BARCODE / SHORT_CODE SCAN
# ============================================================

@router.get("/scan/{code}")
def scan_product(
    code:     str,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Barcode yoki PLU (short_code) orqali mahsulot topish"""
    p = crud.get_product_by_identifier(db, employee.store_id, code)
    if not p:
        raise HTTPException(404, "Mahsulot topilmadi")
    return _fmt(p)


# ============================================================
# KATEGORIYALAR
# ============================================================

@router.get("/categories")
def get_categories(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    return crud.get_store_categories(db, employee.store_id)


@router.post("/categories")
def create_category(
    data:     schemas.CategoryCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    data.name = (data.name or "").strip()
    if not data.name:
        raise HTTPException(400, "Kategoriya nomini yozing")
    dup = db.query(models.Category).filter(
        models.Category.store_id == employee.store_id,
        models.Category.is_active == True,
        models.Category.name.ilike(data.name),
    ).first()
    if dup:
        raise HTTPException(400, f"'{dup.name}' kategoriyasi allaqachon bor")
    return crud.create_category(db, data, employee.store_id)


@router.delete("/categories/{cat_id}", status_code=204)
def delete_category(
    cat_id:   int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    _require_admin(employee, "Kategoriyani o'chirish")
    cat = db.query(models.Category).filter(
        models.Category.id       == cat_id,
        models.Category.store_id == employee.store_id,
    ).first()
    if not cat:
        raise HTTPException(404, "Kategoriya topilmadi")

    # Bu kategoriyali mahsulotlarni kategoriyasiz qilish
    db.query(models.Product).filter(
        models.Product.category_id == cat_id
    ).update({"category_id": None})

    db.delete(cat)
    db.commit()
    return Response(status_code=204)


# ============================================================
# KIRIM TARIXI (SUPPLY HISTORY)
# ============================================================

@router.get("/supply-history")
def get_supply_history(
    limit:       int           = Query(500, le=1000),
    start_date:  Optional[str] = None,
    end_date:    Optional[str] = None,
    product_id:  Optional[int] = None,
    supplier_id: Optional[int] = None,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Kirim tarixi — SupplyBatch lari"""
    start_dt = end_dt = None
    if start_date:
        try:   start_dt = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError: raise HTTPException(400, "start_date: YYYY-MM-DD bo'lsin")
    if end_date:
        try:   end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
        except ValueError: raise HTTPException(400, "end_date: YYYY-MM-DD bo'lsin")

    batches = crud.get_supply_history(
        db          = db,
        store_id    = employee.store_id,
        product_id  = product_id,
        supplier_id = supplier_id,
        start_date  = start_dt,
        end_date    = end_dt,
        limit       = limit,
    )

    result = []
    for b in batches:
        emp_name = None
        if b.created_by:
            emp = crud.get_employee_by_id(db, b.created_by)
            if emp: emp_name = emp.full_name

        result.append({
            "id":                b.id,
            "product_id":        b.product_id,
            "product_name":      b.product.name      if b.product  else "O'chirilgan",
            "quantity_received": b.quantity_received,
            "supply_price":      b.supply_price,
            "total_cost":        b.total_cost,
            "unit_type":         b.product.unit_type.value if b.product and hasattr(b.product.unit_type, "value") else "dona",
            "is_paid":           b.is_paid,
            "supply_type":       b.supply_type.value if hasattr(b.supply_type, "value") else str(b.supply_type or ""),
            "supplier_name":     b.supplier.name     if b.supplier else None,
            "employee_name":     emp_name,
            "created_at":        b.created_at.isoformat() if b.created_at else None,
        })
    return result


# ============================================================
# MAHSULOT QO'SHISH
# ============================================================

@router.post("/")
async def create_product(
    data:     schemas.ProductCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    ✅ crud.create_product — SupplyBatch ham yoziladi
    ✅ short_code bandligi tekshiriladi
    ✅ WebSocket: product_added broadcast
    """
    data.name = (data.name or "").strip()
    if not data.name:
        raise HTTPException(400, "Mahsulot nomi bo'sh bo'lmasin")
    data.barcode    = (data.barcode or "").strip() or None
    data.short_code = (data.short_code or "").strip() or None
    _check_category(db, data.category_id, employee.store_id)

    # short_code bandligi
    if data.short_code:
        exist = db.query(models.Product).filter(
            models.Product.store_id   == employee.store_id,
            models.Product.short_code == data.short_code,
            models.Product.is_deleted == False,
        ).first()
        if exist:
            raise HTTPException(400, f"'{data.short_code}' PLU kodi band: {exist.name}")

    # barcode bandligi
    if data.barcode:
        exist = db.query(models.Product).filter(
            models.Product.store_id   == employee.store_id,
            models.Product.barcode    == data.barcode,
            models.Product.is_deleted == False,
        ).first()
        if exist:
            raise HTTPException(400, f"'{data.barcode}' shtrix-kodi band: {exist.name}")

    product = crud.create_product(db, data, employee.store_id, created_by=employee.id)

    # Broadcast
    await ws_manager.broadcast(
        store_id = employee.store_id,
        event    = "product_added",
        data     = {
            "product_id": product.id,
            "name":       product.name,
            "quantity":   product.quantity,
            "price_out":  product.price_out,
            "barcode":    product.barcode,
            "short_code": product.short_code,
            "added_by":   employee.full_name,
        },
    )
    return _fmt(product)


# ============================================================
# BITTA MAHSULOT
# ============================================================

@router.get("/{product_id}")
def get_product(
    product_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    p = db.query(models.Product).options(
        joinedload(models.Product.category)
    ).filter(
        models.Product.id         == product_id,
        models.Product.store_id   == employee.store_id,
        models.Product.is_deleted == False,
    ).first()
    if not p:
        raise HTTPException(404, "Mahsulot topilmadi")
    return _fmt(p)


# ============================================================
# MAHSULOT TAHRIRLASH
# ============================================================

@router.put("/{product_id}")
async def update_product(
    product_id: int,
    data:       schemas.ProductUpdate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """✅ Pydantic v2 model_dump() + WebSocket broadcast"""
    p = db.query(models.Product).filter(
        models.Product.id       == product_id,
        models.Product.store_id == employee.store_id,
        models.Product.is_deleted == False,
    ).first()
    if not p:
        raise HTTPException(404, "Mahsulot topilmadi")

    # short_code o'zgarsa — bandligini tekshirish
    d = data.model_dump(exclude_unset=True)
    # ✅ Kassir narx va qoldiqni o'zgartira olmaydi (o'zgarmagan qiymatlar yuborilsa — ruxsat)
    if not _is_admin(employee):
        for f in ("price_in", "price_out", "quantity", "min_stock_limit"):
            if f in d and d[f] is not None and float(d[f]) != float(getattr(p, f) or 0):
                raise HTTPException(403, "Narx va qoldiqni faqat admin o'zgartira oladi")
    for f in ("barcode", "short_code"):
        if f in d and isinstance(d[f], str):
            d[f] = d[f].strip() or None
    if d.get("name") is not None:
        d["name"] = d["name"].strip()
        if not d["name"]:
            raise HTTPException(400, "Mahsulot nomi bo'sh bo'lmasin")
    if "category_id" in d:
        _check_category(db, d["category_id"], employee.store_id)
    if d.get("barcode"):
        exist = db.query(models.Product).filter(
            models.Product.store_id   == employee.store_id,
            models.Product.barcode    == d["barcode"],
            models.Product.is_deleted == False,
            models.Product.id         != product_id,
        ).first()
        if exist:
            raise HTTPException(400, f"'{d['barcode']}' shtrix-kodi band: {exist.name}")
    if "short_code" in d and d["short_code"]:
        exist = db.query(models.Product).filter(
            models.Product.store_id   == employee.store_id,
            models.Product.short_code == d["short_code"],
            models.Product.is_deleted == False,
            models.Product.id         != product_id,
        ).first()
        if exist:
            raise HTTPException(400, f"'{d['short_code']}' PLU kodi band: {exist.name}")

    for k, v in d.items():
        setattr(p, k, v)
    from datetime import datetime as _dt
    p.updated_at = _dt.now(timezone.utc)
    db.commit(); db.refresh(p)

    # Broadcast
    await ws_manager.broadcast(
        store_id = employee.store_id,
        event    = "product_edited",
        data     = {
            "product_id": p.id,
            "name":       p.name,
            "quantity":   p.quantity,
            "price_out":  p.price_out,
            "barcode":    p.barcode,
            "short_code": p.short_code,
            "edited_by":  employee.full_name,
        },
    )
    return _fmt(p)


# ============================================================
# MAHSULOT O'CHIRISH
# ============================================================

@router.delete("/{product_id}")
async def delete_product(
    product_id: int,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Soft delete + WebSocket broadcast. ✅ Faqat admin."""
    _require_admin(employee, "Mahsulotni o'chirish")
    p = db.query(models.Product).filter(
        models.Product.id       == product_id,
        models.Product.store_id == employee.store_id,
    ).first()
    if not p:
        raise HTTPException(404, "Mahsulot topilmadi")

    name = p.name
    ok   = crud.soft_delete_product(db, product_id)
    if not ok:
        raise HTTPException(400, "O'chirib bo'lmadi")

    await ws_manager.broadcast(
        store_id = employee.store_id,
        event    = "product_deleted",
        data     = {"product_id": product_id, "name": name},
    )
    return {"status": "success", "message": f"'{name}' o'chirildi"}


# ============================================================
# KIRIM QILISH (SUPPLY BATCH)
# ============================================================

@router.post("/supply_batches")
async def create_supply_batch(
    data:     schemas.SupplyBatchCreate,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    ✅ crud.create_supply_batch — supplier debt yangilanadi
    ✅ WebSocket: stock_updated broadcast
    """
    p = db.query(models.Product).filter(
        models.Product.id         == data.product_id,
        models.Product.store_id   == employee.store_id,
        models.Product.is_deleted == False,
    ).first()
    if not p:
        raise HTTPException(404, "Mahsulot topilmadi")
    if data.supplier_id is not None:
        sup = db.query(models.Supplier).filter(
            models.Supplier.id       == data.supplier_id,
            models.Supplier.store_id == employee.store_id,
        ).first()
        if not sup:
            raise HTTPException(404, "Ta'minotchi topilmadi")
    if not data.is_paid and data.supplier_id is None:
        raise HTTPException(400, "Qarzga olingan tovar uchun ta'minotchini tanlang")
    # ✅ Kassir tovar qabul qila oladi, lekin sotuv narxini o'zgartira olmaydi
    if (not _is_admin(employee) and data.price_out
            and float(data.price_out) != float(p.price_out or 0)):
        raise HTTPException(403, "Sotuv narxini faqat admin o'zgartira oladi")

    try:
        batch = crud.create_supply_batch(
            db         = db,
            data       = data,
            store_id   = employee.store_id,
            created_by = employee.id,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Broadcast: qoldiq yangilandi
    p = crud.get_product(db, data.product_id)   # refresh
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

    return {"status": "success", "new_quantity": p.quantity, "batch_id": batch.id}


# ============================================================
# INVENTARIZATSIYA (STOCK ADJUSTMENT)
# ============================================================

@router.post("/{product_id}/adjust-stock")
async def adjust_stock(
    product_id:   int,
    new_quantity: float = Query(..., ge=0, description="Yangi haqiqiy qoldiq"),
    reason:       Optional[models.AdjustmentReason] = Query(None, description="inventarizatsiya | shikastlangan | qaytarish | tuzatish | boshqa"),
    notes:        Optional[str] = Query(None, max_length=300),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """
    Inventarizatsiya — qoldiqni to'g'rilash.
    StockAdjustment yoziladi. ✅ Faqat admin.
    """
    _require_admin(employee, "Qoldiqni tuzatish")
    p = db.query(models.Product).filter(
        models.Product.id       == product_id,
        models.Product.store_id == employee.store_id,
        models.Product.is_deleted == False,
    ).first()
    if not p:
        raise HTTPException(404, "Mahsulot topilmadi")

    adj = crud.adjust_stock(
        db           = db,
        product_id   = product_id,
        new_quantity = new_quantity,
        reason       = reason,
        notes        = notes,
        employee_id  = employee.id,
        store_id     = employee.store_id,
    )

    p = crud.get_product(db, product_id)
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
        "status":       "success",
        "old_quantity": adj.old_quantity,
        "new_quantity": adj.new_quantity,
        "difference":   adj.difference,
    }


# ============================================================
# PAST LIMIT MAHSULOTLAR
# ============================================================

@router.get("/low-stock/list")
def get_low_stock(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Min qoldiq limitdan past mahsulotlar"""
    products = crud.get_low_stock_products(db, employee.store_id)
    return [_fmt(p) for p in products]


# ============================================================
# BULK LIMIT YANGILASH
# ============================================================

@router.post("/bulk-update-limits")
def bulk_update_limits(
    unit:      str   = Query(...),
    new_limit: float = Query(..., ge=0),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    _require_admin(employee, "Limitlarni o'zgartirish")
    products = db.query(models.Product).filter(
        models.Product.store_id   == employee.store_id,
        models.Product.unit_type  == unit,
        models.Product.is_deleted == False,
    ).all()

    for p in products:
        p.min_stock_limit = new_limit
    db.commit()

    return {"status": "success", "updated_count": len(products), "unit": unit, "new_limit": new_limit}
