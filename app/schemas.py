"""
NovaPOS — Pydantic Schemas v2.1
=================================
Tuzatilgan muammolar:
  ✅ SaleItemOut — returned_quantity, net_quantity qo'shildi
     (frontend sotuv tarixida qaytarilgan miqdorni to'g'ri ko'radi)
  ✅ SupplyBatchOut — supply_type, notes, creator qo'shildi
  ✅ SaleWithItems.payment_method — PaymentMethod enum
  ✅ AIProductScan schema
  ✅ Pydantic v2 model_config
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator
from pydantic import ConfigDict
from typing import List, Optional, Any
from datetime import datetime
from app.models import UnitType, PaymentMethod, EmployeeRole


# ─── Base config ─────────────────────────────────────────────
class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ============================================
# STORE
# ============================================

class StoreBase(BaseModel):
    name:    str
    address: Optional[str] = None
    phone:   Optional[str] = None

class StoreCreate(StoreBase):
    pass

class StoreOut(_Base):
    id:                      int
    name:                    str
    phone:                   Optional[str]
    address:                 Optional[str]
    is_active:               bool
    payment_status:          str
    subscription_expires_at: Optional[datetime]
    created_at:              datetime


# ============================================
# EMPLOYEE
# ============================================

class EmployeeBase(BaseModel):
    full_name: str
    username:  str
    role:      EmployeeRole = EmployeeRole.admin

class EmployeeCreate(EmployeeBase):
    password:  str = Field(..., min_length=4)
    pin_code:  str = Field(..., min_length=4, max_length=8)
    store_id:  Optional[int] = None

class EmployeeUpdate(BaseModel):
    full_name: Optional[str]         = None
    role:      Optional[EmployeeRole]= None
    is_active: Optional[bool]        = None
    password:  Optional[str]         = Field(None, min_length=4)
    pin_code:  Optional[str]         = Field(None, min_length=4, max_length=8)

class EmployeeOut(_Base):
    id:           int
    store_id:     int
    full_name:    str
    username:     str
    role:         EmployeeRole
    is_active:    bool
    created_at:   datetime
    last_seen_at: Optional[datetime] = None


# ============================================
# CATEGORY
# ============================================

class CategoryBase(BaseModel):
    name:        str
    description: Optional[str] = None

class CategoryCreate(CategoryBase):
    store_id: Optional[int] = None

class CategoryOut(_Base):
    id:          int
    store_id:    int
    name:        str
    description: Optional[str]
    is_active:   bool
    created_at:  datetime


# ============================================
# PRODUCT
# ============================================

class ProductBase(BaseModel):
    name:            str
    barcode:         Optional[str]   = None
    short_code:      Optional[str]   = None
    sku:             Optional[str]   = None
    unit_type:       UnitType        = UnitType.dona
    price_in:        float           = Field(ge=0)
    price_out:       float           = Field(ge=0)
    quantity:        float           = Field(default=0.0, ge=0)
    min_stock_limit: float           = Field(default=2.0, ge=0)
    max_stock_limit: Optional[float] = None
    category_id:     Optional[int]   = None
    description:     Optional[str]   = None
    image_url:       Optional[str]   = None

class ProductCreate(ProductBase):
    store_id: Optional[int] = None

class ProductUpdate(BaseModel):
    name:            Optional[str]      = None
    category_id:     Optional[int]      = None
    price_in:        Optional[float]    = Field(None, ge=0)
    price_out:       Optional[float]    = Field(None, ge=0)
    quantity:        Optional[float]    = Field(None, ge=0)
    barcode:         Optional[str]      = None
    short_code:      Optional[str]      = None
    unit_type:       Optional[UnitType] = None
    min_stock_limit: Optional[float]    = None
    description:     Optional[str]      = None
    image_url:       Optional[str]      = None

class ProductOut(_Base):
    id:              int
    store_id:        int
    name:            str
    barcode:         Optional[str]
    short_code:      Optional[str]
    sku:             Optional[str]
    unit_type:       UnitType
    price_in:        float
    price_out:       float
    quantity:        float
    min_stock_limit: float
    max_stock_limit: Optional[float]
    category_id:     Optional[int]
    category_name:   Optional[str] = "Kategoriyasiz"
    description:     Optional[str]
    image_url:       Optional[str]
    is_deleted:      bool
    created_at:      datetime
    updated_at:      Optional[datetime] = None


# ============================================
# SALE
# ============================================

class SaleItemCreate(BaseModel):
    product_id:       int
    quantity:         float = Field(gt=0)
    price_out:        Optional[float] = None
    discount_percent: float = Field(default=0.0, ge=0, le=100)

class SaleCreate(BaseModel):
    store_id:       int
    customer_id:    Optional[int] = None
    items:          List[SaleItemCreate]
    payment_method: PaymentMethod
    paid_amount:    float = Field(ge=0)
    notes:          Optional[str] = None

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("Savat bo'sh bo'lishi mumkin emas")
        return v


class SaleItemOut(_Base):
    """
    Sotuv elementi javobi.
    ✅ returned_quantity — qaytarilgan miqdor
    ✅ net_quantity      — haqiqiy sotilgan (qaytarilganlar chiqarilib)
    """
    id:                int
    product_id:        int
    product_name:      str
    barcode:           Optional[str]
    quantity:          float           # Dastlabki sotilgan miqdor
    returned_quantity: float = 0.0    # Qaytarilgan miqdor
    unit_price:        float
    cost_price:        float
    discount_percent:  float
    discount_amount:   float
    subtotal:          float
    final_amount:      float
    item_profit:       float

    @property
    def total(self) -> float:
        return self.final_amount

    @property
    def net_quantity(self) -> float:
        """Haqiqiy sotilgan = dastlabki - qaytarilgan"""
        return round(self.quantity - self.returned_quantity, 3)

    model_config = ConfigDict(from_attributes=True)


class SaleReturnOut(_Base):
    id:            int
    sale_id:       int
    product_id:    Optional[int]
    product_name:  Optional[str]
    quantity:      float
    refund_amount: float
    reason:        Optional[str]
    employee_name: Optional[str]
    created_at:    datetime


class SaleListItem(_Base):
    id:             int
    receipt_number: str
    total_amount:   float
    paid_amount:    float
    payment_method: str
    customer_id:    Optional[int]
    customer_name:  Optional[str] = None
    employee_name:  Optional[str] = None
    is_cancelled:   bool
    created_at:     datetime
    items:          List[SaleItemOut] = []
    returns:        List[SaleReturnOut] = []

    @field_validator("payment_method", mode="before")
    @classmethod
    def payment_to_str(cls, v):
        return v.value if hasattr(v, "value") else str(v)


class SaleOut(_Base):
    id:             int
    receipt_number: str
    store_id:       int
    total_amount:   float
    total_cost:     float
    total_profit:   float
    paid_amount:    float
    change_amount:  float
    payment_method: str
    customer_id:    Optional[int]
    customer_name:  Optional[str] = None
    employee_id:    Optional[int] = None
    employee_name:  Optional[str] = None
    notes:          Optional[str] = None
    is_cancelled:   bool
    created_at:     datetime
    items:          List[SaleItemOut]  = []
    returns:        List[SaleReturnOut]= []

    @field_validator("payment_method", mode="before")
    @classmethod
    def payment_to_str(cls, v):
        return v.value if hasattr(v, "value") else str(v)


# ============================================
# SALE RETURN
# ============================================

class SaleReturnCreate(BaseModel):
    product_id: int
    quantity:   float = Field(gt=0)
    reason:     Optional[str] = None


# ============================================
# CUSTOMER
# ============================================

class CustomerBase(BaseModel):
    full_name: str
    phone:     Optional[str] = None
    address:   Optional[str] = None
    notes:     Optional[str] = None

class CustomerCreate(CustomerBase):
    store_id: Optional[int] = None

class CustomerUpdate(BaseModel):
    full_name: Optional[str]  = None
    phone:     Optional[str]  = None
    address:   Optional[str]  = None
    notes:     Optional[str]  = None
    is_active: Optional[bool] = None

class CustomerOut(_Base):
    id:                 int
    store_id:           int
    full_name:          str
    phone:              Optional[str]
    address:            Optional[str]
    notes:              Optional[str]
    current_debt:       float
    total_debt_given:   float
    total_debt_paid:    float
    is_active:          bool
    created_at:         datetime
    last_purchase_date: Optional[datetime]


# ============================================
# DEBT PAYMENT
# ============================================

class DebtPaymentCreate(BaseModel):
    customer_id:    int
    amount:         float = Field(gt=0)
    payment_method: PaymentMethod = PaymentMethod.naqd
    comment:        Optional[str] = None

class DebtPaymentOut(_Base):
    id:             int
    customer_id:    int
    amount:         float
    payment_method: str
    payment_date:   datetime
    comment:        Optional[str]

    @field_validator("payment_method", mode="before")
    @classmethod
    def payment_to_str(cls, v):
        return v.value if hasattr(v, "value") else str(v)


# ============================================
# SUPPLIER
# ============================================

class SupplierBase(BaseModel):
    name:    str
    phone:   Optional[str] = None
    address: Optional[str] = None
    notes:   Optional[str] = None

class SupplierCreate(SupplierBase):
    pass

class SupplierOut(_Base):
    id:             int
    store_id:       int
    name:           str
    phone:          Optional[str]
    address:        Optional[str]
    notes:          Optional[str]
    current_debt:   float
    total_supplied: float
    total_paid:     float
    is_active:      bool
    created_at:     datetime


# ============================================
# SUPPLY BATCH
# ============================================

class SupplyBatchCreate(BaseModel):
    product_id:        int
    supplier_id:       Optional[int]   = None
    quantity_received: float           = Field(gt=0)
    supply_price:      float           = Field(ge=0)
    price_out:         Optional[float] = Field(None, ge=0)
    is_paid:           bool            = True

class SupplyBatchOut(_Base):
    """
    ✅ supply_type — kirim turi (initial/restock/return/adjust)
    ✅ Frontendda kirim tarixini to'g'ri guruhlash uchun
    """
    id:                int
    store_id:          Optional[int]
    product_id:        int
    product_name:      Optional[str] = None    # joined
    supplier_id:       Optional[int]
    supplier_name:     Optional[str] = None    # joined
    supply_type:       str                     # ← YANGI
    quantity_received: float
    supply_price:      float
    price_out:         Optional[float]
    total_cost:        float
    is_paid:           bool
    notes:             Optional[str] = None
    creator_name:      Optional[str] = None    # joined
    created_at:        datetime

    @field_validator("supply_type", mode="before")
    @classmethod
    def supply_type_to_str(cls, v):
        return v.value if hasattr(v, "value") else str(v)


# ============================================
# SUPPLIER PAYMENT
# ============================================

class SupplierPaymentCreate(BaseModel):
    supplier_id:    int
    amount:         float = Field(gt=0)
    payment_method: PaymentMethod = PaymentMethod.naqd
    comment:        Optional[str] = None


# ============================================
# EXPENSE
# ============================================

class ExpenseCreate(BaseModel):
    store_id: Optional[int] = None
    amount:   float = Field(gt=0)
    category: str
    notes:    Optional[str] = None

class ExpenseOut(_Base):
    id:         int
    store_id:   int
    amount:     float
    category:   str
    notes:      Optional[str]
    created_at: datetime


# ============================================
# STOCK ADJUSTMENT
# ============================================

class StockAdjustmentCreate(BaseModel):
    product_id:   int
    new_quantity: float = Field(ge=0)
    reason:       Optional[str] = None
    notes:        Optional[str] = None

class StockAdjustmentOut(_Base):
    id:           int
    product_id:   int
    old_quantity: float
    new_quantity: float
    difference:   float
    reason:       Optional[str]
    notes:        Optional[str]
    created_at:   datetime


# ============================================
# AI PRODUCT SCAN
# ============================================

class AIScannedProduct(BaseModel):
    name:       str
    quantity:   float           = Field(ge=0, default=0.0)
    price_in:   float           = Field(ge=0, default=0.0)
    price_out:  float           = Field(ge=0, default=0.0)
    unit_type:  str             = "dona"
    barcode:    Optional[str]   = None
    confidence: float           = Field(ge=0, le=1, default=1.0)

class AIScanRequest(BaseModel):
    image_base64: Optional[str] = None
    image_url:    Optional[str] = None
    store_id:     Optional[int] = None

    @model_validator(mode="after")
    def check_image_source(self):
        if not self.image_base64 and not self.image_url:
            raise ValueError("image_base64 yoki image_url kerak")
        return self

class AIScanResponse(BaseModel):
    success:        bool
    products_found: int
    products:       List[AIScannedProduct]
    raw_text:       Optional[str] = None
    error:          Optional[str] = None

class AIProductAdd(BaseModel):
    products: List[dict]
    scan_id:  Optional[int] = None


# ============================================
# CUSTOMER HISTORY
# ============================================

class CustomerHistoryItem(BaseModel):
    name:  str
    qty:   float
    price: float

class CustomerHistoryEntry(BaseModel):
    type:    str
    date:    str
    amount:  float
    paid:    Optional[float] = None
    debt:    Optional[float] = None
    receipt: Optional[str]   = None
    method:  Optional[str]   = None
    note:    Optional[str]   = None
    items:   Optional[List[CustomerHistoryItem]] = None


# ============================================
# WEBSOCKET EVENT SCHEMAS (type hints uchun)
# ============================================

class WSEventSale(BaseModel):
    sale_id:        int
    receipt_number: str
    total_amount:   float
    payment_method: str
    employee_id:    Optional[int]
    employee_name:  Optional[str]
    customer_name:  Optional[str]
    items_count:    int
    created_at:     str

class WSEventStock(BaseModel):
    product_id:   int
    product_name: str
    old_quantity: float
    new_quantity: float
    difference:   float
    is_low_stock: bool = False

class WSEventEmployee(BaseModel):
    employee_id:   int
    employee_name: str
    role:          str
    action:        str
    detail:        Optional[str] = None
    timestamp:     str
    online_count:  int = 0


# ============================================
# AUTH
# ============================================

class LoginRequest(BaseModel):
    username: str
    password: str

class PinLoginRequest(BaseModel):
    username: str
    pin_code: str

class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user_info:    dict

class RegisterRequest(BaseModel):
    store_name: str = Field(..., min_length=2)
    username:   str = Field(..., min_length=3)
    password:   str = Field(..., min_length=6)
    pin_code:   str = Field(..., min_length=4, max_length=8)
    full_name:  str = Field(..., min_length=2)
    phone:      Optional[str] = None