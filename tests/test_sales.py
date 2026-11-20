"""Kassa: sotuv, qoldiq, chegirma, nasiya, oflayn sotuv, bekor qilish, qaytarish."""
import uuid
from datetime import timedelta

import pytest

from app.timezone_utils import now_tashkent


def _qty(api, pid):
    return api.get(f"/api/products/{pid}").json()["quantity"]


# ─── Oddiy sotuv ──────────────────────────────────────────────

def test_cash_sale_decreases_stock(owner):
    p = owner.product(quantity=10, price_out=1500)
    sale = owner.sell([(p, 3)])
    assert sale["total_amount"] == 4500
    assert sale["receipt_number"]
    assert _qty(owner, p["id"]) == 7


def test_sale_change_amount(owner):
    p = owner.product(price_out=1500)
    sale = owner.sell([(p, 1)], paid=2000)
    assert sale["paid_amount"] == 2000
    assert sale["change_amount"] == 500


def test_multi_item_sale_total(owner):
    a = owner.product(price_out=1000)
    b = owner.product(price_out=2500)
    sale = owner.sell([(a, 2), (b, 3)])
    assert sale["total_amount"] == 2 * 1000 + 3 * 2500
    assert len(sale["items"]) == 2


def test_fractional_quantity_kg(owner):
    p = owner.product(unit_type="kg", quantity=5, price_in=10000, price_out=20000)
    sale = owner.sell([(p, 1.25)])
    assert sale["total_amount"] == 25000
    assert _qty(owner, p["id"]) == pytest.approx(3.75)
    assert sale["items"][0]["unit_type"] == "kg"


def test_oversell_rejected(owner):
    p = owner.product(quantity=2)
    r = owner.sell([(p, 3)], expect=400)
    assert "yetarli emas" in r["detail"]
    assert _qty(owner, p["id"]) == 2


def test_oversell_rejected_atomically(owner):
    """Bitta mahsulot yetmasa — butun sotuv rad etiladi, boshqa qoldiqlar o'zgarmaydi."""
    ok = owner.product(quantity=10)
    short = owner.product(quantity=1)
    owner.sell([(ok, 2), (short, 5)], expect=400)
    assert _qty(owner, ok["id"]) == 10


def test_sale_zero_quantity_rejected(owner):
    p = owner.product()
    r = owner.post("/api/sales/checkout", {"store_id": owner.store_id, "payment_method": "naqd", "paid_amount": 0,
                                           "items": [{"product_id": p["id"], "quantity": 0}]})
    assert r.status_code == 422


def test_sale_unknown_product(owner):
    r = owner.post("/api/sales/checkout", {"store_id": owner.store_id, "payment_method": "naqd", "paid_amount": 0,
                                           "items": [{"product_id": 999999, "quantity": 1}]})
    assert r.status_code == 400


def test_sale_deleted_product_rejected(owner):
    p = owner.product()
    owner.delete(f"/api/products/{p['id']}")
    owner.sell([(p, 1)], expect=400)


def test_sale_invalid_payment_method(owner):
    p = owner.product()
    r = owner.post("/api/sales/checkout", {"store_id": owner.store_id, "payment_method": "bitcoin", "paid_amount": 0,
                                           "items": [{"product_id": p["id"], "quantity": 1}]})
    assert r.status_code == 422


def test_plastik_sale(owner):
    p = owner.product()
    sale = owner.sell([(p, 1)], payment_method="plastik")
    assert sale["payment_method"] == "plastik"


def test_store_id_taken_from_token(owner, other_owner):
    """Brauzer boshqa do'kon ID sini yuborsa ham sotuv o'z do'koniga yoziladi."""
    p = owner.product()
    r = owner.post("/api/sales/checkout", {"store_id": other_owner.store_id, "payment_method": "naqd",
                                           "paid_amount": 1500, "items": [{"product_id": p["id"], "quantity": 1}]})
    assert r.status_code == 200
    assert owner.get(f"/api/sales/{r.json()['id']}").status_code == 200


# ─── Narx va chegirma ─────────────────────────────────────────

def test_custom_price(owner):
    p = owner.product(price_in=1000, price_out=1500)
    sale = owner.sell([(p, 2, {"price_out": 1800})])
    assert sale["total_amount"] == 3600


def test_item_discount_percent(owner):
    p = owner.product(price_in=1000, price_out=2000)
    sale = owner.sell([(p, 2, {"discount_percent": 10})], paid=3600)
    assert sale["total_amount"] == 3600
    it = sale["items"][0]
    assert it["discount_amount"] == 400
    assert it["final_amount"] == 3600


def test_discount_over_100_rejected(owner):
    p = owner.product()
    r = owner.post("/api/sales/checkout", {"store_id": owner.store_id, "payment_method": "naqd", "paid_amount": 0,
                                           "items": [{"product_id": p["id"], "quantity": 1, "discount_percent": 150}]})
    assert r.status_code == 422


