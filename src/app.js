// Digital Pharma ERP & POS Engine
// Software developed by @ShahzadKhakh

// Core State
let medicines = [];
let sales = [];
let cart = [];
let currentSelectedMed = null;
let aiExtractedBuffer = [];
let currentEditingSaleId = null;
let authUser = null;
let deferredPrompt = null;
let activePosSearchIndex = -1;

// Lazy Firebase modules for instant startup without network stalls
const appId = typeof window.__app_id !== 'undefined' ? window.__app_id : 'digital-pharma-erp';
let db = null;
let auth = null;
let fbAuthMod = null;
let fbFirestoreMod = null;
let unsubscribeMeds = null;
let unsubscribeSales = null;

async function initFirebaseLazy() {
    if (typeof window.__firebase_config === 'undefined') return;
    try {
        const [appMod, authMod, firestoreMod] = await Promise.all([
            import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"),
            import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"),
            import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js")
        ]);
        fbAuthMod = authMod;
        fbFirestoreMod = firestoreMod;
        const config = JSON.parse(window.__firebase_config);
        const fbApp = appMod.initializeApp(config);
        db = firestoreMod.getFirestore(fbApp);
        auth = authMod.getAuth(fbApp);

        authMod.onAuthStateChanged(auth, async (user) => {
            authUser = user;
            window.applyStoreIdentity();
            safeCreateIcons();

            if (user) {
                // Attach real-time Firestore listeners
                if (db && fbFirestoreMod) {
                    const { collection, onSnapshot, doc, setDoc } = fbFirestoreMod;
                    
                    if (unsubscribeMeds) unsubscribeMeds();
                    if (unsubscribeSales) unsubscribeSales();

                    // 1. Sync Medicines
                    const medsColRef = collection(db, 'artifacts', appId, 'users', user.uid, 'medicines');
                    unsubscribeMeds = onSnapshot(medsColRef, async (snapshot) => {
                        const cloudMeds = [];
                        snapshot.forEach(docSnap => cloudMeds.push(docSnap.data()));
                        if (cloudMeds.length > 0) {
                            medicines = cloudMeds;
                            localStorage.setItem('sm_medicines', JSON.stringify(medicines));
                            renderInventoryTable();
                            renderDashboardMetrics();
                        } else if (medicines.length > 0) {
                            // First time logging in on this account: push local guest medicines to cloud!
                            for (const m of medicines) {
                                try {
                                    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'medicines', m.id), m);
                                } catch(err) {}
                            }
                        }
                    }, (err) => console.warn('Meds real-time sync notice:', err));

                    // 2. Sync Sales
                    const salesColRef = collection(db, 'artifacts', appId, 'users', user.uid, 'sales');
                    unsubscribeSales = onSnapshot(salesColRef, async (snapshot) => {
                        const cloudSales = [];
                        snapshot.forEach(docSnap => cloudSales.push(docSnap.data()));
                        if (cloudSales.length > 0) {
                            sales = cloudSales;
                            localStorage.setItem('sm_sales', JSON.stringify(sales));
                            renderDashboardMetrics();
                        } else if (sales.length > 0) {
                            // First time logging in: push local guest sales to cloud!
                            for (const s of sales) {
                                try {
                                    await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'sales', s.id), s);
                                } catch(err) {}
                            }
                        }
                    }, (err) => console.warn('Sales real-time sync notice:', err));
                }
            } else {
                if (unsubscribeMeds) unsubscribeMeds();
                if (unsubscribeSales) unsubscribeSales();
            }
        });
    } catch(e) {
        console.warn('Firebase background init notice:', e);
    }
}

// Toast utility
export function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bgClass = type === 'error' ? 'bg-red-600' : (type === 'info' ? 'bg-blue-600' : 'bg-slate-900');
    toast.className = `fixed top-5 right-5 ${bgClass} text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold z-50 transition-all duration-300 transform translate-y-[-10px] opacity-0 flex items-center gap-2 border border-white/20`;
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-[-10px]', 'opacity-0'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
window.showToast = showToast;

// Background scroll locking when any popup / modal is open (Optimized & guarded)
export function syncModalScrollLock() {
    const modalIds = [
        'digital-receipt-modal',
        'ai-presc-modal',
        'ai-scan-modal',
        'medicine-modal',
        'distributor-modal',
        'sale-edit-modal',
        'account-hub-modal',
        'install-app-modal'
    ];
    let isAnyOpen = modalIds.some(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });
    if (!isAnyOpen && document.querySelector('.custom-confirm-modal')) {
        isAnyOpen = true;
    }

    const isLocked = document.body.classList.contains('overflow-hidden');
    if (isAnyOpen && !isLocked) {
        document.body.classList.add('overflow-hidden');
        document.documentElement.classList.add('overflow-hidden');
    } else if (!isAnyOpen && isLocked) {
        document.body.classList.remove('overflow-hidden');
        document.documentElement.classList.remove('overflow-hidden');
    }
}
window.syncModalScrollLock = syncModalScrollLock;

let iconDebounceTimer = null;
export function safeCreateIcons() {
    if (iconDebounceTimer) return;
    iconDebounceTimer = requestAnimationFrame(() => {
        iconDebounceTimer = null;
        try {
            if (typeof window.lucide !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
                window.lucide.createIcons();
            }
        } catch(e) {}
    });
}
window.safeCreateIcons = safeCreateIcons;

export function customConfirm(title, message, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'custom-confirm-modal fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-white rounded-2xl max-w-xs w-full p-4 shadow-2xl flex flex-col gap-3">
            <h4 class="font-black text-slate-800 text-sm">${title}</h4>
            <p class="text-xs text-slate-600">${message}</p>
            <div class="flex gap-2 pt-2 border-t">
                <button id="cancel-confirm-btn" class="flex-1 py-1.5 border rounded-xl text-xs font-bold text-slate-600">Nahi</button>
                <button id="ok-confirm-btn" class="flex-1 py-1.5 bg-red-600 text-white rounded-xl text-xs font-bold shadow">Haan</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    syncModalScrollLock();
    modal.querySelector('#cancel-confirm-btn').onclick = () => {
        modal.remove();
        syncModalScrollLock();
    };
    modal.querySelector('#ok-confirm-btn').onclick = () => {
        modal.remove();
        syncModalScrollLock();
        if (typeof onConfirm === 'function') onConfirm();
    };
}
window.customConfirm = customConfirm;

// ==========================================
// DYNAMIC HIGH-RES PWA MANIFEST & ICON ENGINE
// Guarantees reliable App Installation
// ==========================================
export function setupDynamicPwaManifest() {
    try {
        const currentOrigin = window.location.origin;
        const currentPath = window.location.pathname;
        const basePath = currentPath.substring(0, currentPath.lastIndexOf('/') + 1) || '/';
        const startUrl = window.location.href.split('#')[0];
        const scopeUrl = currentOrigin + basePath;

        function generateMedicalPngIcon(size) {
            const c = document.createElement('canvas');
            c.width = size;
            c.height = size;
            const ctx = c.getContext('2d');
            if (!ctx) return '';
            
            const r = size * 0.22;
            ctx.fillStyle = '#1e40af';
            ctx.beginPath();
            ctx.roundRect(0, 0, size, size, r);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size * 0.38, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.fill();

            const armW = size * 0.22;
            const armL = size * 0.62;
            const offsetL = (size - armL) / 2;
            const offsetW = (size - armW) / 2;

            ctx.fillStyle = '#22c55e';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = size * 0.028;
            ctx.lineJoin = 'round';

            ctx.beginPath();
            ctx.roundRect(offsetW, offsetL, armW, armL, size * 0.04);
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.roundRect(offsetL, offsetW, armL, armW, size * 0.04);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#fbbf24';
            ctx.beginPath();
            ctx.arc(size * 0.76, size * 0.24, size * 0.07, 0, Math.PI * 2);
            ctx.fill();

            return c.toDataURL('image/png');
        }

        const icon192 = generateMedicalPngIcon(192);
        const icon512 = generateMedicalPngIcon(512);

        const appleIcon = document.getElementById('dynamic-apple-icon');
        if (appleIcon && icon192) appleIcon.href = icon192;
        const favicon = document.getElementById('dynamic-favicon');
        if (favicon && icon192) favicon.href = icon192;

        const manifestObj = {
            name: "Digital Pharma",
            short_name: "DigitalPharma",
            description: "Digital Pharma - Smart Pharmacy ERP, High-Speed POS & AI Scanner",
            id: startUrl,
            start_url: startUrl,
            scope: scopeUrl,
            display: "standalone",
            orientation: "portrait-primary",
            background_color: "#1e40af",
            theme_color: "#1e40af",
            icons: [
                { src: icon192, sizes: "192x192", type: "image/png", purpose: "any" },
                { src: icon192, sizes: "192x192", type: "image/png", purpose: "maskable" },
                { src: icon512, sizes: "512x512", type: "image/png", purpose: "any" },
                { src: icon512, sizes: "512x512", type: "image/png", purpose: "maskable" }
            ]
        };

        const manifestBlob = new Blob([JSON.stringify(manifestObj, null, 2)], { type: 'application/manifest+json' });
        const manifestBlobUrl = URL.createObjectURL(manifestBlob);

        const manifestLink = document.getElementById('dynamic-manifest-link');
        if (manifestLink) {
            manifestLink.href = manifestBlobUrl;
        }
    } catch(e) {
        console.warn('PWA Manifest setup error:', e);
    }
}
window.setupDynamicPwaManifest = setupDynamicPwaManifest;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallUiState();
});

// Unregister any legacy Service Workers to prevent iframe cache lockouts
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
        for (let r of regs) { r.unregister(); }
    });
}

window.openAppInstallModal = function() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) {
        showToast('Digital Pharma App pehle se aap ke device par installed hai!', 'info');
        return;
    }
    const modal = document.getElementById('install-app-modal');
    if (modal) {
        modal.classList.remove('hidden');
        syncModalScrollLock();
        safeCreateIcons();
    }
};

window.closeAppInstallModal = function() {
    document.getElementById('install-app-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.triggerModalAppInstall = async function() {
    if (deferredPrompt) {
        try {
            deferredPrompt.prompt();
            const choiceResult = await deferredPrompt.userChoice;
            if (choiceResult && choiceResult.outcome === 'accepted') {
                showToast('App install shuru ho gayi!', 'success');
                window.closeAppInstallModal();
            }
            deferredPrompt = null;
        } catch(err) {
            console.warn('Install execution error:', err);
        }
    } else {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            showToast('Neechay Safari Share button (📤) dabayein aur "Add to Home Screen" par tap karein.', 'info');
        } else {
            showToast('Browser ke 3 dots (⋮) par tap kar ke "Install app" ya "Add to Home screen" karein.', 'info');
        }
    }
};

window.executeNativeAppInstall = function() {
    window.openAppInstallModal();
};

window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    updateInstallUiState();
    window.closeAppInstallModal();
    showToast('Digital Pharma App kamyabi se install ho gayi!', 'success');
});

export function updateInstallUiState() {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const navBtn = document.getElementById('nav-install-btn');
    if (!navBtn) return;

    if (isStandalone) {
        navBtn.classList.add('hidden');
    } else {
        navBtn.classList.remove('hidden');
    }
}
window.updateInstallUiState = updateInstallUiState;

// Universal Pack Size Parser (supports "20", "2x7", "10x10", "100", etc.)
export function parsePackSize(input) {
    if (!input) return { strips: 1, unitsPerStrip: 20, totalUnits: 20, displayText: '20 Dawai' };
    const str = String(input).trim();
    const multMatch = str.match(/^(\d+)\s*[*xX/×]\s*(\d+)$/);
    if (multMatch) {
        const strips = Math.max(1, parseInt(multMatch[1], 10) || 1);
        const unitsPerStrip = Math.max(1, parseInt(multMatch[2], 10) || 1);
        const total = strips * unitsPerStrip;
        return {
            strips,
            unitsPerStrip,
            totalUnits: total,
            displayText: `${strips}x${unitsPerStrip} (${total} Dawai)`
        };
    }
    const num = parseInt(str, 10);
    if (!isNaN(num) && num > 0) {
        return {
            strips: 1,
            unitsPerStrip: num,
            totalUnits: num,
            displayText: `${num} Dawai`
        };
    }
    return { strips: 1, unitsPerStrip: 20, totalUnits: 20, displayText: '20 Dawai' };
}
window.parsePackSize = parsePackSize;

export function extractSmartJson(text) {
    if (!text) return null;
    try {
        const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn('extractSmartJson error:', e);
        return null;
    }
}
window.extractSmartJson = extractSmartJson;

