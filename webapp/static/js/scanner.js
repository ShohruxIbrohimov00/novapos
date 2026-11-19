/**
 * NovaPOS — GlobalScanner v6.0 (Production-Ready)
 * =================================================
 *
 * QO'LLAB-QUVVATLASH:
 *   ✅ USB Barcode Skaner     — keyboard emulation, Enter terminatli
 *   ✅ Bluetooth HID Skaner   — 100ms gacha kechikish tolerantligi
 *   ✅ PWA Mobil Kamera       — adaptiv makro fokus, to'g'ri barcode qutisi
 *   ✅ Anti-duplicate         — bir xil kodni qayta o'qishdan himoya
 *   ✅ Input-safe             — foydalanuvchi yozayotganda inputni buzmaslik
 *   ✅ Race-condition-safe    — pause/resume/stop orasidagi xatolardan himoya
 *   ✅ Offline fallback       — 404 da ham IDB dan qidirish
 *
 * FOYDALANISH:
 *   const scanner = new GlobalScanner();
 *   scanner.init(code => handleScan(code));
 *   await scanner.startCamera('cam-reader');
 */

class GlobalScanner {

    // ─────────────────────────────────────────────────────────────────────────
    // KONSTANTALAR
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Skaner apparatlar belgini odatda 5-30ms da yozadi.
     * Bluetooth HID (Honeywell, Zebra, Newland) ba'zan 80-100ms gacha boradi.
     * Odam yozishi odatda 120ms dan sekinroq.
     * => 100ms tolerant, lekin odam yozishidan farqlash uchun xavfsiz chegara.
     */
    static HARDWARE_KEYSTROKE_DELAY = 100;

    /**
     * Eng qisqa barcode/PLU uzunligi (EAN-8 = 8, lekin ba'zi PLU 2-3 belgili).
     * 2 dan past bo'lsa tasodifiy tugmalar ham ishga tushishi mumkin.
     */
    static MIN_CODE_LENGTH = 2;

    /**
     * Bir xil kodni qayta o'qishni oldini olish (ms).
     * Kamera har 66ms da kadr olyapti (15fps), shuning uchun 1.5s yetarli.
     */
    static DEBOUNCE_MS = 1500;

    /**
     * Kamera konfiguratsiyasi.
     * Barcode gorizontal — shuning uchun quti keng (16:9 nisbatga yaqin).
     * 15fps CPU/batareya uchun optimal, barcode uchun yetarli.
     */
    static CAMERA_CONFIG = {
        fps: 30, // Tezlikni maksimal qildik
        qrbox: { width: 280, height: 120 }, // Barcode uchun uzunchoq va ingichka quti
        aspectRatio: 1.0, 
        disableFlip: false,
    };

    /**
     * Kamera uchun video constraints.
     * `advanced` ni constructor ichida emas, `startCamera` ichida qilamiz —
     * qurilma capabilities ni tekshirgandan keyin.
     */
    static VIDEO_CONSTRAINTS = {
        facingMode: 'environment',
        width      : { ideal: 1280 },
        height     : { ideal: 720  },
    };

