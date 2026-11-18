# NovaPOS

Do'konlar uchun kassa tizimi (PWA): sotuv, ombor, mijozlar va nasiya, hisobotlar, xodimlar, obuna.
Internet bo'lmasa ham ishlaydi — sotuvlar qurilmada saqlanadi va internet qaytganda avtomatik yuboriladi.

## Serverga o'rnatish (Ubuntu)

Kerak: domen (masalan `pos.sizning-domen.uz`) serveringiz IP siga yo'naltirilgan bo'lsin.

```bash
sudo apt update && sudo apt install -y python3-venv nginx certbot python3-certbot-nginx git
sudo useradd -r -m -d /opt/novapos novapos
sudo -u novapos git clone <repo-manzili> /opt/novapos
cd /opt/novapos
sudo -u novapos python3 -m venv venv
sudo -u novapos venv/bin/pip install -r requirements.txt
sudo -u novapos cp .env.example .env
sudo -u novapos nano .env      # SECRET_KEY, SUPERADMIN_*, ALLOWED_ORIGINS ni to'ldiring
```

`SECRET_KEY` yaratish:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Xizmat va nginx:

```bash
sudo cp deploy/novapos.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now novapos
sudo cp deploy/nginx.conf /etc/nginx/sites-available/novapos    # ichida domenni o'zgartiring
sudo ln -s /etc/nginx/sites-available/novapos /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pos.sizning-domen.uz                   # HTTPS (majburiy!)
```

Har kunlik zaxira nusxa (`sudo -u novapos crontab -e`):

```
0 3 * * * /opt/novapos/deploy/backup.sh >> /opt/novapos/backups/backup.log 2>&1
```

Zaxiradan tiklash: xizmatni to'xtating, `gunzip -c backups/novapos_SANA.db.gz > novapos.db`, qayta ishga tushiring.

## Yangilash

```bash
cd /opt/novapos && cp novapos.db backups/novapos_before_update.db
sudo -u novapos git pull && sudo -u novapos venv/bin/pip install -r requirements.txt
sudo systemctl restart novapos
```

## Muhim

- PWA (telefonga o'rnatish, oflayn ishlash) faqat **HTTPS** orqali ishlaydi.
- Ilova bir marta internet bilan ochilgandan keyin oflayn ishlay boshlaydi.
- Oflayn rejimda **sotuv** qilish mumkin; mahsulot/mijoz qo'shish va qarz to'lovi uchun internet kerak.
- Printer: Android — RawBT ilovasi; kompyuter — QZ Tray yoki brauzer orqali chop etish; Bluetooth printer — Chrome.
- Superadmin `.env` dagi `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` bilan birinchi ishga tushishda yaratiladi.
