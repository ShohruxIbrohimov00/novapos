"""
NovaPOS — Subscriptions Router v2.0
======================================
Tuzatilgan:
  ✅ get_current_employee — dependencies.py dan import
  ✅ upload_proof — fayl xavfsizlik tekshiruvi (content-type + extension + hajm)
  ✅ payment_settings — PUBLIC endpoint (token shart emas)
  ✅ my_requests — joinedload (N+1 yo'q)
  ✅ status — subscription_status to'liq ma'lumot
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone
import os
import logging

from app import models
from app.database import get_db
from app.dependencies import get_current_employee

logger     = logging.getLogger(__name__)
router     = APIRouter(tags=["Subscriptions"])

UPLOAD_DIR        = "webapp/static/uploads/proofs"
ALLOWED_TYPES     = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
ALLOWED_EXT       = {"jpg", "jpeg", "png", "webp"}
MAX_SIZE          = 5 * 1024 * 1024   # 5 MB

os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("/upload-proof")
async def upload_proof(
    tarif_id: int         = Form(...),
    file:     UploadFile  = File(...),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """To'lov skrinshotini yuklash"""
    # Content-type
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Faqat JPEG, PNG, WebP formatlar qabul qilinadi")

    # Extension
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "Noto'g'ri fayl kengaytmasi")

    # Hajm
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "Fayl 5 MB dan katta bo'lmasin")

    # Tarif
    tarif = db.query(models.Tarif).filter(models.Tarif.id == tarif_id).first()
    if not tarif:
        raise HTTPException(404, "Tarif topilmadi")

    # Pending so'rov bormi?
    pending = db.query(models.SubscriptionRequest).filter(
        models.SubscriptionRequest.store_id == employee.store_id,
        models.SubscriptionRequest.status   == "pending",
    ).first()
    if pending:
        raise HTTPException(400, "Avvalgi so'rovingiz hali ko'rib chiqilmagan")

    # Faylni saqlash
    fname = f"proof_{employee.store_id}_{int(datetime.now(timezone.utc).replace(tzinfo=None).timestamp())}.{ext}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    try:
        with open(fpath, "wb") as f:
            f.write(content)
    except Exception as e:
        logger.error(f"File save error: {e}")
        raise HTTPException(500, "Faylni saqlashda xatolik")

    # So'rov yaratish
    req = models.SubscriptionRequest(
        store_id        = employee.store_id,
        employee_id     = employee.id,
        tarif_id        = tarif.id,
        amount          = tarif.price,    # serverdan — manipulyatsiyadan himoya
        plan_months     = tarif.months,
        proof_image_url = f"/static/uploads/proofs/{fname}",
        status          = "pending",
    )
    db.add(req)

    # Do'kon statusini pending ga
    if employee.store:
        employee.store.payment_status = "pending"

    db.commit(); db.refresh(req)

    return {
        "status":     "success",
        "message":    "To'lov skrinshoti yuborildi! 24 soat ichida tasdiqlanadi.",
        "request_id": req.id,
        "tarif": {"name": tarif.name, "months": tarif.months, "price": int(tarif.price)},
    }


@router.get("/payment-settings")
def get_payment_settings(db: Session = Depends(get_db)):
    """Karta ma'lumotlari — PUBLIC (token shart emas)"""
    s = db.query(models.SystemSettings).first()
    if not s:
        return {"card_number": "8600 0000 0000 0000", "card_owner": "NOVAPOS", "support_phone": "+998901234567"}
    return {"card_number": s.card_number, "card_owner": s.card_owner, "support_phone": s.support_phone}


@router.get("/my-requests")
def get_my_requests(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    reqs = db.query(models.SubscriptionRequest).options(
        joinedload(models.SubscriptionRequest.tarif)
    ).filter(
        models.SubscriptionRequest.store_id == employee.store_id
    ).order_by(models.SubscriptionRequest.created_at.desc()).limit(20).all()

    return [
        {
            "id":          r.id,
            "tarif_name":  r.tarif.name if r.tarif else "—",
            "amount":      int(r.amount),
            "plan_months": r.plan_months,
            "status":      r.status,
            "created_at":  r.created_at.isoformat() if r.created_at else None,
        }
        for r in reqs
    ]


@router.get("/status")
def get_subscription_status(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    store = db.query(models.Store).filter(models.Store.id == employee.store_id).first()
    if not store:
        raise HTTPException(404, "Do'kon topilmadi")

    now       = datetime.now(timezone.utc).replace(tzinfo=None)
    days_left = None
    is_expired= False
    if store.subscription_expires_at:
        diff       = store.subscription_expires_at - now
        days_left  = diff.days
        is_expired = diff.total_seconds() < 0

    return {
        "payment_status": store.payment_status,
        "expires_at":     store.subscription_expires_at.isoformat()
                          if store.subscription_expires_at else None,
        "days_left":      days_left,
        "is_expired":     is_expired,
        "is_blocked":     is_expired and store.payment_status not in ("active",),
    }

# api/subscriptions.py ga quyidagi endpointni qo'shing:

@router.get("/tarifs")
def get_public_tarifs(db: Session = Depends(get_db)):
    """Barcha faol tariflar ro'yxati — PUBLIC"""
    tarifs = db.query(models.Tarif).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "price": t.price,
            "months": t.months,
            "description": t.description
        }
        for t in tarifs
    ]

# app/api/subscriptions.py

@router.get("/tarifs")
def get_store_tarifs(db: Session = Depends(get_db)):
    """Do'konlar ko'rishi uchun barcha tariflar ro'yxati"""
    tarifs = db.query(models.Tarif).all()
    # Ma'lumotlarni front-end kutayotgan formatda qaytaramiz
    return [
        {
            "id": t.id,
            "name": t.name,
            "price": float(t.price),
            "months": t.months
        }
        for t in tarifs
    ]