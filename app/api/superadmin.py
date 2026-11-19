"""
NovaPOS — Superadmin Router v2.0
==================================
Tuzatilgan:
  ✅ get_current_employee — dependencies.py dan import
  ✅ create_access_token — dependencies.py dan import
  ✅ login-as-store — yangi token payload (employee_id, store_id, role)
  ✅ verify_super_admin — require_super_admin dependency
  ✅ _sync_store_block_status — saqland (muhim logika)
  ✅ Barcha boshqa logika — o'zgarmagan (yaxshi edi)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta
import logging

from app import models
from app.database import get_db
from app.dependencies import get_current_employee, create_access_token

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Superadmin"])


# ─── Auth dependency ──────────────────────────────────────────
def verify_super_admin(
    employee: models.Employee = Depends(get_current_employee),
) -> models.Employee:
    role = employee.role.value if hasattr(employee.role, "value") else str(employee.role)
    if role != "super_admin":
        raise HTTPException(403, "Sizda bunday huquq yo'q!")
    return employee


# ─── Yordamchi ────────────────────────────────────────────────
def _sync_block(db: Session, store: models.Store) -> None:
    """
    ✅ Obuna tugaganda xodimlar endi o'chirilmaydi: cheklov har bir so'rovda
    402 orqali ishlaydi (dependencies._check_store_subscription), shunda do'kon
    egasi tizimga kirib to'lov chekini yubora oladi.
    Obuna faollashganda do'kon adminlari ochiladi (eski versiyada bloklangan bo'lsa).
    Kassirlarning holatiga tegilmaydi — ularni do'kon admini o'zi boshqaradi.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    active = store.subscription_expires_at is None or store.subscription_expires_at >= now
    if not active:
        return
    for emp in db.query(models.Employee).filter(models.Employee.store_id == store.id).all():
        role = emp.role.value if hasattr(emp.role, "value") else str(emp.role)
        if role == "admin":
            emp.is_active = True


# ═══════════════════════════════════════════════════════════════
# DASHBOARD
# ═══════════════════════════════════════════════════════════════

