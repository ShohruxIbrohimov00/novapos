"""
NovaPOS — Kiruvchi matnni tozalash (XSS himoyasi)
==================================================
Frontend ko'p joyda nomlarni (mahsulot, mijoz, kategoriya, izoh) innerHTML va
onclick="...('${name}')" ichiga qo'yadi. Har bir joyni alohida ekranlash o'rniga
API ga kelayotgan JSON dagi barcha matnlardan HTML/JS ni buzadigan belgilar
o'xshash xavfsiz belgilarga almashtiriladi:

    <  →  ‹      >  →  ›      "  →  ”      `  →  '      \\  →  /

Apostrof (') saqlanadi — o'zbekcha nomlar uchun kerak (O'zbekiston, G'ani).
Parol, PIN va token maydonlariga tegilmaydi.
"""

import json

_TABLE = str.maketrans({"<": "‹", ">": "›", '"': "”", "`": "'", "\\": "/"})
_SKIP_KEY_PARTS = ("password", "pin", "token", "secret")


def _clean(value, key: str = ""):
    if isinstance(value, str):
        k = key.lower()
        if any(p in k for p in _SKIP_KEY_PARTS):
            return value
        return value.translate(_TABLE)
    if isinstance(value, list):
        return [_clean(v, key) for v in value]
    if isinstance(value, dict):
        return {k: _clean(v, k) for k, v in value.items()}
    return value


class SanitizeJSONMiddleware:
    """ASGI middleware: /api/* ga kelgan JSON (POST/PUT/PATCH) matnlarini tozalaydi."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("method") not in ("POST", "PUT", "PATCH")
            or not scope.get("path", "").startswith("/api/")
        ):
            return await self.app(scope, receive, send)

        headers = dict(scope.get("headers") or [])
        if b"application/json" not in headers.get(b"content-type", b""):
            return await self.app(scope, receive, send)

        # Butun body ni o'qiymiz
        body, more = b"", True
        while more:
            msg = await receive()
            if msg["type"] != "http.request":
                return await self.app(scope, receive, send)
            body += msg.get("body", b"")
            more = msg.get("more_body", False)

        try:
            new_body = json.dumps(_clean(json.loads(body)), ensure_ascii=False).encode("utf-8")
        except Exception:
            new_body = body   # JSON emas — o'zgarishsiz (validatsiya xatosini FastAPI beradi)

        scope = dict(scope)
        scope["headers"] = [
            (k, v) for k, v in scope.get("headers", []) if k != b"content-length"
        ] + [(b"content-length", str(len(new_body)).encode())]

        sent = False

        async def _receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": new_body, "more_body": False}
            return await receive()

        await self.app(scope, _receive, send)
