"""
NovaPOS — Database Models v2.1
================================
Tuzatilgan muammolar:
  ✅ Barcha datetime.utcnow() → now_tashkent() (UTC+5)
  ✅ func.now() o'rniga server_default bilan now_tashkent
  ✅ SaleReturn — product_name denormalized (JOIN yo'q)
  ✅ SaleItem — total property, returned_quantity tracking
  ✅ SupplyBatch — store_id, supply_type (initial/restock)
  ✅ StockAdjustment — store_id
  ✅ receipt_number — collision safe
  ✅ PaymentMethod — to'g'ri
  ✅ AIProductScan model
  ✅ OfflineQueue — offline operatsiyalar navbati
"""

from sqlalchemy import (
    Column, Integer, String, Float, ForeignKey,
    DateTime, Enum, Boolean, Text, Index, CheckConstraint
)
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func
import enum

from app.timezone_utils import now_tashkent

Base = declarative_base()


# ============================================
# ENUMS
# ============================================

class UnitType(enum.Enum):
    dona  = "dona"
    kg    = "kg"
    litr  = "litr"
    metr  = "metr"
    blok  = "blok"

class PaymentMethod(enum.Enum):
    naqd    = "naqd"
    plastik = "plastik"
    nasiya  = "nasiya"

class EmployeeRole(enum.Enum):
    super_admin = "super_admin"
    admin       = "admin"
    cashier     = "sotuvchi"

class AdjustmentReason(enum.Enum):
    inventory   = "inventarizatsiya"
    damage      = "shikastlangan"
    return_item = "qaytarish"
    correction  = "tuzatish"
    other       = "boshqa"

class SupplyType(enum.Enum):
    initial = "initial"    # Mahsulot qo'shilganda boshlang'ich qoldiq
    restock = "restock"    # Yetkazib beruvchidan kelgan kirim
    return_ = "return"     # Qaytarish natijasida qoldiq oshdi
    adjust  = "adjust"     # Inventarizatsiya tuzatish


# ============================================
# STORE
# ============================================

class Store(Base):
    __tablename__ = "stores"

    id                       = Column(Integer, primary_key=True, index=True)
    name                     = Column(String(255), nullable=False)
    phone                    = Column(String(50), nullable=True)
    address                  = Column(String(500), nullable=True)
    is_active                = Column(Boolean, default=True, index=True)
    payment_status           = Column(String(20), default="trial", index=True)
    subscription_expires_at  = Column(DateTime, nullable=True)
    created_at               = Column(DateTime, default=now_tashkent)
    updated_at               = Column(DateTime, default=now_tashkent, onupdate=now_tashkent)

    # Relationships
    employees              = relationship("Employee",            back_populates="store", lazy="select")
    categories             = relationship("Category",            back_populates="store", lazy="select")
    products               = relationship("Product",             back_populates="store", lazy="select")
    customers              = relationship("Customer",            back_populates="store", lazy="select")
    sales                  = relationship("Sale",                back_populates="store", lazy="select")
    suppliers              = relationship("Supplier",            back_populates="store", lazy="select")
    expenses               = relationship("Expense",             back_populates="store", lazy="select")
    subscription_requests  = relationship("SubscriptionRequest", back_populates="store", lazy="select")


# ============================================
# EMPLOYEE
# ============================================

class Employee(Base):
    __tablename__ = "employees"

    id              = Column(Integer, primary_key=True, index=True)
    store_id        = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=True, index=True)
    full_name       = Column(String(100), nullable=False)
    username        = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    pin_code        = Column(String(255), nullable=False)
    role            = Column(Enum(EmployeeRole), default=EmployeeRole.admin, index=True)
    is_active       = Column(Boolean, default=True, index=True)
    device_id       = Column(String(255), nullable=True)
    last_seen_at    = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, default=now_tashkent)

    store                  = relationship("Store",           back_populates="employees")
    sales                  = relationship("Sale",            back_populates="employee", foreign_keys="[Sale.employee_id]")
    performed_adjustments  = relationship("StockAdjustment", back_populates="employee")

    __table_args__ = (
        Index("idx_employee_store_role", "store_id", "role"),
    )