// Universal Orientation-Aware & High-Resolution Document Reader (Mobile & Desktop)
export async function enhanceImageLikeCamScanner(file) {
    if (!file) throw new Error("Tasweer select nahi hui.");

    const readFileAsBase64 = () => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = String(e.target?.result || '');
            resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = () => reject(new Error("File read nahi ho saki."));
        reader.readAsDataURL(file);
    });

    try {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const maxDim = 1600;
                    let w = img.naturalWidth || img.width || 1200;
                    let h = img.naturalHeight || img.height || 1600;

                    if (w > maxDim || h > maxDim) {
                        if (w > h) {
                            h = Math.round((h * maxDim) / w);
                            w = maxDim;
                        } else {
                            w = Math.round((w * maxDim) / h);
                            h = maxDim;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        const raw = String(e.target?.result || '');
                        return resolve(raw.includes(',') ? raw.split(',')[1] : raw);
                    }

                    // Crisp solid white background
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, w, h);

                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, w, h);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
                    const cleanBase64 = dataUrl.split(',')[1];
                    resolve(cleanBase64 || readFileAsBase64());
                };
                img.onerror = async () => {
                    try {
                        resolve(await readFileAsBase64());
                    } catch(err) {
                        reject(err);
                    }
                };
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error("File read nahi ho saki."));
            reader.readAsDataURL(file);
        });
    } catch(err) {
        console.warn("enhanceImageLikeCamScanner fallback:", err);
        return await readFileAsBase64();
    }
}
window.enhanceImageLikeCamScanner = enhanceImageLikeCamScanner;

// Normalizes any prescription output format so mobile OCR never crashes
function normalizePrescriptionData(parsed) {
    if (!parsed) return null;
    let meds = [];
    if (Array.isArray(parsed)) {
        meds = parsed;
    } else if (Array.isArray(parsed.medicines)) {
        meds = parsed.medicines;
    } else if (Array.isArray(parsed.items)) {
        meds = parsed.items;
    } else if (Array.isArray(parsed.drugs)) {
        meds = parsed.drugs;
    } else if (Array.isArray(parsed.prescription)) {
        meds = parsed.prescription;
    } else if (parsed.medicines && typeof parsed.medicines === 'object') {
        meds = Object.values(parsed.medicines);
    } else if (parsed.data && typeof parsed.data === 'object') {
        return normalizePrescriptionData(parsed.data);
    }

    return {
        doctor: parsed.doctor || parsed.doctor_name || parsed.clinic || 'Prescription Slip',
        patient: parsed.patient || parsed.patient_name || 'General Patient',
        treatmentSummary: parsed.treatmentSummary || parsed.summary || parsed.treatment || 'Nuskha ke mutabiq adviyaat aur ilaj ki tafseelat.',
        advice: parsed.advice || parsed.precautions || parsed.instructions || 'Dawai waqt par lein aur doctor se rabta karein.',
        medicines: meds.filter(m => m && (m.name || m.medicine || m.brand)).map(m => ({
            name: m.name || m.medicine || m.brand || 'Medicine',
            formula: m.formula || m.generic || m.salt || '',
            form: m.form || m.type || 'Goli / Dawai',
            timing: m.timing || m.dosage || m.schedule || 'Subah sham khane ke baad',
            usage: m.usage || m.method || 'Taza paani ke sath lein',
            purpose: m.purpose || m.indication || m.use || 'Ilaj'
        }))
    };
}

// Normalizes any wholesale invoice items output
function normalizeInvoiceItems(parsed) {
    if (!parsed) return [];
    let list = [];
    if (Array.isArray(parsed)) {
        list = parsed;
    } else if (Array.isArray(parsed.items)) {
        list = parsed.items;
    } else if (Array.isArray(parsed.medicines)) {
        list = parsed.medicines;
    } else if (Array.isArray(parsed.invoicedItems)) {
        list = parsed.invoicedItems;
    } else if (Array.isArray(parsed.lines)) {
        list = parsed.lines;
    } else if (parsed.data && typeof parsed.data === 'object') {
        return normalizeInvoiceItems(parsed.data);
    }
    return list.filter(item => item && (item.name || item.item || item.description)).map(item => ({
        name: item.name || item.item || item.description || 'Medicine',
        generic: item.generic || item.formula || '',
        batch: item.batch || item.batch_no || item.batchNumber || 'B-01',
        expiry: item.expiry || item.exp || '',
        packSize: String(item.packSize || item.pack_size || item.pack || '20'),
        qty: Number(item.qty || item.quantity || item.packs || 1) || 1,
        buyRate: Number(item.buyRate || item.rate || item.tradePrice || item.tp || 0) || 0,
        distributor: item.distributor || item.supplier || '',
        mrp: ''
    }));
}

const LIVE_BACKEND_URL = 'https://ais-pre-ou6bjzs2n66zp6bxp5s7gm-731749917388.asia-east1.run.app';

