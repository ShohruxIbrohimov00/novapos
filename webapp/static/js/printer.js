/**
 * NovaPOS — ReceiptPrinter v5.0 (PWA Universal)
 * ================================================
 *
 * ULANISH USULLARI:
 *
 *   📱 TELEFON / PLANSHET (Android/iOS PWA):
 *      1. RawBT App      — USB yoki Bluetooth printer (Android, eng ishonchli)
 *      2. Web Bluetooth  — To'g'ridan-to'g'ri BT printer (Android Chrome)
 *      3. Web Share      — Chekni ulashish (iOS Safari)
 *
 *   🖥️ KOMPYUTER (Desktop):
 *      4. QZ Tray        — USB/Serial/LAN printer (Windows/Mac/Linux, eng kuchli)
 *      5. IP/LAN Printer — Tarmoqdagi printer (WebSocket yoki QZ Tray orqali)
 *      6. Browser Print  — Har qanday printer (dialog orqali)
 *
 *   📋 FALLBACK (Har qanday qurilma):
 *      7. Clipboard      — Matnni nusxalash
 *
 * ESC/POS KOMANDALAR:
 *   Barcha usullarda ESC/POS komandalar ishlatiladi —
 *   oddiy text emas, to'g'ri termik chop etish uchun.
 *
 * FOYDALANISH:
 *   const printer = new ReceiptPrinter();
 *   await printer.print(receiptText);              // Avtomatik usul
 *   await printer.printWithMethod('rawbt', text);  // Aniq usul
 *   printer.openSettings();                        // Sozlamalar paneli
 */

class ReceiptPrinter {

    // ─────────────────────────────────────────────────────────────────────────
    // ESC/POS KOMANDALAR (Universal termik printer protokoli)
    // ─────────────────────────────────────────────────────────────────────────

    static ESC = 0x1B;
    static GS  = 0x1D;

    static CMD = {
        INIT          : [0x1B, 0x40],           // Printer reset
        ALIGN_LEFT    : [0x1B, 0x61, 0x00],
        ALIGN_CENTER  : [0x1B, 0x61, 0x01],
        ALIGN_RIGHT   : [0x1B, 0x61, 0x02],
        BOLD_ON       : [0x1B, 0x45, 0x01],
        BOLD_OFF      : [0x1B, 0x45, 0x00],
        DOUBLE_HEIGHT : [0x1B, 0x21, 0x10],
        NORMAL_SIZE   : [0x1B, 0x21, 0x00],
        CUT_PAPER     : [0x1D, 0x56, 0x42, 0x00], // Partial cut
        FEED_LINES    : (n) => [0x1B, 0x64, n],    // n qator feed
        LINE_SPACING  : [0x1B, 0x33, 0x18],        // 24 dot spacing
    };

    // ─────────────────────────────────────────────────────────────────────────
    // BLUETOOTH PRINTER UUID LARI
    // Eng ko'p ishlatiladigan termik printer UUID lari
    // ─────────────────────────────────────────────────────────────────────────

    static BT_SERVICES = [
        '000018f0-0000-1000-8000-00805f9b34fb', // Xprinter, Rongta
        '0000ff00-0000-1000-8000-00805f9b34fb', // PeriPage, GoojPrt
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Star Micronics
        '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Sewoo
        '000018f0-0000-1000-8000-00805f9b34fb', // GZM, Bixolon
    ];

    static BT_CHARACTERISTICS = [
        '00002af1-0000-1000-8000-00805f9b34fb', // Xprinter
        '0000ff02-0000-1000-8000-00805f9b34fb', // PeriPage
        '0000ff01-0000-1000-8000-00805f9b34fb', // GoojPrt
        'bf3fbd80-906d-408f-a139-917e00cb8a1e', // Star
        '49535343-8841-cf4e-9da0-26887d729dce', // Sewoo
    ];

    // ─────────────────────────────────────────────────────────────────────────
    // QZ TRAY KONFIGURATSIYASI (Desktop USB/LAN printer)
    // ─────────────────────────────────────────────────────────────────────────

    static QZ_WEBSOCKET_URL = 'wss://localhost:8181'; // QZ Tray default port
    static QZ_FALLBACK_URL  = 'ws://localhost:8182';  // Fallback