def test_profit_after_discount(owner):
    p = owner.product(price_in=1000, price_out=2000)
    sale = owner.sell([(p, 1, {"discount_percent": 25})], paid=1500)
    detail = owner.get(f"/api/sales/{sale['id']}").json()
    assert detail["items"][0]["item_profit"] == 500


def test_admin_can_sell_below_cost(owner):
    p = owner.product(price_in=1000, price_out=1500)
    sale = owner.sell([(p, 1, {"price_out": 800})])
    assert sale["total_amount"] == 800


def test_cashier_cannot_sell_below_cost(owner, cashier):
    p = owner.product(price_in=1000, price_out=1500)
    r = cashier.sell([(p, 1, {"price_out": 800})], expect=400)
    assert "tannarx" in r["detail"]


def test_negative_price_rejected(owner):
    p = owner.product()
    owner.sell([(p, 1, {"price_out": -5})], paid=0, expect=400)


# ─── Nasiya ───────────────────────────────────────────────────

def test_nasiya_requires_customer(owner):
    p = owner.product()
    r = owner.sell([(p, 1)], payment_method="nasiya", paid=0, expect=400)
    assert "mijoz" in r["detail"].lower()


def test_nasiya_adds_debt(owner):
    p = owner.product(price_out=10000)
    c = owner.customer()
    owner.sell([(p, 2)], payment_method="nasiya", paid=5000, customer_id=c["id"])
    cust = owner.get(f"/api/customers/{c['id']}").json()
    assert cust["current_debt"] == 15000
    assert cust["total_debt_given"] == 15000


def test_nasiya_fully_paid_no_debt(owner):
    p = owner.product(price_out=10000)
    c = owner.customer()
    owner.sell([(p, 1)], payment_method="nasiya", paid=10000, customer_id=c["id"])
    assert owner.get(f"/api/customers/{c['id']}").json()["current_debt"] == 0


def test_sale_with_foreign_customer_rejected(owner, other_owner):
    p = owner.product()
    c = other_owner.customer()
    owner.sell([(p, 1)], payment_method="nasiya", paid=0, customer_id=c["id"], expect=400)


# ─── Oflayn sotuv ─────────────────────────────────────────────

def test_offline_sale_idempotent_by_client_uid(owner):
    p = owner.product(quantity=10)
    uid = uuid.uuid4().hex
    s1 = owner.sell([(p, 2)], client_uid=uid, is_offline=True)
    s2 = owner.sell([(p, 2)], client_uid=uid, is_offline=True)
    assert s1["id"] == s2["id"]
    assert _qty(owner, p["id"]) == 8


def test_same_client_uid_different_stores(owner, other_owner):
    uid = uuid.uuid4().hex
    a = owner.sell([(owner.product(), 1)], client_uid=uid)
    b = other_owner.sell([(other_owner.product(), 1)], client_uid=uid)
    assert a["id"] != b["id"]


def test_offline_sale_allowed_when_stock_short(owner):
    """Tovar allaqachon mijozga berilgan — oflayn sotuv yoziladi, qoldiq 0 da to'xtaydi."""
    p = owner.product(quantity=1)
    sale = owner.sell([(p, 3)], is_offline=True, client_uid=uuid.uuid4().hex)
    assert _qty(owner, p["id"]) == 0
    assert "yetmagan" in owner.get(f"/api/sales/{sale['id']}").json()["notes"]


def test_offline_sale_keeps_original_time(owner):
    """Brauzer vaqtni UTC da yuboradi (toISOString) — server Toshkent vaqtiga o'giradi."""
    from datetime import datetime, timezone
    t_utc = datetime.now(timezone.utc) - timedelta(hours=3)
    sale = owner.sell([(owner.product(), 1)], is_offline=True, client_uid=uuid.uuid4().hex,
                      offline_created_at=t_utc.isoformat().replace("+00:00", "Z"))
    expected = (t_utc + timedelta(hours=5)).replace(tzinfo=None)
    assert sale["created_at"].startswith(expected.isoformat()[:16])


def test_offline_sale_future_time_ignored(owner):
    t = now_tashkent() + timedelta(days=2)
    sale = owner.sell([(owner.product(), 1)], is_offline=True, client_uid=uuid.uuid4().hex,
                      offline_created_at=t.isoformat())
    assert not sale["created_at"].startswith(t.date().isoformat())


def test_client_uid_too_long_rejected(owner):
    p = owner.product()
    r = owner.post("/api/sales/checkout", {"store_id": owner.store_id, "payment_method": "naqd", "paid_amount": 1500,
                                           "client_uid": "x" * 65, "items": [{"product_id": p["id"], "quantity": 1}]})
    assert r.status_code == 422


# ─── Bekor qilish ─────────────────────────────────────────────

def test_cancel_restores_stock(owner):
    p = owner.product(quantity=10)
    sale = owner.sell([(p, 4)])
    r = owner.post(f"/api/sales/{sale['id']}/cancel")
    assert r.status_code == 200, r.text
    assert _qty(owner, p["id"]) == 10
    assert owner.get(f"/api/sales/{sale['id']}").json()["is_cancelled"] is True