// Direct client-side Gemini Vision Caller (Essential for offline/custom key usage)
async function callGeminiVisionDirect(prompt, base64Data) {
    const customKey = localStorage.getItem('gemini_api_key') || "";
    if (!customKey) {
        throw new Error('AI Scanner connect nahi ho saka. Barah-e-karam internet connection check karein ya Account Hub mein apni Google Gemini API key enter karein.');
    }
    const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    let lastError = null;

    for (const modelName of models) {
        try {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${customKey}`;
            const payload = {
                contents: [{
                    parts: [
                        { text: prompt },
                        { inlineData: { mimeType: 'image/jpeg', data: base64Data } }
                    ]
                }],
                generationConfig: {
                    responseMimeType: "application/json"
                }
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = await response.json();
                const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) return text;
            } else {
                const errJson = await response.json().catch(() => null);
                lastError = errJson?.error?.message;
            }
        } catch(e) {
            lastError = e?.message || lastError;
        }
    }

    throw new Error(lastError || 'Google AI Vision connect nahi ho saka. API key aur internet check karein.');
}

// Unified AI Caller: Automatically proxies to live backend from GitHub Pages or runs locally
async function callAiBackend(endpoint, base64Data, clientPrompt) {
    // On GitHub Pages or static hosts, call the live hosted backend proxy so Gemini API key is available
    let targetUrl = endpoint;
    const isStaticHost = typeof window !== 'undefined' && (
        window.location.hostname.includes('github.io') ||
        window.location.protocol === 'file:'
    );

    if (isStaticHost) {
        targetUrl = `${LIVE_BACKEND_URL}${endpoint}`;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const res = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64Data }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            if (data && data.success) return data;
            if (data && data.error) throw new Error(data.error);
        }
    } catch (e) {
        if (e.message && !e.message.includes('fetch') && !e.message.includes('abort') && !e.message.includes('Failed')) {
            throw e;
        }
    }

    // Client-side direct vision fallback if user configured their own key in Account Hub
    if (clientPrompt) {
        const rawText = await callGeminiVisionDirect(clientPrompt, base64Data);
        const parsed = extractSmartJson(rawText);
        return { success: true, data: parsed };
    }

    return null;
}

// Store Config
window.getStoreConfig = function() {
    try {
        const saved = localStorage.getItem('sm_store_config');
        if (saved) return JSON.parse(saved);
    } catch(e) {}
    return {
        name: 'Digital Pharma',
        phone: '0300-1234567',
        address: 'Main Commercial Market',
        licenseNo: ''
    };
};

window.applyStoreIdentity = function() {
    const config = window.getStoreConfig();
    document.title = 'Digital Pharma - Smart Pharmacy ERP & POS';
    const topName = document.getElementById('top-store-name');
    if (topName) topName.innerText = 'Digital Pharma';

    const hubName = document.getElementById('hub-header-name');
    if (hubName) hubName.innerText = authUser ? (config.name || 'My Store') : 'Guest Mode';

    const rTitle = document.getElementById('receipt-store-title');
    if (rTitle) rTitle.innerText = config.name || 'Digital Pharma';

    const rAddr = document.getElementById('receipt-store-address');
    if (rAddr) rAddr.innerText = config.address || 'Main Commercial Market';

    const rPhone = document.getElementById('receipt-store-phone');
    if (rPhone) rPhone.innerText = 'Phone/WhatsApp: ' + (config.phone || '');

    const rLicense = document.getElementById('receipt-store-license');
    if (rLicense) {
        if (config.licenseNo && config.licenseNo.trim()) {
            rLicense.innerText = 'D.S.L #: ' + config.licenseNo.trim();
            rLicense.classList.remove('hidden');
        } else {
            rLicense.classList.add('hidden');
        }
    }

    const avatarChar = document.getElementById('profile-avatar-char');
    if (avatarChar) avatarChar.innerText = (authUser ? (config.name || 'S') : 'G').trim().charAt(0).toUpperCase();

    const hubAvatarChar = document.getElementById('hub-avatar-char');
    if (hubAvatarChar) hubAvatarChar.innerText = (authUser ? (config.name || 'S') : 'G').trim().charAt(0).toUpperCase();
};

window.switchTab = function(tabName) {
    const tabs = ['dashboard', 'pos', 'inventory', 'margin', 'network'];
    tabs.forEach(t => {
        const view = document.getElementById('view-' + t);
        if (view) view.classList.add('hidden');
        const deskBtn = document.getElementById('tab-' + t);
        if (deskBtn) {
            deskBtn.classList.remove('bg-brand-700', 'text-white', 'shadow');
            deskBtn.classList.add('text-slate-600', 'hover:bg-slate-100');
        }
        const mobBtn = document.getElementById('mob-tab-' + t);
        if (mobBtn) {
            mobBtn.classList.remove('text-brand-700', 'font-black');
            mobBtn.classList.add('text-slate-500', 'font-semibold');
        }
    });

    const activeView = document.getElementById('view-' + tabName);
    if (activeView) activeView.classList.remove('hidden');

    const activeDeskBtn = document.getElementById('tab-' + tabName);
    if (activeDeskBtn) {
        activeDeskBtn.classList.add('bg-brand-700', 'text-white', 'shadow');
        activeDeskBtn.classList.remove('text-slate-600', 'hover:bg-slate-100');
    }

    const activeMobBtn = document.getElementById('mob-tab-' + tabName);
    if (activeMobBtn) {
        activeMobBtn.classList.add('text-brand-700', 'font-black');
        activeMobBtn.classList.remove('text-slate-500', 'font-semibold');
    }

    if (tabName === 'pos') setTimeout(() => document.getElementById('pos-search')?.focus(), 50);
    if (tabName === 'inventory') {
        renderInventoryTable();
        setTimeout(() => document.getElementById('inv-search')?.focus(), 50);
    }
    if (tabName === 'dashboard') renderDashboardMetrics();
    if (tabName === 'margin') {
        window.populateLooseStockSelector();
        window.runLooseCalc();
        window.runMarginCalc();
    }
    if (tabName === 'network') window.refreshNetworkList();
    safeCreateIcons();
};

// ==========================================
// CALCULATOR: Trade Margin & Profit % Scheme
// ==========================================
window.runMarginCalc = function() {
    const mrp = Number(document.getElementById('calc-mrp')?.value) || 0;
    const rate = Number(document.getElementById('calc-rate')?.value) || 0;
    const packsInput = document.getElementById('calc-packs');
    const freeInput = document.getElementById('calc-free');

    const packs = Math.max(1, Number(packsInput?.value) || 1);
    const free = Math.max(0, Number(freeInput?.value) || 0);

    const discEl = document.getElementById('calc-disc-res');
    const profitEl = document.getElementById('calc-profit-res');
    const costEl = document.getElementById('calc-eff-cost');
    const totProfitEl = document.getElementById('calc-total-profit');

    if (mrp <= 0 || rate <= 0) {
        if (discEl) discEl.innerText = '0.00%';
        if (profitEl) profitEl.innerText = '0.00%';
        if (costEl) costEl.innerText = 'Rs. 0.00';
        if (totProfitEl) totProfitEl.innerText = 'Rs. 0.00';
        return;
    }

    const totalInvoiceCost = rate * packs;
    const totalUnitsGot = packs + free;
    const effectiveCostPerPack = totalUnitsGot > 0 ? (totalInvoiceCost / totalUnitsGot) : rate;

    const tradeDiscountPercent = Math.max(0, ((mrp - rate) / mrp) * 100);
    const netProfitMarginPercent = Math.max(0, ((mrp - effectiveCostPerPack) / mrp) * 100);
    const totalRevenue = mrp * totalUnitsGot;
    const netTotalProfit = totalRevenue - totalInvoiceCost;

    if (discEl) discEl.innerText = tradeDiscountPercent.toFixed(2) + '%';
    if (profitEl) profitEl.innerText = netProfitMarginPercent.toFixed(2) + '%';
    if (costEl) costEl.innerText = 'Rs. ' + effectiveCostPerPack.toFixed(2);
    if (totProfitEl) totProfitEl.innerText = 'Rs. ' + Math.max(0, netTotalProfit).toFixed(2);
};

// ==========================================
// CALCULATOR 2: Loose Dawai Rate & Hisab Calculator
// ==========================================
window.populateLooseStockSelector = function() {
    const sel = document.getElementById('loose-stock-selector');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = `<option value="">-- Medicine Chuniye (${medicines.length} Stock Available) --</option>` +
        medicines.map(m => {
            const packInfo = parsePackSize(m.packSize);
            return `<option value="${m.id}">${m.name} — MRP: Rs.${Number(m.mrp).toFixed(0)} (${packInfo.displayText}, Stock: ${m.stock} packs)</option>`;
        }).join('');
    if (currentVal && medicines.some(m => m.id === currentVal)) {
        sel.value = currentVal;
    }
};

window.selectStockForLooseCalc = function(medId) {
    if (!medId) return;
    const med = medicines.find(m => m.id === medId);
    if (!med) return;
    const priceInput = document.getElementById('loose-pack-price');
    const sizeInput = document.getElementById('loose-pack-size');
    if (priceInput) priceInput.value = med.mrp;
    if (sizeInput) sizeInput.value = med.packSize || '20';
    window.runLooseCalc();
};

window.runLooseCalc = function() {
    const packPriceInput = document.getElementById('loose-pack-price');
    const packSizeInput = document.getElementById('loose-pack-size');
    const qtyInput = document.getElementById('loose-qty');
    const discInput = document.getElementById('loose-discount');

    const packPriceVal = packPriceInput?.value?.trim();
    const packSizeVal = packSizeInput?.value?.trim();
    const qtyVal = qtyInput?.value?.trim();

    const tabPriceEl = document.getElementById('loose-tab-price');
    const stripPriceEl = document.getElementById('loose-strip-price');
    const totalEl = document.getElementById('loose-net-total');
    const unitsHintEl = document.getElementById('loose-units-hint');

    // Keep results at 0.00 until valid rate is entered by user
    if (!packPriceVal || Number(packPriceVal) <= 0) {
        if (tabPriceEl) tabPriceEl.innerText = 'Rs. 0.00';
        if (stripPriceEl) stripPriceEl.innerText = 'Rs. 0.00';
        if (totalEl) totalEl.innerText = 'Rs. 0.00';
        if (unitsHintEl) {
            unitsHintEl.innerText = packSizeVal ? `Total: ${parsePackSize(packSizeVal).totalUnits} Dawai` : 'Total: 0';
        }
        return;
    }

    const packPrice = Number(packPriceVal);
    const parsed = parsePackSize(packSizeVal || '20');
    const totalUnits = Math.max(1, parsed.totalUnits);
    const sellQty = Math.max(1, Number(qtyVal) || 1);
    const discPercent = discInput && discInput.value !== '' ? Number(discInput.value) : 0;

    const perUnitPrice = packPrice / totalUnits;
    const grossTotal = perUnitPrice * sellQty;
    const discountAmt = (grossTotal * discPercent) / 100;
    const netPayable = Math.max(0, grossTotal - discountAmt);

    const perStripPrice = parsed.strips > 1 ? (packPrice / parsed.strips) : (perUnitPrice * Math.min(10, totalUnits));

    if (tabPriceEl) tabPriceEl.innerText = 'Rs. ' + perUnitPrice.toFixed(2);
    if (stripPriceEl) stripPriceEl.innerText = 'Rs. ' + perStripPrice.toFixed(2);
    if (totalEl) totalEl.innerText = 'Rs. ' + netPayable.toFixed(2);
    if (unitsHintEl) unitsHintEl.innerText = `Total: ${parsed.displayText}`;
};

window.changeLooseCalcQty = function(delta) {
    const input = document.getElementById('loose-qty');
    if (!input) return;
    const current = Math.max(0, parseInt(input.value) || 0);
    const updated = Math.max(1, current + delta);
    input.value = updated;
    window.runLooseCalc();
};

window.setLooseQtyPreset = function(qty) {
    const input = document.getElementById('loose-qty');
    if (input) {
        input.value = qty;
        window.runLooseCalc();
    }
};

// Toggle between Main Local Calculator and Bonus Margin Scheme Calculator
window.switchMarginCalcTab = function(type) {
    const looseSection = document.getElementById('margin-calc-loose-section');
    const bonusSection = document.getElementById('margin-calc-bonus-section');
    const btnLoose = document.getElementById('margin-toggle-loose-btn');
    const btnBonus = document.getElementById('margin-toggle-bonus-btn');

    if (type === 'bonus') {
        looseSection?.classList.add('hidden');
        bonusSection?.classList.remove('hidden');
        btnBonus?.classList.add('bg-brand-600', 'text-white', 'shadow-xs');
        btnBonus?.classList.remove('text-slate-600', 'hover:bg-slate-100');
        btnLoose?.classList.remove('bg-brand-600', 'text-white', 'shadow-xs');
        btnLoose?.classList.add('text-slate-600', 'hover:bg-slate-100');
        window.runMarginCalc();
    } else {
        bonusSection?.classList.add('hidden');
        looseSection?.classList.remove('hidden');
        btnLoose?.classList.add('bg-brand-600', 'text-white', 'shadow-xs');
        btnLoose?.classList.remove('text-slate-600', 'hover:bg-slate-100');
        btnBonus?.classList.remove('bg-brand-600', 'text-white', 'shadow-xs');
        btnBonus?.classList.add('text-slate-600', 'hover:bg-slate-100');
        window.populateLooseStockSelector();
        window.runLooseCalc();
    }
    safeCreateIcons();
};

const PRESCRIPTION_PROMPT = `You are an expert clinical prescription and medical handwriting reader for pharmacies in Pakistan.
Carefully examine the uploaded prescription or clinic slip image.
Extract ONLY the REAL medicines and doctor notes actually written or printed on this specific paper.
DO NOT INVENT, hallucinate, or substitute any fake medicines. If a medicine is not legible or not on the page, do not invent one.
If no medicines can be identified from this image, return {"doctor":"","patient":"","treatmentSummary":"","advice":"","medicines":[]}.

CRITICAL LANGUAGE INSTRUCTION:
All patient-facing advice, timing, usage, and treatmentSummary MUST be written in natural Roman Urdu (Urdu written in English alphabets, e.g. "Subah sham 1 goli khane ke baad (1+0+1)", "Khali pait 1 glass taza paani se").

Extract strictly as JSON matching this schema:
{
  "doctor": "Doctor / Clinic name if legible, else empty string",
  "patient": "Patient name or details if legible, else empty string",
  "treatmentSummary": "Short treatment reason in Roman Urdu e.g. Bukhar aur gale ke dard ka ilaj",
  "advice": "Precautions and parhez in Roman Urdu e.g. Thande paani aur tali hui cheezon se parhez karein",
  "medicines": [
    {
      "name": "Exact brand name and potency visible e.g. Augmentin 625mg",
      "formula": "Generic salt if visible or known",
      "form": "Goli (Tablet), Capsule, Sharbath (Syrup), etc.",
      "timing": "Dosage schedule in Roman Urdu e.g. Subah sham khane ke baad (1+0+1)",
      "usage": "Usage instructions in Roman Urdu e.g. Taza paani ke sath lein",
      "purpose": "Therapeutic indication in Roman Urdu e.g. Bukhar aur sozish"
    }
  ]
}`;

const INVOICE_PROMPT = `You are a specialist pharmacy wholesale bill and distributor invoice OCR reader.
Carefully examine the image to detect REAL line items printed or written on this invoice/delivery slip.
DO NOT INVENT or hallucinate fake medicines. Extract ONLY what is visible on the bill.
If no invoice rows or medicines are visible, return an empty array [].

For each real item found, extract:
- name: brand name and strength as printed on the bill
- generic: generic formula if visible, else empty string
- batch: batch number if visible, else empty string
- expiry: expiry date in YYYY-MM-DD if visible, else empty string
- packSize: pack size e.g. "20", "2x7", "10x10"
- qty: quantity of packs invoiced (number)
- buyRate: wholesale buy rate per pack (number)
- distributor: distributor/supplier name from bill header if visible

STRICT RULE: Leave 'mrp' as an empty string ("").
Return a JSON array of objects.`;

const MARGIN_PROMPT = `You are a specialist pharmacy wholesale trade margin and bonus scheme auditor.
Scan this distributor invoice or scheme slip to extract ONLY REAL items present on the paper.
DO NOT INVENT fake medicines. If no items found, return empty array [].

Extract for each real line:
- name: medicine name and strength
- buyRate: wholesale invoiced buy rate per pack (number)
- qty: quantity of packs invoiced (number, default 1)
- freeQty: bonus/free scheme packs received (number, default 0, e.g. 1 in a 10+1 scheme)

STRICT RULE: Leave 'mrp' as an empty string ("").
Return a JSON array of objects.`;

// AI Prescription Scan
window.handlePrescriptionScan = async function(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const modal = document.getElementById('ai-presc-modal');
    const loading = document.getElementById('presc-loading');
    const content = document.getElementById('presc-content');

    modal?.classList.remove('hidden');
    syncModalScrollLock();
    loading?.classList.remove('hidden');
    content?.classList.add('hidden');
    safeCreateIcons();

    try {
        const base64Data = await enhanceImageLikeCamScanner(file);
        const resData = await callAiBackend('/api/ai/scan-prescription', base64Data, PRESCRIPTION_PROMPT);
        let parsed = normalizePrescriptionData(resData?.data);

        if (!parsed || !parsed.medicines || parsed.medicines.length === 0) {
            throw new Error('Prescription se koi dawai saaf detect nahi ho saki. Barah-e-karam achi roshni mein seedhi aur saaf tasweer lein.');
        }

        document.getElementById('presc-doc-name').innerText = 'Doctor / Clinic: ' + (parsed.doctor || 'Prescription Slip');
        document.getElementById('presc-patient-info').innerText = 'Mareez (Patient): ' + (parsed.patient || 'General Patient');
        
        const summaryEl = document.getElementById('presc-treatment-summary');
        if (summaryEl) {
            summaryEl.innerText = parsed.treatmentSummary || 'Nuskha ke mutabiq adviyaat aur ilaj ki tafseelat darj zail hain.';
        }

        document.getElementById('presc-advice').innerText = parsed.advice || 'Dawai hidayat ke mutabiq waqt par lein. Thandi, tali hui aur khatti cheezon se mukammal parhez karein aur garam paani zyada piyen.';

        window.lastPrescriptionParsed = parsed;
        const medList = document.getElementById('presc-medicines-list');
        if (medList) {
            medList.innerHTML = (parsed.medicines || []).map(m => `
                <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <div class="flex justify-between items-start">
                        <div>
                            <strong class="text-slate-900 text-xs sm:text-sm font-black">${m.name}</strong>
                            <span class="text-[11px] text-slate-500 block font-medium">${m.formula ? m.formula + ' • ' : ''}<span class="text-brand-700 font-bold">${m.form || 'Dawai'}</span></span>
                        </div>
                        <span class="text-[10px] bg-brand-50 border border-brand-200 text-brand-700 px-2 py-0.5 rounded-lg font-bold">${m.purpose || 'Ilaj'}</span>
                    </div>
                    
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                        <div class="p-2 bg-emerald-50 border border-emerald-200/70 rounded-lg text-emerald-950 font-semibold flex items-center gap-1.5">
                            <span class="text-base">⏰</span>
                            <div>
                                <span class="text-[9px] uppercase font-bold text-emerald-700 block">Khooraq / Timing:</span>
                                <span>${m.timing || 'Subah sham khane ke baad'}</span>
                            </div>
                        </div>
                        <div class="p-2 bg-blue-50 border border-blue-200/70 rounded-lg text-blue-950 font-semibold flex items-center gap-1.5">
                            <span class="text-base">📋</span>
                            <div>
                                <span class="text-[9px] uppercase font-bold text-blue-700 block">Tareeqa-e-Istemal (Usage):</span>
                                <span>${m.usage || 'Taza paani ke sath lein'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        loading?.classList.add('hidden');
        content?.classList.remove('hidden');
        safeCreateIcons();
        syncModalScrollLock();
        showToast(`${parsed.medicines.length} medicines detect ho gayin!`, 'success');
    } catch(err) {
        console.error('Prescription OCR Error:', err);
        modal?.classList.add('hidden');
        syncModalScrollLock();
        showToast(err.message || 'Prescription scan fail ho gaya, dobara koshish karein.', 'error');
    } finally {
        event.target.value = '';
    }
};

window.copyPrescriptionText = function() {
    if (!window.lastPrescriptionParsed) return;
    const p = window.lastPrescriptionParsed;
    let txt = `📋 PRESCRIPTION AI SCANNER REPORT\n`;
    if (p.doctor) txt += `Doctor / Clinic: ${p.doctor}\n`;
    if (p.patient) txt += `Mareez (Patient): ${p.patient}\n`;
    if (p.treatmentSummary) txt += `Ilaj (Treatment): ${p.treatmentSummary}\n`;
    txt += `\n💊 ADVIYAAT, TIMING & TAFSEELAT:\n`;
    (p.medicines || []).forEach((m, idx) => {
        txt += `${idx + 1}. ${m.name} (${m.form || 'Dawai'})\n`;
        if (m.purpose) txt += `   - Ilaj / Maqsad: ${m.purpose}\n`;
        if (m.timing) txt += `   - Khooraq / Timing: ${m.timing}\n`;
        if (m.usage) txt += `   - Tareeqa Istemal: ${m.usage}\n`;
    });
    if (p.advice) txt += `\n🛑 PARHEZ & ZAROORI HIDAYAT:\n${p.advice}\n`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => showToast('Roman Urdu prescription copy ho gaya!', 'success'));
    } else {
        const el = document.createElement('textarea');
        el.value = txt;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showToast('Roman Urdu prescription copy ho gaya!', 'success');
    }
};