@router.get("/stats")
def get_stats(
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    return {
        "total_stores":      db.query(models.Store).count(),
        "active_stores":     db.query(models.Store).filter(models.Store.is_active == True).count(),
        "pending_requests":  db.query(models.SubscriptionRequest).filter(models.SubscriptionRequest.status == "pending").count(),
        "total_revenue":     int(db.query(func.coalesce(func.sum(models.SubscriptionRequest.amount), 0)).filter(models.SubscriptionRequest.status == "approved").scalar() or 0),
    }


# ═══════════════════════════════════════════════════════════════
# TARIFLAR
# ═══════════════════════════════════════════════════════════════

@router.get("/tarifs")
def get_tarifs(db: Session = Depends(get_db)):
    """PUBLIC — hamma ko'rishi mumkin"""
    return [
        {"id": t.id, "name": t.name, "months": t.months, "price": int(t.price),
         "created_at": t.created_at.isoformat() if t.created_at else None}
        for t in db.query(models.Tarif).order_by(models.Tarif.months).all()
    ]


@router.post("/tarifs", status_code=201)
def create_tarif(
    data:  dict,
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    name   = str(data.get("name", "")).strip()
    months = data.get("months")
    price  = data.get("price")
    if not name or not months or price is None:
        raise HTTPException(400, "name, months, price kerak")
    try:
        months = int(months); price = float(price)
    except (ValueError, TypeError):
        raise HTTPException(400, "months int, price float bo'lsin")
    if months <= 0 or price <= 0:
        raise HTTPException(400, "months va price musbat bo'lsin")
    if db.query(models.Tarif).filter(models.Tarif.name == name).first():
        raise HTTPException(400, f"'{name}' allaqachon mavjud")
    t = models.Tarif(name=name, months=months, price=price)
    db.add(t); db.commit(); db.refresh(t)
    return {"id": t.id, "name": t.name, "months": t.months, "price": int(t.price)}


@router.patch("/tarifs/{tarif_id}")
def update_tarif(
    tarif_id: int,
    data:     dict,
    db:       Session         = Depends(get_db),
    admin:    models.Employee = Depends(verify_super_admin),
):
    t = db.query(models.Tarif).filter(models.Tarif.id == tarif_id).first()
    if not t: raise HTTPException(404, "Tarif topilmadi")
    if "name"   in data and data["name"]:
        new = str(data["name"]).strip()
        if db.query(models.Tarif).filter(models.Tarif.name == new, models.Tarif.id != tarif_id).first():
            raise HTTPException(400, f"'{new}' band")
        t.name = new
    if "months" in data: t.months = int(data["months"])
    if "price"  in data: t.price  = float(data["price"])
    db.commit(); db.refresh(t)
    return {"id": t.id, "name": t.name, "months": t.months, "price": int(t.price)}


@router.delete("/tarifs/{tarif_id}")
def delete_tarif(
    tarif_id: int,
    db:       Session         = Depends(get_db),
    admin:    models.Employee = Depends(verify_super_admin),
):
    t = db.query(models.Tarif).filter(models.Tarif.id == tarif_id).first()
    if not t: raise HTTPException(404, "Tarif topilmadi")
    if db.query(models.SubscriptionRequest).filter(models.SubscriptionRequest.tarif_id == tarif_id).first():
        raise HTTPException(400, "Bu tarif buyurtmalarda ishlatilgan")
    db.delete(t); db.commit()
    return {"status": "success", "message": f"'{t.name}' o'chirildi"}


# ═══════════════════════════════════════════════════════════════
# TO'LOV SOZLAMALARI
# ═══════════════════════════════════════════════════════════════

def _get_settings(db: Session) -> models.SystemSettings:
    s = db.query(models.SystemSettings).first()
    if not s:
        s = models.SystemSettings()
        db.add(s); db.commit(); db.refresh(s)
    return s


@router.get("/settings/payment")
@router.get("/payment-settings")
def get_payment_settings(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    s = _get_settings(db)
    return {"card_number": s.card_number, "card_owner": s.card_owner, "support_phone": s.support_phone}


@router.patch("/settings/payment")
@router.post("/payment-settings")
@router.patch("/payment-settings")
def update_payment_settings(
    data:  dict,
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    s = _get_settings(db)
    if "card_number"   in data and data["card_number"]:   s.card_number   = str(data["card_number"]).strip()
    if "card_owner"    in data and data["card_owner"]:    s.card_owner    = str(data["card_owner"]).strip().upper()
    if "support_phone" in data and data["support_phone"]: s.support_phone = str(data["support_phone"]).strip()
    db.commit(); db.refresh(s)
    return {"status": "success", "card_number": s.card_number, "card_owner": s.card_owner, "support_phone": s.support_phone}


# ═══════════════════════════════════════════════════════════════
# TO'LOV SO'ROVLARI
# ═══════════════════════════════════════════════════════════════

@router.get("/requests")
def get_requests(
    status_filter: str = "pending",
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    q = db.query(models.SubscriptionRequest).options(
        joinedload(models.SubscriptionRequest.store),
        joinedload(models.SubscriptionRequest.employee),
        joinedload(models.SubscriptionRequest.tarif),
    )
    if status_filter != "all":
        q = q.filter(models.SubscriptionRequest.status == status_filter)
    reqs = q.order_by(models.SubscriptionRequest.created_at.desc()).all()
    return [
        {
            "id":          r.id,
            "amount":      int(r.amount),
            "plan_months": r.plan_months,
            "tarif_name":  r.tarif.name           if r.tarif    else "—",
            "store_id":    r.store_id,
            "store_name":  r.store.name            if r.store    else "Noma'lum",
            "admin_name":  r.employee.full_name    if r.employee else "Noma'lum",
            "proof_url":   r.proof_image_url,
            "status":      r.status,
            "created_at":  r.created_at.isoformat() if r.created_at else None,
        }
        for r in reqs
    ]


@router.post("/approve/{request_id}")
def approve_payment(
    request_id: int,
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    req = db.query(models.SubscriptionRequest).options(
        joinedload(models.SubscriptionRequest.store)
    ).filter(models.SubscriptionRequest.id == request_id).first()
    if not req:                      raise HTTPException(404, "So'rov topilmadi")
    if req.status != "pending":      raise HTTPException(400, f"Holat: '{req.status}'")
    store = req.store
    if not store:                    raise HTTPException(404, "Do'kon topilmadi")

    now        = datetime.now(timezone.utc).replace(tzinfo=None)
    start_date = store.subscription_expires_at if (store.subscription_expires_at and store.subscription_expires_at > now) else now
    new_exp    = start_date + relativedelta(months=req.plan_months)

    store.subscription_expires_at = new_exp
    store.payment_status          = "active"
    store.is_active               = True
    req.status                    = "approved"
    req.reviewed_at               = now

    _sync_block(db, store)
    db.commit()

    logger.info(f"[APPROVE] Store #{store.id} → {new_exp.date()}")
    return {"status": "success", "message": f"{store.name} — {req.plan_months} oy uzaytirildi", "expires_at": new_exp.isoformat()}


@router.post("/reject/{request_id}")
def reject_payment(
    request_id: int,
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    req = db.query(models.SubscriptionRequest).options(
        joinedload(models.SubscriptionRequest.store)
    ).filter(models.SubscriptionRequest.id == request_id).first()
    if not req:                 raise HTTPException(404, "So'rov topilmadi")
    if req.status != "pending": raise HTTPException(400, f"Holat: '{req.status}'")

    req.status      = "rejected"
    req.reviewed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    store = req.store
    if store:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if store.subscription_expires_at and store.subscription_expires_at < now:
            # ✅ is_active o'zgartirilmaydi — aks holda egasi kirib qayta to'lay olmaydi (402 yetarli)
            store.payment_status = "expired"
        else:
            store.payment_status = "active"
    db.commit()
    return {"status": "success", "message": "So'rov rad etildi"}


# ═══════════════════════════════════════════════════════════════
# DO'KONLAR
# ═══════════════════════════════════════════════════════════════

@router.get("/stores")
def get_stores(
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    stores     = db.query(models.Store).order_by(models.Store.created_at.desc()).all()
    emp_counts = dict(
        db.query(models.Employee.store_id, func.count(models.Employee.id))
        .filter(models.Employee.is_active == True)
        .group_by(models.Employee.store_id).all()
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return [
        {
            "id":             s.id,
            "name":           s.name,
            "phone":          s.phone,
            "address":        s.address,
            "is_active":      s.is_active,
            "emp_count":      emp_counts.get(s.id, 0),
            "payment_status": s.payment_status,
            "expires_at":     s.subscription_expires_at.isoformat() if s.subscription_expires_at else None,
            "days_left":      (s.subscription_expires_at - now).days if s.subscription_expires_at else None,
            "created_at":     s.created_at.isoformat() if s.created_at else None,
        }
        for s in stores
    ]


@router.get("/stores/{store_id}")
def get_store(
    store_id: int,
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    s = db.query(models.Store).filter(models.Store.id == store_id).first()
    if not s: raise HTTPException(404, "Do'kon topilmadi")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "id": s.id, "name": s.name, "phone": s.phone, "address": s.address,
        "is_active": s.is_active, "payment_status": s.payment_status,
        "expires_at": s.subscription_expires_at.isoformat() if s.subscription_expires_at else None,
        "days_left": (s.subscription_expires_at - now).days if s.subscription_expires_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


@router.get("/stores/{store_id}/employees")
def get_store_employees(
    store_id: int,
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    if not db.query(models.Store).filter(models.Store.id == store_id).first():
        raise HTTPException(404, "Do'kon topilmadi")
    emps = db.query(models.Employee).filter(models.Employee.store_id == store_id).all()
    return [
        {"id": e.id, "full_name": e.full_name, "username": e.username,
         "role": e.role.value if hasattr(e.role, "value") else str(e.role),
         "is_active": e.is_active,
         "created_at": e.created_at.isoformat() if e.created_at else None}
        for e in emps
    ]


@router.patch("/stores/{store_id}/toggle")
def toggle_store(
    store_id: int,
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    s = db.query(models.Store).filter(models.Store.id == store_id).first()
    if not s: raise HTTPException(404, "Do'kon topilmadi")
    # ✅ Xodimlarga tegilmaydi: do'kon bloklangani har bir so'rovda va kirishda tekshiriladi.
    # (Avval blokdan chiqarishda do'kon egasi ataylab bloklagan kassirlar ham ochilib ketardi.)
    s.is_active = not s.is_active
    if s.is_active:
        _sync_block(db, s)   # eski versiyada bloklanganda o'chirilgan admin qayta ochiladi
    db.commit()
    return {"status": "success", "is_active": s.is_active,
            "message": f"Do'kon {'faollashtirildi' if s.is_active else 'bloklandi'}"}


@router.post("/stores/{store_id}/extend")
def extend_store(
    store_id: int,
    data:     dict,
    db:       Session         = Depends(get_db),
    admin:    models.Employee = Depends(verify_super_admin),
):
    s = db.query(models.Store).filter(models.Store.id == store_id).first()
    if not s: raise HTTPException(404, "Do'kon topilmadi")
    months = int(data.get("months", 0))
    if months <= 0: raise HTTPException(400, "months musbat bo'lsin")
    now        = datetime.now(timezone.utc).replace(tzinfo=None)
    start      = s.subscription_expires_at if (s.subscription_expires_at and s.subscription_expires_at > now) else now
    s.subscription_expires_at = start + relativedelta(months=months)
    s.payment_status = "active"; s.is_active = True
    _sync_block(db, s); db.commit()
    logger.info(f"[EXTEND] Store #{store_id} +{months} oy — reason: {data.get('reason','—')}")
    return {"status": "success", "expires_at": s.subscription_expires_at.isoformat()}


@router.delete("/stores/{store_id}")
def delete_store(
    store_id: int,
    db:       Session         = Depends(get_db),
    admin:    models.Employee = Depends(verify_super_admin),
):
    s = db.query(models.Store).filter(models.Store.id == store_id).first()
    if not s: raise HTTPException(404, "Do'kon topilmadi")
    name = s.name
    db.query(models.SubscriptionRequest).filter(models.SubscriptionRequest.store_id == store_id).delete(synchronize_session=False)
    db.query(models.Employee).filter(models.Employee.store_id == store_id).delete(synchronize_session=False)
    db.delete(s); db.commit()
    logger.info(f"[DELETE] Store #{store_id} '{name}'")
    return {"status": "success", "message": f"'{name}' o'chirildi"}


@router.post("/login-as-store/{store_id}")
def login_as_store(
    store_id: int,
    db:       Session         = Depends(get_db),
    admin:    models.Employee = Depends(verify_super_admin),
):
    """Do'konga superadmin sifatida kirish (support)"""
    target = db.query(models.Employee).filter(
        models.Employee.store_id == store_id,
        models.Employee.role     == models.EmployeeRole.admin,
        models.Employee.is_active== True,
    ).first()
    if not target: raise HTTPException(404, "Bu do'konda faol admin topilmadi")

    # ✅ Kirish javobi bilan bir xil shakl (user_info) — avval "employee" qaytarilardi va
    # kassa do'kon ID'sisiz qolardi
    from app.api.auth import _make_token_response
    resp = _make_token_response(target)
    resp["user_info"]["full_name"] = f"SUPPORT: {target.full_name}"
    resp["user_info"]["impersonated"] = True
    logger.warning(f"[IMPERSONATE] Admin #{admin.id} → Store #{store_id} '{target.username}'")
    return resp


@router.post("/run-expiry-check")
def run_expiry_check(
    db:    Session         = Depends(get_db),
    admin: models.Employee = Depends(verify_super_admin),
):
    """Muddati tugagan do'konlarni bulk bloklash (cron job uchun)"""
    now     = datetime.now(timezone.utc).replace(tzinfo=None)
    expired = db.query(models.Store).filter(
        models.Store.subscription_expires_at < now,
        models.Store.payment_status != "pending",
        models.Store.is_active       == True,
    ).all()
    count = 0
    for s in expired:
        # is_active o'zgartirilmaydi — aks holda egasi kirib to'lay olmaydi
        s.payment_status = "expired"
        _sync_block(db, s)
        count += 1
    db.commit()
    logger.info(f"[EXPIRY] {count} ta do'kon bloklandi")
    return {"status": "success", "blocked_stores": count, "checked_at": now.isoformat()}