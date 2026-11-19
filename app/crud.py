"""
NovaPOS — CRUD Operations v2.1
================================
Tuzatilgan muammolar:
  ✅ Barcha datetime → now_tashkent() (UTC+5, Toshkent)
  ✅ return_sale_item() → SaleItem.returned_quantity yangilanadi
     (sotuv tarixida net miqdor to'g'ri ko'rinadi)
  ✅ create_product() → SupplyBatch supply_type=initial
  ✅ create_supply_batch() → supply_type=restock
  ✅ cancel_sale() → DebtPayment to'g'ri hisoblash
  ✅ get_sales_report() → faqat enum methodlar
  ✅ search_products() → List qaytaradi
  ✅ receipt_number → 3x retry
  ✅ adjust_stock() → SupplyBatch supply_type=adjust yoziladi
"""

from __future__ import annotations

from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, func, desc
from typing import List, Optional
from datetime import datetime, timedelta
import string
import random
import hashlib
import hmac
import logging

from app import models, schemas
from app.timezone_utils import now_tashkent, start_of_day, end_of_day, to_tashkent
from passlib.context import CryptContext

logger = logging.getLogger(__name__)

# ─── Password context ────────────────────────────────────────
pwd_context = CryptContext(
    schemes        = ["bcrypt"],
    deprecated     = "auto",
    truncate_error = False,
)


# ============================================================
# HELPERS
# ============================================================

def hash_password(password: str) -> str:
    """SHA-256 → bcrypt (72 bayt limit xavfsiz)"""
    if not password:
        return ""
    pre = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return pwd_context.hash(pre)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        if not plain or not hashed:
            return False
        pre = hashlib.sha256(plain.encode("utf-8")).hexdigest()
        return pwd_context.verify(pre, hashed)
    except Exception:
        return False


_LEGACY_PIN_SALT = "novapos_2024_secure_pin_salt"


def _legacy_pin_hash(pin: str) -> str:
    return hashlib.sha256((pin + _LEGACY_PIN_SALT).encode()).hexdigest()


def hash_pin(pin: str) -> str:
    """✅ PIN bcrypt bilan (avval oddiy SHA-256 edi — 4 raqamli PIN bir zumda topilardi)"""
    return pwd_context.hash(pin)


def pin_needs_rehash(hashed: str) -> bool:
    return not (hashed or "").startswith("$2")