    /**
     * Barcode uchun kerakli formatlar (ortiqchasini o'chirish tezlikni oshiradi).
     * QR_CODE ham qo'shilgan — ayrim do'konlar QR bilan ham ishlaydi.
     */
    static get SCAN_FORMATS() {
        if (typeof Html5QrcodeSupportedFormats === 'undefined') return undefined;
        return [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.QR_CODE,
        ];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // KONSTRUKTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        // Hardware (USB/Bluetooth) bufer
        this._hwBuffer      = '';
        this._hwLastKeyTime = 0;

        // Kamera
        this._html5qr     = null;
        this._scanning    = false;
        this._resumeTimer = null; // pause/resume uchun timer ref

        // Umumiy
        this._callback    = null;
        this._lastScanned = '';
        this._lastScanAt  = 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Skaner sistemasini ishga tushurish.
     * @param {function} callback - Skan qilingan kodni qabul qiluvchi funksiya
     */
    init(callback) {
        if (typeof callback !== 'function') {
            console.error('[Scanner] init() ga funksiya berilishi shart');
            return;
        }
        this._callback = callback;
        this._setupHardwareListener();
        console.info('[Scanner] Hardware skaner tayyor (USB + Bluetooth HID)');
    }


    /**
     * Kamerani Professional rejimda ishga tushurish.
     * @param {string} elementId - Html5Qrcode uchun container element ID
     * @param {object} customConfig - Qo'shimcha konfiguratsiya
     */
    async startCamera(elementId, customConfig = {}) {
        if (this._scanning) {
            console.warn('[Scanner] Kamera allaqachon ishlayapti');
            return false;
        }

        if (typeof Html5Qrcode === 'undefined') {
            this._showError('QR Skaner kutubxonasi yuklanmagan!');
            return false;
        }

        // 1. Professional Skaner Konfiguratsiyasi
        const formats = GlobalScanner.SCAN_FORMATS;
        const config = {
            fps: 25,                      // Tezlikni oshirdik (Silliq tasvir)
            qrbox: { width: 260, height: 120 }, // Barcode uchun uzunchoq quti
            aspectRatio: 1.0,             // Mobil qurilmalarda markazlash uchun 1:1 kvadrat kadr
            disableFlip: false,
            ...(formats ? { formatsToSupport: formats } : {}),
            ...customConfig,
        };

        // Mobil ekranlar uchun moslashtirish
        if (window.innerWidth < 600) {
            config.qrbox = { width: 250, height: 110 };
            config.aspectRatio = 1.0; 
        }

        try {
            this._html5qr = new Html5Qrcode(elementId);
            await this._html5qr.start(
                { facingMode: "environment" },
                { ...GlobalScanner.CAMERA_CONFIG, ...customConfig },
                (text) => this._onCameraResult(text),
                () => {} 
            );
    
            this._scanning = true;
    
            // 1. UI TOZALASH (Kutubxona chizgan ortiqcha qutilarni yashirish)
            const video = document.querySelector(`#${elementId} video`);
            if (video) {
                video.style.objectFit = "cover"; // Videoni konteynerga to'liq yoyish
                video.style.width = "100%";
                video.style.height = "100%";
            }
            // Kutubxonaning ichki ramkasini yashiramiz (CSS dagi o'zimizniki qoladi)
            const region = document.querySelector(`#${elementId}__scan_region`);
            if (region) region.style.display = "none";
    
            // 2. FOKUSNI QULFLASH (Continuous focus)
            setTimeout(async () => {
                try {
                    const track = this._html5qr.getRunningTrack();
                    if (track.getCapabilities().focusMode?.includes('continuous')) {
                        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
                    }
                } catch (e) { console.warn("Focus API fail"); }
            }, 500);
    
            return true;
        } catch (err) {
            this._scanning = false;
            this._html5qr  = null;
            this._handleCameraError(err);
            return false;
        }
    }

    /**
     * Kamerani to'xtatish.
     */
    async stopCamera() {
        if (this._html5qr) {
            try {
                // Faqat skaner ishlayotgan (yoki pause bo'lgan) bo'lsa to'xtatamiz
                if (this._html5qr.isScanning) { 
                    await this._html5qr.stop();
                }
            } catch (e) {
                // Kutubxona allaqachon to'xtagan bo'lsa, xatoni konsolga chiqarmaymiz
                console.warn("[Scanner] To'xtatishda xato (ignor):", e.message);
            } finally {
                // Har qanday holatda ham o'zgaruvchilarni tozalaymiz
                if (typeof this._html5qr.clear === 'function') this._html5qr.clear();
                this._html5qr = null;
                this._scanning = false;
            }
        }
    }

    /**
     * Kamerani yoqish/o'chirish.
     * @returns {Promise<boolean>} - Yangi holat: true = yoqildi, false = o'chirildi
     */
    async toggleCamera(elementId, config = {}) {
        if (this._scanning) {
            await this.stopCamera();
            return false;
        }
        return this.startCamera(elementId, config);
    }

    /** Kamera ishlayotganligini bildiradi */
    get isScanning() {
        return this._scanning;
    }

    /**
     * Backend + IDB dan mahsulot qidirish.
     * Online bo'lsa backend, offline bo'lsa IDB, ikkalasi ham ishlamasa null.
     * 404 da ham IDB fallback qilinadi.
     * @param {string} code
     * @returns {Promise<object|null>}
     */
    async lookupProduct(code) {
        // Online: backend
        if (navigator.onLine) {
            try {
                return await apiRequest(
                    `/api/products/scan/${encodeURIComponent(code)}`,
                    'GET', null, true
                );
            } catch (e) {
                // 404 — topilmadi, lekin IDB dan ham qidirish kerak (local ma'lumot bo'lishi mumkin)
                // Boshqa xatolarda ham IDB fallback
                console.warn('[Scanner] Backend xatosi, IDB fallback:', e.status || e.message);
            }
        }

        // Offline fallback yoki backend xatosida IDB
        if (window.NovaPOS_DB) {
            try {
                return await NovaPOS_DB.products.getByCode(code);
            } catch (e) {
                console.warn('[Scanner] IDB xatosi:', e.message);
            }
        }

        return null;
    }

    /**
     * Qurilmada kamera borligini tekshirish.
     * @returns {Promise<boolean>}
     */
    static async checkCamera() {
        try {
            if (!navigator?.mediaDevices?.enumerateDevices) return false;
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.some(d => d.kind === 'videoinput');
        } catch {
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HARDWARE SKANER (USB / BLUETOOTH HID)
    // ─────────────────────────────────────────────────────────────────────────

    _setupHardwareListener() {
        document.addEventListener('keydown', (e) => {
            // Modifier tugmalar (Ctrl+C, Alt+Tab va hokazo) — ignor
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            // ✅ Raqam kiritiladigan oyna ochiq (vazn, to'lov summasi, yangi mijoz) — skaner jim turadi.
            // Aks holda tez yozilgan "1.5"+Enter yoki "50000"+Enter shtrix-kod deb ushlanardi.
            if (document.querySelector('[data-scanner-off]:not(.hidden)')) { this._hwBuffer = ''; return; }

            const key = e.key;
            if (!key) return;

            const now = Date.now();

            // Agar oxirgi tugmadan beri ko'p vaqt o'tgan bo'lsa —
            // yangi session boshlandi (odam yozmoqda yoki yangi barcode)
            if (now - this._hwLastKeyTime > GlobalScanner.HARDWARE_KEYSTROKE_DELAY) {
                this._hwBuffer = '';
            }
            this._hwLastKeyTime = now;

            if (key === 'Enter') {
                const code = this._hwBuffer.trim();
                this._hwBuffer = '';

                if (code.length >= GlobalScanner.MIN_CODE_LENGTH) {
                    this._handleHardwareScan(e, code);
                }

            } else if (key.length === 1) {
                // Faqat bosiladigan (printable) belgilar
                this._hwBuffer += key;
            }
            // Shift, CapsLock, Arrow, Tab va boshqa maxsus tugmalar — ignor
        }, true); // Capture phase: hamma handler'dan oldin ishlaydi
    }

    /**
     * Hardware skaner Enter bosganda chaqiriladi.
     * Logika: Foydalanuvchi INPUT ichida o'zi yozayotgan bo'lishi mumkin.
     * Biz bu holatni keystroke tezligi bilan aniqlaymiz.
     * Agar buffer skaner tezligida to'plangan bo'lsa — skaner deb qabul qilamiz.
     */
    _handleHardwareScan(event, code) {
        const activeEl = document.activeElement;
        const isInputFocused = activeEl && (
            activeEl.tagName === 'INPUT'    ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.isContentEditable
        );

        if (isInputFocused) {
            /**
             * INPUT FOKUSDA: Skaner inputga to'g'ridan-to'g'ri yozadi.
             * Biz kodni interceptsiya qilish uchun:
             * 1. inputga yozilgan skanerning matnini o'chiramiz
             * 2. Enter default amalini to'xtatamiz
             *
             * MUHIM: Biz faqat input qiymati bizning buferdagi kod bilan tugasa o'chiramiz.
             * Bu foydalanuvchi o'zi yozayotgan matnni buzmaslikni ta'minlaydi.
             *
             * Lekin: agar input POS search bo'lsa (skaner uchun mo'ljallangan),
             * odatda to'liq qiymat skaner kodiga teng bo'ladi.
             */
            const inputVal = activeEl.value;

            // Inputdagi qiymat faqat skaner kodidan iborat bo'lsa — bu skaner
            if (inputVal === code || inputVal.endsWith(code)) {
                // Skanerning yozganini inputdan olib tashlash
                activeEl.value = inputVal === code ? '' : inputVal.slice(0, -code.length);

                // Enter default amalini bloklash (form submit va hokazo)
                event.preventDefault();
                event.stopImmediatePropagation();

                this._processScan(code, 'hardware');
            }
            // Aks holda: foydalanuvchi o'zi yozayotgan — aralashmaymiz

        } else {
            // INPUT fokusda emas — bu aniq skaner
            event.preventDefault();
            event.stopImmediatePropagation();
            this._processScan(code, 'hardware');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // KAMERA SKANERNING NATIJASI
    // ─────────────────────────────────────────────────────────────────────────

    _onCameraResult(decodedText) {
        const code = decodedText.trim();
        if (!code) return;

        this._processScan(code, 'camera');

        // Duplicate oldini olish: debounce davomida kamerani muzlatamiz
        // Race condition: agar scanner allaqachon stopped bo'lsa — xato bermasin
        if (!this._scanning || !this._html5qr) return;

        try {
            this._html5qr.pause();
        } catch (_) { /* Ignore pause errors */ }

        // Avvalgi resume timerni bekor qil
        if (this._resumeTimer) {
            clearTimeout(this._resumeTimer);
        }

        this._resumeTimer = setTimeout(() => {
            this._resumeTimer = null;
            // Faqat scanning hali aktiv bo'lsa resume
            if (this._scanning && this._html5qr) {
                try {
                    this._html5qr.resume();
                } catch (_) { /* Scanner stopped bo'lgan bo'lishi mumkin */ }
            }
        }, GlobalScanner.DEBOUNCE_MS);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FOKUS OPTIMIZATSIYASI (Kamera)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Telefonning kamera sensoridan eng yaxshi fokus rejimini tanlab qo'llaydi.
     *
     * MUHIM: Ba'zi qurilmalarda 'macro' alohida fizik kamera —
     * uni 'continuous' bilan birga so'rash xato beradi!
     * Shuning uchun biz capabilities tekshirib, qo'llab-quvvatlanadigan rejimni tanlaymiz.
     *
     * Ustuvorlik tartibi:
     *   1. continuous  — eng universal, dinamik fokus
     *   2. macro       — yaqin barcode uchun (agar alohida qo'llab-quvvatlansa)
     *   3. auto        — fallback
     *   4. Hech narsa  — qurilma o'zi biladi
     */
    async _applyOptimalFocus(elementId) {
        try {
            const video = document.querySelector(`#${elementId} video`);
            if (!video?.srcObject) return;

            const track = video.srcObject.getVideoTracks()?.[0];
            if (!track) return;

            const capabilities = track.getCapabilities?.() ?? {};
            const availableModes = capabilities.focusMode ?? [];

            // Ustuvorlik tartibi bo'yicha mos rejimni topamiz
            const preferredModes = ['continuous', 'auto'];
            const selectedMode = preferredModes.find(m => availableModes.includes(m));

            const constraints = { advanced: [{}] };
            let applyNeeded = false;

            // Fokus rejimi
            if (selectedMode) {
                constraints.advanced[0].focusMode = selectedMode;
                applyNeeded = true;
            }

            // Fokus masofasi: barcode odatda 5-20 sm masofada bo'ladi
            // Qurilma buni qo'llab-quvvatlasa, optimal masofaga sozlaymiz
            if (capabilities.focusDistance) {
                const { min = 0, max = 1 } = capabilities.focusDistance;
                // 15-25 sm oraliq barcode uchun ideal — bu min+20% ga to'g'ri keladi
                const optimalDistance = min + (max - min) * 0.2;
                constraints.advanced[0].focusDistance = optimalDistance;
                applyNeeded = true;
            }

            if (applyNeeded) {
                await track.applyConstraints(constraints);
                console.info('[Scanner] Fokus qo\'llanildi:', constraints.advanced[0]);
            }

            // Zoom: agar qo'llab-quvvatlansa, 1.0x da turamiz (zoom barcode ni kattalashtirmaydi)
            // Ba'zi ilovalar zoom berib, fokus maydonini kichraytiradi — buni QILMAYMIZ

        } catch (e) {
            // Fokus API ko'pchilik brauzerlarda cheklangan — bu normal
            console.info('[Scanner] Fokus API mavjud emas yoki qurilma qo\'llamaydi:', e.message);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // UMUMIY SKAN PROTSESSORI
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Har qanday manbadan (hardware / camera) kelgan kodni qayta ishlaydi.
     * Anti-duplicate himoyasi shu yerda.
     */
    _processScan(code, source) {
        if (!code || code.length < GlobalScanner.MIN_CODE_LENGTH) return;

        const now = Date.now();

        // Anti-duplicate FAQAT KAMERA uchun (kamera bitta kodni ketma-ket ko'p marta o'qiydi).
        // ✅ USB skanerda har bir bosish = bitta tovar: kassir 2 ta bir xil suvni tez skanerlasa,
        // ikkalasi ham qo'shilishi shart (avval 1.5 soniya ichidagi ikkinchisi yo'qolardi).
        if (source === 'camera' && code === this._lastScanned && (now - this._lastScanAt) < GlobalScanner.DEBOUNCE_MS) {
            return;
        }

        this._lastScanned = code;
        this._lastScanAt  = now;

        // 1. FAQAT KAMERA UCHUN VIBRATSIYA (Apparat hissini beradi)
        // Ovoz pos.html dagi addProd ichida chiqadi, shuning uchun bu yerga ovoz qo'shmaymiz.
        if (source === 'camera' && navigator.vibrate) {
            navigator.vibrate(50); // Juda qisqa va aniq "tirs" etgan vibratsiya
        }

        // 2. Callbackni chaqirish (handleScan -> addProd -> BEEP shu yerda chiqadi)
        if (typeof this._callback === 'function') {
            this._callback(code);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // YORDAMCHI METODLAR
    // ─────────────────────────────────────────────────────────────────────────

    _handleCameraError(err) {
        console.error('[Scanner] Kamera xatosi:', err);

        if (err?.name === 'NotAllowedError') {
            this._showError('Kamera uchun ruxsat berilmagan. Brauzer sozlamalaridan yoqing.');
        } else if (err?.name === 'NotFoundError') {
            this._showError('Kamera topilmadi. Qurilmangizda kamera bor-yo\'qligini tekshiring.');
        } else if (err?.name === 'NotReadableError') {
            this._showError('Kamera band. Boshqa ilova kamerani ishlatayotgan bo\'lishi mumkin.');
        } else {
            this._showError('Kamera ishga tushmadi. Sahifani yangilang va qayta urining.');
        }
    }

    _showError(msg) {
        if (typeof showToast === 'function') {
            showToast(msg, 'error');
        } else {
            console.error('[Scanner]', msg);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL INSTANSIYA
// ─────────────────────────────────────────────────────────────────────────────

const scanner = new GlobalScanner();

// DOMContentLoaded: kamera mavjudligini tekshirish va loga yozish
document.addEventListener('DOMContentLoaded', async () => {
    const hasCamera = await GlobalScanner.checkCamera();
    if (!hasCamera) {
        console.info('[Scanner] Kamera topilmadi — faqat USB/Bluetooth skaner ishlaydi');
    } else {
        console.info('[Scanner] Kamera mavjud — startCamera() bilan ishga tushiring');
    }
});