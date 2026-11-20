"""Xodimlar: limitlar, rollar, bloklash, ruxsatlar."""
from conftest import _uid, login


def _create(owner, role="sotuvchi", **kw):
    data = {"full_name": "Xodim", "username": f"e{_uid()}", "password": "pass1234", "pin_code": "1234",
            "role": role, **kw}
    return owner.post("/api/employees/", data)


def test_create_cashier_and_login(client, owner):
    r = _create(owner)
    assert r.status_code == 201, r.text
    emp = login(client, r.json()["username"], "pass1234")
    assert emp.info["role"] == "sotuvchi"
    assert emp.info["store_id"] == owner.store_id


def test_list_employees(owner):
    _create(owner)
    rows = owner.get("/api/employees/").json()
    assert len(rows) == 2


def test_max_three_cashiers(owner):
    for _ in range(3):
        assert _create(owner).status_code == 201
    r = _create(owner)
    assert r.status_code == 400


def test_only_one_admin(owner):
    r = _create(owner, role="admin")
    assert r.status_code == 400


def test_cannot_create_super_admin(owner):
    assert _create(owner, role="super_admin").status_code == 403


def test_invalid_role(owner):
    assert _create(owner, role="direktor").status_code in (400, 422)


def test_duplicate_username(owner):
    name = f"e{_uid()}"
    assert _create(owner, username=name).status_code == 201
    assert _create(owner, username=name).status_code == 400


def test_short_pin_rejected(owner):
    assert _create(owner, pin_code="12").status_code in (400, 422)


def test_short_password_rejected(owner):
    assert _create(owner, password="12").status_code in (400, 422)


def test_toggle_blocks_and_unblocks(client, owner):
    r = _create(owner)
    eid = r.json()["id"]
    assert owner.patch(f"/api/employees/{eid}/toggle").status_code == 200
    assert client.post("/api/auth/login", json={"username": r.json()["username"], "password": "pass1234"}).status_code != 200
    assert owner.patch(f"/api/employees/{eid}/toggle").status_code == 200
    login(client, r.json()["username"], "pass1234")


def test_blocked_employee_token_rejected(owner):
    emp = owner.employee()
    owner.patch(f"/api/employees/{emp.info['user_id']}/toggle")
    assert emp.get("/api/products/").status_code in (401, 403)


def test_cannot_block_self(owner):
    assert owner.patch(f"/api/employees/{owner.info['user_id']}/toggle").status_code == 400


def test_cannot_delete_self(owner):
    assert owner.delete(f"/api/employees/{owner.info['user_id']}").status_code == 400


def test_delete_employee(owner):
    eid = _create(owner).json()["id"]
    assert owner.delete(f"/api/employees/{eid}").status_code == 200


def test_delete_employee_with_sales_keeps_history(owner):
    emp = owner.employee()
    sale = emp.sell([(owner.product(), 1)])
    owner.delete(f"/api/employees/{emp.info['user_id']}")
    assert owner.get(f"/api/sales/{sale['id']}").status_code == 200


def test_reset_password(client, owner):
    r = _create(owner)
    eid, uname = r.json()["id"], r.json()["username"]
    assert owner.post(f"/api/employees/{eid}/reset-password", {"new_password": "brandnew1"}).status_code == 200
    login(client, uname, "brandnew1")


def test_reset_pin(client, owner):
    r = _create(owner)
    eid, uname = r.json()["id"], r.json()["username"]
    assert owner.post(f"/api/employees/{eid}/reset-pin", {"new_pin": "4321"}).status_code == 200
    assert client.post("/api/auth/login-pin", json={"username": uname, "pin_code": "4321"}).status_code == 200


def test_reset_pin_non_digits(owner):
    eid = _create(owner).json()["id"]
    assert owner.post(f"/api/employees/{eid}/reset-pin", {"new_pin": "12ab"}).status_code in (400, 422)


def test_update_employee_name(owner):
    eid = _create(owner).json()["id"]
    r = owner.patch(f"/api/employees/{eid}", {"full_name": "Yangi Ism"})
    assert r.status_code == 200
    assert owner.get(f"/api/employees/{eid}").json()["full_name"] == "Yangi Ism"


def test_cannot_change_own_role(owner):
    r = owner.patch(f"/api/employees/{owner.info['user_id']}", {"role": "sotuvchi"})
    assert r.status_code == 400


def test_employee_stats(owner):
    emp = owner.employee()
    emp.sell([(owner.product(), 2)])
    r = owner.get(f"/api/employees/{emp.info['user_id']}/stats")
    assert r.status_code == 200


def test_cashier_cannot_manage_employees(owner, cashier):
    assert cashier.get("/api/employees/").status_code == 403
    assert _create(cashier).status_code == 403
    assert cashier.delete(f"/api/employees/{owner.info['user_id']}").status_code == 403
    assert cashier.patch(f"/api/employees/{owner.info['user_id']}/toggle").status_code == 403


def test_online_endpoint(owner):
    assert owner.get("/api/employees/online").status_code == 200


def test_deleted_cashier_frees_slot(owner):
    ids = [_create(owner).json()["id"] for _ in range(3)]
    assert _create(owner).status_code == 400
    owner.delete(f"/api/employees/{ids[0]}")
    assert _create(owner).status_code == 201