def verify_pin(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    if pin_needs_rehash(hashed):                       # eski SHA-256 format
        return hmac.compare_digest(_legacy_pin_hash(plain), hashed)
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def _generate_receipt_number() -> str:
    """CH-XXXXXXXX (8 belgi)"""
    chars = string.ascii_uppercase + string.digits
    rand  = "".join(random.choices(chars, k=8))
    return f"CH-{rand}"


def _safe_val(v) -> str:
    return v.value if hasattr(v, "value") else str(v)


# ============================================================
# STORE
# ============================================================

def create_store(db: Session, data: schemas.StoreCreate) -> models.Store:
    store = models.Store(**data.model_dump())
    db.add(store)
    db.commit()
    db.refresh(store)
    return store


def get_store(db: Session, store_id: int) -> Optional[models.Store]:
    return db.query(models.Store).filter(models.Store.id == store_id).first()


def get_active_stores(db: Session) -> List[models.Store]:
    return db.query(models.Store).filter(models.Store.is_active == True).all()


def update_store(db: Session, store_id: int, data: dict) -> Optional[models.Store]:
    store = get_store(db, store_id)
    if not store:
        return None
    for k, v in data.items():
        if hasattr(store, k):
            setattr(store, k, v)
    store.updated_at = now_tashkent()
    db.commit()
    db.refresh(store)
    return store


# ============================================================
# EMPLOYEE
# ============================================================

def create_employee(db: Session, data: schemas.EmployeeCreate) -> models.Employee:
    d = data.model_dump(exclude={"password", "pin_code"})
    d["hashed_password"] = hash_password(data.password)
    d["pin_code"]        = hash_pin(data.pin_code)
    emp = models.Employee(**d)
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


def get_employee_by_username(db: Session, username: str) -> Optional[models.Employee]:
    return db.query(models.Employee).filter(
        models.Employee.username  == username,
        models.Employee.is_active == True,
    ).first()


def get_employee_by_id(db: Session, employee_id: int) -> Optional[models.Employee]:
    return db.query(models.Employee).filter(
        models.Employee.id        == employee_id,
        models.Employee.is_active == True,
    ).first()


def verify_employee_credentials(db: Session, username: str, password: str) -> Optional[models.Employee]:
    emp = get_employee_by_username(db, username)
    if not emp or not verify_password(password, emp.hashed_password):
        return None
    return emp


def verify_employee_pin(db: Session, username: str, pin: str) -> Optional[models.Employee]:
    emp = get_employee_by_username(db, username)
    if not emp or not emp.is_active or not verify_pin(pin, emp.pin_code):
        return None
    # Eski formatdagi PIN — birinchi muvaffaqiyatli kirishda bcrypt ga o'tkaziladi
    if pin_needs_rehash(emp.pin_code):
        try:
            emp.pin_code = hash_pin(pin)
            db.commit()
        except Exception:
            db.rollback()
    return emp


def get_store_employees(db: Session, store_id: int) -> List[models.Employee]:
    return db.query(models.Employee).filter(
        models.Employee.store_id  == store_id,
        models.Employee.is_active == True,
    ).order_by(models.Employee.full_name).all()


def update_employee(db: Session, emp_id: int, data: schemas.EmployeeUpdate) -> Optional[models.Employee]:
    emp = get_employee_by_id(db, emp_id)
    if not emp:
        return None
    d = data.model_dump(exclude_unset=True)
    if "password" in d:
        emp.hashed_password = hash_password(d.pop("password"))
    if "pin_code" in d:
        emp.pin_code = hash_pin(d.pop("pin_code"))
    for k, v in d.items():
        setattr(emp, k, v)
    db.commit()
    db.refresh(emp)
    return emp


def delete_employee(db: Session, emp_id: int) -> bool:
    emp = get_employee_by_id(db, emp_id)
    if not emp:
        return False
    emp.is_active = False
    db.commit()
    return True


# ============================================================
# SYSTEM SETTINGS
# ============================================================

def get_system_settings(db: Session) -> Optional[models.SystemSettings]:
    s = db.query(models.SystemSettings).first()
    if not s:
        s = models.SystemSettings()
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def update_system_settings(db: Session, data: dict) -> models.SystemSettings:
    s = get_system_settings(db)
    for k, v in data.items():
        if hasattr(s, k):
            setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s


# ============================================================
# CATEGORY
# ============================================================

def create_category(db: Session, data: schemas.CategoryCreate, store_id: int) -> models.Category:
    cat = models.Category(
        **data.model_dump(exclude={"store_id"}),
        store_id=store_id,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def get_store_categories(db: Session, store_id: int) -> List[models.Category]:
    return db.query(models.Category).filter(
        models.Category.store_id  == store_id,
        models.Category.is_active == True,
    ).order_by(models.Category.name).all()


def delete_category(db: Session, cat_id: int) -> bool:
    cat = db.query(models.Category).filter(models.Category.id == cat_id).first()
    if not cat:
        return False
    cat.is_active = False
    db.commit()
    return True


# ============================================================
# PRODUCT
# ============================================================

def create_product(db: Session, data: schemas.ProductCreate, store_id: int,
                   created_by: Optional[int] = None) -> models.Product:
    d           = data.model_dump(exclude={"store_id"})
    d["store_id"] = store_id
    product       = models.Product(**d)
    db.add(product)
    db.flush()  # id olish uchun

    # ✅ Boshlang'ich qoldiq bo'lsa — SupplyBatch (supply_type=initial)
    if product.quantity > 0:
        batch = models.SupplyBatch(
            store_id          = store_id,
            product_id        = product.id,
            supplier_id       = None,
            supply_type       = models.SupplyType.initial,   # ← kirim tarixida 'Boshlang'ich qoldiq'
            quantity_received = product.quantity,
            supply_price      = product.price_in,
            total_cost        = round(product.quantity * product.price_in, 2),
            is_paid           = True,
            notes             = "Mahsulot qo'shilganda boshlang'ich qoldiq",
            created_by        = created_by,
        )
        db.add(batch)

    db.commit()
    db.refresh(product)
    return product


def get_product(db: Session, product_id: int) -> Optional[models.Product]:
    return db.query(models.Product).filter(
        models.Product.id         == product_id,
        models.Product.is_deleted == False,
    ).first()


def get_store_products(
    db:       Session,
    store_id: int,
    limit:    int = 9999,
    skip:     int = 0,
) -> List[models.Product]:
    return db.query(models.Product).filter(
        models.Product.store_id   == store_id,
        models.Product.is_deleted == False,
    ).order_by(models.Product.name).offset(skip).limit(limit).all()


def get_product_by_identifier(db: Session, store_id: int, identifier: str) -> Optional[models.Product]:
    return db.query(models.Product).filter(
        models.Product.store_id   == store_id,
        models.Product.is_deleted == False,
        or_(
            models.Product.barcode    == identifier,
            models.Product.short_code == identifier,
        ),
    ).first()


def search_products(
    db:       Session,
    store_id: int,
    query:    str = "",
    skip:     int = 0,
    limit:    int = 50,
) -> List[models.Product]:
    q = db.query(models.Product).filter(
        models.Product.store_id   == store_id,
        models.Product.is_deleted == False,
    )
    if query:
        q = q.filter(or_(
            models.Product.name.ilike(f"%{query}%"),
            models.Product.barcode    == query,
            models.Product.short_code == query,
        ))
    return q.order_by(models.Product.name).offset(skip).limit(limit).all()


def search_products_count(db: Session, store_id: int, query: str = "") -> int:
    q = db.query(func.count(models.Product.id)).filter(
        models.Product.store_id   == store_id,
        models.Product.is_deleted == False,
    )
    if query:
        q = q.filter(or_(
            models.Product.name.ilike(f"%{query}%"),
            models.Product.barcode    == query,
            models.Product.short_code == query,
        ))
    return q.scalar() or 0


def update_product(db: Session, product_id: int, data: schemas.ProductUpdate) -> models.Product:
    product = get_product(db, product_id)
    if not product:
        raise ValueError(f"Mahsulot topilmadi: {product_id}")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(product, k, v)
    product.updated_at = now_tashkent()
    db.commit()
    db.refresh(product)
    return product


def soft_delete_product(db: Session, product_id: int) -> bool:
    product = get_product(db, product_id)
    if not product:
        return False
    product.is_deleted = True
    product.short_code = None
    product.updated_at = now_tashkent()
    db.commit()
    return True


def get_low_stock_products(db: Session, store_id: int) -> List[models.Product]:
    return db.query(models.Product).filter(
        models.Product.store_id   == store_id,
        models.Product.is_deleted == False,
        models.Product.quantity   <= models.Product.min_stock_limit,
    ).order_by(models.Product.quantity).all()


def adjust_stock(
    db:           Session,
    product_id:   int,
    new_quantity: float,
    reason:       Optional["models.AdjustmentReason"],
    notes:        Optional[str],
    employee_id:  int,
    store_id:     int,
) -> models.StockAdjustment:
    """
    Inventarizatsiya — qoldiqni to'g'rilash.
    ✅ SupplyBatch ham yoziladi (kirim tarixida ko'rinish uchun, supply_type=adjust)
    """
    product = get_product(db, product_id)
    if not product:
        raise ValueError("Mahsulot topilmadi")

    old_qty = product.quantity
    diff    = round(new_quantity - old_qty, 3)

    # StockAdjustment log
    adj = models.StockAdjustment(
        store_id     = store_id,
        product_id   = product_id,
        old_quantity = old_qty,
        new_quantity = new_quantity,
        difference   = diff,
        reason       = reason,
        notes        = notes,
        created_by   = employee_id,
    )
    db.add(adj)

    # ✅ Kirim tarixida ko'rinishi uchun SupplyBatch (faqat diff > 0 bo'lsa)
    if diff > 0:
        batch = models.SupplyBatch(
            store_id          = store_id,
            product_id        = product_id,
            supplier_id       = None,
            supply_type       = models.SupplyType.adjust,
            quantity_received = diff,
            supply_price      = product.price_in,
            total_cost        = round(diff * product.price_in, 2),
            is_paid           = True,
            notes             = notes or (reason.value if hasattr(reason, "value") else reason) or "Inventarizatsiya tuzatish",
            created_by        = employee_id,
        )
        db.add(batch)

    product.quantity   = new_quantity
    product.updated_at = now_tashkent()
    db.commit()
    db.refresh(adj)
    return adj


# ============================================================
# SALE
# ============================================================

def find_sale_by_client_uid(db: Session, store_id: int, client_uid: Optional[str]) -> Optional[models.Sale]:
    if not client_uid:
        return None
    return db.query(models.Sale).filter(
        models.Sale.store_id   == store_id,
        models.Sale.client_uid == client_uid,
    ).first()


def create_sale(
    db:          Session,
    sale_data:   schemas.SaleCreate,
    employee_id: int,
    can_sell_below_cost: bool = False,
) -> models.Sale:
    """
    Sotuv yaratish.
    ✅ receipt_number collision → 3x retry
    ✅ Oversell himoya
    ✅ Nasiya → customer.current_debt to'g'ri
    ✅ Toshkent vaqti
    """

    # ── 1. Mahsulotlarni tekshirish ──────────────────────────
    items_data   = []
    total_amount = 0.0
    total_cost   = 0.0
    total_profit = 0.0

    for item in sale_data.items:
        product = get_product(db, item.product_id)
        # ✅ Mahsulot aynan shu do'konniki va o'chirilmagan bo'lishi shart
        if (not product
                or product.store_id != sale_data.store_id
                or getattr(product, "is_deleted", False)):
            raise ValueError(f"Mahsulot topilmadi: ID={item.product_id}")

        qty = round(float(item.quantity), 3)

        # Oflayn sotuv allaqachon bo'lib o'tgan (tovar mijozda) — qoldiq yetmasa ham
        # yoziladi (qoldiq minusga tushadi, inventarizatsiyada ko'rinadi).
        if not sale_data.is_offline and round(product.quantity, 3) < qty:
            raise ValueError(
                f"'{product.name}' yetarli emas: omborda {product.quantity:g} ta, "
                f"savatda {qty:g} ta"
            )

        unit_price      = round(float(item.price_out if item.price_out is not None else product.price_out), 2)
        if unit_price < 0:
            raise ValueError("Narx manfiy bo'lishi mumkin emas")
        # ✅ Kassir tovarni tannarxdan arzon sota olmaydi (faqat admin)
        if (not can_sell_below_cost and not sale_data.is_offline
                and unit_price < round(float(product.price_in or 0), 2)):
            raise ValueError(
                f"'{product.name}' narxi tannarxdan ({product.price_in:,.0f}) past. "
                f"Bunday narxda faqat admin sota oladi."
            )
        subtotal        = round(qty * unit_price, 2)
        discount_pct    = round(float(getattr(item, "discount_percent", 0) or 0), 2)
        discount_amount = round(subtotal * discount_pct / 100, 2)
        final_amount    = round(subtotal - discount_amount, 2)
        # ✅ Foyda chegirmadan KEYINGI summadan hisoblanadi
        item_profit     = round(final_amount - product.price_in * qty, 2)

        items_data.append({
            "product":          product,
            "quantity":         qty,
            "unit_price":       unit_price,
            "cost_price":       round(float(product.price_in), 2),
            "discount_percent": discount_pct,
            "discount_amount":  discount_amount,
            "subtotal":         subtotal,
            "final_amount":     final_amount,
            "item_profit":      item_profit,
        })
        total_amount += final_amount
        total_cost   += round(product.price_in * qty, 2)
        total_profit += item_profit

    total_amount  = round(total_amount, 2)
    total_cost    = round(total_cost,   2)
    total_profit  = round(total_profit, 2)
    paid_amount   = round(float(sale_data.paid_amount), 2)
    change_amount = round(max(0.0, paid_amount - total_amount), 2)

    # ── 2. Nasiya tekshiruv ───────────────────────────────────
    if _safe_val(sale_data.payment_method) == "nasiya":
        if not sale_data.customer_id:
            raise ValueError("Nasiya sotuvda mijoz tanlanishi shart")
    # ✅ Mijoz aynan shu do'konniki bo'lishi shart
    if sale_data.customer_id:
        cust = db.query(models.Customer).filter(
            models.Customer.id       == sale_data.customer_id,
            models.Customer.store_id == sale_data.store_id,
        ).first()
        if not cust:
            raise ValueError("Mijoz topilmadi")

    # ── 3. Receipt number — 3x retry ─────────────────────────
    db_sale = None
    for attempt in range(3):
        try:
            db_sale = models.Sale(
                store_id       = sale_data.store_id,
                employee_id    = employee_id,
                customer_id    = sale_data.customer_id,
                total_amount   = total_amount,
                total_cost     = total_cost,
                total_profit   = total_profit,
                payment_method = sale_data.payment_method,
                paid_amount    = paid_amount,
                change_amount  = change_amount,
                notes          = sale_data.notes,
                receipt_number = _generate_receipt_number(),
                client_uid     = sale_data.client_uid,
            )
            # Oflayn sotuv — haqiqiy sotilgan vaqt bilan yoziladi (kelajak va 30 kundan eski emas)
            if sale_data.is_offline and sale_data.offline_created_at:
                t = to_tashkent(sale_data.offline_created_at).replace(tzinfo=None)
                now = now_tashkent()
                if now - timedelta(days=30) <= t <= now + timedelta(minutes=5):
                    db_sale.created_at = t
            db.add(db_sale)
            db.flush()
            break
        except Exception as e:
            db.rollback()
            # Shu client_uid bilan parallel so'rov allaqachon yozgan bo'lsa — o'shani qaytaramiz
            dup = find_sale_by_client_uid(db, sale_data.store_id, sale_data.client_uid)
            if dup:
                return dup
            logger.error(f"Sale insert error (attempt {attempt + 1}): {e}")
            if attempt == 2:
                raise ValueError("Sotuvni saqlab bo'lmadi. Qaytadan urinib ko'ring.")
            logger.warning(f"Receipt collision, retry {attempt + 1}")

    # ── 4. SaleItem va qoldiq kamaytirish ────────────────────
    shortage_notes = []
    for d in items_data:
        db.add(models.SaleItem(
            sale_id           = db_sale.id,
            product_id        = d["product"].id,
            product_name      = d["product"].name,
            barcode           = d["product"].barcode,
            quantity          = d["quantity"],
            returned_quantity = 0.0,    # ✅ boshlang'ich
            unit_price        = d["unit_price"],
            cost_price        = d["cost_price"],
            discount_percent  = d["discount_percent"],
            discount_amount   = d["discount_amount"],
            subtotal          = d["subtotal"],
            final_amount      = d["final_amount"],
            item_profit       = d["item_profit"],
        ))
        left = round(d["product"].quantity - d["quantity"], 3)
        if left < 0:
            # Faqat oflayn sotuvda bo'lishi mumkin — qoldiq 0 da to'xtaydi, kamomad izohga yoziladi
            shortage_notes.append(f"{d['product'].name}: {abs(left):g} yetmagan")
            left = 0.0
        d["product"].quantity   = left
        d["product"].updated_at = now_tashkent()

    if shortage_notes:
        note = "⚠ Oflayn sotuv, omborda yetmagan: " + "; ".join(shortage_notes)
        db_sale.notes = f"{db_sale.notes}\n{note}" if db_sale.notes else note

    # ── 5. Nasiya → qarz qo'shish ────────────────────────────
    if _safe_val(sale_data.payment_method) == "nasiya" and sale_data.customer_id:
        customer = db.query(models.Customer).filter(
            models.Customer.id == sale_data.customer_id
        ).first()
        if customer:
            debt = round(total_amount - paid_amount, 2)
            if debt > 0:
                customer.current_debt     = round(customer.current_debt     + debt, 2)
                customer.total_debt_given = round(customer.total_debt_given + debt, 2)
            customer.last_purchase_date = now_tashkent()

    db.commit()
    db.refresh(db_sale)
    return db_sale


def get_sale(db: Session, sale_id: int) -> Optional[models.Sale]:
    return db.query(models.Sale).options(
        joinedload(models.Sale.items),
        joinedload(models.Sale.employee),
        joinedload(models.Sale.customer),
        joinedload(models.Sale.returns),
    ).filter(models.Sale.id == sale_id).first()


def get_sales_history(
    db:             Session,
    store_id:       int,
    start_date:     Optional[datetime] = None,
    end_date:       Optional[datetime] = None,
    payment_method: Optional[str]      = None,
    employee_id:    Optional[int]      = None,
    limit:          int                = 100,
    skip:           int                = 0,
    include_cancelled: bool            = False,
) -> List[models.Sale]:
    q = db.query(models.Sale).options(
        joinedload(models.Sale.items).joinedload(models.SaleItem.product),
        joinedload(models.Sale.employee),
        joinedload(models.Sale.customer),
        joinedload(models.Sale.returns),
    ).filter(models.Sale.store_id == store_id)
    if not include_cancelled:
        q = q.filter(models.Sale.is_cancelled == False)  # noqa: E712
    if start_date:
        q = q.filter(models.Sale.created_at >= start_date)
    if end_date:
        q = q.filter(models.Sale.created_at <= end_of_day(end_date))
    if payment_method:
        try:
            pm = models.PaymentMethod(payment_method)
            q  = q.filter(models.Sale.payment_method == pm)
        except ValueError:
            pass
    if employee_id:
        q = q.filter(models.Sale.employee_id == employee_id)

    return q.order_by(desc(models.Sale.created_at)).offset(skip).limit(limit).all()


def cancel_sale(
    db:           Session,
    sale_id:      int,
    cancelled_by: int,
) -> models.Sale:
    """
    ✅ Mahsulot qoldiqlari qaytariladi
    ✅ Nasiya qarz to'g'ri hisob: faqat to'lanmagan qarz qaytariladi
    ✅ SaleItem.returned_quantity RESET (bekor bo'lgani uchun)
    """
    sale = db.query(models.Sale).options(
        joinedload(models.Sale.items)
    ).filter(models.Sale.id == sale_id).first()

    if not sale:
        raise ValueError("Sotuv topilmadi")
    if sale.is_cancelled:
        raise ValueError("Bu sotuv allaqachon bekor qilingan")

    # Mahsulot qoldiqlarini qaytarish
    for item in sale.items:
        product = get_product(db, item.product_id)
        if product:
            # Faqat hali qaytarilmagan miqdorini qaytaramiz
            not_yet_returned = round(item.quantity - item.returned_quantity, 3)
            if not_yet_returned > 0:
                product.quantity   = round(product.quantity + not_yet_returned, 3)
                product.updated_at = now_tashkent()
            item.returned_quantity = item.quantity  # hammasi qaytarildi

    # Nasiya qarzni to'g'ri qaytarish
    if _safe_val(sale.payment_method) == "nasiya" and sale.customer_id:
        customer = db.query(models.Customer).filter(
            models.Customer.id == sale.customer_id
        ).first()
        if customer:
            # Ushbu sotuv uchun qilingan barcha to'lovlar
            paid_via_debt = db.query(func.sum(models.DebtPayment.amount)).filter(
                models.DebtPayment.customer_id == sale.customer_id,
                models.DebtPayment.sale_id     == sale_id,
            ).scalar() or 0.0

            original_debt = round(sale.total_amount - sale.paid_amount, 2)
            remaining     = round(max(0.0, original_debt - paid_via_debt), 2)

            customer.current_debt     = round(max(0.0, customer.current_debt     - remaining), 2)
            customer.total_debt_given = round(max(0.0, customer.total_debt_given - original_debt), 2)

    sale.is_cancelled = True
    sale.cancelled_by = cancelled_by
    db.commit()
    db.refresh(sale)
    return sale


def return_sale_item(
    db:          Session,
    sale_id:     int,
    product_id:  int,
    quantity:    float,
    reason:      Optional[str],
    employee_id: int,
) -> models.SaleReturn:
    """
    Bitta mahsulotni qaytarish.
    ✅ SaleItem.returned_quantity YANGILANADI
    ✅ Sale (Sotuv) summasi, tannarxi va foydasi KAMAYTIRILADI
    ✅ Nasiya bo'lsa, mijozning qarzi KAMAYTIRILADI
    ✅ Product.quantity (ombor) qayta to'ldiriladi
    ✅ SaleReturn yoziladi
    """
    # 1. Sotuv va uning tarkibini olish
    sale = db.query(models.Sale).options(
        joinedload(models.Sale.items)
    ).filter(models.Sale.id == sale_id).first()

    if not sale:
        raise ValueError("Sotuv topilmadi")
    if sale.is_cancelled:
        raise ValueError("Bekor qilingan sotuvdan mahsulot qaytarib bo'lmaydi")

    # 2. Sotilgan mahsulot qatorini (SaleItem) topish
    sale_item = next(
        (i for i in sale.items if i.product_id == product_id), None
    )
    if not sale_item:
        raise ValueError("Bu mahsulot ushbu sotuvda (chekda) mavjud emas")

    # 3. Qaytarish miqdorini tekshirish (oversell return himoyasi)
    max_returnable = round(sale_item.quantity - sale_item.returned_quantity, 3)
    quantity = round(float(quantity), 3)
    
    if quantity > max_returnable:
        raise ValueError(
            f"Xato: Maksimal {max_returnable} {sale_item.product_name} qaytarish mumkin"
        )

    # 4. Moliyaviy summalarni hisoblash
    # refund_amount: mijozga qaytariladigan pul (sotuv narxi bo'yicha)
    # cost_back: qaytayotgan tovarning tannarxi
    # profit_back: ushbu qaytayotgan tovardan qilingan foyda
    # ✅ Chegirma hisobga olinadi: mijoz haqiqatda to'lagan narx bo'yicha qaytariladi
    unit_paid     = (sale_item.final_amount / sale_item.quantity) if sale_item.quantity else 0.0
    refund_amount = round(unit_paid * quantity, 2)
    cost_back     = round(sale_item.cost_price * quantity, 2)
    profit_back   = round(refund_amount - cost_back, 2)

    # 5. Sale (Sotuv) jadvalidagi umumiy summalarni yangilash
    # Bu qism tarixda chek summasi to'g'ri ko'rinishi uchun shart!
    sale.total_amount = round(sale.total_amount - refund_amount, 2)
    sale.total_cost   = round(sale.total_cost - cost_back, 2)
    sale.total_profit = round(sale.total_profit - profit_back, 2)

    # 6. Nasiya bo'lsa, mijozning qarzini kamaytirish
    # payment_method enum yoki string bo'lishi mumkin, shuning uchun tekshiramiz
    is_nasiya = False
    if hasattr(sale.payment_method, "value"):
        is_nasiya = sale.payment_method.value == "nasiya"
    else:
        is_nasiya = str(sale.payment_method) == "nasiya"

    if is_nasiya and sale.customer_id:
        customer = db.query(models.Customer).filter(
            models.Customer.id == sale.customer_id
        ).first()
        if customer:
            # Qarzni refund_amount miqdorida kamaytiramiz (lekin 0 dan pastga tushib ketmasin)
            customer.current_debt = round(max(0.0, customer.current_debt - refund_amount), 2)
            customer.total_debt_given = round(max(0.0, customer.total_debt_given - refund_amount), 2)

    # 7. SaleItem dagi qaytarilgan miqdorni yangilash
    sale_item.returned_quantity = round(sale_item.returned_quantity + quantity, 3)

    # 8. SaleReturn (Qaytarish tarixi) jadvaliga yozish
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    emp_name = emp.full_name if emp else "Noma'lum"

    ret = models.SaleReturn(
        sale_id       = sale_id,
        product_id    = product_id,
        product_name  = sale_item.product_name,
        quantity      = quantity,
        refund_amount = refund_amount,
        reason        = reason,
        employee_id   = employee_id,
        employee_name = emp_name,
    )
    db.add(ret)

    # 9. Mahsulot qoldig'ini (Ombor) qayta to'ldirish
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if product:
        product.quantity   = round(product.quantity + quantity, 3)
        product.updated_at = now_tashkent()

    # 10. Saqlash
    db.commit()
    db.refresh(ret)
    return ret


def get_sale_returns(db: Session, sale_id: int) -> List[models.SaleReturn]:
    return db.query(models.SaleReturn).filter(
        models.SaleReturn.sale_id == sale_id
    ).order_by(models.SaleReturn.created_at).all()


def get_sales_report(
    db:         Session,
    store_id:   int,
    start_date: datetime,
    end_date:   datetime,
) -> dict:
    sales = db.query(models.Sale).filter(
        models.Sale.store_id     == store_id,
        models.Sale.is_cancelled == False,
        models.Sale.created_at   >= start_date,
        models.Sale.created_at   <= end_of_day(end_date),
    ).all()

    breakdown = {"naqd": 0.0, "plastik": 0.0, "nasiya": 0.0}
    for sale in sales:
        m = _safe_val(sale.payment_method)
        if m in breakdown:
            breakdown[m] += sale.total_amount

    return {
        "summary": {
            "total_sales":  round(sum(s.total_amount  for s in sales), 2),
            "total_cost":   round(sum(s.total_cost    for s in sales), 2),
            "total_profit": round(sum(s.total_profit  for s in sales), 2),
            "sales_count":  len(sales),
        },
        "payments": {k: round(v, 2) for k, v in breakdown.items()},
        "period": {
            "start": start_date.isoformat(),
            "end":   end_date.isoformat(),
        },
    }


# ============================================================
# CUSTOMER
# ============================================================

def create_customer(db: Session, data: schemas.CustomerCreate, store_id: int) -> models.Customer:
    c = models.Customer(
        **data.model_dump(exclude={"store_id"}),
        store_id         = store_id,
        current_debt     = 0.0,
        total_debt_given = 0.0,
        total_debt_paid  = 0.0,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def get_customer(db: Session, customer_id: int) -> Optional[models.Customer]:
    return db.query(models.Customer).filter(
        models.Customer.id        == customer_id,
        models.Customer.is_active == True,
    ).first()


def get_store_customers(db: Session, store_id: int) -> List[models.Customer]:
    return db.query(models.Customer).filter(
        models.Customer.store_id  == store_id,
        models.Customer.is_active == True,
    ).order_by(models.Customer.full_name).all()


def search_customers(db: Session, store_id: int, query: str = "") -> List[models.Customer]:
    q = db.query(models.Customer).filter(
        models.Customer.store_id  == store_id,
        models.Customer.is_active == True,
    )
    if query:
        q = q.filter(or_(
            models.Customer.full_name.ilike(f"%{query}%"),
            models.Customer.phone.ilike(f"%{query}%"),
        ))
    return q.order_by(models.Customer.full_name).all()


def update_customer(db: Session, customer_id: int, data: schemas.CustomerUpdate) -> Optional[models.Customer]:
    c = get_customer(db, customer_id)
    if not c:
        return None
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    db.refresh(c)
    return c


def get_customers_with_debt(db: Session, store_id: int) -> List[models.Customer]:
    return db.query(models.Customer).filter(
        models.Customer.store_id   == store_id,
        models.Customer.is_active  == True,
        models.Customer.current_debt > 0,
    ).order_by(desc(models.Customer.current_debt)).all()


def create_debt_payment(
    db:          Session,
    data:        schemas.DebtPaymentCreate,
    received_by: int,
) -> models.DebtPayment:
    customer = get_customer(db, data.customer_id)
    if not customer:
        raise ValueError("Mijoz topilmadi")
    if round(data.amount, 2) > round(customer.current_debt, 2):
        raise ValueError(
            f"To'lov ({data.amount}) qarzdan ({customer.current_debt}) katta"
        )
    payment = models.DebtPayment(
        customer_id    = data.customer_id,
        amount         = data.amount,
        payment_method = data.payment_method,
        comment        = data.comment,
        received_by    = received_by,
    )
    db.add(payment)
    customer.current_debt    = round(customer.current_debt    - data.amount, 2)
    customer.total_debt_paid = round(customer.total_debt_paid + data.amount, 2)
    db.commit()
    db.refresh(payment)
    return payment


def get_customer_history(
    db:          Session,
    customer_id: int,
    limit:       int = 50,
) -> list:
    """Sotuvlar + to'lovlar — birlashtirilgan tarix"""
    sales = db.query(models.Sale).options(
        joinedload(models.Sale.items)
    ).filter(
        models.Sale.customer_id  == customer_id,
        models.Sale.is_cancelled == False,
    ).order_by(desc(models.Sale.created_at)).limit(limit).all()

    payments = db.query(models.DebtPayment).filter(
        models.DebtPayment.customer_id == customer_id,
    ).order_by(desc(models.DebtPayment.payment_date)).limit(limit).all()

    history = []
    for s in sales:
        history.append({
            "type":    "sale",
            "date":    s.created_at.isoformat(),
            "amount":  s.total_amount,
            "paid":    s.paid_amount,
            "debt":    round(s.total_amount - s.paid_amount, 2),
            "receipt": s.receipt_number,
            "method":  _safe_val(s.payment_method),
            "items": [
                {
                    "name":  i.product_name,
                    "qty":   i.net_quantity,        # ✅ net (qaytarilganlar chiqarilib)
                    "price": i.unit_price,
                }
                for i in s.items
            ],
        })
    for p in payments:
        history.append({
            "type":   "payment",
            "date":   p.payment_date.isoformat(),
            "amount": p.amount,
            "method": _safe_val(p.payment_method),
            "note":   p.comment,
        })

    history.sort(key=lambda x: x["date"], reverse=True)
    return history[:limit]


# ============================================================
# SUPPLIER
# ============================================================

def create_supplier(db: Session, data: schemas.SupplierCreate, store_id: int) -> models.Supplier:
    s = models.Supplier(**data.model_dump(), store_id=store_id)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def get_supplier(db: Session, supplier_id: int) -> Optional[models.Supplier]:
    return db.query(models.Supplier).filter(
        models.Supplier.id        == supplier_id,
        models.Supplier.is_active == True,
    ).first()


def get_store_suppliers(db: Session, store_id: int) -> List[models.Supplier]:
    return db.query(models.Supplier).filter(
        models.Supplier.store_id  == store_id,
        models.Supplier.is_active == True,
    ).order_by(models.Supplier.name).all()


def create_supply_batch(
    db:         Session,
    data:       schemas.SupplyBatchCreate,
    store_id:   int,
    created_by: int,
) -> models.SupplyBatch:
    """
    ✅ supply_type=restock (kirim tarixida to'g'ri ko'rinadi)
    ✅ is_paid=False → supplier.current_debt yangilanadi
    ✅ store_id yoziladi
    """
    product = get_product(db, data.product_id)
    if not product:
        raise ValueError("Mahsulot topilmadi")

    total_cost = round(data.quantity_received * data.supply_price, 2)

    batch = models.SupplyBatch(
        store_id          = store_id,
        product_id        = data.product_id,
        supplier_id       = data.supplier_id,
        supply_type       = models.SupplyType.restock,    # ← kirim tarixida 'Yetkazib beruvchi'
        quantity_received = data.quantity_received,
        supply_price      = data.supply_price,
        price_out         = data.price_out,
        total_cost        = total_cost,
        is_paid           = data.is_paid,
        created_by        = created_by,
    )
    db.add(batch)

    product.quantity   = round(product.quantity + data.quantity_received, 3)
    product.price_in   = data.supply_price
    product.updated_at = now_tashkent()
    if data.price_out and data.price_out > 0:
        product.price_out = data.price_out

    # ✅ To'lanmagan → supplier qarzini yangilash
    if not data.is_paid and data.supplier_id:
        supplier = get_supplier(db, data.supplier_id)
        if supplier:
            supplier.current_debt   = round(supplier.current_debt   + total_cost, 2)
            supplier.total_supplied = round(supplier.total_supplied + total_cost, 2)

    db.commit()
    db.refresh(batch)
    return batch


def get_supply_history(
    db:          Session,
    store_id:    int,
    product_id:  Optional[int]      = None,
    supplier_id: Optional[int]      = None,
    start_date:  Optional[datetime] = None,
    end_date:    Optional[datetime] = None,
    supply_type: Optional[str]      = None,
    limit:       int                = 100,
) -> List[models.SupplyBatch]:
    q = db.query(models.SupplyBatch).options(
        joinedload(models.SupplyBatch.product),
        joinedload(models.SupplyBatch.supplier),
        joinedload(models.SupplyBatch.creator),
    ).filter(
        models.SupplyBatch.store_id == store_id
    )
    if product_id:
        q = q.filter(models.SupplyBatch.product_id == product_id)
    if supplier_id:
        q = q.filter(models.SupplyBatch.supplier_id == supplier_id)
    if start_date:
        q = q.filter(models.SupplyBatch.created_at >= start_date)
    if end_date:
        q = q.filter(models.SupplyBatch.created_at <= end_of_day(end_date))
    if supply_type:
        try:
            st = models.SupplyType(supply_type)
            q  = q.filter(models.SupplyBatch.supply_type == st)
        except ValueError:
            pass
    return q.order_by(desc(models.SupplyBatch.created_at)).limit(limit).all()


def create_supplier_payment(
    db:      Session,
    data:    schemas.SupplierPaymentCreate,
    paid_by: int,
) -> models.SupplierPayment:
    supplier = get_supplier(db, data.supplier_id)
    if not supplier:
        raise ValueError("Ta'minotchi topilmadi")
    if round(data.amount, 2) > round(supplier.current_debt, 2):
        raise ValueError(
            f"To'lov ({data.amount}) qarzdan ({supplier.current_debt}) katta"
        )
    payment = models.SupplierPayment(
        **data.model_dump(),
        paid_by=paid_by,
    )
    db.add(payment)
    supplier.current_debt = round(supplier.current_debt - data.amount, 2)
    supplier.total_paid   = round(supplier.total_paid   + data.amount, 2)
    db.commit()
    db.refresh(payment)
    return payment


# ============================================================
# EXPENSE
# ============================================================

def create_expense(
    db:          Session,
    data:        schemas.ExpenseCreate,
    store_id:    int,
    employee_id: int,
) -> models.Expense:
    exp = models.Expense(
        **data.model_dump(exclude={"store_id"}),
        store_id   = store_id,
        created_by = employee_id,
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return exp


def get_store_expenses(
    db:         Session,
    store_id:   int,
    start_date: Optional[datetime] = None,
    end_date:   Optional[datetime] = None,
    limit:      int                = 100,
) -> List[models.Expense]:
    q = db.query(models.Expense).filter(models.Expense.store_id == store_id)
    if start_date:
        q = q.filter(models.Expense.created_at >= start_date)
    if end_date:
        q = q.filter(models.Expense.created_at <= end_of_day(end_date))
    return q.order_by(desc(models.Expense.created_at)).limit(limit).all()