// AI Wholesale Invoice Scan
window.handleRealInvoiceOcr = async function(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const modal = document.getElementById('ai-scan-modal');
    const loading = document.getElementById('ai-scan-loading');
    const content = document.getElementById('ai-scan-content');

    modal?.classList.remove('hidden');
    loading?.classList.remove('hidden');
    content?.classList.add('hidden');
    safeCreateIcons();

    try {
        const base64Data = await enhanceImageLikeCamScanner(file);
        const resData = await callAiBackend('/api/ai/scan-invoice', base64Data, INVOICE_PROMPT);
        let items = normalizeInvoiceItems(resData?.data);

        if (!items || items.length === 0) {
            throw new Error('Wholesale bill se koi medicine rows detect nahi ho sakin. Tasweer saaf roshni mein dobara upload karein.');
        }

        const detectedDist = items.find(i => i.distributor)?.distributor || '';
        const distInput = document.getElementById('ai-bill-distributor');
        if (distInput) distInput.value = detectedDist;

        aiExtractedBuffer = items.map((item, idx) => ({
            id: 'ai_' + Date.now() + '_' + idx,
            name: item.name || 'Item ' + (idx + 1),
            generic: item.generic || '',
            batch: item.batch || 'B-' + Math.floor(100 + Math.random() * 900),
            expiry: item.expiry || '',
            packSize: item.packSize || '20',
            qty: Number(item.qty) || 1,
            buyRate: Number(item.buyRate) || 0,
            mrp: '',
            distributor: detectedDist || 'Distributor'
        }));

        renderAiScannedTable();
        loading?.classList.add('hidden');
        content?.classList.remove('hidden');
        safeCreateIcons();
        showToast(`${items.length} bill items detect ho gaye! MRP check karein.`, 'success');
    } catch(err) {
        console.error('Invoice OCR Error:', err);
        modal?.classList.add('hidden');
        showToast(err.message || 'Bill scan nahi ho saka, dobara koshish karein.', 'error');
    } finally {
        event.target.value = '';
    }
};

function renderAiScannedTable() {
    const tbody = document.getElementById('ai-scanned-table-body');
    if (!tbody) return;
    if (aiExtractedBuffer.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400">Koi item nahi mila.</td></tr>`;
        return;
    }
    tbody.innerHTML = aiExtractedBuffer.map((item, idx) => `
        <tr class="border-b border-slate-100">
            <td class="p-2 min-w-[280px] sm:min-w-[340px]">
                <input type="text" value="${item.name}" title="${item.name}" placeholder="Medicine Full Name" onchange="window.updateScannedItem(${idx}, 'name', this.value)" class="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
            </td>
            <td class="p-2 min-w-[90px]">
                <input type="text" value="${item.batch}" placeholder="Batch" onchange="window.updateScannedItem(${idx}, 'batch', this.value)" class="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 bg-white">
            </td>
            <td class="p-2 text-center min-w-[70px]">
                <input type="number" min="1" value="${item.qty}" onchange="window.updateScannedItem(${idx}, 'qty', this.value)" class="w-16 px-1.5 py-1.5 border border-slate-300 rounded-lg text-xs text-center font-bold text-slate-900 bg-white">
            </td>
            <td class="p-2 text-right min-w-[95px]">
                <input type="number" step="0.01" value="${item.buyRate}" placeholder="Buy Rate" onchange="window.updateScannedItem(${idx}, 'buyRate', this.value)" class="w-20 px-1.5 py-1.5 border border-slate-300 rounded-lg text-xs text-right font-bold text-slate-900 bg-white">
            </td>
            <td class="p-2 text-right bg-amber-50/70 min-w-[105px]">
                <input type="number" step="0.01" placeholder="Box MRP" value="${item.mrp || ''}" onchange="window.updateScannedItem(${idx}, 'mrp', this.value)" class="w-24 px-1.5 py-1.5 border border-amber-300 rounded-lg text-xs text-right font-black text-emerald-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500">
            </td>
            <td class="p-2 text-center">
                <button onclick="window.removeAiScannedRow(${idx})" class="p-1 text-slate-400 hover:text-red-600 rounded-lg" title="Delete Row">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </td>
        </tr>
    `).join('');
    safeCreateIcons();
}

window.updateScannedItem = function(idx, field, value) {
    if (aiExtractedBuffer[idx]) {
        aiExtractedBuffer[idx][field] = (field === 'qty' || field === 'buyRate' || field === 'mrp') ? Number(value) : value;
    }
};

window.removeAiScannedRow = function(idx) {
    aiExtractedBuffer.splice(idx, 1);
    renderAiScannedTable();
};

window.applyDistributorToAllScanned = function() {
    const dist = document.getElementById('ai-bill-distributor')?.value.trim() || 'Distributor';
    aiExtractedBuffer.forEach(item => { item.distributor = dist; });
    showToast(`Distributor "${dist}" sab par lag gaya!`, 'info');
};

window.closeAiScanModal = function() {
    document.getElementById('ai-scan-modal')?.classList.add('hidden');
    aiExtractedBuffer = [];
    syncModalScrollLock();
};