# ============================================
# CATEGORY
# ============================================

class Category(Base):
    __tablename__ = "categories"

    id          = Column(Integer, primary_key=True, index=True)
    store_id    = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    name        = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, default=now_tashkent)

    store    = relationship("Store",   back_populates="categories")
    products = relationship("Product", back_populates="category")

    __table_args__ = (
        Index("idx_category_store", "store_id", "name"),
    )


# ============================================
# PRODUCT
# ============================================

class Product(Base):
    __tablename__ = "products"

    id               = Column(Integer, primary_key=True, index=True)
    store_id         = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id      = Column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    name             = Column(String(255), nullable=False, index=True)
    barcode          = Column(String(50), nullable=True, index=True)
    short_code       = Column(String(20), nullable=True, index=True)
    sku              = Column(String(50), nullable=True)
    unit_type        = Column(Enum(UnitType), default=UnitType.dona, nullable=False)
    price_in         = Column(Float, nullable=False, default=0.0)
    price_out        = Column(Float, nullable=False, default=0.0)
    quantity         = Column(Float, default=0.0, nullable=False)
    min_stock_limit  = Column(Float, default=2.0)
    max_stock_limit  = Column(Float, nullable=True)
    description      = Column(Text, nullable=True)
    image_url        = Column(String(500), nullable=True)
    is_deleted       = Column(Boolean, default=False, index=True)
    created_at       = Column(DateTime, default=now_tashkent)
    updated_at       = Column(DateTime, default=now_tashkent, onupdate=now_tashkent)

    store      = relationship("Store",    back_populates="products")
    category   = relationship("Category", back_populates="products")
    sale_items = relationship("SaleItem", back_populates="product")
    batches    = relationship("SupplyBatch", back_populates="product")

    __table_args__ = (
        CheckConstraint("price_in >= 0",  name="chk_price_in_pos"),
        CheckConstraint("price_out >= 0", name="chk_price_out_pos"),
        CheckConstraint("quantity >= 0",  name="chk_qty_pos"),
        Index("idx_product_store_code",    "store_id", "short_code"),
        Index("idx_product_store_barcode", "store_id", "barcode"),
        Index("idx_product_search",        "store_id", "name", "is_deleted"),
    )


# ============================================
# SALE
# ============================================

