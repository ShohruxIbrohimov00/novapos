# NovaPOS

Do'konlar uchun kassa tizimi (PWA): sotuv, ombor, mijozlar va nasiya, hisobotlar, xodimlar, obuna.
Internet bo'lmasa ham ishlaydi — sotuvlar qurilmada saqlanadi va internet qaytganda avtomatik yuboriladi.

## Serverga o'rnatish

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # keyin .env ni to'ldiring (SECRET_KEY majburiy!)
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`SECRET_KEY` yaratish:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Superadmin `.env` dagi `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` bilan server birinchi ishga tushganda yaratiladi.

## Muhim

- PWA (telefonga o'rnatish, oflayn ishlash) faqat **HTTPS** orqali ishlaydi (nginx + Let's Encrypt).
- Baza fayli (`novapos.db`) gitda saqlanmaydi — serverda muntazam zaxira nusxa oling.
- Ilova bir marta internet bilan ochilgandan keyin oflayn ishlay boshlaydi.
