"""Hisobot: dashboard, top mahsulotlar, xarajatlar."""
import pytest


@pytest.mark.parametrize("period", ["today", "week", "month", "year"])
def test_dashboard_periods(owner, period):
    assert owner.get("/api/reports/dashboard", params={"period": period}).status_code == 200


def test_dashboard_counts_sales(owner):
    before = owner.get("/api/reports/dashboard").json()
    p = owner.product(price_in=1000, price_out=1500)
    owner.sell([(p, 2)])
    after = owner.get("/api/reports/dashboard").json()
    assert after != before
    assert "3000" in str(after) or "3000.0" in str(after)


def test_dashboard_custom_range(owner):
    r = owner.get("/api/reports/dashboard", params={"period": "custom", "start_date": "2026-01-01", "end_date": "2026-01-31"})
    assert r.status_code == 200


def test_top_products(owner):
    p = owner.product(name="Eng ko'p sotilgan")
    owner.sell([(p, 3)])
    r = owner.get("/api/reports/top-products")
    assert r.status_code == 200
    assert "Eng ko'p sotilgan" in str(r.json())


def test_cancelled_sale_not_in_top_products(owner):
    p = owner.product(name="Bekor qilingan tovar")
    s = owner.sell([(p, 3)])
    owner.post(f"/api/sales/{s['id']}/cancel")
    assert "Bekor qilingan tovar" not in str(owner.get("/api/reports/top-products").json())


def test_expenses_crud(owner):
    r = owner.post("/api/reports/expenses", {"amount": 25000, "category": "ijara", "notes": "Noyabr"})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    rows = owner.get("/api/reports/expenses-list", params={"period": "today"}).json()
    assert eid in [e["id"] for e in (rows if isinstance(rows, list) else rows.get("expenses", rows.get("items", [])))]
    assert owner.delete(f"/api/reports/expenses/{eid}").status_code == 200


def test_expense_must_be_positive(owner):
    assert owner.post("/api/reports/expenses", {"amount": 0, "category": "x"}).status_code == 422


def test_debtors_report(owner):
    assert owner.get("/api/reports/debtors").status_code == 200