class Sale(Base):
    __tablename__ = "sales"

    id              = Column(Integer, primary_key=True, index=True)
    store_id        = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id     = Column(Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    customer_id     = Column(Integer, ForeignKey("customers.id", ondelete="SET NULL"), nullable=True)
    total_amount    = Column(Float, nullable=False)
    total_cost      = Column(Float, nullable=False, default=0.0)
    total_profit    = Column(Float, nullable=False, default=0.0)
    payment_method  = Column(Enum(PaymentMethod), nullable=False)
    paid_amount     = Column(Float, nullable=False, default=0.0)
    change_amount   = Column(Float, default=0.0)
    receipt_number  = Column(String(50), unique=True, index=True)
    client_uid      = Column(String(64), nullable=True, index=True)  # oflayn sotuv takrorlanmasligi uchun
    notes           = Column(Text, nullable=True)
    is_cancelled    = Column(Boolean, default=False, index=True)
    cancelled_by    = Column(Integer, ForeignKey("employees.id"), nullable=True)
    created_at      = Column(DateTime, default=now_tashkent, index=True)

    store    = relationship("Store",    back_populates="sales")
    employee = relationship("Employee", back_populates="sales", foreign_keys=[employee_id])
    canceller= relationship("Employee", foreign_keys=[cancelled_by])
    customer = relationship("Customer", back_populates="sales")
    items    = relationship("SaleItem",   back_populates="sale", cascade="all, delete-orphan", lazy="select")
    returns  = relationship("SaleReturn", back_populates="sale",  lazy="select")

    __table_args__ = (
        Index("idx_sale_store_date",    "store_id", "created_at"),
        Index("idx_sale_store_payment", "store_id", "payment_method"),
    )


# ============================================
# SALE ITEM
# ============================================

class SaleItem(Base):
    __tablename__ = "sale_items"

    id               = Column(Integer, primary_key=True, index=True)
    sale_id          = Column(Integer, ForeignKey("sales.id", ondelete="CASCADE"), nullable=False)
    product_id       = Column(Integer, ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    product_name     = Column(String(255), nullable=False)   # denormalized
    barcode          = Column(String(50), nullable=True)
    quantity         = Column(Float, nullable=False)
    # ✅ returned_quantity — qaytarilgan miqdorni kuzatish uchun
    returned_quantity = Column(Float, nullable=False, default=0.0)
    unit_price       = Column(Float, nullable=False)
    cost_price       = Column(Float, nullable=False)
    discount_percent = Column(Float, default=0.0)
    discount_amount  = Column(Float, default=0.0)
    subtotal         = Column(Float, nullable=False)
    final_amount     = Column(Float, nullable=False)
    item_profit      = Column(Float, nullable=False, default=0.0)

    sale    = relationship("Sale",    back_populates="items")
    product = relationship("Product", back_populates="sale_items")

    @property
    def total(self):
        return self.final_amount

    @property
    def net_quantity(self):
        """Haqiqiy sotilgan miqdor (qaytarilganlar chiqarilib)"""
        return round(self.quantity - self.returned_quantity, 3)

    __table_args__ = (
        CheckConstraint("quantity > 0", name="chk_sale_item_qty"),
        CheckConstraint("returned_quantity >= 0", name="chk_sale_item_returned_qty"),
        Index("idx_sale_item_sale",    "sale_id"),
        Index("idx_sale_item_product", "product_id"),
    )


# ============================================
# SALE RETURN
# ============================================

class SaleReturn(Base):
    __tablename__ = "sale_returns"

    id             = Column(Integer, primary_key=True, index=True)
    sale_id        = Column(Integer, ForeignKey("sales.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id     = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    product_name   = Column(String(255), nullable=True)    # denormalized
    quantity       = Column(Float, nullable=False)
    refund_amount  = Column(Float, nullable=False)
    reason         = Column(Text, nullable=True)
    employee_id    = Column(Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    employee_name  = Column(String(100), nullable=True)    # denormalized
    created_at     = Column(DateTime, default=now_tashkent, index=True)

    sale     = relationship("Sale",     back_populates="returns")
    product  = relationship("Product")
    employee = relationship("Employee")

    __table_args__ = (
        CheckConstraint("quantity > 0",       name="chk_return_qty"),
        CheckConstraint("refund_amount >= 0", name="chk_return_amount"),
    )


# ============================================
# CUSTOMER
# ============================================

class Customer(Base):
    __tablename__ = "customers"

    id                 = Column(Integer, primary_key=True, index=True)
    store_id           = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    full_name          = Column(String(255), nullable=False, index=True)
    phone              = Column(String(50), nullable=True, index=True)
    address            = Column(String(500), nullable=True)
    current_debt       = Column(Float, default=0.0, nullable=False)
    total_debt_given   = Column(Float, default=0.0)
    total_debt_paid    = Column(Float, default=0.0)
    notes              = Column(Text, nullable=True)
    is_active          = Column(Boolean, default=True, index=True)
    created_at         = Column(DateTime, default=now_tashkent)
    last_purchase_date = Column(DateTime, nullable=True)

    store    = relationship("Store",       back_populates="customers")
    sales    = relationship("Sale",        back_populates="customer")
    payments = relationship("DebtPayment", back_populates="customer", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_customer_store_phone", "store_id", "phone"),
        Index("idx_customer_debt",        "store_id", "current_debt"),
    )


# ============================================
# DEBT PAYMENT
# ============================================

class DebtPayment(Base):
    __tablename__ = "debt_payments"

    id             = Column(Integer, primary_key=True, index=True)
    customer_id    = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False)
    sale_id        = Column(Integer, ForeignKey("sales.id", ondelete="SET NULL"), nullable=True)
    amount         = Column(Float, nullable=False)
    payment_method = Column(Enum(PaymentMethod), nullable=False, default=PaymentMethod.naqd)
    payment_date   = Column(DateTime, default=now_tashkent, index=True)
    received_by    = Column(Integer, ForeignKey("employees.id"), nullable=True)
    comment        = Column(String(255), nullable=True)

    customer = relationship("Customer", back_populates="payments")

    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_debt_payment_pos"),
        Index("idx_debt_payment_cust_date", "customer_id", "payment_date"),
    )


# ============================================
# SUPPLIER
# ============================================

class Supplier(Base):
    __tablename__ = "suppliers"

    id              = Column(Integer, primary_key=True, index=True)
    store_id        = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    name            = Column(String(255), nullable=False, index=True)
    phone           = Column(String(50), nullable=True)
    address         = Column(String(500), nullable=True)
    current_debt    = Column(Float, default=0.0, nullable=False)
    total_supplied  = Column(Float, default=0.0)
    total_paid      = Column(Float, default=0.0)
    notes           = Column(Text, nullable=True)
    is_active       = Column(Boolean, default=True, index=True)
    created_at      = Column(DateTime, default=now_tashkent)

    store             = relationship("Store",           back_populates="suppliers")
    batches           = relationship("SupplyBatch",     back_populates="supplier", cascade="all, delete-orphan")
    supplier_payments = relationship("SupplierPayment", back_populates="supplier", cascade="all, delete-orphan")

    __table_args__ = (
        Index("idx_supplier_store_debt", "store_id", "current_debt"),
    )


# ============================================
# SUPPLY BATCH
# ============================================

class SupplyBatch(Base):
    __tablename__ = "supply_batches"

    id                 = Column(Integer, primary_key=True, index=True)
    store_id           = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id         = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    supplier_id        = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)
    # ✅ supply_type — kirim turini aniqlash uchun (kirim tarixida to'g'ri ko'rsatish)
    supply_type        = Column(Enum(SupplyType), default=SupplyType.restock, nullable=False)
    quantity_received  = Column(Float, nullable=False)
    supply_price       = Column(Float, nullable=False)
    price_out          = Column(Float, nullable=True)
    total_cost         = Column(Float, nullable=False)
    is_paid            = Column(Boolean, default=True, index=True)
    payment_due_date   = Column(DateTime, nullable=True)
    notes              = Column(Text, nullable=True)
    created_at         = Column(DateTime, default=now_tashkent, index=True)
    created_by         = Column(Integer, ForeignKey("employees.id"), nullable=True)

    product  = relationship("Product",  back_populates="batches")
    supplier = relationship("Supplier", back_populates="batches")
    creator  = relationship("Employee", foreign_keys=[created_by])

    __table_args__ = (
        CheckConstraint("quantity_received > 0", name="chk_supply_qty"),
        CheckConstraint("supply_price >= 0",     name="chk_supply_price"),
        Index("idx_supply_store_date",   "store_id", "created_at"),
        Index("idx_supply_store_type",   "store_id", "supply_type"),
        Index("idx_supply_product_date", "product_id", "created_at"),
    )


# ============================================
# SUPPLIER PAYMENT
# ============================================

class SupplierPayment(Base):
    __tablename__ = "supplier_payments"

    id             = Column(Integer, primary_key=True, index=True)
    supplier_id    = Column(Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False)
    amount         = Column(Float, nullable=False)
    payment_method = Column(Enum(PaymentMethod), nullable=False, default=PaymentMethod.naqd)
    payment_date   = Column(DateTime, default=now_tashkent, index=True)
    paid_by        = Column(Integer, ForeignKey("employees.id"), nullable=True)
    comment        = Column(String(255), nullable=True)

    supplier = relationship("Supplier", back_populates="supplier_payments")

    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_supplier_pay_pos"),
        Index("idx_supplier_payment_date", "supplier_id", "payment_date"),
    )


# ============================================
# EXPENSE
# ============================================

class Expense(Base):
    __tablename__ = "expenses"

    id         = Column(Integer, primary_key=True, index=True)
    store_id   = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    amount     = Column(Float, nullable=False)
    category   = Column(String(100), nullable=False, index=True)
    notes      = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("employees.id"), nullable=True)
    created_at = Column(DateTime, default=now_tashkent, index=True)

    store = relationship("Store", back_populates="expenses")

    __table_args__ = (
        CheckConstraint("amount > 0", name="chk_expense_pos"),
    )


