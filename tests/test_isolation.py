"""
Do'konlar ajratilgani: bir do'kon boshqasining ma'lumotini ko'ra olmaydi va o'zgartira olmaydi.
SaaS uchun eng muhim xavfsizlik talabi.
"""
import pytest


@pytest.fixture
def foreign(other_owner):
    """Boshqa do'konning ma'lumotlari."""
    p = other_owner.product(quantity=10)
    c = other_owner.customer()
    sale = other_owner.sell([(p, 1)])
    sup = other_owner.post("/api/suppliers/", {"name": "Ta'minotchi X"}).json()
    cat = other_owner.post("/api/products/categories", {"name": "Kat X"}).json()
    emp = other_owner.employee()
    exp = other_owner.post("/api/reports/expenses", {"amount": 5000, "category": "ijara"}).json()
    assert sup.get("id") and cat.get("id") and exp.get("id"), (sup, cat, exp)
    return {"product": p, "customer": c, "sale": sale, "supplier": sup, "category": cat,
            "employee_id": emp.info["user_id"], "expense": exp, "owner": other_owner}


def _ok(code):
    return 200 <= code < 300


def test_cannot_read_foreign_product(owner, foreign):
    assert owner.get(f"/api/products/{foreign['product']['id']}").status_code in (403, 404)


def test_cannot_update_foreign_product(owner, foreign):
    r = owner.put(f"/api/products/{foreign['product']['id']}", {"price_out": 1})
    assert not _ok(r.status_code)
    assert foreign["owner"].get(f"/api/products/{foreign['product']['id']}").json()["price_out"] == 1500


def test_cannot_delete_foreign_product(owner, foreign):
    assert not _ok(owner.delete(f"/api/products/{foreign['product']['id']}").status_code)
    assert foreign["owner"].get(f"/api/products/{foreign['product']['id']}").status_code == 200


def test_cannot_adjust_foreign_stock(owner, foreign):
    r = owner.post(f"/api/products/{foreign['product']['id']}/adjust-stock?new_quantity=0")
    assert not _ok(r.status_code)
    assert foreign["owner"].get(f"/api/products/{foreign['product']['id']}").json()["quantity"] == 9


def test_cannot_sell_foreign_product(owner, foreign):
    owner.sell([(foreign["product"], 1)], expect=400)


def test_cannot_scan_foreign_barcode(owner, other_owner):
    p = other_owner.product(barcode="4780000000017")
    r = owner.get(f"/api/products/scan/{p['barcode']}")
    assert r.status_code == 404


def test_product_list_only_own(owner, foreign):
    body = owner.get("/api/products/").json()
    rows = body if isinstance(body, list) else body.get("products") or body.get("items") or []
    assert all(p["id"] != foreign["product"]["id"] for p in rows)


def test_cannot_supply_foreign_product(owner, foreign):
    r = owner.post("/api/products/supply_batches", {"product_id": foreign["product"]["id"],
                                                     "quantity_received": 5, "supply_price": 1000})
    assert r.status_code in (400, 403, 404), r.text
    assert foreign["owner"].get(f"/api/products/{foreign['product']['id']}").json()["quantity"] == 9


def test_cannot_read_foreign_sale(owner, foreign):
    assert owner.get(f"/api/sales/{foreign['sale']['id']}").status_code in (403, 404)


def test_cannot_cancel_foreign_sale(owner, foreign):
    assert not _ok(owner.post(f"/api/sales/{foreign['sale']['id']}/cancel").status_code)
    assert foreign["owner"].get(f"/api/sales/{foreign['sale']['id']}").json()["is_cancelled"] is False


def test_cannot_return_foreign_sale(owner, foreign):
    r = owner.post(f"/api/sales/{foreign['sale']['id']}/return",
                   {"product_id": foreign["product"]["id"], "quantity": 1})
    assert not _ok(r.status_code)


def test_cannot_read_foreign_sale_returns(owner, foreign):
    assert not _ok(owner.get(f"/api/sales/{foreign['sale']['id']}/returns").status_code)


