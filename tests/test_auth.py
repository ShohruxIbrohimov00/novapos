"""Ro'yxatdan o'tish, kirish, PIN, parol almashtirish."""
import pytest

from conftest import login, register, _uid


def test_register_creates_trial_store(client):
    a = register(client)
    assert a.info["role"] == "admin"
    assert a.info["store_id"]
    assert a.info["payment_status"] == "trial"
    assert a.info["expires_at"]


def test_register_normalizes_username(client):
    name = f"Owner{_uid()}"
    a = register(client, username=f"  {name}  ")
    assert a.info["username"] == name.lower()


def test_register_duplicate_username_rejected(client):
    name = f"dup{_uid()}"
    register(client, username=name)
    r = client.post("/api/auth/register-store", json={
        "store_name": "X", "full_name": "Ism", "username": name, "password": "pass1234", "pin_code": "1234"})
    assert r.status_code == 400
    assert "band" in r.json()["detail"]


@pytest.mark.parametrize("field,value,msg", [
    ("store_name", "   ", "nomi"),
    ("full_name", "A", "Ism"),
    ("username", "ab", "Login"),
    ("username", "bad name", "Login"),
    ("username", "кириллица", "Login"),
    ("password", "123", "Parol"),
    ("pin_code", "12", "PIN"),
    ("pin_code", "12ab", "PIN"),
    ("pin_code", "123456789", "PIN"),
])
def test_register_validation(client, field, value, msg):
    data = {"store_name": "Do'kon", "full_name": "Ism Familiya", "username": f"u{_uid()}",
            "password": "pass1234", "pin_code": "1234", field: value}
    r = client.post("/api/auth/register-store", json=data)
    assert r.status_code == 400, r.text
    assert msg in r.json()["detail"]


def test_login_ok_and_me(client, owner):
    r = owner.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["username"] == owner.info["username"]


def test_login_wrong_password(client, owner):
    r = client.post("/api/auth/login", json={"username": owner.info["username"], "password": "wrong"})
    assert r.status_code == 401


def test_login_unknown_user(client):
    r = client.post("/api/auth/login", json={"username": f"nobody{_uid()}", "password": "x"})
    assert r.status_code == 401


def test_login_is_case_insensitive(client, owner):
    r = client.post("/api/auth/login", json={"username": owner.info["username"].upper(), "password": "pass1234"})
    assert r.status_code == 200


def test_login_pin(client, owner):
    r = client.post("/api/auth/login-pin", json={"username": owner.info["username"], "pin_code": "1234"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]


def test_login_pin_wrong(client, owner):
    r = client.post("/api/auth/login-pin", json={"username": owner.info["username"], "pin_code": "9999"})
    assert r.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code in (401, 403)


def test_invalid_token_rejected(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.token"})
    assert r.status_code == 401


def test_change_password(client, owner):
    r = owner.post("/api/auth/change-password", {"old_password": "pass1234", "new_password": "newpass99"})
    assert r.status_code == 200, r.text
    login(client, owner.info["username"], "newpass99")
    bad = client.post("/api/auth/login", json={"username": owner.info["username"], "password": "pass1234"})
    assert bad.status_code == 401


def test_change_password_wrong_old(owner):
    r = owner.post("/api/auth/change-password", {"old_password": "nope", "new_password": "newpass99"})
    assert r.status_code == 400


def test_change_pin(client, owner):
    r = owner.post("/api/auth/change-pin", {"old_pin": "1234", "new_pin": "5678"})
    assert r.status_code == 200, r.text
    ok = client.post("/api/auth/login-pin", json={"username": owner.info["username"], "pin_code": "5678"})
    assert ok.status_code == 200


def test_inactive_employee_cannot_login(client, owner):
    emp = owner.employee()
    owner.patch(f"/api/employees/{emp.info['user_id']}/toggle")
    r = client.post("/api/auth/login", json={"username": emp.info["username"], "password": "pass1234"})
    assert r.status_code in (401, 403)