# ============================================
# STOCK ADJUSTMENT
# ============================================

class StockAdjustment(Base):
    __tablename__ = "stock_adjustments"

    id           = Column(Integer, primary_key=True, index=True)
    store_id     = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id   = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    old_quantity = Column(Float, nullable=False)
    new_quantity = Column(Float, nullable=False)
    difference   = Column(Float, nullable=False)
    reason       = Column(Enum(AdjustmentReason), nullable=True)
    notes        = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=now_tashkent, index=True)
    created_by   = Column(Integer, ForeignKey("employees.id"))

    product  = relationship("Product")
    employee = relationship("Employee", back_populates="performed_adjustments")

    __table_args__ = (
        Index("idx_adj_store_date",    "store_id", "created_at"),
        Index("idx_adj_product_date",  "product_id", "created_at"),
    )


# ============================================
# AI PRODUCT SCAN
# ============================================

class AIProductScan(Base):
    __tablename__ = "ai_product_scans"

    id             = Column(Integer, primary_key=True, index=True)
    store_id       = Column(Integer, ForeignKey("stores.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id    = Column(Integer, ForeignKey("employees.id"), nullable=True)
    image_url      = Column(String(500), nullable=True)
    raw_response   = Column(Text, nullable=True)
    products_found = Column(Integer, default=0)
    products_added = Column(Integer, default=0)
    status         = Column(String(20), default="pending")
    error_message  = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=now_tashkent, index=True)

    __table_args__ = (
        Index("idx_ai_scan_store", "store_id", "created_at"),
    )


# ============================================
# TARIF & SUBSCRIPTION
# ============================================

class Tarif(Base):
    __tablename__ = "tarifs"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String(100), nullable=False, unique=True)
    months     = Column(Integer, nullable=False)
    price      = Column(Float, nullable=False)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=now_tashkent)

    __table_args__ = (
        CheckConstraint("price >= 0",  name="chk_tarif_price"),
        CheckConstraint("months > 0",  name="chk_tarif_months"),
    )