window.closeAiPrescModal = function() {
    document.getElementById('ai-presc-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.saveAiScannedItemsToInventory = async function() {
    if (aiExtractedBuffer.length === 0) return;
    const dist = document.getElementById('ai-bill-distributor')?.value.trim() || 'Distributor';

    const missingMrp = aiExtractedBuffer.filter(i => !i.mrp || Number(i.mrp) <= 0);
    if (missingMrp.length > 0) {
        showToast('Tamam items ki Box MRP enter karein!', 'error');
        return;
    }

    for (const item of aiExtractedBuffer) {
        const existing = medicines.find(m => m.name.toLowerCase() === item.name.toLowerCase() && m.batch === item.batch);
        if (existing) {
            existing.stock += item.qty;
            existing.buyRate = item.buyRate;
            existing.mrp = item.mrp;
            existing.distributor = dist;
            await saveMedicineToStore(existing);
        } else {
            const newMed = {
                id: 'med_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                name: item.name,
                generic: item.generic || '',
                distributor: dist,
                packSize: item.packSize || '20',
                batch: item.batch || 'B-' + Math.floor(100 + Math.random() * 900),
                expiry: item.expiry || '',
                buyRate: Number(item.buyRate),
                mrp: Number(item.mrp),
                stock: Number(item.qty),
                updatedAt: new Date().toISOString()
            };
            await saveMedicineToStore(newMed);
        }
    }

    window.closeAiScanModal();
    showToast('Stock inventory mein shamil ho gaya!', 'success');
    renderInventoryTable();
    renderDashboardMetrics();
};

// AI Margin Bill Scan
window.marginScannedItems = [];
window.handleAiMarginBillScan = async function(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const container = document.getElementById('margin-scanned-container');
    const loading = document.getElementById('margin-scan-loading');
    const content = document.getElementById('margin-scan-content');

    container?.classList.remove('hidden');
    loading?.classList.remove('hidden');
    content?.classList.add('hidden');
    safeCreateIcons();

    try {
        const base64Data = await enhanceImageLikeCamScanner(file);
        const resData = await callAiBackend('/api/ai/scan-margin', base64Data, MARGIN_PROMPT);
        let items = Array.isArray(resData?.data) ? resData.data : [];

        if (!items || items.length === 0) {
            throw new Error('Bill se koi items detect nahi ho sake. Barah-e-karam achi roshni mein seedhi tasweer upload karein.');
        }
        window.marginScannedItems = items.map((item, idx) => ({
            id: idx,
            name: item.name || 'Item ' + (idx + 1),
            buyRate: Number(item.buyRate || item.rate) || 0,
            qty: Number(item.qty || item.quantity) || 1,
            freeQty: Number(item.freeQty || item.free || item.bonus) || 0,
            mrp: ''
        }));

        renderMarginScannedTable();
        loading?.classList.add('hidden');
        content?.classList.remove('hidden');
        safeCreateIcons();
        showToast(`${items.length} items detect ho gaye! MRP enter karein.`, 'success');
    } catch(e) {
        console.error('Margin OCR Error:', e);
        container?.classList.add('hidden');
        showToast(e.message || 'Bill scan nahi ho saka, dobara koshish karein.', 'error');
    } finally {
        event.target.value = '';
    }
};

function renderMarginScannedTable() {
    const tbody = document.getElementById('margin-scanned-table-body');
    if (!tbody) return;
    if (window.marginScannedItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Koi item nahi mila.</td></tr>`;
        return;
    }
    tbody.innerHTML = window.marginScannedItems.map((item, idx) => {
        const schemeText = item.freeQty > 0 ? `${item.qty} + ${item.freeQty} Free` : 'No Scheme';
        return `
            <tr class="border-b border-slate-100 hover:bg-slate-50">
                <td class="p-2.5 font-bold text-slate-900">${item.name}</td>
                <td class="p-2.5 text-right font-black text-slate-700">Rs. ${item.buyRate.toFixed(2)}</td>
                <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${item.freeQty > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">
                        ${schemeText}
                    </span>
                </td>
                <td class="p-2.5 text-right bg-amber-50">
                    <input type="number" step="0.01" placeholder="Box MRP" value="${item.mrp}" 
                        oninput="window.updateMarginRowMrp(${idx}, this.value)" 
                        class="w-24 px-2 py-1 border border-amber-300 rounded-lg text-xs font-black text-emerald-800 text-right bg-white focus:outline-none">
                </td>
                <td class="p-2.5 text-right font-bold" id="margin-disc-col-${idx}">
                    <span class="text-slate-400 italic text-[11px]">Enter MRP</span>
                </td>
                <td class="p-2.5 text-right font-black bg-emerald-50" id="margin-profit-col-${idx}">
                    <span class="text-slate-400 italic text-[11px]">Enter MRP</span>
                </td>
            </tr>
        `;
    }).join('');
}

window.updateMarginRowMrp = function(idx, mrpVal) {
    const item = window.marginScannedItems[idx];
    if (!item) return;
    item.mrp = mrpVal;
    const mrp = Number(mrpVal);
    const discCol = document.getElementById(`margin-disc-col-${idx}`);
    const profitCol = document.getElementById(`margin-profit-col-${idx}`);

    if (!mrp || mrp <= 0 || item.buyRate <= 0) {
        if (discCol) discCol.innerHTML = `<span class="text-slate-400 italic text-[11px]">Enter MRP</span>`;
        if (profitCol) profitCol.innerHTML = `<span class="text-slate-400 italic text-[11px]">Enter MRP</span>`;
        return;
    }

    const totalCost = item.buyRate * item.qty;
    const totalUnits = item.qty + item.freeQty;
    const effCost = totalUnits > 0 ? (totalCost / totalUnits) : item.buyRate;

    const discPercent = Math.max(0, ((mrp - item.buyRate) / mrp) * 100);
    const profitPercent = Math.max(0, ((mrp - effCost) / mrp) * 100);

    if (discCol) discCol.innerHTML = `<span class="text-brand-700 font-extrabold">${discPercent.toFixed(2)}%</span>`;
    if (profitCol) profitCol.innerHTML = `<span class="text-emerald-700 font-black text-xs bg-emerald-100 px-2 py-0.5 rounded-full">${profitPercent.toFixed(2)}% Profit</span>`;
};

// POS Search & Cart
window.handlePosSearchKey = function(event) {
    const resultsContainer = document.getElementById('pos-search-results');
    const resultItems = resultsContainer ? resultsContainer.querySelectorAll('.pos-result-row') : [];

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (resultItems.length > 0) {
            activePosSearchIndex = Math.min(activePosSearchIndex + 1, resultItems.length - 1);
            highlightActivePosRow(resultItems);
        }
        return;
    }

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (resultItems.length > 0) {
            activePosSearchIndex = Math.max(activePosSearchIndex - 1, 0);
            highlightActivePosRow(resultItems);
        }
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        if (activePosSearchIndex >= 0 && activePosSearchIndex < resultItems.length) {
            resultItems[activePosSearchIndex].click();
        } else if (resultItems.length > 0) {
            resultItems[0].click();
        }
        return;
    }

    setTimeout(() => {
        activePosSearchIndex = -1;
        window.searchMedicineForPos();
    }, 10);
};

function highlightActivePosRow(items) {
    items.forEach((item, idx) => {
        if (idx === activePosSearchIndex) {
            item.classList.add('bg-brand-100', 'ring-2', 'ring-brand-500');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('bg-brand-100', 'ring-2', 'ring-brand-500');
        }
    });
}

window.searchMedicineForPos = function() {
    const input = document.getElementById('pos-search');
    const results = document.getElementById('pos-search-results');
    const query = input?.value.toLowerCase().trim() || '';
    if (!query) {
        results?.classList.add('hidden');
        return;
    }
    const matches = medicines.filter(m => 
        m.name.toLowerCase().includes(query) || 
        (m.generic && m.generic.toLowerCase().includes(query))
    );
    if (!results) return;
    if (matches.length === 0) {
        results.innerHTML = `<p class="p-3 text-xs text-slate-400 text-center">Koi medicine nahi mili.</p>`;
    } else {
        results.innerHTML = matches.map(m => {
            const packInfo = parsePackSize(m.packSize);
            return `
                <div tabindex="0" onclick="window.selectMedicineForPos('${m.id}')" class="pos-result-row p-2.5 hover:bg-brand-50 outline-none cursor-pointer flex justify-between items-center text-xs transition">
                    <div>
                        <strong class="text-slate-800 text-xs">${m.name}</strong>
                        <span class="text-[10px] text-slate-400 block">Stock: ${m.stock} packs (${packInfo.displayText}) • Batch: ${m.batch || 'B-01'}</span>
                    </div>
                    <span class="font-black text-emerald-700 text-xs">Rs. ${Number(m.mrp).toFixed(2)}</span>
                </div>
            `;
        }).join('');
    }
    results.classList.remove('hidden');
};

window.selectMedicineForPos = function(id) {
    const med = medicines.find(m => m.id === id);
    if (!med) return;
    currentSelectedMed = med;

    const packInfo = parsePackSize(med.packSize);
    const totalTabs = Math.floor(med.stock * packInfo.totalUnits);

    document.getElementById('pos-selected-title').innerText = med.name;
    document.getElementById('pos-selected-stock').innerText = `${med.stock} packs (${totalTabs} tabs)`;
    document.getElementById('pos-search-results')?.classList.add('hidden');
    document.getElementById('pos-search').value = '';
    
    const unitSelect = document.getElementById('pos-unit-type');
    if (unitSelect) unitSelect.value = 'pack';
    const qtyInput = document.getElementById('pos-qty');
    if (qtyInput) qtyInput.value = '1';

    window.updatePosLivePriceHint();
};

window.updatePosLivePriceHint = function() {
    const badge = document.getElementById('pos-calc-rate-badge');
    if (!badge) return;
    if (!currentSelectedMed) {
        badge.innerText = 'Rs. 0';
        return;
    }

    const packInfo = parsePackSize(currentSelectedMed.packSize);
    const totalUnits = Math.max(1, packInfo.totalUnits);
    const mrp = Number(currentSelectedMed.mrp) || 0;
    const qty = Math.max(1, parseInt(document.getElementById('pos-qty')?.value) || 1);
    const unitType = document.getElementById('pos-unit-type')?.value || 'pack';

    if (unitType === 'loose') {
        const perTabPrice = mrp / totalUnits;
        const total = perTabPrice * qty;
        badge.innerText = `Rs. ${perTabPrice.toFixed(2)}/dawai (Tot: Rs. ${total.toFixed(2)})`;
        badge.className = 'text-[9px] font-black text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded truncate max-w-[130px]';
    } else {
        const total = mrp * qty;
        badge.innerText = `Rs. ${mrp.toFixed(2)}/pack (Tot: Rs. ${total.toFixed(2)})`;
        badge.className = 'text-[9px] font-black text-brand-800 bg-brand-100 px-1.5 py-0.5 rounded truncate max-w-[130px]';
    }
};

window.changePosQty = function(delta) {
    const input = document.getElementById('pos-qty');
    if (!input) return;
    const current = Math.max(1, parseInt(input.value) || 1);
    const updated = Math.max(1, current + delta);
    input.value = updated;
    window.updatePosLivePriceHint();
};

window.addItemToCart = function() {
    if (!currentSelectedMed) {
        showToast('Pehle dawai search kar ke select karein!', 'error');
        document.getElementById('pos-search')?.focus();
        return;
    }

    const unitType = document.getElementById('pos-unit-type')?.value || 'pack';
    const qty = Math.max(1, parseInt(document.getElementById('pos-qty')?.value) || 1);
    const packInfo = parsePackSize(currentSelectedMed.packSize);
    const totalUnits = Math.max(1, packInfo.totalUnits);
    const mrp = Number(currentSelectedMed.mrp) || 0;

    let pricePerUnit = 0;
    let stockDeduction = 0;
    let displayUnit = '';

    if (unitType === 'loose') {
        pricePerUnit = mrp / totalUnits;
        stockDeduction = qty / totalUnits;
        displayUnit = 'Loose Dawai';
        const totalTabsAvailable = currentSelectedMed.stock * totalUnits;
        if (totalTabsAvailable < qty) {
            showToast(`Stock kam hai! Mojood loose dawai: ${Math.floor(totalTabsAvailable)}`, 'error');
            return;
        }
    } else {
        pricePerUnit = mrp;
        stockDeduction = qty;
        displayUnit = `Pack (${packInfo.displayText})`;
        if (currentSelectedMed.stock < stockDeduction) {
            showToast(`Stock kam hai! Mojood: ${currentSelectedMed.stock} packs`, 'error');
            return;
        }
    }

    cart.push({
        id: currentSelectedMed.id,
        name: currentSelectedMed.name,
        unitType: unitType,
        displayUnit: displayUnit,
        qty: qty,
        price: pricePerUnit,
        total: pricePerUnit * qty,
        stockDeduct: stockDeduction
    });

    currentSelectedMed = null;
    document.getElementById('pos-selected-title').innerText = 'Koi Select Nahi';
    document.getElementById('pos-selected-stock').innerText = '0';
    document.getElementById('pos-qty').value = '1';
    window.updatePosLivePriceHint();

    renderCartTable();
    window.calculateCartTotals();
    showToast('Bill mein shamil ho gaya!', 'success');
    document.getElementById('pos-search')?.focus();
};

window.changeCartItemQty = function(index, delta) {
    if (!cart[index]) return;
    const item = cart[index];
    const newQty = item.qty + delta;
    if (newQty <= 0) {
        window.removeCartItem(index);
        return;
    }
    const med = medicines.find(m => m.id === item.id);
    const packInfo = med ? parsePackSize(med.packSize) : { totalUnits: 20 };
    const totalUnits = Math.max(1, packInfo.totalUnits);

    if (item.unitType === 'loose') {
        const totalTabsAvailable = (med ? med.stock : 999) * totalUnits;
        if (totalTabsAvailable < newQty) {
            showToast(`Stock kam hai! Mojood loose dawai: ${Math.floor(totalTabsAvailable)}`, 'error');
            return;
        }
        item.stockDeduct = newQty / totalUnits;
    } else {
        if (med && med.stock < newQty) {
            showToast(`Stock kam hai! Mojood: ${med.stock} packs`, 'error');
            return;
        }
        item.stockDeduct = newQty;
    }
    item.qty = newQty;
    item.total = item.price * newQty;
    renderCartTable();
    window.calculateCartTotals();
};

function renderCartTable() {
    const tbody = document.getElementById('cart-table-body');
    if (!tbody) return;
    if (cart.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400">Cart khali hai. Dawai search kar ke add karein.</td></tr>`;
        return;
    }
    tbody.innerHTML = cart.map((item, index) => `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
            <td class="p-2 font-bold text-slate-800">${item.name}</td>
            <td class="p-2 text-center text-slate-600 font-bold">${item.displayUnit}</td>
            <td class="p-2 text-center font-black">
                <div class="inline-flex items-center justify-center gap-1">
                    <button type="button" onclick="window.changeCartItemQty(${index}, -1)" class="w-5 h-5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-black text-xs flex items-center justify-center active:scale-90 select-none shadow-2xs" title="Kam karein">-</button>
                    <span class="font-black px-1 min-w-[20px] text-center text-xs text-slate-900">${item.qty}</span>
                    <button type="button" onclick="window.changeCartItemQty(${index}, 1)" class="w-5 h-5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-black text-xs flex items-center justify-center active:scale-90 select-none shadow-2xs" title="Barhayein">+</button>
                </div>
            </td>
            <td class="p-2 text-right text-slate-600">Rs. ${item.price.toFixed(2)}</td>
            <td class="p-2 text-right font-black text-slate-900">Rs. ${item.total.toFixed(2)}</td>
            <td class="p-2 text-center">
                <button onclick="window.removeCartItem(${index})" class="text-red-500 hover:text-red-700 p-1" title="Hata dein">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </td>
        </tr>
    `).join('');
    safeCreateIcons();
}
window.renderCartTable = renderCartTable;

window.removeCartItem = function(index) {
    cart.splice(index, 1);
    renderCartTable();
    window.calculateCartTotals();
};

window.calculateCartTotals = function() {
    const subtotal = cart.reduce((sum, item) => sum + item.total, 0);
    const discInput = document.getElementById('pos-discount');
    const discPercent = discInput && discInput.value !== '' ? Number(discInput.value) : 0;
    const discAmt = (subtotal * discPercent) / 100;
    const netTotal = Math.max(0, subtotal - discAmt);

    document.getElementById('pos-subtotal').innerText = 'Rs. ' + subtotal.toFixed(2);
    document.getElementById('pos-discount-amt').innerText = '- Rs. ' + discAmt.toFixed(2);
    document.getElementById('pos-grand-total').innerText = 'Rs. ' + netTotal.toFixed(2);
    return { subtotal, discPercent, discAmt, netTotal };
};

window.clearCartPrompt = function() {
    if (cart.length === 0) return;
    customConfirm('Cart Khali Karein?', 'Kya aap bill ke items remove karna chahte hain?', () => {
        cart = [];
        const discInput = document.getElementById('pos-discount');
        if (discInput) discInput.value = '';
        renderCartTable();
        window.calculateCartTotals();
        showToast('Cart clear ho gaya!', 'info');
    });
};

window.completeSale = async function() {
    if (cart.length === 0) {
        showToast('Pehle cart mein items add karein!', 'error');
        return;
    }

    const { subtotal, discPercent, discAmt, netTotal } = window.calculateCartTotals();
    const payMode = document.getElementById('pos-pay-mode')?.value || 'Cash';
    const customer = document.getElementById('pos-customer')?.value.trim() || 'Walk-in Customer';

    const invoiceId = 'INV-' + Math.floor(1000 + Math.random() * 9000);
    const saleRecord = {
        id: 'sale_' + Date.now(),
        invoiceId: invoiceId,
        customer: customer,
        paymentMode: payMode,
        subtotal: subtotal,
        discountPercent: discPercent,
        discountAmount: discAmt,
        netTotal: netTotal,
        items: [...cart],
        timestamp: new Date().toISOString()
    };

    for (const c of cart) {
        const med = medicines.find(m => m.id === c.id);
        if (med) {
            med.stock = Math.max(0, parseFloat((med.stock - c.stockDeduct).toFixed(4)));
            await saveMedicineToStore(med);
        }
    }

    await saveSaleToStore(saleRecord);
    populateReceipt(saleRecord);

    cart = [];
    document.getElementById('pos-customer').value = '';
    const discInput = document.getElementById('pos-discount');
    if (discInput) discInput.value = '';
    renderCartTable();
    window.calculateCartTotals();
    renderDashboardMetrics();

    document.getElementById('digital-receipt-modal')?.classList.remove('hidden');
    safeCreateIcons();
    showToast('Sale mukammal! Receipt tayyar hai.', 'success');
};

// ==========================================
// RECEIPT GENERATION (NO "thermal" or "80mm")
// Dynamic Size according to items count
// ==========================================
function populateReceipt(sale) {
    window.currentViewingSale = sale;
    const config = window.getStoreConfig();

    document.getElementById('receipt-store-title').innerText = config.name || 'Digital Pharma';
    document.getElementById('receipt-store-address').innerText = config.address || 'Main Commercial Market';
    document.getElementById('receipt-store-phone').innerText = 'Phone/WhatsApp: ' + (config.phone || '');
    const rLicense = document.getElementById('receipt-store-license');
    if (rLicense) {
        if (config.licenseNo && config.licenseNo.trim()) {
            rLicense.innerText = 'D.S.L #: ' + config.licenseNo.trim();
            rLicense.classList.remove('hidden');
        } else {
            rLicense.classList.add('hidden');
        }
    }
    document.getElementById('receipt-invoice-no').innerText = 'INV: #' + (sale.invoiceId || '1001');
    document.getElementById('receipt-date-time').innerText = new Date(sale.timestamp).toLocaleString();
    document.getElementById('receipt-customer-name').innerText = sale.customer || 'Walk-in';

    const totalItemCount = sale.items.reduce((acc, i) => acc + (i.qty || 1), 0);
    document.getElementById('receipt-items-count').innerText = `${sale.items.length} items (${totalItemCount} units)`;

    const tbody = document.getElementById('receipt-items-tbody');
    if (tbody) {
        tbody.innerHTML = sale.items.map(item => `
            <tr class="py-1">
                <td class="py-1 font-bold">
                    <div>${item.name}</div>
                    <span class="text-[8px] text-slate-600 block">${item.displayUnit}</span>
                </td>
                <td class="py-1 text-center font-black">${item.qty}</td>
                <td class="py-1 text-right">${Number(item.price).toFixed(2)}</td>
                <td class="py-1 text-right font-black">${Number(item.total).toFixed(2)}</td>
            </tr>
        `).join('');
    }

    document.getElementById('receipt-subtotal-val').innerText = 'Rs. ' + Number(sale.subtotal).toFixed(2);
    document.getElementById('receipt-discount-val').innerText = '- Rs. ' + Number(sale.discountAmount).toFixed(2);
    document.getElementById('receipt-net-total-val').innerText = 'Rs. ' + Number(sale.netTotal).toFixed(2);
    document.getElementById('receipt-payment-mode').innerText = sale.paymentMode || 'Cash';
    document.getElementById('receipt-barcode-number').innerText = `*${sale.invoiceId || 'INV-1001'}*`;
}

window.closeReceiptModal = function() {
    document.getElementById('digital-receipt-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.downloadReceiptImage = function() {
    const card = document.getElementById('receipt-card-capture');
    if (!card) return;
    showToast('Image generate ho rahi hai...', 'info');
    if (typeof window.html2canvas === 'function') {
        window.html2canvas(card, { scale: 2.5, backgroundColor: '#fcfcf8' }).then(canvas => {
            const link = document.createElement('a');
            link.download = `Receipt_${window.currentViewingSale?.invoiceId || 'Bill'}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            showToast('Receipt download ho gayi!', 'success');
        }).catch(err => {
            console.error('Image Export Error:', err);
            showToast('Receipt image download nahi ho saki.', 'error');
        });
    }
};

window.shareReceiptOnWhatsApp = function() {
    if (!window.currentViewingSale) return;
    const s = window.currentViewingSale;
    const config = window.getStoreConfig();

    let text = `*${config.name.toUpperCase()}*\n`;
    text += `${config.address}\n`;
    text += `Phone: ${config.phone}\n`;
    if (config.licenseNo && config.licenseNo.trim()) {
        text += `D.S.L #: ${config.licenseNo.trim()}\n`;
    }
    text += `\n`;
    text += `*Receipt:* #${s.invoiceId}\n`;
    text += `*Customer:* ${s.customer}\n`;
    text += `*Date:* ${new Date(s.timestamp).toLocaleDateString()}\n`;
    text += `--------------------------------\n`;
    s.items.forEach(i => {
        text += `• ${i.name} (${i.qty} ${i.displayUnit}) = Rs. ${i.total.toFixed(2)}\n`;
    });
    text += `--------------------------------\n`;
    text += `*Gross Subtotal:* Rs. ${s.subtotal.toFixed(2)}\n`;
    if (s.discountAmount > 0) text += `*Discount:* -Rs. ${s.discountAmount.toFixed(2)}\n`;
    text += `*NET PAYABLE:* Rs. ${s.netTotal.toFixed(2)}\n`;
    text += `*Payment:* ${s.paymentMode}\n\n`;
    text += `_Shukriya / Get Well Soon!_\n`;
    text += `_DIGITAL PHARMA DEVELOPED BY SHAHZAD KHAKH_`;

    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
};

window.printReceipt = function() {
    window.print();
};

// Global / Mobile Search
window.globalQuickSearch = function() {
    const input = document.getElementById('global-search-input');
    const results = document.getElementById('global-search-results');
    const clearBtn = document.getElementById('clear-global-search');
    handleQuickSearchLogic(input, results, clearBtn);
};

window.mobileQuickSearch = function() {
    const input = document.getElementById('mobile-search-input');
    const results = document.getElementById('mobile-search-results');
    const clearBtn = document.getElementById('clear-mobile-search');
    handleQuickSearchLogic(input, results, clearBtn);
};

function handleQuickSearchLogic(inputEl, resultsEl, clearBtnEl) {
    if (!inputEl || !resultsEl) return;
    const query = inputEl.value.toLowerCase().trim();
    if (!query) {
        resultsEl.classList.add('hidden');
        clearBtnEl?.classList.add('hidden');
        return;
    }
    clearBtnEl?.classList.remove('hidden');

    const myMatch = medicines.filter(m => 
        (m.name && m.name.toLowerCase().includes(query)) || 
        (m.generic && m.generic.toLowerCase().includes(query)) ||
        (m.distributor && m.distributor.toLowerCase().includes(query)) ||
        (m.batch && m.batch.toLowerCase().includes(query))
    );
    
    const otherPharmacies = [
        { store: 'Al-Madina Pharmacy', phone: '03011234567', name: query.toUpperCase(), rate: 'Market MRP', stock: 'Dastiyab Hai' },
        { store: 'Qadri Medicos', phone: '03027654321', name: query.toUpperCase(), rate: 'Wholesale Discount', stock: 'Limited Stock' }
    ];

    let html = '';
    if (myMatch.length > 0) {
        html += `<div class="p-2 text-[10px] font-black uppercase text-brand-700 bg-brand-50 rounded-xl flex items-center justify-between"><span>Aap Ke Store Ka Stock:</span><span>${myMatch.length} found</span></div>`;
        html += myMatch.map(m => {
            const packInfo = parsePackSize(m.packSize);
            const totalUnits = Math.max(1, packInfo.totalUnits);
            const totalTabs = Math.floor(m.stock * totalUnits);
            const perUnitRate = (Number(m.mrp) / totalUnits).toFixed(2);
            const location = m.location || 'Rack A-1';
            return `
                <div class="p-3 hover:bg-slate-50 border-b border-slate-100 transition rounded-xl flex flex-col gap-2">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <strong class="text-slate-900 text-xs sm:text-sm font-black">${m.name}</strong>
                                <span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">Available</span>
                                <span class="px-2 py-0.5 bg-brand-100 text-brand-800 text-[10px] font-bold rounded-full flex items-center gap-1">
                                    <i data-lucide="map-pin" class="w-3 h-3"></i> ${location}
                                </span>
                            </div>
                            <span class="text-[11px] text-slate-500 font-medium block mt-0.5">${m.generic ? m.generic + ' • ' : ''}<span class="text-brand-700 font-bold">${m.distributor || 'General'}</span></span>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="text-[10px] text-slate-400 font-bold uppercase block">Retail MRP</span>
                            <span class="font-black text-emerald-700 text-sm sm:text-base block">Rs. ${Number(m.mrp).toFixed(2)}</span>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs bg-slate-50 p-2 rounded-xl border border-slate-200/80">
                        <div>
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Stock Qty:</span>
                            <strong class="text-slate-900 font-black">${m.stock} Packs <span class="text-slate-500 font-normal">(${totalTabs} goli)</span></strong>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Per Unit Rate:</span>
                            <strong class="text-brand-700 font-black">Rs. ${perUnitRate} / goli</strong>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Location:</span>
                            <strong class="text-slate-800 font-bold">${location}</strong>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Kharid Rate (TP):</span>
                            <strong class="text-slate-700 font-bold">Rs. ${Number(m.buyRate).toFixed(2)}</strong>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        html += `<div class="p-3 text-xs text-amber-800 bg-amber-50 rounded-xl font-semibold border border-amber-200">Aap ke store par yeh medicine mojood nahi hai.</div>`;
    }

    html += `<div class="p-2 text-[10px] font-black uppercase text-emerald-800 bg-emerald-50 rounded-xl mt-2 flex items-center justify-between"><span>Connected Pharmacies Network</span></div>`;
    html += otherPharmacies.map(p => `
        <div class="p-2.5 hover:bg-slate-50 flex items-center justify-between text-xs border-b border-slate-100 transition rounded-lg">
            <div class="space-y-0.5">
                <strong class="text-slate-800 text-xs sm:text-sm font-black">${p.store}</strong>
                <span class="text-[10px] text-emerald-600 font-semibold block">${p.stock}</span>
            </div>
            <a href="https://wa.me/92${p.phone.replace(/^0/, '')}?text=${encodeURIComponent('Assalam-o-Alaikum, kya aap ke paas ' + query + ' medicine dastiyab hai?')}" target="_blank" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-black flex items-center gap-1.5 shadow-xs active:scale-95 transition">
                <i data-lucide="message-circle" class="w-3.5 h-3.5"></i> WhatsApp Rabta
            </a>
        </div>
    `).join('');

    resultsEl.innerHTML = html;
    resultsEl.classList.remove('hidden');
    safeCreateIcons();
}

window.clearGlobalSearch = function() {
    const input = document.getElementById('global-search-input');
    if (input) input.value = '';
    document.getElementById('global-search-results')?.classList.add('hidden');
    document.getElementById('clear-global-search')?.classList.add('hidden');
};

window.clearMobileSearch = function() {
    const input = document.getElementById('mobile-search-input');
    if (input) input.value = '';
    document.getElementById('mobile-search-results')?.classList.add('hidden');
    document.getElementById('clear-mobile-search')?.classList.add('hidden');
};

// Inventory Table
function renderInventoryTable() {
    const tbody = document.getElementById('inventory-table-body');
    const mobileCards = document.getElementById('inventory-mobile-cards');
    const searchVal = document.getElementById('inv-search')?.value.toLowerCase().trim() || '';

    let filtered = medicines;
    if (searchVal) {
        filtered = medicines.filter(m => 
            m.name.toLowerCase().includes(searchVal) ||
            (m.generic && m.generic.toLowerCase().includes(searchVal)) ||
            (m.batch && m.batch.toLowerCase().includes(searchVal)) ||
            (m.distributor && m.distributor.toLowerCase().includes(searchVal))
        );
    }

    // 1. Desktop & Tablet Table (Wide Screen)
    if (tbody) {
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400">Stock mein koi medicine nahi mili.</td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(m => {
                const packInfo = parsePackSize(m.packSize);
                return `
                    <tr class="hover:bg-slate-50 border-b border-slate-100">
                        <td class="p-3">
                            <strong class="text-slate-900 block text-xs sm:text-sm break-words">${m.name}</strong>
                            <div class="flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span class="text-[10px] text-slate-500">${m.generic || 'Formula'}</span>
                                <span class="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-mono font-medium">📍 ${m.location || 'Rack A-1'}</span>
                            </div>
                        </td>
                        <td class="p-3 text-slate-600 font-semibold">${m.distributor || 'General'}</td>
                        <td class="p-3 text-slate-700 font-bold">${packInfo.displayText}</td>
                        <td class="p-3 font-mono text-slate-700">${m.batch || '-'}</td>
                        <td class="p-3 text-slate-600">${m.expiry || '-'}</td>
                        <td class="p-3 text-right font-bold text-slate-600">Rs. ${Number(m.buyRate).toFixed(2)}</td>
                        <td class="p-3 text-right font-black text-emerald-700">Rs. ${Number(m.mrp).toFixed(2)}</td>
                        <td class="p-3 text-center">
                            <span class="px-2 py-0.5 rounded-full font-black text-xs ${m.stock < 10 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
                                ${m.stock}
                            </span>
                        </td>
                        <td class="p-3 text-center">
                            <div class="flex items-center justify-center gap-1">
                                <button onclick="window.openEditMedicineModal('${m.id}')" class="p-1 text-slate-500 hover:text-brand-600 active:scale-90" title="Edit">
                                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                                </button>
                                <button onclick="window.deleteMedicinePrompt('${m.id}')" class="p-1 text-slate-400 hover:text-red-600 active:scale-90" title="Delete">
                                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // 2. Mobile Responsive Stock Cards (100% Screen Fit, Zero Horizontal Movement!)
    if (mobileCards) {
        if (filtered.length === 0) {
            mobileCards.innerHTML = `<div class="bg-white p-6 rounded-2xl border border-slate-200 text-center text-xs text-slate-400">Stock mein koi medicine nahi mili.</div>`;
        } else {
            mobileCards.innerHTML = filtered.map(m => {
                const packInfo = parsePackSize(m.packSize);
                return `
                    <div class="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs space-y-2.5">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <h4 class="font-black text-sm text-slate-900 leading-tight break-words">${m.name}</h4>
                                <span class="text-[11px] text-slate-500 font-medium block mt-0.5">${m.generic ? m.generic + ' • ' : ''}<span class="text-brand-700 font-bold">${m.distributor || 'General'}</span> • <span class="text-slate-600 font-mono">📍 ${m.location || 'Rack A-1'}</span></span>
                            </div>
                            <span class="shrink-0 px-2.5 py-1 rounded-full font-black text-xs ${m.stock < 10 ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}">
                                ${m.stock} Packs
                            </span>
                        </div>

                        <!-- 4-Box Metrics Grid (Clean & Proportionate) -->
                        <div class="grid grid-cols-2 gap-2 text-xs">
                            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Retail MRP:</span>
                                <strong class="text-xs font-black text-emerald-700">Rs. ${Number(m.mrp).toFixed(2)}</strong>
                            </div>
                            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Kharid Rate:</span>
                                <strong class="text-xs font-bold text-slate-700">Rs. ${Number(m.buyRate).toFixed(2)}</strong>
                            </div>
                            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Pack Size:</span>
                                <span class="text-xs font-semibold text-slate-800">${packInfo.displayText}</span>
                            </div>
                            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Batch & Expiry:</span>
                                <span class="text-xs font-mono text-slate-800 truncate block">${m.batch || 'B-01'} • ${m.expiry || 'N/A'}</span>
                            </div>
                        </div>

                        <!-- Mobile Action Buttons -->
                        <div class="flex items-center gap-2 pt-1 border-t border-slate-100">
                            <button onclick="window.openEditMedicineModal('${m.id}')" class="flex-1 py-2 px-3 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold text-xs flex items-center justify-center gap-1.5 transition active:scale-95">
                                <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Edit Medicine
                            </button>
                            <button onclick="window.deleteMedicinePrompt('${m.id}')" class="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 transition active:scale-95" title="Delete">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    safeCreateIcons();
}
window.renderInventoryTable = renderInventoryTable;

window.filterInventoryTable = function() {
    renderInventoryTable();
};

window.updateMedPackHintLive = function() {
    const input = document.getElementById('med-pack');
    const hint = document.getElementById('med-pack-hint');
    if (!hint) return;
    const val = input ? input.value : '20';
    const parsed = parsePackSize(val);
    hint.innerText = `Total: ${parsed.displayText}`;
};

window.openAddMedicineModal = function() {
    const title = document.getElementById('medicine-modal-title');
    if (title) title.innerText = 'Nayi Medicine Shamil Karein';
    document.getElementById('medicine-form')?.reset();
    const idEl = document.getElementById('med-id');
    if (idEl) idEl.value = '';
    const packEl = document.getElementById('med-pack');
    if (packEl) packEl.value = '20';
    const batchEl = document.getElementById('med-batch');
    if (batchEl) batchEl.value = 'B-' + Math.floor(100 + Math.random() * 900);
    const expEl = document.getElementById('med-expiry');
    if (expEl) {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 2);
        expEl.value = d.toISOString().split('T')[0];
    }
    const locEl = document.getElementById('med-location');
    if (locEl) locEl.value = 'Rack A-1';
    const minEl = document.getElementById('med-min-stock');
    if (minEl) minEl.value = '5';
    const stockEl = document.getElementById('med-stock');
    if (stockEl) stockEl.value = '10';
    window.updateMedPackHintLive();
    document.getElementById('medicine-modal')?.classList.remove('hidden');
    syncModalScrollLock();
    safeCreateIcons();
};

window.openEditMedicineModal = function(id) {
    const med = medicines.find(m => m.id === id);
    if (!med) return;
    document.getElementById('medicine-modal-title').innerText = 'Medicine Update Karein';
    document.getElementById('med-id').value = med.id;
    document.getElementById('med-name').value = med.name;
    document.getElementById('med-generic').value = med.generic || '';
    document.getElementById('med-distributor').value = med.distributor || '';
    document.getElementById('med-pack').value = med.packSize || '20';
    document.getElementById('med-batch').value = med.batch || '';
    document.getElementById('med-expiry').value = med.expiry || '';
    document.getElementById('med-buy').value = med.buyRate;
    document.getElementById('med-mrp').value = med.mrp;
    document.getElementById('med-stock').value = med.stock;
    const locEl = document.getElementById('med-location');
    if (locEl) locEl.value = med.location || 'Rack A-1';
    const minEl = document.getElementById('med-min-stock');
    if (minEl) minEl.value = med.minStock || 5;
    window.updateMedPackHintLive();
    document.getElementById('medicine-modal')?.classList.remove('hidden');
    syncModalScrollLock();
    safeCreateIcons();
};

window.closeMedicineModal = function() {
    document.getElementById('medicine-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.saveMedicineRecord = async function(event) {
    event.preventDefault();
    const id = document.getElementById('med-id')?.value;
    const expiryInput = document.getElementById('med-expiry')?.value;
    let fallbackExp = '';
    if (!expiryInput) {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 2);
        fallbackExp = d.toISOString().split('T')[0];
    }

    const newMed = {
        id: id || ('med_' + Date.now()),
        name: document.getElementById('med-name').value.trim(),
        generic: document.getElementById('med-generic').value.trim(),
        distributor: document.getElementById('med-distributor').value.trim() || 'General',
        packSize: document.getElementById('med-pack').value.trim() || '20',
        batch: document.getElementById('med-batch').value.trim() || ('B-' + Math.floor(100 + Math.random() * 900)),
        expiry: expiryInput || fallbackExp,
        buyRate: Number(document.getElementById('med-buy').value) || 0,
        mrp: Number(document.getElementById('med-mrp').value) || 0,
        stock: Number(document.getElementById('med-stock').value) || 0,
        location: document.getElementById('med-location')?.value.trim() || 'Rack A-1',
        minStock: Number(document.getElementById('med-min-stock')?.value) || 5,
        updatedAt: new Date().toISOString()
    };

    await saveMedicineToStore(newMed);
    window.closeMedicineModal();
    showToast('Medicine save ho gayi!', 'success');
    renderInventoryTable();
    renderDashboardMetrics();
    window.populateLooseStockSelector();
};

window.deleteMedicinePrompt = function(id) {
    const med = medicines.find(m => m.id === id);
    if (!med) return;
    customConfirm('Delete Medicine?', `Kya aap "${med.name}" ko stock se delete karna chahte hain?`, async () => {
        await deleteMedicineFromStore(id);
        showToast('Medicine delete ho gayi!', 'info');
        renderInventoryTable();
        renderDashboardMetrics();
        window.populateLooseStockSelector();
    });
};

window.closeDistributorModal = function() {
    document.getElementById('distributor-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.closeSaleEditModal = function() {
    document.getElementById('sale-edit-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.openDistributorComparisonModal = function() {
    const container = document.getElementById('distributor-comparison-body');
    const map = {};
    medicines.forEach(m => {
        const key = m.name.toLowerCase().trim();
        if (!map[key]) map[key] = { name: m.name, rates: [] };
        map[key].rates.push({
            distributor: m.distributor || 'Unknown',
            buyRate: m.buyRate,
            mrp: m.mrp,
            margin: (((m.mrp - m.buyRate) / m.mrp) * 100).toFixed(1)
        });
    });

    const items = Object.values(map);
    if (!container) return;
    if (items.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">Koi medicine data dastiyab nahi.</p>`;
    } else {
        container.innerHTML = items.map(item => `
            <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                <strong class="text-slate-900 block font-bold">${item.name}</strong>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${item.rates.map(r => `
                        <div class="bg-white p-2 rounded-lg border border-slate-200 flex justify-between items-center">
                            <div>
                                <span class="font-bold text-slate-700">${r.distributor}</span>
                                <span class="text-[10px] text-slate-400 block">Buy: Rs. ${r.buyRate.toFixed(2)}</span>
                            </div>
                            <span class="text-xs font-black text-emerald-600">${r.margin}% Profit</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }
    document.getElementById('distributor-modal')?.classList.remove('hidden');
    safeCreateIcons();
};

window.refreshNetworkList = function() {
    const grid = document.getElementById('network-stores-grid');
    if (!grid) return;
    const mockStores = [
        { name: 'City Care Pharmacy', city: 'Muzaffargarh', phone: '03011234567', items: 840, status: 'Online' },
        { name: 'National Medicos', city: 'Multan', phone: '03027654321', items: 1200, status: 'Active' },
        { name: 'Al-Razi Pharmacy', city: 'Lahore', phone: '03009876543', items: 1450, status: 'Online' }
    ];

    grid.innerHTML = mockStores.map(s => `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between gap-3">
            <div class="flex items-start justify-between">
                <div>
                    <h4 class="font-black text-slate-800 text-sm">${s.name}</h4>
                    <p class="text-[11px] text-slate-500">${s.city}</p>
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">${s.status}</span>
            </div>
            <div class="text-[11px] text-slate-600 flex justify-between">
                <span>Active Stock:</span>
                <strong class="text-brand-700">${s.items}+ Medicines</strong>
            </div>
            <a href="https://wa.me/92${s.phone.replace(/^0/, '')}?text=${encodeURIComponent('Assalam-o-Alaikum, Digital Pharma network se rabta kiya hai.')}" target="_blank" class="w-full py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition">
                <i data-lucide="message-square" class="w-3.5 h-3.5"></i> Contact via WhatsApp
            </a>
        </div>
    `).join('');
    safeCreateIcons();
};

function renderDashboardMetrics() {
    const elTotalItems = document.getElementById('dash-total-items');
    if (elTotalItems) elTotalItems.innerText = medicines.length;

    const stockCost = medicines.reduce((sum, m) => sum + ((Number(m.buyRate) || 0) * (Number(m.stock) || 0)), 0);
    const elTotalValue = document.getElementById('dash-total-value');
    if (elTotalValue) elTotalValue.innerText = 'Rs. ' + stockCost.toLocaleString('en-PK', { maximumFractionDigits: 0 });

    const lowStock = medicines.filter(m => (Number(m.stock) || 0) < 10);
    const elLowStock = document.getElementById('dash-low-stock');
    if (elLowStock) elLowStock.innerText = lowStock.length;

    const today = new Date().toISOString().split('T')[0];
    const todaySales = sales.filter(s => s.timestamp && s.timestamp.startsWith(today));
    const todayTotal = todaySales.reduce((sum, s) => sum + (Number(s.netTotal) || 0), 0);
    const elTodaySales = document.getElementById('dash-today-sales');
    if (elTodaySales) elTodaySales.innerText = 'Rs. ' + todayTotal.toLocaleString('en-PK', { maximumFractionDigits: 0 });

    const lowStockList = document.getElementById('low-stock-list');
    if (lowStockList) {
        if (lowStock.length === 0) {
            lowStockList.innerHTML = `<p class="text-xs text-slate-400 py-3 text-center">Tamam medicines ka stock munasib hai.</p>`;
        } else {
            lowStockList.innerHTML = lowStock.slice(0, 5).map(m => `
                <div class="py-2 flex items-center justify-between text-xs">
                    <div>
                        <strong class="text-slate-800">${m.name}</strong>
                        <span class="text-[10px] text-slate-400 block">${m.distributor || 'General'}</span>
                    </div>
                    <span class="font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">${m.stock} remaining</span>
                </div>
            `).join('');
        }
    }

    const expiryList = document.getElementById('expiry-alert-list');
    if (expiryList) {
        const now = new Date();
        const sixtyDaysLater = new Date(now.getTime() + 60*24*60*60*1000);
        const expiringSoon = medicines.filter(m => {
            if (!m.expiry) return false;
            const d = new Date(m.expiry);
            return d >= now && d <= sixtyDaysLater;
        });

        if (expiringSoon.length === 0) {
            expiryList.innerHTML = `<p class="text-xs text-slate-400 py-2 text-center">Agly 60 dino mein koi medicine expire nahi ho rahi.</p>`;
        } else {
            expiryList.innerHTML = expiringSoon.slice(0, 5).map(m => `
                <div class="py-1.5 flex items-center justify-between text-xs">
                    <strong class="text-slate-800">${m.name}</strong>
                    <span class="font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded text-[10px]">Exp: ${m.expiry}</span>
                </div>
            `).join('');
        }
    }

    const recentSalesList = document.getElementById('recent-sales-list');
    if (recentSalesList) {
        if (sales.length === 0) {
            recentSalesList.innerHTML = `<p class="text-xs text-slate-400 py-4 text-center">Aaj abhi tak koi sale invoice generate nahi hui.</p>`;
        } else {
            recentSalesList.innerHTML = [...sales].reverse().slice(0, 8).map(s => `
                <div onclick="window.openSaleEditModal('${s.id}')" class="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl cursor-pointer flex items-center justify-between text-xs transition border border-slate-100">
                    <div>
                        <strong class="text-slate-800 block">#${s.invoiceId} - ${s.customer}</strong>
                        <span class="text-[10px] text-slate-400">${new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${s.paymentMode}</span>
                    </div>
                    <span class="font-black text-brand-700">Rs. ${Number(s.netTotal).toFixed(2)}</span>
                </div>
            `).join('');
        }
    }
    safeCreateIcons();
}

window.openSaleEditModal = function(saleId) {
    const sale = sales.find(s => s.id === saleId);
    if (!sale) return;
    currentEditingSaleId = saleId;
    document.getElementById('edit-invoice-id').innerText = sale.invoiceId;
    document.getElementById('edit-customer-name').value = sale.customer;
    document.getElementById('edit-payment-mode').value = sale.paymentMode || 'Cash';

    const itemsList = document.getElementById('edit-invoice-items-list');
    if (itemsList) {
        itemsList.innerHTML = sale.items.map(i => `
            <div class="flex justify-between text-[11px]">
                <span>${i.name} (${i.qty} ${i.displayUnit})</span>
                <strong class="text-slate-700">Rs. ${i.total.toFixed(2)}</strong>
            </div>
        `).join('');
    }
    document.getElementById('sale-edit-modal')?.classList.remove('hidden');
};

window.saveSaleEdits = async function() {
    const sale = sales.find(s => s.id === currentEditingSaleId);
    if (!sale) return;
    sale.customer = document.getElementById('edit-customer-name')?.value.trim() || 'Walk-in';
    sale.paymentMode = document.getElementById('edit-payment-mode')?.value || 'Cash';
    await saveSaleToStore(sale);
    document.getElementById('sale-edit-modal')?.classList.add('hidden');
    showToast('Invoice details update ho gayin!', 'success');
    renderDashboardMetrics();
};

window.reprintEditedSale = function() {
    const sale = sales.find(s => s.id === currentEditingSaleId);
    if (!sale) return;
    document.getElementById('sale-edit-modal')?.classList.add('hidden');
    populateReceipt(sale);
    document.getElementById('digital-receipt-modal')?.classList.remove('hidden');
};

window.deleteSaleInvoicePrompt = function() {
    customConfirm('Bill Delete & Restock Karein?', 'Kya aap is bill ko delete kar ke medicines wapis stock mein daalna chahte hain?', async () => {
        const sale = sales.find(s => s.id === currentEditingSaleId);
        if (sale) {
            for (const item of sale.items) {
                const med = medicines.find(m => m.id === item.id);
                if (med) {
                    med.stock = parseFloat((med.stock + item.stockDeduct).toFixed(4));
                    await saveMedicineToStore(med);
                }
            }
            await deleteSaleFromStore(currentEditingSaleId);
        }
        document.getElementById('sale-edit-modal')?.classList.add('hidden');
        showToast('Bill delete aur stock wapis add ho gaya!', 'info');
        renderDashboardMetrics();
        renderInventoryTable();
    });
};

async function saveMedicineToStore(med) {
    const idx = medicines.findIndex(m => m.id === med.id);
    if (idx !== -1) medicines[idx] = med; else medicines.push(med);
    localStorage.setItem('sm_medicines', JSON.stringify(medicines));
    if (db && authUser && fbFirestoreMod) {
        try {
            await fbFirestoreMod.setDoc(fbFirestoreMod.doc(db, 'artifacts', appId, 'users', authUser.uid, 'medicines', med.id), med);
        } catch(e) {}
    }
}

async function deleteMedicineFromStore(id) {
    medicines = medicines.filter(m => m.id !== id);
    localStorage.setItem('sm_medicines', JSON.stringify(medicines));
    if (db && authUser && fbFirestoreMod) {
        try {
            await fbFirestoreMod.deleteDoc(fbFirestoreMod.doc(db, 'artifacts', appId, 'users', authUser.uid, 'medicines', id));
        } catch(e) {}
    }
}

async function saveSaleToStore(sale) {
    const idx = sales.findIndex(s => s.id === sale.id);
    if (idx !== -1) sales[idx] = sale; else sales.push(sale);
    localStorage.setItem('sm_sales', JSON.stringify(sales));
    if (db && authUser && fbFirestoreMod) {
        try {
            await fbFirestoreMod.setDoc(fbFirestoreMod.doc(db, 'artifacts', appId, 'users', authUser.uid, 'sales', sale.id), sale);
        } catch(e) {}
    }
}

async function deleteSaleFromStore(id) {
    sales = sales.filter(s => s.id !== id);
    localStorage.setItem('sm_sales', JSON.stringify(sales));
    if (db && authUser && fbFirestoreMod) {
        try {
            await fbFirestoreMod.deleteDoc(fbFirestoreMod.doc(db, 'artifacts', appId, 'users', authUser.uid, 'sales', id));
        } catch(e) {}
    }
}

// Account Hub
window.openAccountHubModal = function() {
    const config = window.getStoreConfig();
    document.getElementById('hub-store-name').value = config.name || '';
    document.getElementById('hub-store-phone').value = config.phone || '';
    document.getElementById('hub-store-address').value = config.address || '';
    document.getElementById('hub-store-license').value = config.licenseNo || '';

    const statusDot = document.getElementById('hub-status-dot');
    const statusText = document.getElementById('hub-status-text');
    const authPill = document.getElementById('hub-auth-pill');
    const unauthBox = document.getElementById('hub-unauth-box');
    const authBox = document.getElementById('hub-auth-box');
    const userEmailSpan = document.getElementById('hub-user-email');

    if (authUser) {
        statusDot.className = 'w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse';
        statusText.innerText = 'Online Cloud Synced';
        statusText.className = 'text-emerald-700 font-bold';
        authPill.innerText = 'Online';
        authPill.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
        unauthBox?.classList.add('hidden');
        authBox?.classList.remove('hidden');
        if (userEmailSpan) userEmailSpan.innerText = authUser.email;
    } else {
        statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 inline-block';
        statusText.innerText = 'Guest Mode (Local System)';
        statusText.className = 'text-slate-600 font-semibold';
        authPill.innerText = 'Local System';
        authPill.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800';
        unauthBox?.classList.remove('hidden');
        authBox?.classList.add('hidden');
    }

    document.getElementById('account-hub-modal')?.classList.remove('hidden');
    safeCreateIcons();
};

window.closeAccountHubModal = function() {
    document.getElementById('account-hub-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.saveAccountHubStoreProfile = function() {
    const name = document.getElementById('hub-store-name')?.value.trim() || 'Digital Pharma';
    const phone = document.getElementById('hub-store-phone')?.value.trim() || '';
    const address = document.getElementById('hub-store-address')?.value.trim() || '';
    const licenseNo = document.getElementById('hub-store-license')?.value.trim() || 'DSL-PB-2024-8901';

    const config = { name, phone, address, licenseNo };
    localStorage.setItem('sm_store_config', JSON.stringify(config));
    window.applyStoreIdentity();
    showToast('Store settings save ho gayin!', 'success');
};

window.handleHubLogin = async function() {
    const email = document.getElementById('hub-email')?.value.trim();
    const password = document.getElementById('hub-password')?.value.trim();
    if (!email || !password) {
        showToast('Email aur password enter karein!', 'error');
        return;
    }
    if (!auth || !fbAuthMod) {
        showToast('Local system active hai.', 'info');
        return;
    }
    try {
        await fbAuthMod.signInWithEmailAndPassword(auth, email, password);
        showToast('Login kamyab raha!', 'success');
        window.openAccountHubModal();
    } catch (err) {
        showToast(err.message || 'Login fail ho gaya.', 'error');
    }
};

window.handleHubSignUp = async function() {
    const email = document.getElementById('hub-email')?.value.trim();
    const password = document.getElementById('hub-password')?.value.trim();
    if (!email || !password) {
        showToast('Email aur password enter karein!', 'error');
        return;
    }
    if (!auth || !fbAuthMod) {
        showToast('Local system active hai.', 'info');
        return;
    }
    try {
        await fbAuthMod.createUserWithEmailAndPassword(auth, email, password);
        window.saveAccountHubStoreProfile();
        showToast('Account ban gaya!', 'success');
        window.openAccountHubModal();
    } catch (err) {
        showToast(err.message || 'Registration fail ho gayi.', 'error');
    }
};

window.handleHubLogout = async function() {
    if (auth && fbAuthMod) {
        try {
            await fbAuthMod.signOut(auth);
            showToast('Guest mode par wapis aa gaye hain.', 'info');
        } catch(e) {}
    }
    window.openAccountHubModal();
};

function initApp() {
    try {
        const savedMeds = localStorage.getItem('sm_medicines');
        if (savedMeds) medicines = JSON.parse(savedMeds);
        const savedSales = localStorage.getItem('sm_sales');
        if (savedSales) sales = JSON.parse(savedSales);
    } catch(e) {}

    if (medicines.length === 0) {
        medicines = [
            { id: 'med_1', name: 'Panadol 500mg', generic: 'Paracetamol', distributor: 'GSK Pakistan', packSize: '200', batch: 'B-849', expiry: '2027-11-20', buyRate: 480, mrp: 540, stock: 25, location: 'Rack A-1', minStock: 5 },
            { id: 'med_2', name: 'Augmentin 625mg', generic: 'Co-Amoxiclav', distributor: 'GSK Pakistan', packSize: '2x7', batch: 'AUG-11', expiry: '2026-12-15', buyRate: 310, mrp: 360, stock: 8, location: 'Rack B-2', minStock: 5 },
            { id: 'med_3', name: 'Brufen 400mg', generic: 'Ibuprofen', distributor: 'Abbott Lab', packSize: '10x10', batch: 'BF-309', expiry: '2027-04-10', buyRate: 260, mrp: 300, stock: 15, location: 'Rack A-3', minStock: 5 },
            { id: 'med_4', name: 'Risek 20mg Cap', generic: 'Omeprazole', distributor: 'Getz Pharma', packSize: '2x7', batch: 'RK-77', expiry: '2026-10-30', buyRate: 240, mrp: 285, stock: 4, location: 'Rack C-1', minStock: 5 }
        ];
        localStorage.setItem('sm_medicines', JSON.stringify(medicines));
    } else {
        let changed = false;
        medicines.forEach(m => {
            if (!m.location) { m.location = 'Rack A-1'; changed = true; }
            if (m.minStock === undefined) { m.minStock = 5; changed = true; }
        });
        if (changed) localStorage.setItem('sm_medicines', JSON.stringify(medicines));
    }

    setupDynamicPwaManifest();
    updateInstallUiState();
    window.applyStoreIdentity();
    renderDashboardMetrics();
    renderInventoryTable();
    window.populateLooseStockSelector();
    window.runMarginCalc();
    window.runLooseCalc();
    safeCreateIcons();
    syncModalScrollLock();
    initFirebaseLazy();
}

// Instant startup without waiting for full window.load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