def test_cancel_twice_rejected(owner):
    sale = owner.sell([(owner.product(), 1)])
    owner.post(f"/api/sales/{sale['id']}/cancel")
    assert owner.post(f"/api/sales/{sale['id']}/cancel").status_code == 400


def test_cancel_nasiya_removes_debt(owner):
    p = owner.product(price_out=10000)
    c = owner.customer()
    sale = owner.sell([(p, 1)], payment_method="nasiya", paid=0, customer_id=c["id"])
    owner.post(f"/api/sales/{sale['id']}/cancel")
    assert owner.get(f"/api/customers/{c['id']}").json()["current_debt"] == 0


def test_cashier_cannot_cancel(owner, cashier):
    sale = cashier.sell([(owner.product(), 1)])
    assert cashier.post(f"/api/sales/{sale['id']}/cancel").status_code == 403


def test_cancel_after_partial_return(owner):
    p = owner.product(quantity=10)
    sale = owner.sell([(p, 5)])
    owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 2})
    owner.post(f"/api/sales/{sale['id']}/cancel")
    assert _qty(owner, p["id"]) == 10


# ─── Qaytarish ────────────────────────────────────────────────

def test_partial_return(owner):
    p = owner.product(quantity=10, price_out=1500)
    sale = owner.sell([(p, 4)])
    r = owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1, "reason": "buzuq"})
    assert r.status_code == 200, r.text
    assert _qty(owner, p["id"]) == 7
    d = owner.get(f"/api/sales/{sale['id']}").json()
    assert d["total_amount"] == 4500
    assert d["items"][0]["quantity"] == 3
    assert d["refunded_amount"] == 1500


def test_return_more_than_sold_rejected(owner):
    p = owner.product()
    sale = owner.sell([(p, 2)])
    r = owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 3})
    assert r.status_code == 400


def test_return_cumulative_limit(owner):
    p = owner.product()
    sale = owner.sell([(p, 2)])
    assert owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 2}).status_code == 200
    assert owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1}).status_code == 400


def test_full_return_marks_fully_returned(owner):
    p = owner.product()
    sale = owner.sell([(p, 2)])
    owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 2})
    d = owner.get(f"/api/sales/{sale['id']}").json()
    assert d["fully_returned"] is True
    assert d["items"] == []


def test_return_product_not_in_sale(owner):
    sale = owner.sell([(owner.product(), 1)])
    other = owner.product()
    assert owner.post(f"/api/sales/{sale['id']}/return", {"product_id": other["id"], "quantity": 1}).status_code == 400


def test_return_from_cancelled_sale_rejected(owner):
    p = owner.product()
    sale = owner.sell([(p, 1)])
    owner.post(f"/api/sales/{sale['id']}/cancel")
    assert owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1}).status_code == 400


def test_return_refund_uses_discounted_price(owner):
    p = owner.product(price_in=1000, price_out=2000)
    sale = owner.sell([(p, 2, {"discount_percent": 50})], paid=2000)
    owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1})
    rets = owner.get(f"/api/sales/{sale['id']}/returns").json()
    assert rets[0]["refund_amount"] == 1000


def test_return_nasiya_reduces_debt(owner):
    p = owner.product(price_out=10000)
    c = owner.customer()
    sale = owner.sell([(p, 3)], payment_method="nasiya", paid=0, customer_id=c["id"])
    owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1})
    assert owner.get(f"/api/customers/{c['id']}").json()["current_debt"] == 20000


def test_cashier_can_return_today(owner, cashier):
    p = owner.product()
    sale = cashier.sell([(p, 2)])
    assert cashier.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1}).status_code == 200


def test_cashier_cannot_return_old_receipt(owner, cashier, db):
    from app import models
    p = owner.product()
    sale = owner.sell([(p, 2)])
    s = db.get(models.Sale, sale["id"])
    s.created_at = now_tashkent().replace(tzinfo=None) - timedelta(days=2)
    db.commit()
    assert cashier.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1}).status_code == 403
    assert owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1}).status_code == 200


def test_returns_list_endpoint(owner):
    p = owner.product()
    sale = owner.sell([(p, 3)])
    owner.post(f"/api/sales/{sale['id']}/return", {"product_id": p["id"], "quantity": 1})
    r = owner.get("/api/sales/returns")
    assert r.status_code == 200


# ─── Tarix ────────────────────────────────────────────────────

def test_history_lists_sale(owner):
    sale = owner.sell([(owner.product(), 1)])
    r = owner.get("/api/sales/history")
    assert r.status_code == 200
    body = r.json()
    rows = body if isinstance(body, list) else body.get("sales") or body.get("items") or []
    assert any(s["id"] == sale["id"] for s in rows)


def test_summary_endpoint(owner):
    owner.sell([(owner.product(price_out=1500), 2)])
    r = owner.get("/api/sales/summary")
    assert r.status_code == 200


def test_get_unknown_sale_404(owner):
    assert owner.get("/api/sales/99999999").status_code == 404