    // ─────────────────────────────────────────────────────────────────────────
    // KONSTRUKTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        this.paperWidth   = 32;      // 58mm = 32 belgi | 80mm = 48 belgi
        this.encoding     = 'UTF-8';
        this._btDevice    = null;    // Ulangan BT qurilma (sessiyada saqlanadi)
        this._btChar      = null;    // Ulangan BT characteristic
        this._qzSocket    = null;    // QZ Tray WebSocket
        this._ipPrinter   = null;    // IP printer sozlamalari

        this._loadSettings();
    }

    _loadSettings() {
        try {
            const s = JSON.parse(localStorage.getItem('printer_settings') || '{}');
            this.paperWidth  = s.paper_width  || 32;
            this._ipPrinter  = s.ip_printer   || null;  // { host, port }
            this._method     = s.method       || 'auto'; // Saqlangan usul
        } catch (_) {}
    }

    _saveSettings(data) {
        try {
            const cur = JSON.parse(localStorage.getItem('printer_settings') || '{}');
            localStorage.setItem('printer_settings', JSON.stringify({ ...cur, ...data }));
        } catch (_) {}
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ASOSIY PRINT METODI
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Chekni eng mos usul bilan chop etadi.
     * @param {string} text - Chek matni (cart.buildReceiptText() dan)
     * @returns {Promise<boolean>}
     */
    async print(text) {
        const method = this._method || 'auto';

        if (method !== 'auto') {
            return this.printWithMethod(method, text);
        }

        return this._autoPrint(text);
    }

    /**
     * Aniq usul bilan chop etish.
     * @param {'rawbt'|'bluetooth'|'qztray'|'ip'|'browser'|'share'|'clipboard'} method
     * @param {string} text
     */
    async printWithMethod(method, text) {
        const methods = {
            rawbt    : () => this.printRawBT(text),
            bluetooth: () => this.printBluetooth(text),
            qztray   : () => this.printQZTray(text),
            ip       : () => this.printIP(text),
            browser  : () => this.printBrowser(text),
            share    : () => this.share(text),
            clipboard: () => this.copyToClipboard(text),
        };

        const fn = methods[method];
        if (!fn) {
            this._toast('Noma\'lum printer usuli: ' + method, 'error');
            return false;
        }

        return fn();
    }

    /**
     * Qurilma turiga qarab avtomatik usul tanlash.
     */
    async _autoPrint(text) {
        const ua       = navigator.userAgent.toLowerCase();
        const isAndroid = /android/.test(ua);
        const isIOS     = /iphone|ipad|ipod/.test(ua);
        const isMobile  = isAndroid || isIOS;
        const isDesktop = !isMobile;

        // 1. Kompyuter: QZ Tray tekshirish (USB/LAN printer uchun)
        if (isDesktop) {
            const qzAvail = await this._checkQZTray();
            if (qzAvail) return this.printQZTray(text);

            // 2. IP printer sozlangan bo'lsa
            if (this._ipPrinter?.host) return this.printIP(text);

            // 3. Browser print dialog
            return this.printBrowser(text);
        }

        // 4. Android: RawBT (eng ishonchli — USB ham BT ham ishlaydi)
        if (isAndroid) {
            return this.printRawBT(text);
        }

        // 5. iOS: Web Share (iOS Safari BT printer ni qo'llamaydi)
        if (isIOS && navigator.share) {
            return this.share(text);
        }

        // 6. Fallback: browser print
        return this.printBrowser(text);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. RAWBT (Android — USB + Bluetooth, eng ishonchli usul)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * RawBT ilovasi orqali chop etish.
     * Google Play: "RawBT Print Service"
     * USB ham, Bluetooth ham ishlaydi.
     * UTF-8 + ESC/POS to'liq qo'llab-quvvatlanadi.
     */
    printRawBT(text) {
        try {
            // ESC/POS komandalar bilan boyitilgan matn
            const enhanced = this._addEscPos(text);

            // Base64 encode (UTF-8 ni to'g'ri encode qilish)
            const bytes  = new TextEncoder().encode(enhanced);
            const base64 = this._uint8ToBase64(bytes);
            const url    = `rawbt:base64,${base64}`;

            // Intent orqali ochish
            const link        = document.createElement('a');
            link.href         = url;
            link.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => link.remove(), 1000);

            this._toast('Printer ilovasiga yuborildi ✓', 'success');
            return true;

        } catch (e) {
            console.error('[Printer] RawBT:', e);
            this._toast('RawBT xatosi. Ilova o\'rnatilganmi?', 'error');
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. WEB BLUETOOTH (Android Chrome, to'g'ridan-to'g'ri BT printer)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Web Bluetooth API orqali termik printerga to'g'ridan-to'g'ri ulanish.
     * Avvalgi ulangan qurilmani eslab qoladi (bir marta pair qilish yetarli).
     */
    async printBluetooth(text) {
        if (!navigator.bluetooth) {
            this._toast('Ushbu brauzer Bluetooth-ni qo\'llab-quvvatlamaydi', 'error');
            return false;
        }

        try {
            // Oldingi ulanishni tekshirish
            if (!this._btChar || !this._btDevice?.gatt?.connected) {
                this._btChar  = null;
                this._btDevice = null;

                this._toast('Printer qidirilmoqda...', 'info');

                // Barcha mashhur termik printer servislarini qidirish
                const device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true, // Barcha qurilmalarni ko'rsatish
                    optionalServices: GlobalScanner ? GlobalScanner.BT_SERVICES : ReceiptPrinter.BT_SERVICES,
                });

                this._btDevice = device;

                // Ulanish uzilsa — keshni tozalash
                device.addEventListener('gattserverdisconnected', () => {
                    this._btDevice = null;
                    this._btChar   = null;
                });

                const server = await device.gatt.connect();

                // Ishlayotgan servis va characteristicni topish
                const { service, char } = await this._findBTPrinterChar(server);
                this._btChar = char;

                this._saveSettings({ bt_device_name: device.name });
                this._toast(`Ulandi: ${device.name}`, 'success');
            }

            // ESC/POS ma'lumotlarini yuborish
            await this._btSendData(text);

            this._toast('Chop etildi ✓', 'success');
            return true;

        } catch (e) {
            this._btDevice = null;
            this._btChar   = null;

            if (e.name === 'NotFoundError' || e.name === 'AbortError') {
                this._toast('Printer tanlash bekor qilindi', 'warning');
            } else {
                this._toast('Bluetooth xatosi: ' + e.message, 'error');
            }
            console.error('[Printer] Bluetooth:', e);
            return false;
        }
    }

    /**
     * GATT serverdan ishlayotgan servis va characteristicni topish.
     * Har xil printer modellari boshqa UUID ishlatadi — hammasi sinab ko'riladi.
     */
    async _findBTPrinterChar(server) {
        for (const svcUUID of ReceiptPrinter.BT_SERVICES) {
            try {
                const service = await server.getPrimaryService(svcUUID);

                for (const charUUID of ReceiptPrinter.BT_CHARACTERISTICS) {
                    try {
                        const char = await service.getCharacteristic(charUUID);
                        // Yozish imkoniyatini tekshirish
                        if (char.properties.write || char.properties.writeWithoutResponse) {
                            console.info('[Printer] BT char topildi:', svcUUID, charUUID);
                            return { service, char };
                        }
                    } catch (_) { /* Bu char yo'q, keyingisini sinash */ }
                }

            } catch (_) { /* Bu servis yo'q, keyingisini sinash */ }
        }

        // Topilmasa — barcha writable characteristiclarni olish
        try {
            const services = await server.getPrimaryServices();
            for (const svc of services) {
                const chars = await svc.getCharacteristics();
                for (const char of chars) {
                    if (char.properties.write || char.properties.writeWithoutResponse) {
                        console.info('[Printer] BT fallback char:', char.uuid);
                        return { service: svc, char };
                    }
                }
            }
        } catch (_) {}

        throw new Error('Printer characteristici topilmadi. Qurilma termik printer emasmi?');
    }

    /**
     * BT printer ga ESC/POS ma'lumotlarini yuborish.
     * Chunk hajmi: 512 bytes (ko'pchilik zamonaviy printerlar qabul qiladi).
     * Eski printerlar uchun 128 bytes ga kamaytirish mumkin.
     */
    async _btSendData(text) {
        const escData = this._buildEscPosBytes(text);
        const CHUNK   = 512; // 20 bytes juda kichik edi — 512 ga oshirdik

        for (let i = 0; i < escData.length; i += CHUNK) {
            const chunk = escData.slice(i, i + CHUNK);

            // writeWithoutResponse tezroq, write ishonchli
            if (this._btChar.properties.writeWithoutResponse) {
                await this._btChar.writeValueWithoutResponse(chunk);
            } else {
                await this._btChar.writeValueWithResponse(chunk);
            }

            // Printer buffer uchun kichik pauza (juda katta chunkda kerak)
            if (escData.length > CHUNK) {
                await new Promise(r => setTimeout(r, 30));
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. QZ TRAY (Desktop — USB + Serial + LAN + Network printer)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * QZ Tray — Windows/Mac/Linux da ishlaydi.
     * USB printer, Serial (COM port), va LAN printer hammasini qo'llab-quvvatlaydi.
     * O'rnatish: https://qz.io/download
     *
     * QANDAY ISHLAYDI:
     *   1. Foydalanuvchi kompyuteriga QZ Tray o'rnatadi (bir marta)
     *   2. QZ Tray localhost:8181 da WebSocket server ochadi
     *   3. Biz WebSocket orqali bog'lanamiz va ESC/POS yuboramiz
     *   4. QZ Tray printerga to'g'ri yuboradi
     *
     * Bu HECH QANDAY driver yozmasdan USB, LAN, Wi-Fi printer bilan ishlash imkonini beradi.
     */
    async printQZTray(text) {
        try {
            if (!this._qzSocket || this._qzSocket.readyState !== WebSocket.OPEN) {
                await this._connectQZTray();
            }

            const printerName = await this._getQZDefaultPrinter();
            const escData     = this._buildEscPosBytes(text);
            const base64Data  = this._uint8ToBase64(new Uint8Array(escData));

            // QZ Tray JSON protokoli
            const message = JSON.stringify({
                call: 'print',
                params: {
                    printer: { name: printerName },
                    options: { language: 'ESC/POS', encoding: 'UTF-8' },
                    data: [{ type: 'raw', format: 'base64', data: base64Data }],
                }
            });

            this._qzSocket.send(message);
            this._toast('QZ Tray orqali chop etildi ✓', 'success');
            return true;

        } catch (e) {
            console.error('[Printer] QZ Tray:', e);
            this._toast(
                'QZ Tray topilmadi. <a href="https://qz.io/download" target="_blank">O\'rnatish</a>',
                'error'
            );
            return false;
        }
    }

    async _connectQZTray() {
        return new Promise((resolve, reject) => {
            // HTTPS da WSS, HTTP da WS
            const urls = [
                ReceiptPrinter.QZ_WEBSOCKET_URL,  // wss://localhost:8181
                ReceiptPrinter.QZ_FALLBACK_URL,   // ws://localhost:8182
            ];

            let tried = 0;

            const tryNext = () => {
                if (tried >= urls.length) {
                    reject(new Error('QZ Tray topilmadi'));
                    return;
                }

                const ws = new WebSocket(urls[tried++]);
                const timeout = setTimeout(() => { ws.close(); tryNext(); }, 2000);

                ws.onopen = () => {
                    clearTimeout(timeout);
                    this._qzSocket = ws;
                    ws.onerror = ws.onclose = () => {
                        this._qzSocket = null;
                    };
                    resolve();
                };
                ws.onerror = () => { clearTimeout(timeout); tryNext(); };
            };

            tryNext();
        });
    }

    async _getQZDefaultPrinter() {
        // Saqlangan printer nomini ishlatish
        const saved = JSON.parse(localStorage.getItem('printer_settings') || '{}');
        if (saved.qz_printer_name) return saved.qz_printer_name;

        // QZ Tray dan default printer ro'yxatini so'rash
        return new Promise((resolve) => {
            if (!this._qzSocket) { resolve('default'); return; }

            const handler = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.call === 'printers') {
                        this._qzSocket.removeEventListener('message', handler);
                        const printers = data.params?.printers || [];
                        resolve(printers[0] || 'default');
                    }
                } catch (_) { resolve('default'); }
            };

            this._qzSocket.addEventListener('message', handler);
            this._qzSocket.send(JSON.stringify({ call: 'printers', params: {} }));

            // 1 sekundda javob kelmasa — default
            setTimeout(() => resolve('default'), 1000);
        });
    }

    async _checkQZTray() {
        try {
            await this._connectQZTray();
            return true;
        } catch (_) {
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. IP / LAN PRINTER (Tarmoqdagi printer, WebSocket orqali)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Tarmoqdagi (LAN/Wi-Fi) termik printer ga ulanish.
     *
     * QANDAY ISHLAYDI:
     *   - Ko'pchilik tarmoq printerlari 9100-portda RAW socket tinglaydi
     *   - Brauzerdan to'g'ridan-to'g'ri TCP socket ochib bo'lmaydi (xavfsizlik)
     *   - Shuning uchun backend orqali yuboramiz: POST /api/print/raw
     *   - Backend printer ga 9100-portda connect qilib ma'lumot yuboradi
     *
     * SOZLASH:
     *   printer.setIPPrinter('192.168.1.100', 9100)
     *   yoki printer.openSettings() dan sozlash
     */
    async printIP(text) {
        if (!this._ipPrinter?.host) {
            this._toast('IP printer sozlanmagan. Sozlamalardan kiriting.', 'warning');
            this.openSettings();
            return false;
        }

        try {
            const escData    = this._buildEscPosBytes(text);
            const base64Data = this._uint8ToBase64(new Uint8Array(escData));

            // Backend orqali RAW print (POST /api/print/raw)
            const res = await fetch('/api/print/raw', {
                method : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body   : JSON.stringify({
                    host: this._ipPrinter.host,
                    port: this._ipPrinter.port || 9100,
                    data: base64Data,
                }),
            });

            if (!res.ok) throw new Error(`Server xatosi: ${res.status}`);

            this._toast('IP printer orqali chop etildi ✓', 'success');
            return true;

        } catch (e) {
            console.error('[Printer] IP:', e);
            this._toast('IP printer xatosi: ' + e.message, 'error');
            return false;
        }
    }

    /**
     * IP printer sozlamasini o'rnatish.
     * @param {string} host - Printer IP manzili (masalan, '192.168.1.100')
     * @param {number} port - Port (odatda 9100)
     */
    setIPPrinter(host, port = 9100) {
        this._ipPrinter = { host, port };
        this._saveSettings({ ip_printer: { host, port } });
        console.info('[Printer] IP printer sozlandi:', host, port);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. BROWSER PRINT DIALOG
    // ─────────────────────────────────────────────────────────────────────────

    printBrowser(text) {
        const win = window.open('', '_blank', 'width=420,height=750');
        if (!win) {
            this._toast('Pop-up bloklangan. Brauzer sozlamalarini tekshiring.', 'warning');
            return this.copyToClipboard(text);
        }

        // 58mm chek uchun to'g'ri CSS
        const W = this.paperWidth === 48 ? '80mm' : '58mm';

        win.document.write(`<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <title>Chek — NovaPOS</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 10px;
      line-height: 1.5;
      white-space: pre;
      padding: 2mm 3mm;
      color: #000;
      background: #fff;
      width: ${W};
    }
    @media print {
      @page { size: ${W} auto; margin: 0; }
      body  { padding: 0 2mm; }
    }
    .no-print { text-align: center; margin: 8px 0; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
<div class="no-print">
  <button onclick="window.print()" style="padding:6px 18px;font-size:12px;cursor:pointer;border-radius:4px;border:1px solid #ccc">
    🖨️ Chop etish
  </button>
</div>
${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
</body>
</html>`);

        win.document.close();
        setTimeout(() => { win.focus(); win.print(); }, 400);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. WEB SHARE API
    // ─────────────────────────────────────────────────────────────────────────

    async share(text) {
        if (navigator.share) {
            try {
                await navigator.share({ title: 'Sotuv cheki — NovaPOS', text });
                return true;
            } catch (e) {
                if (e.name !== 'AbortError') {
                    return this.copyToClipboard(text);
                }
                return false;
            }
        }
        return this.copyToClipboard(text);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. CLIPBOARD FALLBACK
    // ─────────────────────────────────────────────────────────────────────────

    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (_) {
            // Eski brauzer fallback
            const ta = Object.assign(document.createElement('textarea'), {
                value   : text,
                style   : 'position:fixed;opacity:0;top:0;left:0',
            });
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        this._toast('Chek matnidan nusxa olindi 📋', 'success');
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ESC/POS BAYT GENERATSIYASI
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Matnni ESC/POS baytlariga aylantirish.
     * To'g'ri termik chop etish uchun zarur.
     */
    _buildEscPosBytes(text) {
        const enc  = new TextEncoder();
        const buf  = [];
        const cmd  = ReceiptPrinter.CMD;

        // Init
        buf.push(...cmd.INIT);
        buf.push(...cmd.LINE_SPACING);

        // Matnni qatorlarga bo'lib, har birini qayta ishlash
        const lines = text.split('\n');

        for (const line of lines) {
            const trimmed = line.trimEnd();

            // === bilan boshlangan qatorlar — Sarlavha (bold + center)
            if (trimmed.startsWith('===') || trimmed.startsWith('---')) {
                buf.push(...cmd.ALIGN_CENTER);
                buf.push(...cmd.BOLD_ON);
                buf.push(...enc.encode(trimmed));
                buf.push(...cmd.BOLD_OFF);
                buf.push(...cmd.ALIGN_LEFT);
            }
            // BOSH HARFLI qatorlar — Do'kon nomi kabi (bold)
            else if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && /[A-ZА-ЯA-Z]/.test(trimmed)) {
                buf.push(...cmd.BOLD_ON);
                buf.push(...enc.encode(trimmed));
                buf.push(...cmd.BOLD_OFF);
            }
            else {
                buf.push(...enc.encode(trimmed));
            }

            buf.push(0x0A); // LF (newline)
        }

        // Qog'oz kesish oldidan feed
        buf.push(...cmd.FEED_LINES(4));
        buf.push(...cmd.CUT_PAPER);

        return new Uint8Array(buf);
    }

    /**
     * RawBT uchun string ESC/POS
     */
    _addEscPos(text) {
        return text + '\n\n\n\n';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SOZLAMALAR PANELI
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Printer sozlamalar panelini ochish.
     * Foydalanuvchi usul, IP, kog'oz kengligi va boshqalarni sozlay oladi.
     */
    openSettings() {
        // Eski panel bo'lsa — olib tashlash
        document.getElementById('printer-settings-panel')?.remove();

        const s    = JSON.parse(localStorage.getItem('printer_settings') || '{}');
        const ua   = navigator.userAgent.toLowerCase();
        const isAnd = /android/.test(ua);
        const isDes = !(/android|iphone|ipad/.test(ua));

        const panel = document.createElement('div');
        panel.id    = 'printer-settings-panel';
        panel.style.cssText = `
            position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:99999;
            display:flex; align-items:center; justify-content:center; padding:16px;
            backdrop-filter:blur(4px);
        `;

        panel.innerHTML = `
        <div style="background:var(--surface,#fff); border-radius:20px; padding:24px;
                    width:100%; max-width:420px; max-height:90vh; overflow-y:auto;
                    font-family:inherit; color:var(--text,#111); box-shadow:0 20px 60px rgba(0,0,0,.3)">

            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px">
                <h3 style="font-size:17px; font-weight:900">🖨️ Printer Sozlamalari</h3>
                <button onclick="this.closest('#printer-settings-panel').remove()"
                        style="width:30px; height:30px; border-radius:8px; border:none;
                               background:var(--surface2,#f1f5f9); cursor:pointer; font-size:16px">✕</button>
            </div>

            <!-- Qog'oz kengligi -->
            <div style="margin-bottom:16px">
                <label style="font-size:10px; font-weight:900; text-transform:uppercase;
                              letter-spacing:1px; color:var(--text3,#94a3b8); display:block; margin-bottom:6px">
                    Qog'oz kengligi
                </label>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
                    <button onclick="_printerSetPaper(32, this)"
                            style="padding:12px; border-radius:12px; border:2px solid ${s.paper_width===48?'var(--border,#e2e8f0)':'var(--primary,#2563eb)'};
                                   background:${s.paper_width===48?'var(--surface2,#f1f5f9)':'var(--primary-s,#eff6ff)'};
                                   cursor:pointer; font-weight:800; font-size:13px; font-family:inherit;
                                   color:${s.paper_width===48?'var(--text2)':'var(--primary,#2563eb)'}">
                        📄 58mm (32 belgi)
                    </button>
                    <button onclick="_printerSetPaper(48, this)"
                            style="padding:12px; border-radius:12px; border:2px solid ${s.paper_width===48?'var(--primary,#2563eb)':'var(--border,#e2e8f0)'};
                                   background:${s.paper_width===48?'var(--primary-s,#eff6ff)':'var(--surface2,#f1f5f9)'};
                                   cursor:pointer; font-weight:800; font-size:13px; font-family:inherit;
                                   color:${s.paper_width===48?'var(--primary,#2563eb)':'var(--text2)'}">
                        📄 80mm (48 belgi)
                    </button>
                </div>
            </div>

            <!-- Usul tanlash -->
            <div style="margin-bottom:16px">
                <label style="font-size:10px; font-weight:900; text-transform:uppercase;
                              letter-spacing:1px; color:var(--text3,#94a3b8); display:block; margin-bottom:6px">
                    Printer Usuli
                </label>
                <select id="printer-method-sel"
                        style="width:100%; padding:12px; border-radius:12px; border:1.5px solid var(--border,#e2e8f0);
                               background:var(--surface2,#f1f5f9); font-size:14px; font-weight:700;
                               color:var(--text,#111); outline:none; font-family:inherit; cursor:pointer">
                    <option value="auto"      ${s.method==='auto'||!s.method?'selected':''}>🔄 Avtomatik (tavsiya etiladi)</option>
                    ${isAnd ? `<option value="rawbt"   ${s.method==='rawbt'?'selected':''}>📱 RawBT (USB + Bluetooth)</option>` : ''}
                    <option value="bluetooth" ${s.method==='bluetooth'?'selected':''}>🦷 Web Bluetooth</option>
                    ${isDes ? `<option value="qztray"  ${s.method==='qztray'?'selected':''}>🖥️ QZ Tray (USB/LAN/Serial)</option>` : ''}
                    <option value="ip"        ${s.method==='ip'?'selected':''}>🌐 IP / LAN Printer</option>
                    <option value="browser"   ${s.method==='browser'?'selected':''}>🖨️ Brauzer Print Dialogi</option>
                    <option value="share"     ${s.method==='share'?'selected':''}>📤 Ulashish (Share)</option>
                    <option value="clipboard" ${s.method==='clipboard'?'selected':''}>📋 Nusxa olish</option>
                </select>
            </div>

            <!-- IP Printer sozlama -->
            <div id="ip-printer-section" style="margin-bottom:16px; display:${s.method==='ip'?'block':'none'}">
                <label style="font-size:10px; font-weight:900; text-transform:uppercase;
                              letter-spacing:1px; color:var(--text3,#94a3b8); display:block; margin-bottom:6px">
                    Printer IP Manzili
                </label>
                <div style="display:flex; gap:8px">
                    <input id="printer-ip-host" type="text" placeholder="192.168.1.100"
                           value="${s.ip_printer?.host || ''}"
                           style="flex:1; padding:11px 13px; border-radius:12px; border:1.5px solid var(--border,#e2e8f0);
                                  background:var(--surface2,#f1f5f9); font-size:14px; font-weight:600;
                                  color:var(--text,#111); outline:none; font-family:inherit"
                           oninput="document.getElementById('ip-printer-section').dataset.host=this.value">
                    <input id="printer-ip-port" type="number" placeholder="9100" value="${s.ip_printer?.port || 9100}"
                           style="width:80px; padding:11px 8px; border-radius:12px; border:1.5px solid var(--border,#e2e8f0);
                                  background:var(--surface2,#f1f5f9); font-size:14px; font-weight:600;
                                  color:var(--text,#111); outline:none; font-family:inherit; text-align:center">
                </div>
                <div style="font-size:11px; color:var(--text3,#94a3b8); margin-top:6px; line-height:1.5">
                    💡 Printer va telefon/kompyuter bir xil Wi-Fi tarmog'ida bo'lishi kerak.<br>
                    Printer IP manzilini printer menusi yoki router admin panelidan toping.
                </div>
            </div>

            <!-- QZ Tray ma'lumot -->
            <div id="qztray-info" style="display:${s.method==='qztray'?'block':'none'}; margin-bottom:16px;
                                         background:var(--primary-s,#eff6ff); border-radius:12px; padding:12px">
                <div style="font-size:12px; font-weight:700; color:var(--primary,#2563eb); margin-bottom:4px">
                    QZ Tray haqida
                </div>
                <div style="font-size:11px; color:var(--text2,#475569); line-height:1.5">
                    QZ Tray kompyuteringizga bir marta o'rnatiladi va USB, Serial (COM port),
                    LAN, hamda Wi-Fi printerlar bilan ishlaydi.<br><br>
                    <a href="https://qz.io/download" target="_blank"
                       style="color:var(--primary,#2563eb); font-weight:800">
                        ⬇️ QZ Tray yuklab olish →
                    </a>
                </div>
            </div>

            <!-- Usul o'zgartirilganda -->
            <script>
                document.getElementById('printer-method-sel').onchange = function() {
                    document.getElementById('ip-printer-section').style.display =
                        this.value === 'ip' ? 'block' : 'none';
                    document.getElementById('qztray-info').style.display =
                        this.value === 'qztray' ? 'block' : 'none';
                };
            </script>

            <!-- Test Print -->
            <button onclick="_printerTest()" style="width:100%; padding:12px; border-radius:12px;
                    border:1.5px solid var(--border,#e2e8f0); background:var(--surface2,#f1f5f9);
                    font-size:13px; font-weight:800; cursor:pointer; font-family:inherit;
                    color:var(--text,#111); margin-bottom:10px; display:flex;
                    align-items:center; justify-content:center; gap:8px">
                🧾 Test chek chiqarish
            </button>

            <!-- Saqlash -->
            <button onclick="_printerSaveSettings()" style="width:100%; padding:14px; border-radius:12px;
                    border:none; background:var(--primary,#2563eb); color:#fff;
                    font-size:14px; font-weight:900; cursor:pointer; font-family:inherit">
                Saqlash ✓
            </button>
        </div>`;

        document.body.appendChild(panel);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // YORDAMCHI METODLAR
    // ─────────────────────────────────────────────────────────────────────────

    _uint8ToBase64(uint8Array) {
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
        }
        return btoa(binary);
    }

    _toast(msg, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(msg, type);
        } else {
            console.info('[Printer]', msg);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL INSTANSIYA VA YORDAMCHI FUNKSIYALAR (Settings panel uchun)
// ─────────────────────────────────────────────────────────────────────────────

const printer = new ReceiptPrinter();

// Settings panel tugmalari
window._printerSetPaper = function(width, btn) {
    printer.paperWidth = width;
    printer._saveSettings({ paper_width: width });
    // Tugmalar holatini yangilash
    btn.closest('div').querySelectorAll('button').forEach(b => {
        const isThis = b === btn;
        b.style.borderColor = isThis ? 'var(--primary,#2563eb)' : 'var(--border,#e2e8f0)';
        b.style.background  = isThis ? 'var(--primary-s,#eff6ff)' : 'var(--surface2,#f1f5f9)';
        b.style.color       = isThis ? 'var(--primary,#2563eb)' : 'var(--text2)';
    });
};

window._printerSaveSettings = function() {
    const method = document.getElementById('printer-method-sel')?.value;
    const host   = document.getElementById('printer-ip-host')?.value?.trim();
    const port   = parseInt(document.getElementById('printer-ip-port')?.value) || 9100;

    if (method) printer._method = method;
    if (host)   printer.setIPPrinter(host, port);

    printer._saveSettings({ method });
    document.getElementById('printer-settings-panel')?.remove();

    if (typeof showToast === 'function') showToast('Sozlamalar saqlandi ✓', 'success');
};

window._printerTest = async function() {
    const testText = [
        '================================',
        '          TEST CHEK             ',
        '================================',
        'NovaPOS Printer Test',
        '--------------------------------',
        'Mahsulot 1          1 x 50,000',
        'Mahsulot 2          2 x 25,000',
        '--------------------------------',
        'JAMI:              100,000 so\'m',
        'To\'landi:          100,000 so\'m',
        'Qaytim:                  0 so\'m',
        '================================',
        '       Rahmat! Qaytib keling!   ',
        '================================',
        '',
    ].join('\n');

    await printer.print(testText);
};