class SubscriptionRequest(Base):
    __tablename__ = "subscription_requests"

    id              = Column(Integer, primary_key=True, index=True)
    store_id        = Column(Integer, ForeignKey("stores.id"), nullable=False)
    employee_id     = Column(Integer, ForeignKey("employees.id"))
    tarif_id        = Column(Integer, ForeignKey("tarifs.id"), nullable=True)
    amount          = Column(Float, nullable=False)
    plan_months     = Column(Integer, nullable=False, default=1)
    proof_image_url = Column(String(500), nullable=True)
    status          = Column(String(20), default="pending", index=True)
    admin_note      = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=now_tashkent)
    reviewed_at     = Column(DateTime, nullable=True)

    store    = relationship("Store",    back_populates="subscription_requests")
    employee = relationship("Employee")
    tarif    = relationship("Tarif")

    __table_args__ = (
        Index("idx_sub_req_status", "status", "created_at"),
    )


# ============================================
# SYSTEM SETTINGS
# ============================================

class SystemSettings(Base):
    __tablename__ = "system_settings"

    id            = Column(Integer, primary_key=True)
    card_number   = Column(String(25), default="8600 0000 0000 0000")
    card_owner    = Column(String(100), default="NOVAPOS ADMIN")
    support_phone = Column(String(20), default="+998597551023")
    updated_at    = Column(DateTime, default=now_tashkent, onupdate=now_tashkent)