def test_sales_history_only_own(owner, foreign):
    body = owner.get("/api/sales/history").json()
    rows = body if isinstance(body, list) else body.get("sales") or body.get("items") or []
    assert all(s["id"] != foreign["sale"]["id"] for s in rows)


def test_cannot_read_foreign_customer(owner, foreign):
    assert owner.get(f"/api/customers/{foreign['customer']['id']}").status_code in (403, 404)


def test_cannot_update_foreign_customer(owner, foreign):
    assert not _ok(owner.patch(f"/api/customers/{foreign['customer']['id']}", {"full_name": "Hack"}).status_code)


def test_cannot_delete_foreign_customer(owner, foreign):
    assert not _ok(owner.delete(f"/api/customers/{foreign['customer']['id']}").status_code)


def test_cannot_read_foreign_customer_history(owner, foreign):
    assert not _ok(owner.get(f"/api/customers/{foreign['customer']['id']}/history").status_code)


def test_cannot_pay_foreign_customer_debt(owner, foreign):
    r = owner.post("/api/customers/payment", {"customer_id": foreign["customer"]["id"], "amount": 100})
    assert not _ok(r.status_code)


def test_customer_search_only_own(owner, foreign):
    r = owner.get("/api/customers/search", params={"q": foreign["customer"]["full_name"]})
    assert all(c["id"] != foreign["customer"]["id"] for c in r.json())


def test_cannot_read_foreign_supplier(owner, foreign):
    assert owner.get(f"/api/suppliers/{foreign['supplier']['id']}").status_code in (403, 404)


def test_cannot_update_foreign_supplier(owner, foreign):
    assert not _ok(owner.patch(f"/api/suppliers/{foreign['supplier']['id']}", {"name": "Hack"}).status_code)


def test_cannot_delete_foreign_supplier(owner, foreign):
    assert not _ok(owner.delete(f"/api/suppliers/{foreign['supplier']['id']}").status_code)


def test_cannot_read_foreign_supplier_history(owner, foreign):
    assert not _ok(owner.get(f"/api/suppliers/{foreign['supplier']['id']}/history").status_code)


def test_cannot_pay_foreign_supplier(owner, foreign):
    r = owner.post("/api/suppliers/payment", {"supplier_id": foreign["supplier"]["id"], "amount": 100})
    assert not _ok(r.status_code)


def test_cannot_delete_foreign_category(owner, foreign):
    owner.delete(f"/api/products/categories/{foreign['category']['id']}")
    cats = foreign["owner"].get("/api/products/categories").json()
    assert any(c["id"] == foreign["category"]["id"] for c in cats)


def test_cannot_read_foreign_employee(owner, foreign):
    assert owner.get(f"/api/employees/{foreign['employee_id']}").status_code in (403, 404)


def test_cannot_toggle_foreign_employee(owner, foreign):
    assert not _ok(owner.patch(f"/api/employees/{foreign['employee_id']}/toggle").status_code)


def test_cannot_delete_foreign_employee(owner, foreign):
    assert not _ok(owner.delete(f"/api/employees/{foreign['employee_id']}").status_code)


def test_cannot_reset_foreign_employee_password(owner, foreign):
    r = owner.post(f"/api/employees/{foreign['employee_id']}/reset-password", {"new_password": "hacked123"})
    assert not _ok(r.status_code)


def test_cannot_read_foreign_employee_stats(owner, foreign):
    assert not _ok(owner.get(f"/api/employees/{foreign['employee_id']}/stats").status_code)


def test_cannot_delete_foreign_expense(owner, foreign):
    assert not _ok(owner.delete(f"/api/reports/expenses/{foreign['expense']['id']}").status_code)


def test_dashboard_only_own(owner, foreign):
    d = owner.get("/api/reports/dashboard").json()
    flat = str(d)
    assert "Ta'minotchi X" not in flat


def test_employee_list_only_own(owner, foreign):
    rows = owner.get("/api/employees/").json()
    assert all(e["id"] != foreign["employee_id"] for e in rows)


def test_store_cannot_use_superadmin_api(owner):
    assert owner.get("/api/superadmin/stores").status_code == 403
    assert owner.get("/api/superadmin/stats").status_code == 403
