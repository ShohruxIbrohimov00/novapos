# NovaPOS — do'konlar uchun kassa tizimi

NovaPOS — kichik va o'rta do'konlar uchun brauzerda ishlaydigan kassa (POS) tizimi.
Kompyuter, planshet va telefonda ishlaydi, telefonga ilova kabi o'rnatiladi (PWA)
va **internet uzilganda ham sotuv qilishda davom etadi**.

Bitta server ko'p do'konga xizmat qiladi: har bir do'kon ro'yxatdan o'tadi, oylik
obuna to'laydi, siz esa **superadmin** sifatida hammasini boshqarasiz.

---

## Mundarija

1. [Imkoniyatlar](#1-imkoniyatlar)
2. [Loyiha tuzilmasi](#2-loyiha-tuzilmasi)
3. [Kompyuterda sinab ko'rish (5 daqiqa)](#3-kompyuterda-sinab-korish-5-daqiqa)
4. [GitHub Codespaces'da sinab ko'rish](#4-github-codespacesda-sinab-korish)
5. [Serverga o'rnatish (haqiqiy ishga tushirish)](#5-serverga-ornatish-haqiqiy-ishga-tushirish)
6. [`.env` sozlamalari — har biri nima uchun](#6-env-sozlamalari--har-biri-nima-uchun)
7. [Birinchi sozlash: superadmin va do'konlar](#7-birinchi-sozlash-superadmin-va-dokonlar)
8. [Do'konda ishlatish: printer, skaner, telefon](#8-dokonda-ishlatish-printer-skaner-telefon)
9. [Rollar va huquqlar](#9-rollar-va-huquqlar)
10. [Oflayn rejim qanday ishlaydi](#10-oflayn-rejim-qanday-ishlaydi)
11. [Yangilash](#11-yangilash)
12. [Zaxira nusxa va tiklash](#12-zaxira-nusxa-va-tiklash)
13. [Muammolar va yechimlar](#13-muammolar-va-yechimlar)
14. [Muhim eslatmalar (qonun, soliq)](#14-muhim-eslatmalar-qonun-soliq)
15. [Frontend (React) bilan ishlash](#15-frontend-react-bilan-ishlash)

---

## 1. Imkoniyatlar

| Bo'lim | Nima qiladi |
|---|---|
| **Kassa** | Shtrix-kod skaneri (USB yoki telefon kamerasi), PLU kod, nom bo'yicha qidiruv, kg/litr tovarlar, naqd / plastik / nasiya, qaytim hisobi, chek chop etish |
| **Ombor** | Mahsulot qo'shish va tahrirlash, kategoriyalar, kirim (blok bilan, ta'minotchidan qarzga), qoldiqni tuzatish (inventarizatsiya), kam qolgan tovarlar, ombor qiymati, to'plam (variantlar), kirim tarixi, Excel/AI orqali import |
| **Sotuv tarixi** | Davr bo'yicha jami (naqd / plastik / nasiya / qaytarilgan), chek raqami, mijoz yoki tovar bo'yicha qidiruv, qisman qaytarish, chekni bekor qilish, chekni qayta chiqarish, qaytarishlar ro'yxati |
| **Mijozlar** | Nasiya (qarz) hisobi, qarz to'lovlarini qabul qilish, xaridlar tarixi |
| **Hisobot** | Savdo, foyda, kassadagi naqd pul, chiqimlar, sof foyda, top tovarlar, qarzdorlar, ta'minotchilar |
| **Xodimlar** | 1 ta admin + 3 tagacha kassir, PIN bilan tezkor kirish |
| **Superadmin** | Do'konlar, tariflar, obuna to'lovlarini tasdiqlash, do'kon nomidan kirish |
| **Oflayn** | Internet yo'q paytda ham sotuv, internet qaytganda avtomatik yuboriladi |

---

## 2. Loyiha tuzilmasi

```
novapos/
├── app/                    # Backend (Python, FastAPI)
│   ├── main.py             # Ilovaning kirish nuqtasi
│   ├── models.py           # Baza jadvallari
│   ├── crud.py             # Sotuv, qaytarish, qarz va h.k. mantiqi
│   ├── database.py         # Baza ulanishi va avtomatik migratsiya
│   ├── dependencies.py     # Token, obuna tekshiruvi
│   ├── sanitize.py         # Kiruvchi matnni tozalash (XSS himoyasi)
│   └── api/                # API manzillari (products, sales, reports ...)
├── frontend/               # Yangi frontend (React + Vite + TypeScript) — 15-bo'lim
│   └── src/
│       ├── components/ui/  # Tugma, maydon, oyna, bildirishnoma... (yagona dizayn)
│       ├── components/layout/  # Menyu: telefon / planshet / kompyuter
│       ├── lib/            # API, sessiya, formatlar, tema
│       └── pages/          # Sahifalar (React'ga ko'chirilganlari)
├── webapp/
│   ├── templates/          # Eski HTML sahifalar (bosqichma-bosqich React'ga ko'chirilmoqda)
│   ├── static/app/         # React build natijasi (repoga qo'shiladi — serverda Node.js shart emas)
│   ├── static/js/          # Kassa, oflayn baza, sinxronizatsiya, printer, skaner
│   ├── static/vendor/      # htmx, ikonkalar, shriftlar (internetsiz ishlashi uchun)
│   └── sw.js               # Service Worker (oflayn rejim)
├── deploy/
│   ├── nginx.conf          # Nginx sozlamasi (HTTPS, WebSocket)
│   ├── novapos.service     # Serverda avtomatik ishga tushirish (systemd)
│   └── backup.sh           # Har kungi zaxira nusxa
├── requirements.txt        # Python kutubxonalari
└── .env.example            # Sozlamalar namunasi
```

Baza: standart holatda **SQLite** (`novapos.db` fayli). Alohida baza serveri shart emas.

---

## 3. Kompyuterda sinab ko'rish (5 daqiqa)

Bu bo'lim — loyihani o'z kompyuteringizda ochib ko'rish uchun. Do'konlarga berish uchun
5-bo'limga qarang.

### 3.1. Kerakli dasturlar

- **Python 3.10 yoki undan yangi** — https://www.python.org/downloads/
  Windows'da o'rnatayotganda **"Add Python to PATH"** belgisini qo'ying.
- **Git** — https://git-scm.com/downloads

Tekshirish (terminal yoki Windows'da "Command Prompt"):

```bash
python --version
```

### 3.2. Loyihani yuklab olish

```bash
git clone https://github.com/ShohruxIbrohimov00/novapos.git
```

```bash
cd novapos
```

### 3.3. Virtual muhit va kutubxonalar

**Windows:**

```bash
python -m venv venv
```

```bash
venv\Scripts\activate
```

**Mac / Linux:**

```bash
python3 -m venv venv
```

```bash
source venv/bin/activate
```

So'ng (hamma tizimda):

```bash
pip install -r requirements.txt
```

### 3.4. Sozlamalar fayli

`.env.example` faylidan nusxa olib, `.env` deb nomlang:

- Windows: `copy .env.example .env`
- Mac/Linux: `cp .env.example .env`

`.env` ni istalgan matn muharririda oching va **sinov uchun** shunday to'ldiring:

```ini
ENVIRONMENT=development
SECRET_KEY=istalgan-uzun-tasodifiy-matn-shu-yerga-yozing-12345
DATABASE_URL=sqlite:///./novapos.db
SUPERADMIN_USERNAME=admin
SUPERADMIN_PASSWORD=Admin12345
SUPERADMIN_FULLNAME=Super Admin
```

### 3.5. Ishga tushirish

```bash
uvicorn app.main:app --reload --port 8000
```

Brauzerda oching: **http://localhost:8000**

- **Do'kon sifatida sinash:** "Ro'yxatdan o'tish" → do'kon nomi, login, parol va PIN.
  Do'konga avtomatik **30 kunlik sinov muddati** beriladi.
- **Superadmin sifatida:** `.env` dagi `SUPERADMIN_USERNAME` / `SUPERADMIN_PASSWORD` bilan kiring.

To'xtatish: terminalda `Ctrl + C`.

> Kompyuterda sinashda ilovani telefonga o'rnatish va oflayn rejim ishlamasligi mumkin —
> buning uchun HTTPS kerak (5-bo'lim yoki Codespaces).

---

## 4. GitHub Codespaces'da sinab ko'rish

Kompyuterga hech narsa o'rnatmasdan, brauzerning o'zida sinash mumkin. Bu **faqat sinov va
demo uchun**: Codespace harakatsiz qolsa o'chadi, manzili doimiy emas.

1. GitHub'da repo → **Code** → **Codespaces** → **Create codespace**.
2. Ochilgan terminalda:

```bash
pip install -r requirements.txt
```

```bash
printf "ENVIRONMENT=development\nSECRET_KEY=$(python -c 'import secrets;print(secrets.token_hex(32))')\nSUPERADMIN_USERNAME=admin\nSUPERADMIN_PASSWORD=Admin12345\n" > .env
```

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

3. Pastdagi **Ports** bo'limida 8000-port chiqadi — globus belgisini bosing.
4. Telefonda ochish uchun: portni o'ng tugma → **Port Visibility → Public**
   (sinovdan keyin yana **Private** qiling).

Codespaces HTTPS beradi, shuning uchun telefonga o'rnatish va oflayn rejimni ham shu yerda
sinab ko'rsa bo'ladi.

---

## 5. Serverga o'rnatish (haqiqiy ishga tushirish)

Do'konlar har kuni ishlatishi uchun loyiha doim yoqiq turadigan serverda bo'lishi kerak.

### 5.1. Nima kerak

| Narsa | Tavsiya |
|---|---|
| **Server (VPS)** | O'zbekistondagi data-markaz (shaxsiy ma'lumotlar qonuni — 14-bo'limga qarang). Ubuntu 22.04 yoki 24.04, 2 vCPU, 2–4 GB RAM, 40 GB SSD |
| **Domen** | Masalan `pos.sizningbrend.uz` |
| **HTTPS** | Bepul — Let's Encrypt (quyida o'rnatiladi). **HTTPS'siz telefonga o'rnatish va oflayn rejim ishlamaydi** |

### 5.2. Domenni serverga ulash

Domen sotib olgan joyingizning DNS sozlamalarida **A yozuv** qo'shing:

| Turi | Nom | Qiymat |
|---|---|---|
| A | `pos` (yoki `@`) | serveringiz IP manzili |

DNS 5 daqiqadan bir necha soatgacha tarqaladi. Tekshirish: `ping pos.sizningbrend.uz`

### 5.3. Serverga kirish

Kompyuteringizdan (Windows'da PowerShell):

```bash
ssh root@SERVER_IP_MANZILI
```

### 5.4. Kerakli paketlarni o'rnatish

```bash
sudo apt update && sudo apt upgrade -y
```

```bash
sudo apt install -y python3-venv python3-pip nginx certbot python3-certbot-nginx git ufw
```

### 5.5. Alohida foydalanuvchi va loyihani yuklash

Xavfsizlik uchun ilova `root` emas, alohida `novapos` foydalanuvchisi nomidan ishlaydi:

```bash
sudo useradd -r -m -d /opt/novapos -s /bin/bash novapos
```

```bash
sudo -u novapos git clone https://github.com/ShohruxIbrohimov00/novapos.git /opt/novapos
```

> Repo **private** bo'lsa, GitHub token yoki deploy key kerak bo'ladi:
> GitHub → Settings → Developer settings → Personal access tokens.
> Clone qilishda parol o'rniga token kiritiladi.

### 5.6. Kutubxonalar

```bash
cd /opt/novapos
```

```bash
sudo -u novapos python3 -m venv venv
```

```bash
sudo -u novapos venv/bin/pip install -r requirements.txt
```

### 5.7. `.env` sozlamalari

```bash
sudo -u novapos cp .env.example .env
```

Maxfiy kalit yarating va natijani nusxalang:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Faylni tahrirlang:

```bash
sudo -u novapos nano .env
```

Namuna (o'z qiymatlaringizni yozing):

```ini
ENVIRONMENT=production
SECRET_KEY=yuqorida_yaratilgan_64_belgili_kalit
DATABASE_URL=sqlite:///./novapos.db
ALLOWED_ORIGINS=https://pos.sizningbrend.uz
SUPERADMIN_USERNAME=sizning_loginingiz
SUPERADMIN_PASSWORD=Juda_Kuchli_Parol_2026!
SUPERADMIN_FULLNAME=Ism Familiya
GEMINI_API_KEY=
```

Saqlash: `Ctrl + O`, `Enter`, chiqish: `Ctrl + X`.
Har bir sozlamaning ma'nosi — 6-bo'limda.

Faylni boshqalar o'qiy olmasin:

```bash
sudo chmod 600 /opt/novapos/.env
```

### 5.8. Qo'lda sinab ko'rish

```bash
cd /opt/novapos && sudo -u novapos venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Logda `✅ Baza tayyor!` va `Superadmin yaratildi` chiqsa — hammasi joyida. `Ctrl + C` bilan
to'xtating.

### 5.9. Avtomatik ishga tushirish (systemd)

Server qayta yonganda ham ilova o'zi ishga tushadi:

```bash
sudo cp /opt/novapos/deploy/novapos.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now novapos
```

Holatini ko'rish:

```bash
sudo systemctl status novapos
```

Loglarni jonli ko'rish:

```bash
sudo journalctl -u novapos -f
```

### 5.10. Nginx (veb-server)

```bash
sudo cp /opt/novapos/deploy/nginx.conf /etc/nginx/sites-available/novapos
```

Fayl ichida `pos.sizning-domen.uz` ni o'z domeningizga almashtiring:

```bash
sudo nano /etc/nginx/sites-available/novapos
```

Yoqish:

```bash
sudo ln -s /etc/nginx/sites-available/novapos /etc/nginx/sites-enabled/
```

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 5.11. HTTPS (bepul sertifikat)

```bash
sudo certbot --nginx -d pos.sizningbrend.uz
```

Email so'raladi va shartlarga rozilik bildirasiz. Sertifikat 90 kunda o'zi yangilanadi.

### 5.12. Firewall

```bash
sudo ufw allow OpenSSH
```

```bash
sudo ufw allow 'Nginx Full'
```

```bash
sudo ufw enable
```

Qo'shimcha himoya — parolni taxmin qilishga urinishlarni bloklash va avtomatik xavfsizlik
yangilanishlari:

```bash
sudo apt install -y fail2ban unattended-upgrades
```

### 5.13. Har kungi zaxira nusxa

```bash
sudo -u novapos mkdir -p /opt/novapos/backups
```

```bash
sudo -u novapos crontab -e
```

Ochilgan faylning oxiriga qo'shing (har kuni soat 03:00 da):

```
0 3 * * * /opt/novapos/deploy/backup.sh >> /opt/novapos/backups/backup.log 2>&1
```

**Muhim:** zaxira serverning o'zida saqlanadi. Server buzilsa nusxalar ham yo'qoladi,
shuning uchun ularni muntazam **boshqa joyga** ko'chiring (12-bo'lim).

### 5.14. Tayyor!

Brauzerda **https://pos.sizningbrend.uz** ni oching. Keyingi qadam — 7-bo'lim.

Ishlayotganini tekshirish uchun manzil: `https://pos.sizningbrend.uz/api/health`
(UptimeRobot kabi bepul xizmatda kuzatib boring — server tushib qolsa xabar keladi).

---

## 6. `.env` sozlamalari — har biri nima uchun

| Sozlama | Majburiymi | Ma'nosi |
|---|---|---|
| `ENVIRONMENT` | ha | Serverda `production`. Kompyuterda sinash uchun `development` |
| `SECRET_KEY` | **ha** | Kirish tokenlarini imzolovchi maxfiy kalit. Uzun va tasodifiy bo'lsin, **hech kimga ko'rsatmang**. O'zgartirilsa, hamma qaytadan kiradi |
| `DATABASE_URL` | yo'q | Standart: `sqlite:///./novapos.db` |
| `ALLOWED_ORIGINS` | production'da ha | Saytingiz manzili, masalan `https://pos.sizningbrend.uz` |
| `SUPERADMIN_USERNAME` | ha | Superadmin logini. **Faqat birinchi ishga tushishda** yaratiladi |
| `SUPERADMIN_PASSWORD` | ha | Superadmin paroli — kuchli bo'lsin. Keyin `.env` ni o'zgartirish parolni o'zgartirmaydi (13-bo'lim) |
| `SUPERADMIN_FULLNAME` | yo'q | Superadmin ismi |
| `GEMINI_API_KEY` | yo'q | AI Scan (rasmdan mahsulot tanish) uchun Google Gemini kaliti. Bo'lmasa AI Scan ishlamaydi, qolgan hammasi ishlaydi |
| `RATE_LIMIT_LOGIN` | yo'q | Login urinishlari cheklovi, standart `5/minute` |

`.env` o'zgartirilgandan keyin: `sudo systemctl restart novapos`

---

## 7. Birinchi sozlash: superadmin va do'konlar

### 7.1. Superadmin paneli

`https://domeningiz/login` → superadmin login va paroli bilan kiring.

1. **To'lov sozlamalari** — do'konlar obuna uchun pul o'tkazadigan karta raqami, karta egasi
   va qo'llab-quvvatlash telefoni.
2. **Tariflar** — masalan: "1 oy — 100 000 so'm", "3 oy — 270 000 so'm".
3. **Do'konlar** — ro'yxatdan o'tgan do'konlar, muddatini qo'lda uzaytirish, bloklash,
   "do'kon nomidan kirish" (yordam berish uchun).
4. **To'lovlar** — do'konlar yuborgan to'lov cheklari. **Tasdiqlash** bosilsa, obuna avtomatik
   uzayadi.

### 7.2. Do'kon ochish (do'kon egasi qiladi)

1. `https://domeningiz/register` → do'kon nomi, ism, telefon → login va parol → 4 xonali PIN.
2. Do'konga **30 kunlik bepul sinov** beriladi.
3. Sozlamalar → **Do'kon ma'lumotlari**: nom, telefon, manzil (chekda chiqadi).
4. Sozlamalar → **Xodimlar** → kassir qo'shish (login, parol, PIN).
5. Ombor → **Qo'shish** — mahsulotlar (yoki AI Scan / Excel orqali ommaviy).

### 7.3. Obuna tugaganda

- Do'kon tizimga **kira oladi**, lekin sotuv va boshqa ishlar **bloklanadi**.
- Avtomatik **Sozlamalar → Obuna** bo'limi ochiladi: tarifni tanlaydi, kartaga to'laydi va chek
  rasmini yuklaydi.
- Siz superadmin panelida tasdiqlaysiz — do'kon darhol ishlay boshlaydi.

---

## 8. Do'konda ishlatish: printer, skaner, telefon

### 8.1. Telefon yoki planshetga ilova sifatida o'rnatish

- **Android (Chrome):** saytni oching → menyu (⋮) → **"Ilovani o'rnatish"** / "Add to Home screen".
- **iPhone (Safari):** saytni oching → **Ulashish** → **"Add to Home Screen"**.
- **Kompyuter (Chrome/Edge):** manzil satridagi o'rnatish belgisi.

Ilova bir marta internet bilan ochilgach, keyin internetsiz ham ochiladi.

### 8.2. Chek printeri (Sozlamalar → Chek printer)

| Qurilma | Usul |
|---|---|
| **Android planshet/telefon** | **RawBT** ilovasini Google Play'dan o'rnating, printerni (USB yoki Bluetooth) RawBT'da ulang. NovaPOS'da usul: RawBT |
| **Bluetooth printer (Chrome, Android/kompyuter)** | Usul: Web Bluetooth → "Ulanish" |
| **Kompyuter + USB printer** | **QZ Tray** dasturini o'rnating (qz.io). U bo'lmasa, brauzerning oddiy chop etish oynasi ochiladi |
| **Boshqa** | Brauzer orqali chop etish |

Qog'oz kengligi: **58mm** yoki **80mm** — Sozlamalarda tanlang. Chek pastidagi matn va do'kon
nomini ham shu yerda o'zgartirish mumkin.

### 8.3. Shtrix-kod skaneri

- **USB / Bluetooth skaner** — hech qanday sozlash shart emas, klaviatura kabi ishlaydi.
  Kassa sahifasi ochiq bo'lsa, skanerlangan tovar savatga tushadi.
  Ombor sahifasida skanerlansa: tovar bor bo'lsa — uning kirim sahifasi ochiladi,
  yo'q bo'lsa — shu shtrix-kod bilan "Yangi tovar" formasi.
- **Telefon kamerasi** — kassada va tovar formasida kamera belgisini bosing.

### 8.4. Tovar qabul qilish (kirim)

1. Ombor → tovarni skanerlang yoki bosing.
2. **Tovar qabul qilish** bo'limida kelgan miqdorni yozing (blokda kelsa — "Blok bilan":
   `2 blok × 12 = 24 dona`), kelish narxini tekshiring.
3. Ta'minotchidan qarzga olingan bo'lsa — ta'minotchini tanlab **Qarzga** ni bosing:
   uning qarziga avtomatik qo'shiladi (Hisobot → Ta'minotchilar).
4. **Kirim qilish**. Hamma kirimlar: Ombor → **Kirim tarixi**.

Sanoqda qoldiq boshqacha chiqsa — admin tovar sahifasida **Qoldiqni tuzatish** ni bosadi
(sabab bilan saqlanadi).

### 8.5. Tovarni qaytarish

Tarix → chekni toping (chek raqami, mijoz yoki tovar nomini yozing) → tovar yonidagi
**Qaytarish** → miqdor va sabab. Tovar omborga qaytadi, chek summasi kamayadi; nasiya
bo'lsa, mijoz qarzi kamayadi. Kassir faqat bugungi chekdan qaytara oladi, eskisidan — admin.
Chekni butunlay bekor qilish — faqat admin.

### 8.6. Kassada tezkor ishlash

- Kg/litr tovar bosilganda miqdor oynasi ochiladi: klaviaturada `1.5` va `Enter`.
- To'lov oynasida `Enter` — sotuvni yakunlaydi, `Esc` — yopadi.
- PLU kod: qidiruvga `11` yozib `Enter`.

---

## 9. Rollar va huquqlar

| Amal | Kassir | Admin (do'kon egasi) | Superadmin |
|---|:-:|:-:|:-:|
| Sotuv, nasiya, qaytarish (bugungi chek) | ✅ | ✅ | — |
| Eski chekdan qaytarish, chekni bekor qilish | ❌ | ✅ | — |
| Mahsulot qo'shish, tovar qabul qilish (kirim) | ✅ | ✅ | — |
| Narxni o'zgartirish, mahsulotni yoki kategoriyani o'chirish, qoldiqni tuzatish | ❌ | ✅ | — |
| Tannarxdan arzon sotish | ❌ | ✅ | — |
| Hisobot, foyda, chiqimlar | ❌ | ✅ | — |
| Xodimlar, do'kon ma'lumotlari | ❌ | ✅ | — |
| Do'konlar, tariflar, to'lovlarni tasdiqlash | — | — | ✅ |

Bir do'konda: **1 ta admin + 3 tagacha kassir**.

---

## 10. Oflayn rejim qanday ishlaydi

- Ilova bir marta internet bilan ochilganda barcha sahifalar va mahsulotlar qurilmaga saqlanadi.
- Internet uzilsa — kassa ishlashda davom etadi, sotuvlar qurilmada navbatga yoziladi
  (chekda "OFFLINE" belgisi).
- Internet qaytganda — sotuvlar avtomatik serverga yuboriladi. **Bir sotuv hech qachon ikki
  marta yozilmaydi**, asl sotilgan vaqti bilan yoziladi.
- Yuborilmagan oflayn sotuvlar bo'lsa, tizimdan chiqib bo'lmaydi (yo'qolmasligi uchun).
- Oflayn paytda **faqat sotuv** qilinadi. Mahsulot va mijoz qo'shish, qarz to'lovi uchun
  internet kerak.

---

## 11. Yangilash

Yangi versiya chiqqanda serverda:

```bash
cd /opt/novapos && sudo -u novapos cp novapos.db backups/novapos_yangilashdan_oldin.db
```

```bash
sudo -u novapos git pull
```

```bash
sudo -u novapos venv/bin/pip install -r requirements.txt
```

```bash
sudo systemctl restart novapos
```

Baza tuzilmasi o'zgargan bo'lsa, u ishga tushishda **avtomatik** yangilanadi. Foydalanuvchilar
qurilmalarida yangi versiya keyingi ochilishda o'zi yuklanadi.

---

## 12. Zaxira nusxa va tiklash

### Zaxira

`deploy/backup.sh` har kuni (5.13-bo'lim):
- bazani ishlab turgan holatda xavfsiz nusxalaydi → `backups/novapos_SANA.db.gz`;
- yuklangan to'lov cheklarini arxivlaydi;
- 30 kundan eski nusxalarni o'chiradi.

Qo'lda ishga tushirish:

```bash
sudo -u novapos /opt/novapos/deploy/backup.sh
```

**Nusxalarni boshqa joyga ko'chirish (juda tavsiya etiladi).** Masalan, kompyuteringizga
yuklab olish:

```bash
scp root@SERVER_IP:/opt/novapos/backups/novapos_*.db.gz ./
```

Yoki `rclone` bilan bulutli xotiraga (Google Drive, S3 va h.k.) har kuni avtomatik.

### Tiklash

```bash
sudo systemctl stop novapos
```

```bash
cd /opt/novapos && sudo -u novapos cp novapos.db novapos_buzilgan.db
```

```bash
gunzip -c backups/novapos_2026-11-18_0300.db.gz | sudo -u novapos tee novapos.db > /dev/null
```

```bash
sudo systemctl start novapos
```

Zaxiradan tiklashni **oldindan bir marta sinab ko'ring** — kerak bo'lganda ishlashiga ishonch
hosil qiling.

---

## 13. Muammolar va yechimlar

| Muammo | Yechim |
|---|---|
| **Sayt ochilmaydi, 502 Bad Gateway** | Ilova to'xtagan: `sudo systemctl status novapos` va `sudo journalctl -u novapos -n 100` — xato sababini ko'rsatadi |
| **`ModuleNotFoundError`** | Kutubxonalar o'rnatilmagan: `sudo -u novapos /opt/novapos/venv/bin/pip install -r requirements.txt` |
| **Logda "SECRET_KEY .env da berilmagan"** | `.env` ga `SECRET_KEY` yozing va qayta ishga tushiring |
| **Telefonga o'rnatib bo'lmaydi / oflayn ishlamaydi** | Sayt `https://` orqali ochilishi kerak (5.11) |
| **Do'kon "Obuna muddati tugagan" deydi** | Superadmin → To'lovlar → tasdiqlash, yoki Do'konlar → muddatni uzaytirish |
| **Xodim kira olmaydi** | Sozlamalar → Xodimlar — bloklanmaganini tekshiring |
| **Chek chiqmaydi** | Sozlamalar → Chek printer → "Sinov cheki". Android'da RawBT o'rnatilganini tekshiring |
| **Oflayn sotuvlar yuborilmayapti** | Internetni tekshiring, kassa sahifasini oching — sinxronizatsiya o'zi boshlanadi |
| **Port 8000 band** | `sudo lsof -i :8000` — band qilgan jarayonni to'xtating |

### Superadmin parolini unutdim

`.env` dagi parolni o'zgartirish yordam bermaydi — superadmin faqat bir marta yaratiladi.
Parolni tiklash (`admin` va `YangiParol123` o'rniga o'zingiznikini yozing):

```bash
cd /opt/novapos && sudo -u novapos bash -c 'set -a; . ./.env; set +a; venv/bin/python -c "
from app.database import SessionLocal; from app import models, crud
db = SessionLocal()
u = db.query(models.Employee).filter(models.Employee.username == \"admin\").first()
u.hashed_password = crud.hash_password(\"YangiParol123\"); db.commit(); print(\"Parol yangilandi\")"'
```

### Do'kon egasi yoki kassir parolini unutdi

Yuqoridagi buyruqning o'zi ishlaydi — faqat `"admin"` o'rniga o'sha xodimning loginini yozing.
Do'kon egasiga yangi parolni ayting va kirgandan keyin Sozlamalar → **Parol o'zgartirish**
orqali o'zi almashtirsin.

PIN esda bo'lsa, PIN bilan kirish ham mumkin (Kirish → PIN).

---

## 14. Muhim eslatmalar (qonun, soliq)

- **Fiskal chek.** O'zbekistonda chakana savdo soliq tizimiga ulangan onlayn-kassa (onlayn-NKM
  yoki virtual kassa) orqali fiskal chek berishi kerak. NovaPOS **fiskal chek bermaydi** —
  u fiskal kassa yonida ishlaydigan ombor, nasiya va hisobot tizimi. Soliq maslahatchisi bilan
  aniqlashtiring.
- **Shaxsiy ma'lumotlar.** Mijozlarning ismi va telefoni shaxsiy ma'lumot hisoblanadi; ularni
  O'zbekiston hududidagi serverlarda saqlash talab qilinadi.
- **Obuna to'lovi.** Doimiy daromad uchun YaTT/MChJ va rasmiy to'lov (Payme/Click) tavsiya
  etiladi.
- **Foydalanish shartlari.** Do'konlarga berishdan oldin ommaviy oferta va maxfiylik siyosatini
  tayyorlang.

---

## 15. Frontend (React) bilan ishlash

Frontend bosqichma-bosqich **React + Vite + TypeScript** ga ko'chirilmoqda. Ko'rinish (ranglar,
shrift, tungi rejim) eski sahifalar bilan bir xil, lekin hamma tugma, maydon va oyna endi
**bitta komponentlar to'plamidan** (`frontend/src/components/ui/`) foydalanadi.

| Sahifa | Holati |
|---|---|
| Kassa | ✅ React (`/app/pos`) |
| Ombor, tovar qo'shish/tahrirlash, kirim tarixi | ✅ React (`/app/products`) |
| Sotuv tarixi | ✅ React (`/app/sales`) |
| Mijozlar | ✅ React (`/app/customers`) |
| AI Scan, Hisobot, Sozlamalar, Superadmin | ⏳ eski sahifa (navbatda) |

Eski va yangi sahifalar birga ishlaydi: login, tema va oflayn kesh umumiy, menyu ikkalasida bir xil.
Eski manzil (masalan `/pos`, `/products`, `/sales`, `/customers`) ko'chirilgandan keyin yangisiga yo'naltiriladi.

### Serverga o'rnatishda

Hech narsa qilish shart emas — tayyor build `webapp/static/app/` da, repoda turibdi.
**Serverda Node.js kerak emas.**

### Frontend'ni o'zgartirish (dasturchi uchun)

Kerak: **Node.js 20+** (https://nodejs.org).

Bir marta:

```bash
cd frontend
```

```bash
npm install
```

Ishlab chiqish rejimi (o'zgarishlar darhol ko'rinadi). Avval backend'ni 8000-portda ishga
tushiring (3.5-bo'lim), keyin:

```bash
npm run dev
```

Brauzerda: http://localhost:5173/app/pos

Tayyor bo'lgach build qiling va natijani commit qiling:

```bash
npm run build
```

```bash
git add webapp/static/app frontend && git commit -m "Frontend: ..."
```

### Qoidalar

- Yangi tugma, maydon yoki oyna kerak bo'lsa — `components/ui/` dagi tayyor komponentdan
  foydalaning. Sahifada alohida uslub yozmang.
- Ranglar va o'lchamlar faqat `styles/tokens.css` dagi o'zgaruvchilar orqali.
- Server so'rovlari faqat `lib/api.ts` orqali (token, xatolar, oflayn shu yerda).
- Pul — `money()`, sana — `dateTime()` / `localDate()` (`lib/format.ts`).

---

## Litsenziyalar

- Ikonkalar: Font Awesome Free (`webapp/static/vendor/fontawesome/LICENSE.txt`)
- Shriftlar: Plus Jakarta Sans, JetBrains Mono — SIL Open Font License
- htmx, html5-qrcode — o'z litsenziyalari bo'yicha
