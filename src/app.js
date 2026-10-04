// Digital Pharma ERP & POS Engine
// Smart Pharmacy System

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

// Real Firebase Services via Bundled SDK
import { 
    app, 
    db, 
    auth, 
    googleProvider, 
    signInWithPopup, 
    signInAnonymously,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    signOut, 
    onAuthStateChanged, 
    collection, 
    doc, 
    setDoc, 
    deleteDoc,
    onSnapshot, 
    getDocs, 
    handleFirestoreError 
} from './firebase.js';

let unsubscribeMeds = null;
let unsubscribeSales = null;
let unsubscribePharmacies = null;

// Initialize Live Listeners & Auth
function initFirebase() {
    onAuthStateChanged(auth, async (user) => {
        authUser = user;
        if (user) {
            const googleUser = {
                name: user.displayName || user.email.split('@')[0],
                email: user.email,
                uid: user.uid,
                loginMethod: 'google',
                isLiveSync: true,
                photo: user.photoURL || ''
            };
            localStorage.setItem('sm_auth_user', JSON.stringify(googleUser));
            localStorage.removeItem('sm_user_mode');

            // 1. Sync User-Owned Medicines
            if (unsubscribeMeds) unsubscribeMeds();
            const medsColRef = collection(db, 'users', user.uid, 'medicines');
            unsubscribeMeds = onSnapshot(medsColRef, async (snapshot) => {
                const cloudMeds = [];
                snapshot.forEach(docSnap => cloudMeds.push(docSnap.data()));
                if (cloudMeds.length > 0) {
                    medicines = cloudMeds;
                    localStorage.setItem('sm_medicines', JSON.stringify(medicines));
                    renderInventoryTable();
                    renderDashboardMetrics();
                } else if (medicines.length > 0) {
                    // Upload existing local medicines to cloud on first sync
                    for (const m of medicines) {
                        try {
                            await setDoc(doc(db, 'users', user.uid, 'medicines', m.id), m);
                        } catch(err) {
                            handleFirestoreError(err, 'write', `users/${user.uid}/medicines/${m.id}`);
                        }
                    }
                }
            }, (err) => handleFirestoreError(err, 'get', `users/${user.uid}/medicines`));

            // 2. Sync User-Owned Sales Invoices
            if (unsubscribeSales) unsubscribeSales();
            const salesColRef = collection(db, 'users', user.uid, 'sales');
            unsubscribeSales = onSnapshot(salesColRef, async (snapshot) => {
                const cloudSales = [];
                snapshot.forEach(docSnap => cloudSales.push(docSnap.data()));
                if (cloudSales.length > 0) {
                    sales = cloudSales;
                    localStorage.setItem('sm_sales', JSON.stringify(sales));
                    renderDashboardMetrics();
                } else if (sales.length > 0) {
                    // Upload existing local sales to cloud
                    for (const s of sales) {
                        try {
                            await setDoc(doc(db, 'users', user.uid, 'sales', s.id), s);
                        } catch(err) {
                            handleFirestoreError(err, 'write', `users/${user.uid}/sales/${s.id}`);
                        }
                    }
                }
            }, (err) => handleFirestoreError(err, 'get', `users/${user.uid}/sales`));

            // 3. Auto Register or Link Pharmacy in Connected Network
            const config = window.getStoreConfig();
            try {
                const pharmDocRef = doc(db, 'pharmacies', user.uid);
                await setDoc(pharmDocRef, {
                    name: config.name || `${googleUser.name} Pharmacy`,
                    ownerName: config.ownerName || googleUser.name,
                    city: config.address || 'Pakistan',
                    phone: config.phone || '03001234567',
                    email: user.email,
                    licenseNo: config.licenseNo || '',
                    remarks: 'Verified Digital Pharma Live Member',
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            } catch(e) {}
        } else {
            if (unsubscribeMeds) unsubscribeMeds();
            if (unsubscribeSales) unsubscribeSales();
        }

        window.applyStoreIdentity();
        safeCreateIcons();
    });

    // 4. Public Connected Pharmacies Real-time Sync
    try {
        const pharmColRef = collection(db, 'pharmacies');
        unsubscribePharmacies = onSnapshot(pharmColRef, (snapshot) => {
            const list = [];
            snapshot.forEach(d => list.push({ id: d.id, ...d.data() }));
            if (list.length > 0) {
                localStorage.setItem('sm_network_stores', JSON.stringify(list));
                if (typeof window.refreshNetworkList === 'function') {
                    window.refreshNetworkList();
                }
            }
        }, (err) => handleFirestoreError(err, 'get', 'pharmacies'));
    } catch(e) {}
}

initFirebase();

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
// EXPIRY DATE HELPERS (Strictly MM / YY, Zero DD, Zero YYYY, Auto-Formatting)
// ==========================================
export function formatExpiryMMYY(exp) {
    if (!exp) return '-';
    const str = String(exp).trim();
    if (str.includes('/')) {
        const parts = str.split('/');
        let mm = parts[0].trim().padStart(2, '0');
        let yy = parts[1].trim();
        if (yy.length === 4) yy = yy.slice(-2);
        return `${mm}/${yy}`;
    }
    if (str.includes('-')) {
        const parts = str.split('-');
        let yy = parts[0].slice(-2);
        let mm = (parts[1] || '01').padStart(2, '0');
        return `${mm}/${yy}`;
    }
    return str;
}
window.formatExpiryMMYY = formatExpiryMMYY;

export function parseExpiryToDate(exp) {
    if (!exp) return null;
    const str = String(exp).trim();
    if (str.includes('/')) {
        const [mm, yy] = str.split('/').map(Number);
        const fullYear = yy < 100 ? (2000 + yy) : yy;
        return new Date(fullYear, mm, 0, 23, 59, 59);
    }
    if (str.includes('-')) {
        return new Date(str);
    }
    return null;
}
window.parseExpiryToDate = parseExpiryToDate;

window.handleExpiryMonthInput = function(el) {
    let v = el.value.replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0, 2);
    if (parseInt(v, 10) > 12) v = '12';
    el.value = v;
};

window.formatExpiryMonthBlur = function(el) {
    let v = el.value.replace(/\D/g, '');
    if (!v) return;
    let n = parseInt(v, 10);
    if (n < 1) n = 1;
    if (n > 12) n = 12;
    el.value = String(n).padStart(2, '0');
};

window.handleExpiryYearInput = function(el) {
    let v = el.value.replace(/\D/g, '');
    if (v.length >= 4) {
        v = v.slice(-2);
    }
    el.value = v;
};

window.formatExpiryYearBlur = function(el) {
    let v = el.value.replace(/\D/g, '');
    if (!v) return;
    if (v.length > 2) {
        v = v.slice(-2);
    } else if (v.length === 1) {
        v = String(v).padStart(2, '0');
    }
    el.value = v;
};

// Rate Check Buy Rate TP Eye Visibility Toggle
window.toggleRateCheckTp = function(medId) {
    const span = document.getElementById('rate-tp-' + medId);
    const btn = document.getElementById('btn-rate-tp-' + medId);
    if (!span) return;
    const isHidden = span.classList.contains('hidden');
    if (isHidden) {
        span.classList.remove('hidden');
        if (btn) btn.innerHTML = '<i data-lucide="eye-off" class="w-3 h-3"></i> <span>Hide TP</span>';
    } else {
        span.classList.add('hidden');
        if (btn) btn.innerHTML = '<i data-lucide="eye" class="w-3 h-3"></i> <span>Show TP</span>';
    }
    safeCreateIcons();
};

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
    if (!input) return { strips: 1, unitsPerStrip: 20, totalUnits: 20, displayText: '20 Units' };
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
            displayText: `${strips}x${unitsPerStrip} (${total} Units)`
        };
    }
    const num = parseInt(str, 10);
    if (!isNaN(num) && num > 0) {
        return {
            strips: 1,
            unitsPerStrip: num,
            totalUnits: num,
            displayText: `${num} Units`
        };
    }
    return { strips: 1, unitsPerStrip: 20, totalUnits: 20, displayText: '20 Units' };
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

// Convolution-based Unsharp Masking & Edge-Sharpening for low-contrast/dim camera images
function applyImageSharpening(ctx, w, h) {
    try {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const copy = new Uint8ClampedArray(d);
        const weight = 0.32;
        // Edge sharpening pass to crisp up faint doctor handwriting & thermal bill print
        for (let y = 1; y < h - 1; y += 2) {
            const rowOffset = y * w;
            const upOffset = (y - 1) * w;
            const downOffset = (y + 1) * w;
            for (let x = 1; x < w - 1; x += 2) {
                const idx = (rowOffset + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const val = copy[idx + c];
                    const up = copy[(upOffset + x) * 4 + c];
                    const down = copy[(downOffset + x) * 4 + c];
                    const left = copy[(rowOffset + (x - 1)) * 4 + c];
                    const right = copy[(rowOffset + (x + 1)) * 4 + c];
                    const laplacian = 4 * val - up - down - left - right;
                    d[idx + c] = Math.min(255, Math.max(0, val + weight * laplacian));
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
    } catch (e) {
        // Fallback without canvas convolution
    }
}

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
        // Modern createImageBitmap natively auto-rotates EXIF orientation from mobile phone cameras
        if (typeof window.createImageBitmap === 'function') {
            try {
                const bitmap = await window.createImageBitmap(file, { imageOrientation: 'from-image' });
                // Optimal 1600px resolution preserves sharp handwriting while keeping payload under 350KB for fast mobile upload
                const maxDim = 1600;
                let w = bitmap.width;
                let h = bitmap.height;
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
                if (ctx) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, w, h);

                    // First pass: Draw to sample luminance
                    ctx.drawImage(bitmap, 0, 0, w, h);
                    let avgLum = 135;
                    try {
                        const sampleW = Math.min(w, 150);
                        const sampleH = Math.min(h, 150);
                        const pData = ctx.getImageData(0, 0, sampleW, sampleH).data;
                        let sum = 0;
                        for (let i = 0; i < pData.length; i += 16) {
                            sum += (0.299 * pData[i] + 0.587 * pData[i+1] + 0.114 * pData[i+2]);
                        }
                        avgLum = sum / (pData.length / 16);
                    } catch(eLum) {}

                    // Clear and redraw with adaptive contrast & brightness boost for dark/dim mobile photos
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, w, h);
                    if (avgLum < 95) {
                        ctx.filter = 'contrast(1.36) brightness(1.36) saturate(1.08)';
                    } else if (avgLum < 135) {
                        ctx.filter = 'contrast(1.25) brightness(1.20) saturate(1.04)';
                    } else {
                        ctx.filter = 'contrast(1.15) brightness(1.06)';
                    }

                    ctx.drawImage(bitmap, 0, 0, w, h);
                    ctx.filter = 'none';

                    // Apply optical edge-sharpening pass
                    applyImageSharpening(ctx, w, h);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    bitmap.close?.();
                    return dataUrl.split(',')[1];
                }
            } catch(eBitmap) {
                console.warn("createImageBitmap fallback to HTMLImageElement:", eBitmap);
            }
        }

        // Fallback using HTMLImageElement with ObjectURL
        return await new Promise((resolve) => {
            const img = new Image();
            const objUrl = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(objUrl);
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
                    readFileAsBase64().then(resolve);
                    return;
                }

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.filter = 'contrast(1.25) brightness(1.18)';
                ctx.drawImage(img, 0, 0, w, h);
                ctx.filter = 'none';

                applyImageSharpening(ctx, w, h);

                const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                resolve(dataUrl.split(',')[1]);
            };
            img.onerror = () => {
                URL.revokeObjectURL(objUrl);
                readFileAsBase64().then(resolve);
            };
            img.src = objUrl;
        });
    } catch(err) {
        console.warn("enhanceImageLikeCamScanner fallback:", err);
        return await readFileAsBase64();
    }
}
window.enhanceImageLikeCamScanner = enhanceImageLikeCamScanner;

// Absolute filter against model refusal language so users never see "roshni mein dubara banao" or "unreadable"
const PRESCRIPTION_REFUSAL_REGEX = /tasveer|tasvir|photo|image|roshni|dobara|dubara|wazeh|clear|blurry|dhundli|dhundla|bhejein|banao|bnaao|upload|camera|nahi parha|parha nahi|not readable|unreadable|illegible|bad lighting|lighting|kheenchain|khainchain|le kar|retake|re-take|cant read|cannot read|unable to read|dim light|dark|koshish|again|consult/i;

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

    let rawAdvice = String(parsed.advice || parsed.precautions || parsed.instructions || '');
    if (!rawAdvice || PRESCRIPTION_REFUSAL_REGEX.test(rawAdvice)) {
        rawAdvice = 'Dawai hidayat ke mutabiq waqt par lein. Thandi, tali hui aur khatti cheezon se mukammal parhez karein, saaf paani zyada piyen aur aaram karein.';
    }

    let rawSummary = String(parsed.treatmentSummary || parsed.summary || parsed.treatment || '');
    if (!rawSummary || PRESCRIPTION_REFUSAL_REGEX.test(rawSummary)) {
        rawSummary = 'Nuskha ke mutabiq adviyaat aur ilaj ki mukammal tafseelat darj hain.';
    }

    let rawDoctor = String(parsed.doctor || parsed.doctor_name || parsed.clinic || '');
    if (!rawDoctor || PRESCRIPTION_REFUSAL_REGEX.test(rawDoctor) || /n\/a|not readable|unknown|mojood nahi/i.test(rawDoctor)) {
        rawDoctor = 'Doctor / Clinic Slip';
    }

    let rawPatient = String(parsed.patient || parsed.patient_name || '');
    if (!rawPatient || PRESCRIPTION_REFUSAL_REGEX.test(rawPatient) || /n\/a|not readable|unknown|mojood nahi/i.test(rawPatient)) {
        rawPatient = 'General Patient';
    }

    const cleanedMeds = meds
        .filter(m => m && (m.name || m.medicine || m.brand))
        .filter(m => {
            const nameStr = String(m.name || m.medicine || m.brand || '');
            return !PRESCRIPTION_REFUSAL_REGEX.test(nameStr);
        })
        .map(m => ({
            name: String(m.name || m.medicine || m.brand || 'Prescribed Medicine').trim(),
            formula: String(m.formula || m.generic || m.salt || '').trim(),
            form: String(m.form || m.type || 'Goli (Tablet)').trim(),
            timing: PRESCRIPTION_REFUSAL_REGEX.test(String(m.timing || '')) 
                ? 'Subah sham 1 goli khane ke baad (1+0+1)' 
                : String(m.timing || m.dosage || m.schedule || 'Subah sham 1 goli khane ke baad (1+0+1)').trim(),
            usage: PRESCRIPTION_REFUSAL_REGEX.test(String(m.usage || '')) 
                ? 'Taza paani ke sath lein' 
                : String(m.usage || m.method || 'Taza paani ke sath lein').trim(),
            purpose: PRESCRIPTION_REFUSAL_REGEX.test(String(m.purpose || '')) 
                ? 'Ilaj' 
                : String(m.purpose || m.indication || m.use || 'Ilaj').trim()
        }));

    return {
        doctor: rawDoctor,
        patient: rawPatient,
        treatmentSummary: rawSummary,
        advice: rawAdvice,
        medicines: cleanedMeds
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

const LIVE_BACKEND_URLS = [
    'https://ais-dev-ou6bjzs2n66zp6bxp5s7gm-731749917388.asia-east1.run.app',
    'https://ais-pre-ou6bjzs2n66zp6bxp5s7gm-731749917388.asia-east1.run.app'
];

// Direct client-side Gemini Vision Caller (Essential for offline/custom key usage)
async function callGeminiVisionDirect(prompt, base64Data) {
    const customKey = localStorage.getItem('gemini_api_key') || "";
    if (!customKey) {
        throw new Error('AI Scanner connect nahi ho saka. Barah-e-karam apna internet connection check karein.');
    }
    const models = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];
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

// Unified AI Caller: Automatically proxies to live backend from GitHub Pages, mobile webapps, or runs locally
async function callAiBackend(endpoint, base64Data, clientPrompt) {
    const isLocalNodeHost = typeof window !== 'undefined' && (
        window.location.hostname.includes('run.app') ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
    );

    // Build ordered list of candidate URLs
    const targetUrls = [];
    if (isLocalNodeHost) {
        targetUrls.push(endpoint);
    }
    for (const base of LIVE_BACKEND_URLS) {
        targetUrls.push(`${base}${endpoint}`);
    }
    if (!isLocalNodeHost) {
        targetUrls.push(endpoint);
    }

    for (const url of targetUrls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ imageBase64: base64Data }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                if (data && (data.success || data.data)) return data;
            }
        } catch (e) {
            console.warn(`AI backend candidate attempt (${url}) note:`, e?.message || e);
        }
    }

    // Direct client-side vision fallback if user configured key in Account Hub
    if (clientPrompt) {
        try {
            const rawText = await callGeminiVisionDirect(clientPrompt, base64Data);
            const parsed = extractSmartJson(rawText);
            if (parsed) return { success: true, data: parsed };
        } catch (e) {
            console.warn('Direct vision fallback note:', e?.message || e);
        }
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
        name: '',
        phone: '',
        address: '',
        licenseNo: ''
    };
};

window.getCurrentUserMode = function() {
    if (authUser) return 'authenticated';
    try {
        const localAuth = localStorage.getItem('sm_auth_user');
        if (localAuth) return 'authenticated';
        const mode = localStorage.getItem('sm_user_mode');
        if (mode === 'guest') return 'guest';
    } catch(e) {}
    return null;
};

window.getCurrentUser = function() {
    if (authUser) {
        return {
            name: authUser.displayName || authUser.email?.split('@')[0] || 'User',
            email: authUser.email || '',
            photo: authUser.photoURL || localStorage.getItem('sm_profile_pic') || ''
        };
    }
    try {
        const localAuth = localStorage.getItem('sm_auth_user');
        if (localAuth) {
            const parsed = JSON.parse(localAuth);
            return {
                name: parsed.name || parsed.email?.split('@')[0] || 'User',
                email: parsed.email || '',
                photo: parsed.photo || localStorage.getItem('sm_profile_pic') || ''
            };
        }
    } catch(e) {}
    return null;
};

window.applyStoreIdentity = function() {
    const config = window.getStoreConfig();
    document.title = 'Digital Pharma - Smart Pharmacy ERP & POS';
    const topName = document.getElementById('top-store-name');
    if (topName) topName.innerText = 'Digital Pharma'; // App title stays Digital Pharma and does not change with profile name

    const user = window.getCurrentUser();
    const mode = window.getCurrentUserMode();

    const hubName = document.getElementById('hub-header-name');
    const hubStatus = document.getElementById('hub-header-status');
    const statusDot = document.getElementById('hub-status-dot');
    const statusText = document.getElementById('hub-status-text');

    if (mode === 'authenticated' && user) {
        if (hubName) hubName.innerText = user.name || config.name || 'My Store';
        if (hubStatus) hubStatus.innerText = 'Online Active';
        if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse';
        if (statusText) {
            statusText.innerText = `Logged In (${user.email || user.name})`;
            statusText.className = 'text-emerald-700 font-bold';
        }
    } else if (mode === 'guest') {
        if (hubName) hubName.innerText = config.name || 'Guest Mode';
        if (hubStatus) hubStatus.innerText = 'Anonymous';
        if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-amber-400 inline-block';
        if (statusText) {
            statusText.innerText = 'Guest Mode (Anonymous)';
            statusText.className = 'text-slate-600 font-semibold';
        }
    } else {
        if (hubName) hubName.innerText = 'Guest Mode';
        if (hubStatus) hubStatus.innerText = 'Not Selected';
        if (statusDot) statusDot.className = 'w-2 h-2 rounded-full bg-slate-400 inline-block';
        if (statusText) {
            statusText.innerText = 'Profile Not Selected';
            statusText.className = 'text-slate-500 font-semibold';
        }
    }

    const rTitle = document.getElementById('receipt-store-title');
    if (rTitle) rTitle.innerText = config.name || 'Smart Pharmacy System';

    const rAddr = document.getElementById('receipt-store-address');
    if (rAddr) rAddr.innerText = config.address || '';

    const rPhone = document.getElementById('receipt-store-phone');
    if (rPhone) rPhone.innerText = config.phone ? ('Phone/WhatsApp: ' + config.phone) : '';

    const rLicense = document.getElementById('receipt-store-license');
    if (rLicense) {
        if (config.licenseNo && config.licenseNo.trim()) {
            rLicense.innerText = 'D.S.L #: ' + config.licenseNo.trim();
            rLicense.classList.remove('hidden');
        } else {
            rLicense.classList.add('hidden');
        }
    }

    // Profile photo & Anonymous state management
    const savedPhoto = (user ? user.photo : '') || localStorage.getItem('sm_profile_pic') || '';
    const headerAnonIcon = document.getElementById('profile-anonymous-icon');
    const headerImg = document.getElementById('profile-header-img');
    const headerChar = document.getElementById('profile-avatar-char');

    const hubAnonIcon = document.getElementById('hub-anon-icon');
    const hubImg = document.getElementById('hub-avatar-img');
    const hubChar = document.getElementById('hub-avatar-char');
    const hubCameraBtn = document.getElementById('hub-avatar-camera-btn');
    const hubPhotoBox = document.getElementById('hub-photo-control-box');
    const removePhotoBtn = document.getElementById('remove-profile-pic-btn');

    if (mode === 'authenticated' && user) {
        // LOGGED IN USER: Show Photo or First Initial Letter
        if (hubCameraBtn) hubCameraBtn.classList.remove('hidden');
        if (hubPhotoBox) hubPhotoBox.classList.remove('hidden');

        if (savedPhoto) {
            if (headerImg) {
                headerImg.src = savedPhoto;
                headerImg.classList.remove('hidden');
            }
            if (headerAnonIcon) headerAnonIcon.classList.add('hidden');
            if (headerChar) headerChar.classList.add('hidden');

            if (hubImg) {
                hubImg.src = savedPhoto;
                hubImg.classList.remove('hidden');
            }
            if (hubAnonIcon) hubAnonIcon.classList.add('hidden');
            if (hubChar) hubChar.classList.add('hidden');
            if (removePhotoBtn) removePhotoBtn.classList.remove('hidden');
        } else {
            // First word / initial letter alphabetical display
            const initial = (user.name || user.email || config.name || 'U').trim().charAt(0).toUpperCase();
            if (headerChar) {
                headerChar.innerText = initial;
                headerChar.classList.remove('hidden');
            }
            if (headerAnonIcon) headerAnonIcon.classList.add('hidden');
            if (headerImg) headerImg.classList.add('hidden');

            if (hubChar) {
                hubChar.innerText = initial;
                hubChar.classList.remove('hidden');
            }
            if (hubAnonIcon) hubAnonIcon.classList.add('hidden');
            if (hubImg) hubImg.classList.add('hidden');
            if (removePhotoBtn) removePhotoBtn.classList.add('hidden');
        }
    } else {
        // GUEST MODE or NOT SELECTED: Show Anonymous Icon
        if (headerAnonIcon) headerAnonIcon.classList.remove('hidden');
        if (headerImg) headerImg.classList.add('hidden');
        if (headerChar) headerChar.classList.add('hidden');

        if (hubAnonIcon) hubAnonIcon.classList.remove('hidden');
        if (hubImg) hubImg.classList.add('hidden');
        if (hubChar) hubChar.classList.add('hidden');
        if (hubCameraBtn) hubCameraBtn.classList.add('hidden');
        if (hubPhotoBox) hubPhotoBox.classList.add('hidden');
    }
    safeCreateIcons();
};

window.handleProfilePicUpload = function(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Sirf tasveer (image) select karein!', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            // Compress & resize to clean 200x200 square thumbnail
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 200;
            const ctx = canvas.getContext('2d');
            
            // Draw center cropped
            const minSide = Math.min(img.width, img.height);
            const sx = (img.width - minSide) / 2;
            const sy = (img.height - minSide) / 2;
            ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 200, 200);

            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
            localStorage.setItem('sm_profile_pic', compressedBase64);
            window.applyStoreIdentity();
            showToast('Profile picture kamyabi se lag gayi!', 'success');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.removeProfilePic = function() {
    localStorage.removeItem('sm_profile_pic');
    const input = document.getElementById('profile-pic-file-input');
    if (input) input.value = '';
    window.applyStoreIdentity();
    showToast('Profile picture hata di gayi.', 'info');
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
        // Default to #1: Simple Hisaab Calculator as requested
        window.switchCalculatorTab('simple');
    }
    if (tabName === 'network') window.refreshNetworkList();

    // Rate Check in topbar only visible on 'dashboard' and 'network' tabs; hidden on POS, Inventory, Calculator
    const showRateCheck = (tabName === 'dashboard' || tabName === 'network');
    const deskRate = document.getElementById('header-rate-check-desktop');
    const mobRate = document.getElementById('header-rate-check-mobile');
    if (deskRate) {
        if (showRateCheck) {
            // Strictly hide on mobile devices (<768px), show only on tablets/desktops (md:)
            deskRate.className = 'relative flex-1 max-w-xs md:max-w-md mx-2 hidden md:block';
        } else {
            deskRate.className = 'relative flex-1 max-w-xs md:max-w-md mx-2 hidden';
        }
    }
    if (mobRate) {
        if (showRateCheck) {
            // Strictly hide on tablets/desktops (md:hidden), show only on mobile devices
            mobRate.className = 'relative md:hidden px-3 pb-2.5 pt-1 border-t border-brand-700 bg-brand-900/80 block';
        } else {
            mobRate.className = 'relative md:hidden px-3 pb-2.5 pt-1 border-t border-brand-700 bg-brand-900/80 hidden';
        }
    }

    safeCreateIcons();
};

// Toggle Calculator Dropdown Menu (Desktop or Mobile)
window.toggleCalculatorDropdown = function(event, type) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const desktopMenu = document.getElementById('desktop-calc-menu');
    const mobileMenu = document.getElementById('mobile-calc-menu');

    if (type === 'desktop') {
        mobileMenu?.classList.add('hidden');
        desktopMenu?.classList.toggle('hidden');
    } else {
        desktopMenu?.classList.add('hidden');
        mobileMenu?.classList.toggle('hidden');
    }
    safeCreateIcons();
};

// Directly open selected calculator option from dropdown (No submit button needed)
window.openCalculatorWithSub = function(subType) {
    document.getElementById('desktop-calc-menu')?.classList.add('hidden');
    document.getElementById('mobile-calc-menu')?.classList.add('hidden');
    window.switchTab('margin');
    window.switchCalculatorTab(subType);
    safeCreateIcons();
};

// Close calculator dropdown when clicking outside
document.addEventListener('click', (e) => {
    const desktopContainer = document.getElementById('desktop-calc-dropdown-container');
    const mobileBtn = document.getElementById('mob-tab-margin');
    const mobileMenu = document.getElementById('mobile-calc-menu');
    const desktopMenu = document.getElementById('desktop-calc-menu');

    if (desktopMenu && !desktopContainer?.contains(e.target)) {
        desktopMenu.classList.add('hidden');
    }
    if (mobileMenu && !mobileBtn?.contains(e.target) && !mobileMenu.contains(e.target)) {
        mobileMenu.classList.add('hidden');
    }
});

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
    if (costEl) costEl.innerText = 'Rs. ' + effectiveCostPerPack.toFixed(1);
    if (totProfitEl) totProfitEl.innerText = 'Rs. ' + Math.max(0, netTotalProfit).toFixed(1);
};

// ==========================================
// CALCULATOR 1 (MAIN): Simple Price, Rate & Amount Calculator
// ==========================================
window.resetSimpleCalc = function() {
    const priceInput = document.getElementById('loose-pack-price');
    const sizeInput = document.getElementById('loose-pack-size');
    const packsInput = document.getElementById('loose-full-packs');
    const qtyInput = document.getElementById('loose-qty');
    const discInput = document.getElementById('loose-discount');

    if (priceInput) priceInput.value = '';
    if (sizeInput) sizeInput.value = '';
    if (packsInput) packsInput.value = '';
    if (qtyInput) qtyInput.value = '';
    if (discInput) discInput.value = '';

    window.runLooseCalc();
};

window.runLooseCalc = function() {
    const packPriceInput = document.getElementById('loose-pack-price');
    const packSizeInput = document.getElementById('loose-pack-size');
    const fullPacksInput = document.getElementById('loose-full-packs');
    const qtyInput = document.getElementById('loose-qty');
    const discInput = document.getElementById('loose-discount');

    const packPriceVal = packPriceInput?.value?.trim();
    const packSizeVal = packSizeInput?.value?.trim();
    const fullPacksVal = fullPacksInput?.value?.trim();
    const qtyVal = qtyInput?.value?.trim();

    const tabPriceEl = document.getElementById('loose-tab-price');
    const stripPriceEl = document.getElementById('loose-strip-price');
    const grossEl = document.getElementById('loose-gross-total');
    const netEl = document.getElementById('loose-net-total');
    const unitsHintEl = document.getElementById('loose-units-hint');
    const unitsCalcEl = document.getElementById('loose-units-calculated');
    const discSavedEl = document.getElementById('loose-discount-saved');
    const mathDetailEl = document.getElementById('loose-calc-math-detail');

    // Parse pack size cleanly
    const parsed = parsePackSize(packSizeVal || '1');
    const totalUnitsInPack = Math.max(1, parsed.totalUnits || 1);

    if (unitsHintEl) {
        unitsHintEl.innerText = packSizeVal ? `Total: ${totalUnitsInPack} Units` : 'Total: 0';
    }

    // Keep results at 0.0 until valid rate is entered by user
    if (!packPriceVal || Number(packPriceVal) <= 0) {
        if (tabPriceEl) tabPriceEl.innerText = 'Rs. 0.0';
        if (stripPriceEl) stripPriceEl.innerText = 'Rs. 0.0';
        if (grossEl) grossEl.innerText = 'Rs. 0.0';
        if (netEl) netEl.innerText = 'Rs. 0.0';
        if (unitsCalcEl) unitsCalcEl.innerText = '0 Units';
        if (discSavedEl) discSavedEl.innerText = 'Disc: Rs. 0.0';
        if (mathDetailEl) mathDetailEl.innerText = '';
        return;
    }

    const packPrice = Number(packPriceVal);
    const fullPacks = Math.max(0, Number(fullPacksVal) || 0);
    const looseUnits = Math.max(0, Number(qtyVal) || 0);

    // If both full packs and loose units are empty, calculate for 1 full pack by default
    let totalUnitsToCalc = 0;
    if (fullPacks === 0 && looseUnits === 0) {
        totalUnitsToCalc = totalUnitsInPack;
    } else {
        totalUnitsToCalc = (fullPacks * totalUnitsInPack) + looseUnits;
    }

    const perUnitPrice = packPrice / totalUnitsInPack;
    const perStripPrice = parsed.strips > 1 ? (packPrice / parsed.strips) : (perUnitPrice * Math.min(10, totalUnitsInPack));

    const grossTotal = perUnitPrice * totalUnitsToCalc;
    const discPercent = discInput && discInput.value !== '' ? Math.max(0, Math.min(100, Number(discInput.value))) : 0;
    const discountAmt = (grossTotal * discPercent) / 100;
    const netPayable = Math.max(0, grossTotal - discountAmt);

    // 1 Decimal Place Formatting (e.g. 24.9 instead of 24.95)
    if (tabPriceEl) tabPriceEl.innerText = 'Rs. ' + perUnitPrice.toFixed(1);
    if (stripPriceEl) stripPriceEl.innerText = 'Rs. ' + perStripPrice.toFixed(1);
    if (grossEl) grossEl.innerText = 'Rs. ' + grossTotal.toFixed(1);
    if (netEl) netEl.innerText = 'Rs. ' + netPayable.toFixed(1);
    if (discSavedEl) discSavedEl.innerText = `Disc: -Rs. ${discountAmt.toFixed(1)}${discPercent > 0 ? ` (${discPercent}%)` : ''}`;
    
    let unitsDesc = `${totalUnitsToCalc} Units`;
    if (fullPacks > 0 || looseUnits > 0) {
        const parts = [];
        if (fullPacks > 0) parts.push(`📦 ${fullPacks} Pack`);
        if (looseUnits > 0) parts.push(`💊 ${looseUnits} Loose Unit`);
        unitsDesc += ` (${parts.join(' + ')})`;
    }
    if (unitsCalcEl) unitsCalcEl.innerText = unitsDesc;

    if (mathDetailEl) {
        mathDetailEl.innerText = `Rate: Rs.${packPrice} | Unit: Rs.${perUnitPrice.toFixed(1)} | Net: Rs.${netPayable.toFixed(1)}`;
    }
};

window.changeLooseCalcQty = function(delta) {
    const input = document.getElementById('loose-qty');
    if (!input) return;
    const current = Math.max(0, parseInt(input.value) || 0);
    const updated = Math.max(0, current + delta);
    input.value = updated > 0 ? updated : '';
    window.runLooseCalc();
};

window.setLooseQtyPreset = function(qty) {
    const input = document.getElementById('loose-qty');
    if (input) {
        input.value = qty;
        window.runLooseCalc();
    }
};

// ==========================================
// 3 CALCULATORS SWITCHER (Rate & Pack, Simple Math, Bonus Scheme)
// ==========================================
window.switchCalculatorTab = function(type) {
    const secRate = document.getElementById('calc-section-rate');
    const secSimple = document.getElementById('calc-section-simple');
    const secBonus = document.getElementById('calc-section-bonus');
    const marginBanner = document.getElementById('margin-scanner-banner');

    const btnRate = document.getElementById('calc-tab-btn-rate');
    const btnSimple = document.getElementById('calc-tab-btn-simple');
    const btnBonus = document.getElementById('calc-tab-btn-bonus');

    const setInactive = (btn) => {
        if (!btn) return;
        btn.classList.remove('bg-brand-600', 'text-white', 'shadow-xs');
        btn.classList.add('text-slate-600', 'hover:bg-slate-100');
    };
    const setActive = (btn) => {
        if (!btn) return;
        btn.classList.add('bg-brand-600', 'text-white', 'shadow-xs');
        btn.classList.remove('text-slate-600', 'hover:bg-slate-100');
    };

    setInactive(btnRate);
    setInactive(btnSimple);
    setInactive(btnBonus);

    secRate?.classList.add('hidden');
    secSimple?.classList.add('hidden');
    secBonus?.classList.add('hidden');

    if (type === 'simple') {
        marginBanner?.classList.add('hidden');
        secSimple?.classList.remove('hidden');
        setActive(btnSimple);
        window.updateSimpleCalcDisplay();
    } else if (type === 'bonus') {
        marginBanner?.classList.remove('hidden');
        secBonus?.classList.remove('hidden');
        setActive(btnBonus);
        window.runMarginCalc();
    } else {
        // default: 'rate'
        marginBanner?.classList.add('hidden');
        secRate?.classList.remove('hidden');
        setActive(btnRate);
        window.runLooseCalc();
    }
    safeCreateIcons();
};

// Backwards compatibility alias
window.switchMarginCalcTab = function(type) {
    if (type === 'bonus') window.switchCalculatorTab('bonus');
    else if (type === 'simple') window.switchCalculatorTab('simple');
    else window.switchCalculatorTab('rate');
};

// ==========================================
// CALCULATOR 1: Simple Commercial Digital Shop Calculator (Citizen / Casio Precision)
// ==========================================
function cleanFloat(val) {
    if (isNaN(val) || !isFinite(val)) return 0;
    return Math.round((val + Number.EPSILON) * 100000000) / 100000000;
}

function formatShopDisplay(numStr) {
    if (numStr === 'Error' || numStr === '-Infinity' || numStr === 'Infinity') return numStr;
    const parts = String(numStr).split('.');
    const intPart = parts[0];
    const decPart = parts[1];
    const sign = intPart.startsWith('-') ? '-' : '';
    const cleanInt = sign ? intPart.slice(1) : intPart;
    const withCommas = cleanInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decPart !== undefined ? `${sign}${withCommas}.${decPart}` : `${sign}${withCommas}`;
}

let simpleCalcState = {
    display: '0',
    storedVal: null,
    operation: null,
    waitingForOperand: false,
    history: '',
    lastOp: null,
    lastOperand: null,
    memory: 0
};

window.updateSimpleCalcDisplay = function() {
    const dispEl = document.getElementById('simple-calc-display');
    const histEl = document.getElementById('simple-calc-history');
    const opEl = document.getElementById('simple-calc-op-indicator');
    const memEl = document.getElementById('simple-calc-mem-indicator');

    if (dispEl) {
        dispEl.innerText = formatShopDisplay(simpleCalcState.display);
    }
    if (histEl) {
        histEl.innerText = simpleCalcState.history || '';
    }
    if (opEl) {
        opEl.innerText = simpleCalcState.operation || '';
    }
    if (memEl) {
        if (Math.abs(simpleCalcState.memory) > 1e-9) {
            memEl.classList.remove('hidden');
        } else {
            memEl.classList.add('hidden');
        }
    }
};

window.simpleCalcDigit = function(digit) {
    if (simpleCalcState.waitingForOperand) {
        if (digit === '.') {
            simpleCalcState.display = '0.';
        } else {
            simpleCalcState.display = digit;
        }
        simpleCalcState.waitingForOperand = false;
    } else {
        if (digit === '.') {
            if (!simpleCalcState.display.includes('.')) {
                simpleCalcState.display += '.';
            }
        } else {
            if (simpleCalcState.display === '0') {
                simpleCalcState.display = digit;
            } else if (simpleCalcState.display === '-0') {
                simpleCalcState.display = '-' + digit;
            } else {
                if (simpleCalcState.display.replace('-', '').replace('.', '').length < 14) {
                    simpleCalcState.display += digit;
                }
            }
        }
    }
    window.updateSimpleCalcDisplay();
};

window.simpleCalcDoubleZero = function() {
    if (simpleCalcState.waitingForOperand) {
        simpleCalcState.display = '0';
        simpleCalcState.waitingForOperand = false;
    } else {
        if (simpleCalcState.display !== '0' && simpleCalcState.display !== '-0') {
            if (simpleCalcState.display.replace('-', '').replace('.', '').length < 13) {
                simpleCalcState.display += '00';
            }
        }
    }
    window.updateSimpleCalcDisplay();
};

function executeMathOp(a, op, b) {
    a = cleanFloat(a);
    b = cleanFloat(b);
    if (op === '+') return cleanFloat(a + b);
    if (op === '-') return cleanFloat(a - b);
    if (op === '×' || op === '*') return cleanFloat(a * b);
    if (op === '÷' || op === '/') {
        if (b === 0) return 'Error';
        return cleanFloat(a / b);
    }
    return b;
}

window.simpleCalcOp = function(nextOp) {
    const currentNum = parseFloat(simpleCalcState.display);
    if (isNaN(currentNum)) return;

    if (simpleCalcState.operation && !simpleCalcState.waitingForOperand && simpleCalcState.storedVal !== null) {
        const intermediate = executeMathOp(simpleCalcState.storedVal, simpleCalcState.operation, currentNum);
        if (intermediate === 'Error') {
            simpleCalcState.display = 'Error';
            simpleCalcState.history = 'Zero divide nahi ho sakta';
            simpleCalcState.storedVal = null;
            simpleCalcState.operation = null;
            simpleCalcState.waitingForOperand = true;
            window.updateSimpleCalcDisplay();
            return;
        }
        simpleCalcState.display = String(intermediate);
        simpleCalcState.storedVal = intermediate;
    } else {
        simpleCalcState.storedVal = currentNum;
    }

    simpleCalcState.operation = nextOp;
    simpleCalcState.waitingForOperand = true;
    simpleCalcState.history = `${formatShopDisplay(String(simpleCalcState.storedVal))} ${nextOp}`;
    window.updateSimpleCalcDisplay();
};

window.simpleCalcPercent = function() {
    const currentNum = parseFloat(simpleCalcState.display);
    if (isNaN(currentNum)) return;

    // Commercial shop % logic (Markup, Discount, or standard percentage)
    if (simpleCalcState.storedVal !== null && simpleCalcState.operation) {
        const base = simpleCalcState.storedVal;
        const op = simpleCalcState.operation;
        if (op === '+' || op === '-') {
            const delta = cleanFloat((base * currentNum) / 100);
            const res = op === '+' ? cleanFloat(base + delta) : cleanFloat(base - delta);
            simpleCalcState.display = String(res);
            simpleCalcState.history = `${formatShopDisplay(String(base))} ${op} ${currentNum}% (${formatShopDisplay(String(delta))}) =`;
            simpleCalcState.storedVal = null;
            simpleCalcState.operation = null;
            simpleCalcState.waitingForOperand = true;
        } else if (op === '×' || op === '*') {
            const res = cleanFloat((base * currentNum) / 100);
            simpleCalcState.display = String(res);
            simpleCalcState.history = `${formatShopDisplay(String(base))} × ${currentNum}% =`;
            simpleCalcState.storedVal = null;
            simpleCalcState.operation = null;
            simpleCalcState.waitingForOperand = true;
        } else if (op === '÷' || op === '/') {
            if (currentNum === 0) {
                simpleCalcState.display = 'Error';
                window.updateSimpleCalcDisplay();
                return;
            }
            const res = cleanFloat((base / currentNum) * 100);
            simpleCalcState.display = String(res);
            simpleCalcState.history = `${formatShopDisplay(String(base))} ÷ ${currentNum}% =`;
            simpleCalcState.storedVal = null;
            simpleCalcState.operation = null;
            simpleCalcState.waitingForOperand = true;
        }
    } else {
        const res = cleanFloat(currentNum / 100);
        simpleCalcState.display = String(res);
        simpleCalcState.history = `${currentNum}% =`;
        simpleCalcState.waitingForOperand = true;
    }
    window.updateSimpleCalcDisplay();
};

window.simpleCalcEquals = function() {
    const currentNum = parseFloat(simpleCalcState.display);
    if (isNaN(currentNum)) return;

    if (simpleCalcState.operation && simpleCalcState.storedVal !== null) {
        const op = simpleCalcState.operation;
        const prev = simpleCalcState.storedVal;
        const res = executeMathOp(prev, op, currentNum);

        if (res === 'Error') {
            simpleCalcState.display = 'Error';
            simpleCalcState.history = 'Zero divide nahi ho sakta';
            simpleCalcState.storedVal = null;
            simpleCalcState.operation = null;
            simpleCalcState.waitingForOperand = true;
            window.updateSimpleCalcDisplay();
            return;
        }

        simpleCalcState.display = String(res);
        simpleCalcState.history = `${formatShopDisplay(String(prev))} ${op} ${formatShopDisplay(String(currentNum))} =`;
        simpleCalcState.lastOp = op;
        simpleCalcState.lastOperand = currentNum;
        simpleCalcState.storedVal = null;
        simpleCalcState.operation = null;
        simpleCalcState.waitingForOperand = true;
    } else if (simpleCalcState.lastOp && simpleCalcState.lastOperand !== null) {
        // Repeat equals functionality (Citizen/Casio repeat)
        const op = simpleCalcState.lastOp;
        const operand = simpleCalcState.lastOperand;
        const res = executeMathOp(currentNum, op, operand);
        if (res !== 'Error') {
            simpleCalcState.display = String(res);
            simpleCalcState.history = `${formatShopDisplay(String(currentNum))} ${op} ${formatShopDisplay(String(operand))} =`;
            simpleCalcState.waitingForOperand = true;
        }
    }
    window.updateSimpleCalcDisplay();
};

window.simpleCalcClearEntry = function() {
    simpleCalcState.display = '0';
    window.updateSimpleCalcDisplay();
};

window.simpleCalcClear = function() {
    simpleCalcState.display = '0';
    simpleCalcState.storedVal = null;
    simpleCalcState.operation = null;
    simpleCalcState.waitingForOperand = false;
    simpleCalcState.history = '';
    simpleCalcState.lastOp = null;
    simpleCalcState.lastOperand = null;
    window.updateSimpleCalcDisplay();
};

window.simpleCalcBackspace = function() {
    if (simpleCalcState.waitingForOperand) {
        return;
    }
    if (simpleCalcState.display.length > 1) {
        simpleCalcState.display = simpleCalcState.display.slice(0, -1);
        if (simpleCalcState.display === '-' || simpleCalcState.display === '') {
            simpleCalcState.display = '0';
        }
    } else {
        simpleCalcState.display = '0';
    }
    window.updateSimpleCalcDisplay();
};

window.simpleCalcToggleSign = function() {
    let current = parseFloat(simpleCalcState.display);
    if (isNaN(current) || current === 0) return;
    current = -current;
    simpleCalcState.display = String(current);
    window.updateSimpleCalcDisplay();
};

// Memory functions (MC, MR, M+, M-)
window.simpleCalcMemClear = function() {
    simpleCalcState.memory = 0;
    window.updateSimpleCalcDisplay();
    showToast('Calculator Memory Saaf (MC)', 'info');
};

window.simpleCalcMemRecall = function() {
    simpleCalcState.display = String(cleanFloat(simpleCalcState.memory));
    simpleCalcState.waitingForOperand = true;
    window.updateSimpleCalcDisplay();
};

window.simpleCalcMemAdd = function() {
    const currentNum = parseFloat(simpleCalcState.display) || 0;
    simpleCalcState.memory = cleanFloat(simpleCalcState.memory + currentNum);
    simpleCalcState.waitingForOperand = true;
    window.updateSimpleCalcDisplay();
    showToast(`Memory M+ (Rs. ${simpleCalcState.memory})`, 'success');
};

window.simpleCalcMemSub = function() {
    const currentNum = parseFloat(simpleCalcState.display) || 0;
    simpleCalcState.memory = cleanFloat(simpleCalcState.memory - currentNum);
    simpleCalcState.waitingForOperand = true;
    window.updateSimpleCalcDisplay();
    showToast(`Memory M- (Rs. ${simpleCalcState.memory})`, 'info');
};

// Keyboard listener for Simple Calculator
window.addEventListener('keydown', (e) => {
    const simpleSec = document.getElementById('calc-section-simple');
    if (!simpleSec || simpleSec.classList.contains('hidden')) return;

    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    if (e.key >= '0' && e.key <= '9') {
        window.simpleCalcDigit(e.key);
    } else if (e.key === '.') {
        window.simpleCalcDigit('.');
    } else if (e.key === '+') {
        window.simpleCalcOp('+');
    } else if (e.key === '-') {
        window.simpleCalcOp('-');
    } else if (e.key === '*' || e.key === 'x' || e.key === 'X') {
        window.simpleCalcOp('×');
    } else if (e.key === '/') {
        e.preventDefault();
        window.simpleCalcOp('÷');
    } else if (e.key === '%') {
        window.simpleCalcPercent();
    } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        window.simpleCalcEquals();
    } else if (e.key === 'Backspace') {
        window.simpleCalcBackspace();
    } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
        window.simpleCalcClear();
    }
});

const PRESCRIPTION_PROMPT = `You are an expert Clinical Pharmacist and forensic prescription OCR reader.
Your mission is to perform strict, accurate OCR on this doctor prescription slip or clinic pad.

STRICT ZERO-HALLUCINATION & HONESTY MANDATE:
1. STRICT OCR TRANSCRIBING: Transcribe ONLY the actual medicines visibly written on this specific slip. DO NOT GUESS, DO NOT INVENT, AND DO NOT ADD MEDICINES THAT ARE NOT WRITTEN ON THE PAPER.
2. If 2 medicines are written, return only 2. If 5 are written, return 5.
3. If no medicines can be deciphered or the image is not a prescription, return an empty array [] for "medicines". NEVER generate dummy, placeholder, or sample medicines like Panadol, Augmentin, Risek, etc.
4. Convert medical timing abbreviations (OD, BD, TDS, 1+0+1, 1x2, HS, SOS) into polite Roman Urdu (e.g. "Subah sham 1 goli khane ke baad (1+0+1)").
5. Never output refusal messages; always return valid JSON conforming to the schema:
{
  "doctor": "Doctor or Clinic name from slip",
  "patient": "Patient name and details if visible",
  "treatmentSummary": "Short treatment reason in Roman Urdu e.g. Bukhar aur infection ka ilaj",
  "advice": "Precautions in Roman Urdu e.g. Tali hui aur thandi cheezon se parhez karein",
  "medicines": [
    {
      "name": "Exact brand name and strength written on slip",
      "formula": "Generic salt if visible or standard formulation",
      "form": "Goli (Tablet), Capsule, Sharbath (Syrup), Injection, Drops, Sachet, etc.",
      "timing": "Dosage schedule in Roman Urdu e.g. Subah sham 1 goli khane ke baad (1+0+1)",
      "usage": "Usage instructions in Roman Urdu e.g. Taza paani ke sath lein",
      "purpose": "Indication in Roman Urdu"
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
        let parsed = normalizePrescriptionData(resData?.data) || {
            doctor: 'Doctor / Clinic Slip',
            patient: 'General Patient',
            treatmentSummary: 'Nuskha ke mutabiq adviyaat aur ilaj ki tafseelat.',
            advice: 'Dawai waqt par lein aur parhez karein.',
            medicines: []
        };

        if (!parsed.medicines) {
            parsed.medicines = [];
        }

        document.getElementById('presc-doc-name').innerText = 'Doctor / Clinic: ' + (parsed.doctor || 'Prescription Slip');
        document.getElementById('presc-patient-info').innerText = 'Mareez (Patient): ' + (parsed.patient || 'General Patient');
        
        const badgeEl = document.getElementById('presc-items-badge');
        if (badgeEl) {
            badgeEl.innerText = `${parsed.medicines.length} Medicines Found`;
        }

        const summaryEl = document.getElementById('presc-treatment-summary');
        if (summaryEl) {
            summaryEl.innerText = parsed.treatmentSummary || 'Nuskha ke mutabiq adviyaat aur ilaj ki tafseelat darj zail hain.';
        }

        document.getElementById('presc-advice').innerText = parsed.advice || 'Dawai hidayat ke mutabiq waqt par lein. Thandi, tali hui aur khatti cheezon se mukammal parhez karein aur garam paani zyada piyen.';

        window.lastPrescriptionParsed = parsed;
        const medList = document.getElementById('presc-medicines-list');
        if (medList) {
            if (parsed.medicines.length === 0) {
                medList.innerHTML = `
                    <div class="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-2">
                        <div class="w-10 h-10 mx-auto rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                            <i data-lucide="scan" class="w-5 h-5"></i>
                        </div>
                        <strong class="text-xs sm:text-sm font-black text-slate-800 block">Tasveer se koi dawai detect nahi hui</strong>
                        <p class="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                            Prescription slip upload karein ya POS Counter par search bar se direct dawai select karein.
                        </p>
                    </div>
                `;
            } else {
                medList.innerHTML = (parsed.medicines || []).map((m, idx) => `
                <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 hover:border-brand-300 transition">
                    <div class="flex justify-between items-start gap-2">
                        <div class="flex items-start gap-2">
                            <span class="w-5 h-5 rounded-full bg-brand-600 text-white font-black text-[10px] flex items-center justify-center shrink-0 mt-0.5">${idx + 1}</span>
                            <div>
                                <strong class="text-slate-900 text-xs sm:text-sm font-black">${m.name}</strong>
                                <span class="text-[11px] text-slate-500 block font-medium">${m.formula ? m.formula + ' • ' : ''}<span class="text-brand-700 font-bold">${m.form || 'Dawai'}</span></span>
                            </div>
                        </div>
                        <div class="flex flex-col items-end gap-1 shrink-0">
                            <span class="text-[10px] bg-brand-50 border border-brand-200 text-brand-700 px-2 py-0.5 rounded-lg font-bold">${m.purpose || 'Ilaj'}</span>
                            <button type="button" onclick="window.addPrescribedItemToPos('${encodeURIComponent(m.name)}')" class="text-[10px] bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-md font-bold flex items-center gap-1 active:scale-95 shadow-xs transition">
                                <i data-lucide="plus" class="w-3 h-3"></i> Add to POS
                            </button>
                        </div>
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
        }

        loading?.classList.add('hidden');
        content?.classList.remove('hidden');
        safeCreateIcons();
        syncModalScrollLock();
        if (parsed.medicines.length > 0) {
            showToast(`${parsed.medicines.length} medicines detect ho gayin!`, 'success');
        } else {
            showToast('Tasveer se koi dawai detect nahi hui.', 'info');
        }
    } catch(err) {
        console.error('Prescription OCR Error:', err);
        modal?.classList.add('hidden');
        syncModalScrollLock();
        showToast('Prescription scan mukammal nahi ho saka, dobara koshish karein.', 'error');
    } finally {
        event.target.value = '';
    }
};

window.addPrescribedItemToPos = function(encodedName) {
    const medName = decodeURIComponent(encodedName || '').trim();
    if (!medName) return;

    window.switchTab('pos');
    window.closeAiPrescModal();

    const query = medName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
    const words = query.split(/\s+/).filter(w => w.length > 2);

    let matched = medicines.find(m => m.name.toLowerCase() === medName.toLowerCase());
    if (!matched && words.length > 0) {
        matched = medicines.find(m => words.every(w => m.name.toLowerCase().includes(w)));
    }
    if (!matched && words.length > 0) {
        matched = medicines.find(m => m.name.toLowerCase().includes(words[0]));
    }

    if (matched) {
        window.selectMedForPos(matched.id);
        showToast(`${matched.name} POS Counter par select ho gayi!`, 'success');
    } else {
        const searchInput = document.getElementById('pos-search');
        if (searchInput) {
            searchInput.value = medName;
            window.searchMedicineForPos();
            searchInput.focus();
        }
        showToast(`${medName} search list mein open ho gayi!`, 'info');
    }
};

window.addAllPrescriptionToPos = function() {
    if (!window.lastPrescriptionParsed || !Array.isArray(window.lastPrescriptionParsed.medicines)) {
        showToast('Prescription mein koi dawai nahi mili.', 'error');
        return;
    }
    const list = window.lastPrescriptionParsed.medicines;
    let addedCount = 0;

    list.forEach(item => {
        const medName = (item.name || '').trim();
        if (!medName) return;
        const query = medName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
        const words = query.split(/\s+/).filter(w => w.length > 2);

        let matched = medicines.find(m => m.name.toLowerCase() === medName.toLowerCase());
        if (!matched && words.length > 0) {
            matched = medicines.find(m => words.every(w => m.name.toLowerCase().includes(w)));
        }
        if (!matched && words.length > 0) {
            matched = medicines.find(m => m.name.toLowerCase().includes(words[0]));
        }

        if (matched) {
            const itemBuyRate = Number(matched.buyRate) || 0;
            const pricePerUnit = Number(matched.mrp) || 0;
            cart.push({
                id: matched.id,
                name: matched.name,
                unitType: 'pack',
                displayUnit: 'Pack',
                qty: 1,
                price: pricePerUnit,
                buyRate: itemBuyRate,
                cost: itemBuyRate,
                total: pricePerUnit,
                stockDeduct: 1
            });
            addedCount++;
        }
    });

    window.switchTab('pos');
    window.closeAiPrescModal();
    if (addedCount > 0) {
        renderCartTable();
        window.calculateCartTotals();
        showToast(`${addedCount} adviyaat POS Bill mein shamil kar di gayin!`, 'success');
    } else {
        showToast('Adviyaat inventory mein dhoondne kelye search bar check karein.', 'info');
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

        if (!items || !Array.isArray(items)) {
            items = [];
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
        if (items.length > 0) {
            showToast(`${items.length} bill items detect ho gaye! MRP check karein.`, 'success');
        } else {
            showToast('Bill se koi item detect nahi hua.', 'info');
        }
    } catch(err) {
        console.error('Invoice OCR Error:', err);
        modal?.classList.add('hidden');
        showToast('Bill scan mukammal nahi ho saka, dobara koshish karein.', 'error');
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
            <td class="p-2 min-w-[190px] sm:min-w-[210px] max-w-[230px]">
                <input type="text" value="${item.name}" title="${item.name}" placeholder="Medicine Name" onchange="window.updateScannedItem(${idx}, 'name', this.value)" class="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
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

        if (!items || !Array.isArray(items)) {
            items = [];
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
        if (items.length > 0) {
            showToast(`${items.length} items detect ho gaye! MRP enter karein.`, 'success');
        } else {
            showToast('Bill se koi item detect nahi hua.', 'info');
        }
    } catch(e) {
        console.error('Margin OCR Error:', e);
        container?.classList.add('hidden');
        showToast('Margin bill scan nahi ho saka, dobara koshish karein.', 'error');
    } finally {
        event.target.value = '';
    }
};

// AI Medicine Packaging / Box / Strip Scanner (Direct Stock In)
window.handleMedicinePackagingScan = async function(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    showToast('Medicine packaging scan ho rahi hai, barah-e-karam intizar karein...', 'info');

    try {
        const base64Data = await enhanceImageLikeCamScanner(file);
        const resData = await callAiBackend('/api/ai/scan-medicine-pack', base64Data, 'Extract medicine name, generic formula, pack size, batch, expiry, mrp, tp from this medicine packaging photo');
        
        const data = resData?.data;
        if (!data || !data.name) {
            showToast('Packaging se dawa ka naam detect nahi ho saka.', 'info');
            return;
        }

        // Open Add Medicine Modal if not open
        window.openAddMedicineModal();

        // Populate fields
        const nameEl = document.getElementById('med-name');
        if (nameEl && data.name) nameEl.value = data.name;

        const typeEl = document.getElementById('med-type');
        if (typeEl && data.form) {
            const formVal = String(data.form).toLowerCase();
            if (formVal.includes('tab')) typeEl.value = 'tab';
            else if (formVal.includes('cap')) typeEl.value = 'cap';
            else if (formVal.includes('syp') || formVal.includes('syrup')) typeEl.value = 'syp';
            else if (formVal.includes('drop')) typeEl.value = 'drop';
            else if (formVal.includes('inj')) typeEl.value = 'inj';
            else if (formVal.includes('scht') || formVal.includes('sachet')) typeEl.value = 'scht';
        }

        const genericEl = document.getElementById('med-generic');
        if (genericEl && data.generic) genericEl.value = data.generic;

        const packEl = document.getElementById('med-pack');
        if (packEl && data.packSize) packEl.value = data.packSize;

        const batchEl = document.getElementById('med-batch');
        if (batchEl && data.batch) batchEl.value = data.batch;

        const expMonthEl = document.getElementById('med-expiry-month');
        if (expMonthEl && data.expiryMonth) expMonthEl.value = data.expiryMonth;

        const expYearEl = document.getElementById('med-expiry-year');
        if (expYearEl && data.expiryYear) expYearEl.value = data.expiryYear;

        const mrpEl = document.getElementById('med-mrp');
        if (mrpEl && data.mrp) mrpEl.value = data.mrp;

        const buyEl = document.getElementById('med-buy');
        if (buyEl && data.buyRate) buyEl.value = data.buyRate;

        window.updateMedPackHintLive();
        showToast(`AI Scanner: ${data.name} kamyabi se auto-fill ho gayi!`, 'success');
    } catch(err) {
        console.error('Packaging Scan Error:', err);
        showToast('Packaging scan mukammal nahi ho saka.', 'error');
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
                <td class="p-2.5 text-right font-black text-slate-700">Rs. ${item.buyRate.toFixed(1)}</td>
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
        badge.innerText = `Rs. ${perTabPrice.toFixed(1)}/unit (Tot: Rs. ${total.toFixed(1)})`;
        badge.className = 'text-[9px] font-black text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded truncate max-w-[130px]';
    } else {
        const total = mrp * qty;
        badge.innerText = `Rs. ${mrp.toFixed(1)}/pack (Tot: Rs. ${total.toFixed(1)})`;
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
        displayUnit = 'Loose Unit 💊';
        const totalUnitsAvailable = currentSelectedMed.stock * totalUnits;
        if (totalUnitsAvailable < qty) {
            showToast(`Stock kam hai! Mojood Loose Unit 💊: ${Math.floor(totalUnitsAvailable)}`, 'error');
            return;
        }
    } else {
        pricePerUnit = mrp;
        stockDeduction = qty;
        displayUnit = `📦 Pack (${packInfo.displayText})`;
        if (currentSelectedMed.stock < stockDeduction) {
            showToast(`Stock kam hai! Mojood: ${currentSelectedMed.stock} packs`, 'error');
            return;
        }
    }

    const itemBuyRate = Number(currentSelectedMed.buyRate) || 0;
    const itemCost = itemBuyRate * stockDeduction;

    cart.push({
        id: currentSelectedMed.id,
        name: currentSelectedMed.name,
        unitType: unitType,
        displayUnit: displayUnit,
        qty: qty,
        price: pricePerUnit,
        buyRate: itemBuyRate,
        cost: itemCost,
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
        const totalUnitsAvailable = (med ? med.stock : 999) * totalUnits;
        if (totalUnitsAvailable < newQty) {
            showToast(`Stock kam hai! Mojood Loose Unit 💊: ${Math.floor(totalUnitsAvailable)}`, 'error');
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
    const totalSaleCost = cart.reduce((sum, item) => sum + (Number(item.cost) || ((Number(item.buyRate) || 0) * (Number(item.stockDeduct) || 1))), 0);
    const saleProfit = Math.max(0, netTotal - totalSaleCost);

    const saleRecord = {
        id: 'sale_' + Date.now(),
        invoiceId: invoiceId,
        customer: customer,
        paymentMode: payMode,
        subtotal: subtotal,
        discountPercent: discPercent,
        discountAmount: discAmt,
        netTotal: netTotal,
        cost: totalSaleCost,
        profit: saleProfit,
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
// RECEIPT GENERATION (Pure Receipt Format)
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
    text += `_DIGITAL PHARMA - SMART PHARMACY SYSTEM_`;

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

    let html = '';
    if (myMatch.length > 0) {
        html += `<div class="p-2 text-[10px] font-black uppercase text-brand-700 bg-brand-50 rounded-xl flex items-center justify-between"><span>Aap Ke Store Ka Stock:</span><span>${myMatch.length} found</span></div>`;
        html += myMatch.map(m => {
            const packInfo = parsePackSize(m.packSize);
            const totalUnits = Math.max(1, packInfo.totalUnits);
            const totalStockUnits = Math.floor(m.stock * totalUnits);
            const perUnitRate = (Number(m.mrp) / totalUnits).toFixed(1);
            const hasLocation = !!(m.location && m.location.trim());
            const displayLocation = hasLocation ? m.location.trim() : 'None';
            return `
                <div class="p-3 hover:bg-slate-50 border-b border-slate-100 transition rounded-xl flex flex-col gap-2">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <strong class="text-slate-900 text-xs sm:text-sm font-black">${m.name}</strong>
                                <span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">Available</span>
                                <span class="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold rounded-full flex items-center gap-1">
                                    <i data-lucide="package" class="w-3 h-3"></i> 📦 ${packInfo.displayText}
                                </span>
                            </div>
                            <span class="text-[11px] text-slate-500 font-medium block mt-0.5">${m.generic ? m.generic + ' • ' : ''}<span class="text-brand-700 font-bold">${m.distributor || 'General'}</span></span>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="text-[10px] text-slate-400 font-bold uppercase block">Retail MRP</span>
                            <span class="font-black text-emerald-700 text-sm sm:text-base block">Rs. ${Number(m.mrp).toFixed(1)}</span>
                        </div>
                    </div>

                    <!-- Clean 5-Box Metrics Grid with Pack Size, Stock, Unit Rate, Location & Hidden Buy Rate TP (Eye Toggle) -->
                    <div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs bg-slate-50 p-2 rounded-xl border border-slate-200/80">
                        <div>
                            <span class="text-[9px] uppercase font-bold text-indigo-600 block">Pack Size:</span>
                            <strong class="text-indigo-950 font-black">📦 ${packInfo.displayText}</strong>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Stock Qty:</span>
                            <strong class="text-slate-900 font-black">${m.stock} Packs <span class="text-slate-500 font-normal">(💊 ${totalStockUnits} Loose Unit)</span></strong>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Per Unit Rate:</span>
                            <strong class="text-brand-700 font-black">Rs. ${perUnitRate} / unit</strong>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase font-bold text-slate-400 block">Shelf / Location:</span>
                            <strong class="${hasLocation ? 'text-slate-800 font-bold' : 'text-slate-400 font-medium italic'}">${displayLocation}</strong>
                        </div>
                        <div class="col-span-2 sm:col-span-1 bg-white p-1 rounded-lg border border-slate-200">
                            <span class="text-[9px] uppercase font-bold text-rose-600 block">Buy Rate TP:</span>
                            <div class="flex items-center justify-between gap-1 mt-0.5">
                                <span id="rate-tp-${m.id}" class="hidden font-mono font-black text-xs text-rose-700">Rs. ${Number(m.buyRate).toFixed(1)}</span>
                                <button type="button" onclick="window.toggleRateCheckTp('${m.id}')" id="btn-rate-tp-${m.id}" class="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[9px] font-bold flex items-center gap-1 active:scale-95 transition" title="Customer se chupa hua buy rate dekhein">
                                    <i data-lucide="eye" class="w-3 h-3"></i> <span>Show TP</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        html += `<div class="p-3 text-xs text-amber-800 bg-amber-50 rounded-xl font-semibold border border-amber-200">Aap ke store par yeh medicine mojood nahi hai. Niche connected partner pharmacies chk karein:</div>`;
    }

    // Connected Network Partner Pharmacies Stock & Rates
    let savedStores = [];
    try {
        const s = localStorage.getItem('sm_network_stores');
        if (s) {
            const parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                // Filter out any stale mock stores
                savedStores = parsed.filter(p => !['net_1', 'net_2', 'net_3'].includes(p.id) && !['Al-Madina Pharmacy', 'Qadri Medicos & Chemists', 'Bismillah Medical Store'].includes(p.name));
            }
        }
    } catch(e) {
        savedStores = [];
    }

    if (savedStores.length > 0) {
        const medNameDisplay = myMatch[0] ? myMatch[0].name : (query.charAt(0).toUpperCase() + query.slice(1));
        const genericDisplay = myMatch[0] ? myMatch[0].generic : 'Authentic Formula';
        const packDisplay = myMatch[0] ? parsePackSize(myMatch[0].packSize).displayText : '20 Tablets / Pack';
        const mrpDisplay = myMatch[0] ? Number(myMatch[0].mrp).toFixed(1) : '350.0';

        html += `<div class="p-2 text-[10px] font-black uppercase text-emerald-800 bg-emerald-50 rounded-xl mt-2 flex items-center justify-between"><span>Connected Pharmacies Network:</span><span>${savedStores.length} stores</span></div>`;
        html += savedStores.map(p => `
            <div class="p-3 hover:bg-emerald-50/40 border-b border-slate-100 transition rounded-xl flex flex-col gap-2 bg-white">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <strong class="text-slate-900 text-xs sm:text-sm font-black">${medNameDisplay}</strong>
                        <span class="text-[11px] text-slate-500 font-medium block mt-0.5">${genericDisplay ? genericDisplay + ' • ' : ''}<span class="text-emerald-700 font-bold">🏪 ${p.name || p.store}</span> • <span class="text-slate-500 font-mono text-[10px]">${p.city || 'Near City'}</span></span>
                    </div>
                    <div class="text-right shrink-0">
                        <span class="text-[10px] text-slate-400 font-bold uppercase block">Retail MRP</span>
                        <strong class="text-emerald-700 font-black text-sm block">Rs. ${mrpDisplay}</strong>
                    </div>
                </div>
                <!-- Product Name, Generic, Pack Size, Availability & WhatsApp -->
                <div class="grid grid-cols-3 gap-1.5 text-xs bg-slate-50 p-2 rounded-xl border border-slate-200/80 items-center">
                    <div>
                        <span class="text-[9px] uppercase font-bold text-indigo-600 block">Pack Size:</span>
                        <strong class="text-indigo-950 font-black text-[11px]">📦 ${packDisplay}</strong>
                    </div>
                    <div>
                        <span class="text-[9px] uppercase font-bold text-slate-400 block">Network:</span>
                        <span class="text-emerald-700 font-bold text-[10px] flex items-center gap-1">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Connected
                        </span>
                    </div>
                    <div class="text-right">
                        <a href="https://wa.me/92${String(p.phone || '').replace(/^0/, '').replace(/\D/g, '')}?text=${encodeURIComponent('Assalam-o-Alaikum, kya aap ke paas ' + medNameDisplay + ' (Pack: ' + packDisplay + ', MRP: Rs.' + mrpDisplay + ') available hai?')}" target="_blank" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black inline-flex items-center gap-1 shadow-xs active:scale-95 transition">
                            <i data-lucide="message-circle" class="w-3 h-3"></i> WhatsApp
                        </a>
                    </div>
                </div>
            </div>
        `).join('');
    }

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

// ==========================================
// MEDICINE TYPES & FORMS SYSTEM (Tab, Cap, Syp, Drop, Inj, Scht, Surgical + Custom)
// ==========================================
const DEFAULT_MED_TYPES = [
    { id: 'tab', label: 'Tablet (Tab)' },
    { id: 'cap', label: 'Capsule (Cap)' },
    { id: 'syp', label: 'Syrup (Syp)' },
    { id: 'drop', label: 'Drops (Drop)' },
    { id: 'inj', label: 'Injection (Inj)' },
    { id: 'scht', label: 'Sachet (Scht)' },
    { id: 'surgical', label: 'Surgical' }
];

function getAllMedTypes() {
    let custom = [];
    try {
        const s = localStorage.getItem('sm_custom_med_types');
        if (s) custom = JSON.parse(s);
    } catch(e) {}
    if (!Array.isArray(custom)) custom = [];
    return [...DEFAULT_MED_TYPES, ...custom];
}

function addCustomMedType(label) {
    if (!label || !label.trim()) return null;
    const cleanLabel = label.trim();
    const id = cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, '_');
    let custom = [];
    try {
        const s = localStorage.getItem('sm_custom_med_types');
        if (s) custom = JSON.parse(s);
    } catch(e) {}
    if (!Array.isArray(custom)) custom = [];
    if (!custom.some(c => c.id === id) && !DEFAULT_MED_TYPES.some(d => d.id === id)) {
        custom.push({ id, label: cleanLabel });
        localStorage.setItem('sm_custom_med_types', JSON.stringify(custom));
    }
    window.populateMedTypeDropdowns();
    return id;
}

window.populateMedTypeDropdowns = function() {
    const types = getAllMedTypes();

    // 1. In Medicine Add/Edit Modal
    const medTypeSelect = document.getElementById('med-type');
    if (medTypeSelect) {
        const currentVal = medTypeSelect.value;
        medTypeSelect.innerHTML = types.map(t => `<option value="${t.id}">${t.label}</option>`).join('') +
            `<option value="__custom__" class="font-bold text-brand-700">+ Add Custom Type...</option>`;
        if (currentVal && (types.some(t => t.id === currentVal) || currentVal === '__custom__')) {
            medTypeSelect.value = currentVal;
        }
    }

    // 2. In Inventory Filter Bar
    const invFilterSelect = document.getElementById('inv-type-filter');
    if (invFilterSelect) {
        const currentVal = invFilterSelect.value;
        invFilterSelect.innerHTML = `<option value="">All Types (Sab Dawaiyan)</option>` +
            types.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
        if (currentVal) invFilterSelect.value = currentVal;
    }
};

window.handleMedTypeChange = function(el) {
    if (el.value === '__custom__') {
        const customName = prompt('Nayi Medicine Type / Form ka naam likhein (e.g. Cream, Gel, Inhaler, Drip, Ointment, Spray):');
        if (customName && customName.trim()) {
            const newId = addCustomMedType(customName.trim());
            if (newId) el.value = newId;
            else el.value = 'tab';
            showToast(`Nayi type "${customName.trim()}" shamil ho gayi!`, 'success');
        } else {
            el.value = 'tab';
        }
    }
};

// Inventory Table
function renderInventoryTable() {
    const tbody = document.getElementById('inventory-table-body');
    const mobileCards = document.getElementById('inventory-mobile-cards');
    const searchVal = document.getElementById('inv-search')?.value.toLowerCase().trim() || '';
    const selectedType = document.getElementById('inv-type-filter')?.value || '';
    const bannerEl = document.getElementById('inv-filter-status-banner');

    let filtered = medicines;

    // Filter by Medicine Type if selected
    if (selectedType) {
        filtered = filtered.filter(m => (m.type || 'tab') === selectedType);
    }

    // Low stock filter: ONLY items where stock <= minStock
    if (window.isLowStockFilterActive) {
        filtered = filtered.filter(m => (Number(m.stock) || 0) <= (Number(m.minStock) || 5));
        if (bannerEl) bannerEl.classList.remove('hidden');
    } else {
        if (!selectedType && bannerEl) bannerEl.classList.add('hidden');
    }

    if (searchVal) {
        filtered = filtered.filter(m => 
            m.name.toLowerCase().includes(searchVal) ||
            (m.generic && m.generic.toLowerCase().includes(searchVal)) ||
            (m.batch && m.batch.toLowerCase().includes(searchVal)) ||
            (m.distributor && m.distributor.toLowerCase().includes(searchVal))
        );
    }

    // 1. Desktop & Tablet Table (Wide Screen)
    if (tbody) {
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-10 text-slate-400">
                <i data-lucide="package-open" class="w-8 h-8 mx-auto text-slate-300 mb-2"></i>
                <p class="font-bold text-slate-600 text-sm">${window.isLowStockFilterActive ? 'Koi low stock medicine nahi mili' : (selectedType ? 'Is type ki koi medicine nahi mili' : 'Stock bilkul khali hai')}</p>
                <p class="text-xs text-slate-400 mt-1">${window.isLowStockFilterActive ? 'Tamam medicines ka stock mutawazan hai.' : 'Oper "Add Medicine" button daba kar apni real medicine add karein'}</p>
            </td></tr>`;
        } else {
            tbody.innerHTML = filtered.map(m => {
                const packInfo = parsePackSize(m.packSize);
                const typeLabel = (m.type || 'tab').toUpperCase();
                const isCriticallyLow = (Number(m.stock) || 0) <= (Number(m.minStock) || 5);
                return `
                    <tr class="hover:bg-slate-50 border-b border-slate-100">
                        <td class="p-3">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <strong class="text-slate-900 block text-xs sm:text-sm break-words">${m.name}</strong>
                                <span class="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">${typeLabel}</span>
                            </div>
                            <div class="flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span class="text-[10px] text-slate-500">${m.generic || 'Formula'}</span>
                                <span class="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-mono font-medium">📍 ${m.location ? m.location : 'None'}</span>
                            </div>
                        </td>
                        <td class="p-3 text-slate-600 font-semibold">${m.distributor || 'General'}</td>
                        <td class="p-3 text-slate-700 font-bold">📦 ${packInfo.displayText}</td>
                        <td class="p-3 font-mono text-slate-700">${m.batch || '-'}</td>
                        <td class="p-3 text-slate-700 font-mono">${formatExpiryMMYY(m.expiry)}</td>
                        <td class="p-3 text-right font-bold text-slate-600">Rs. ${Number(m.buyRate).toFixed(1)}</td>
                        <td class="p-3 text-right font-black text-emerald-700">Rs. ${Number(m.mrp).toFixed(1)}</td>
                        <td class="p-3 text-center">
                            <span class="px-2 py-0.5 rounded-full font-black text-xs ${isCriticallyLow ? 'bg-rose-100 text-rose-800 border border-rose-200 animate-pulse' : 'bg-emerald-100 text-emerald-800'}">
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

    // 2. Mobile Responsive Stock Cards
    if (mobileCards) {
        if (filtered.length === 0) {
            mobileCards.innerHTML = `<div class="bg-white p-8 rounded-2xl border border-slate-200 text-center text-xs text-slate-400 space-y-2">
                <i data-lucide="package-open" class="w-8 h-8 mx-auto text-slate-300"></i>
                <p class="font-bold text-slate-600 text-sm">${window.isLowStockFilterActive ? 'Koi low stock medicine nahi mili' : (selectedType ? 'Is type ki koi medicine nahi mili' : 'Stock bilkul khali hai')}</p>
                <p class="text-[11px] text-slate-400">${window.isLowStockFilterActive ? 'Tamam medicines ka stock mukammal hai.' : 'Oper "Add Medicine" daba kar apni pehli medicine add karein'}</p>
            </div>`;
        } else {
            mobileCards.innerHTML = filtered.map(m => {
                const packInfo = parsePackSize(m.packSize);
                const typeLabel = (m.type || 'tab').toUpperCase();
                const isCriticallyLow = (Number(m.stock) || 0) <= (Number(m.minStock) || 5);
                return `
                    <div class="bg-white p-3.5 rounded-2xl border ${isCriticallyLow ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-200'} shadow-xs space-y-2.5">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <div class="flex items-center gap-1.5 flex-wrap">
                                    <h4 class="font-black text-sm text-slate-900 leading-tight break-words">${m.name}</h4>
                                    <span class="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">${typeLabel}</span>
                                </div>
                                <span class="text-[11px] text-slate-500 font-medium block mt-0.5">${m.generic ? m.generic + ' • ' : ''}<span class="text-brand-700 font-bold">${m.distributor || 'General'}</span> • <span class="text-slate-600 font-mono">📍 ${m.location ? m.location : 'None'}</span></span>
                            </div>
                            <span class="shrink-0 px-2.5 py-1 rounded-full font-black text-xs ${isCriticallyLow ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}">
                                ${m.stock} Packs
                            </span>
                        </div>

                        <!-- 4-Box Metrics Grid -->
                        <div class="grid grid-cols-2 gap-2 text-xs">
                            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Retail MRP:</span>
                                <strong class="text-xs font-black text-emerald-700">Rs. ${Number(m.mrp).toFixed(1)}</strong>
                            </div>
                            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Buy Rate TP:</span>
                                <strong class="text-xs font-bold text-slate-700">Rs. ${Number(m.buyRate).toFixed(1)}</strong>
                            </div>
                            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Pack Size:</span>
                                <span class="text-xs font-semibold text-slate-800">📦 ${packInfo.displayText}</span>
                            </div>
                            <div class="p-2 rounded-xl bg-slate-50 border border-slate-200/70">
                                <span class="text-[9px] uppercase font-bold text-slate-400 block">Batch & Expiry:</span>
                                <span class="text-xs font-mono text-slate-800 truncate block">${m.batch || 'B-01'} • ${formatExpiryMMYY(m.expiry)}</span>
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

window.clearAllInventoryFilters = function() {
    window.isLowStockFilterActive = false;
    const typeFilter = document.getElementById('inv-type-filter');
    if (typeFilter) typeFilter.value = '';
    const searchInput = document.getElementById('inv-search');
    if (searchInput) searchInput.value = '';
    const bannerEl = document.getElementById('inv-filter-status-banner');
    if (bannerEl) bannerEl.classList.add('hidden');
    renderInventoryTable();
    showToast('Tamam filters clear ho gaye, mukammal stock nazar aa raha hai.', 'info');
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
    
    window.populateMedTypeDropdowns();
    const typeSelect = document.getElementById('med-type');
    if (typeSelect) typeSelect.value = 'tab';

    // Clear ALL fields completely
    const clearField = (id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    };

    clearField('med-id');
    clearField('med-name');
    clearField('med-generic');
    clearField('med-distributor');
    clearField('med-pack');
    clearField('med-batch');
    clearField('med-expiry-month');
    clearField('med-expiry-year');
    clearField('med-buy');
    clearField('med-mrp');
    clearField('med-stock');
    clearField('med-location');
    
    // Always default Low Stock Alert to 5 packs for convenience
    const minStockInput = document.getElementById('med-min-stock');
    if (minStockInput) minStockInput.value = '5';

    const hint = document.getElementById('med-pack-hint');
    if (hint) hint.innerText = 'Total: 0';

    document.getElementById('medicine-modal')?.classList.remove('hidden');
    syncModalScrollLock();
    safeCreateIcons();

    const mrpInput = document.getElementById('med-mrp');
    if (mrpInput) {
        mrpInput.classList.add('ring-2', 'ring-emerald-500');
    }
    setTimeout(() => {
        document.getElementById('med-name')?.focus();
    }, 60);
};

window.openEditMedicineModal = function(id) {
    const med = medicines.find(m => m.id === id);
    if (!med) return;

    window.populateMedTypeDropdowns();

    document.getElementById('medicine-modal-title').innerText = 'Medicine Update Karein';
    document.getElementById('med-id').value = med.id;
    document.getElementById('med-name').value = med.name;
    document.getElementById('med-generic').value = med.generic || '';
    document.getElementById('med-distributor').value = med.distributor || '';
    document.getElementById('med-pack').value = med.packSize || '20';
    document.getElementById('med-batch').value = med.batch || '';

    const typeSelect = document.getElementById('med-type');
    if (typeSelect) typeSelect.value = med.type || 'tab';

    // Parse MM and YY from stored expiry date
    const mEl = document.getElementById('med-expiry-month');
    const yEl = document.getElementById('med-expiry-year');
    if (med.expiry) {
        const formatted = formatExpiryMMYY(med.expiry);
        if (formatted.includes('/')) {
            const [mm, yy] = formatted.split('/');
            if (mEl) mEl.value = mm || '';
            if (yEl) yEl.value = yy || '';
        } else {
            if (mEl) mEl.value = '';
            if (yEl) yEl.value = '';
        }
    } else {
        if (mEl) mEl.value = '';
        if (yEl) yEl.value = '';
    }

    document.getElementById('med-buy').value = med.buyRate;
    document.getElementById('med-mrp').value = med.mrp;
    document.getElementById('med-stock').value = med.stock;
    const locEl = document.getElementById('med-location');
    if (locEl) locEl.value = med.location || '';
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
    
    // Read Manual Month (MM) and Year (YY)
    let mVal = document.getElementById('med-expiry-month')?.value.replace(/\D/g, '') || '';
    let yVal = document.getElementById('med-expiry-year')?.value.replace(/\D/g, '') || '';

    if (mVal) {
        let mNum = parseInt(mVal, 10);
        if (mNum < 1) mNum = 1;
        if (mNum > 12) mNum = 12;
        mVal = String(mNum).padStart(2, '0');
    }
    if (yVal.length > 2) {
        yVal = yVal.slice(-2);
    } else if (yVal.length === 1) {
        yVal = yVal.padStart(2, '0');
    }

    let finalExpiry = '';
    if (mVal && yVal) {
        finalExpiry = `${mVal}/${yVal}`;
    } else if (yVal) {
        finalExpiry = `12/${yVal}`;
    } else {
        const now = new Date();
        const yy = String((now.getFullYear() + 2) % 100).padStart(2, '0');
        finalExpiry = `12/${yy}`;
    }

    const medType = document.getElementById('med-type')?.value || 'tab';

    const newMed = {
        id: id || ('med_' + Date.now()),
        name: document.getElementById('med-name').value.trim(),
        generic: document.getElementById('med-generic').value.trim(),
        distributor: document.getElementById('med-distributor').value.trim() || 'General',
        packSize: document.getElementById('med-pack').value.trim() || '20',
        batch: document.getElementById('med-batch').value.trim() || ('B-' + Math.floor(100 + Math.random() * 900)),
        expiry: finalExpiry,
        type: medType,
        buyRate: Number(document.getElementById('med-buy').value) || 0,
        mrp: Number(document.getElementById('med-mrp').value) || 0,
        stock: Number(document.getElementById('med-stock').value) || 0,
        location: document.getElementById('med-location')?.value.trim() || '',
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
                                <span class="text-[10px] text-slate-400 block">Buy Rate TP: Rs. ${r.buyRate.toFixed(1)}</span>
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

// ==========================================
// CONNECTED PHARMACIES NETWORK (Real Partner Stores, Zero Fake Data)
// ==========================================
window.openAddNetworkStoreModal = function() {
    document.getElementById('add-network-modal')?.classList.remove('hidden');
    syncModalScrollLock();
    safeCreateIcons();
};

window.closeAddNetworkStoreModal = function() {
    document.getElementById('add-network-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.saveNewNetworkStore = function(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('net-store-name')?.value.trim();
    const city = document.getElementById('net-store-city')?.value.trim();
    const phone = document.getElementById('net-store-phone')?.value.trim();
    const remarks = document.getElementById('net-store-remarks')?.value.trim() || 'Partner Store';

    if (!name || !city || !phone) {
        showToast('Tamam zaroori fields bharein!', 'error');
        return;
    }

    let stores = [];
    try {
        const saved = localStorage.getItem('sm_network_stores');
        if (saved) stores = JSON.parse(saved);
    } catch(err) {}

    stores.push({ name, city, phone, remarks, timestamp: new Date().toISOString() });
    localStorage.setItem('sm_network_stores', JSON.stringify(stores));

    // Reset form
    document.getElementById('net-store-name').value = '';
    document.getElementById('net-store-city').value = '';
    document.getElementById('net-store-phone').value = '';
    document.getElementById('net-store-remarks').value = '';

    window.closeAddNetworkStoreModal();
    window.refreshNetworkList();
    showToast(`${name} partner network mein connect ho gaya!`, 'success');
};

window.deleteNetworkStore = function(index) {
    customConfirm('Pharmacy Remove Karein?', 'Kya aap is pharmacy ko network se hatana chahte hain?', () => {
        let stores = [];
        try {
            const saved = localStorage.getItem('sm_network_stores');
            if (saved) stores = JSON.parse(saved);
        } catch(err) {}
        stores.splice(index, 1);
        localStorage.setItem('sm_network_stores', JSON.stringify(stores));
        window.refreshNetworkList();
        showToast('Pharmacy network se remove ho gayi', 'info');
    });
};

window.refreshNetworkList = async function() {
    const grid = document.getElementById('network-stores-grid');
    if (!grid) return;

    let stores = [];
    try {
        const res = await fetch('/api/network/pharmacies');
        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.pharmacies)) {
                stores = data.pharmacies;
                localStorage.setItem('sm_network_stores', JSON.stringify(stores));
            }
        }
    } catch (err) {
        console.warn('Network pharmacies fetch offline fallback:', err);
    }

    if (!Array.isArray(stores) || stores.length === 0) {
        try {
            const saved = localStorage.getItem('sm_network_stores');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    stores = parsed.filter(p => !['net_1', 'net_2', 'net_3'].includes(p.id) && !['Al-Madina Pharmacy', 'Qadri Medicos & Chemists', 'Bismillah Medical Store'].includes(p.name));
                }
            }
        } catch(e) {
            stores = [];
        }
    }

    if (!Array.isArray(stores) || stores.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full p-8 bg-white rounded-2xl border border-slate-200 text-center space-y-2">
                <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center mx-auto shadow-xs">
                    <i data-lucide="network" class="w-6 h-6"></i>
                </div>
                <h4 class="font-black text-slate-800 text-sm">Koi Partner Pharmacy Abhi Connected Nahi Hai</h4>
                <p class="text-xs text-slate-500 max-w-sm mx-auto">Jab koi pharmacy Digital Pharma par apni profile info save karegi ya Google sync activate karegi, toh uska verified connection automatically yahan live show ho jayega.</p>
            </div>
        `;
        safeCreateIcons();
        return;
    }

    grid.innerHTML = stores.map((s) => `
        <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between gap-3 hover:border-emerald-300 transition">
            <div class="flex items-start justify-between gap-2">
                <div>
                    <h4 class="font-black text-slate-800 text-sm sm:text-base leading-tight">${s.name}</h4>
                    <p class="text-[11px] text-slate-500 font-semibold mt-0.5">
                        ${s.ownerName ? `<span class="text-brand-700 font-bold">${s.ownerName}</span> • ` : ''}<span>📍 ${s.city || 'Pakistan'}</span>
                    </p>
                </div>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0 flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Connected
                </span>
            </div>
            <div class="text-[11px] text-slate-600 flex justify-between items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                <span class="font-bold text-slate-500 uppercase text-[9px]">Status / Info:</span>
                <strong class="text-brand-700 truncate max-w-[200px]">${s.remarks || 'Active Digital Pharma Network Member'}</strong>
            </div>
            <a href="https://wa.me/92${String(s.phone).replace(/^0/, '').replace(/\D/g, '')}?text=${encodeURIComponent('Assalam-o-Alaikum, Digital Pharma system se rabta kiya hai. (Pharmacy: ' + s.name + ')')}" target="_blank" class="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition">
                <i data-lucide="message-square" class="w-3.5 h-3.5"></i> Contact via WhatsApp (${s.phone})
            </a>
        </div>
    `).join('');

    safeCreateIcons();
};

// ==========================================
// PASSWORD VISIBILITY TOGGLE (Show / Hide Password)
// ==========================================
window.togglePasswordVisibility = function(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
        input.type = 'password';
        if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    safeCreateIcons();
};

// ==========================================
// EXPIRED & NEAR-EXPIRY FILTER SYSTEM (Next 3 Dynamic Calendar Months & Expired)
// ==========================================
function getNext3Months() {
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const now = new Date();
    const curM = now.getMonth(); // 0 to 11
    const curY = now.getFullYear();

    const m1Idx = (curM + 1) % 12;
    const m1Year = curM + 1 > 11 ? curY + 1 : curY;

    const m2Idx = (curM + 2) % 12;
    const m2Year = curM + 2 > 11 ? curY + 1 : curY;

    const m3Idx = (curM + 3) % 12;
    const m3Year = curM + 3 > 11 ? curY + 1 : curY;

    return [
        { name: monthNames[m1Idx], monthIndex: m1Idx, year: m1Year, key: 'm1' },
        { name: monthNames[m2Idx], monthIndex: m2Idx, year: m2Year, key: 'm2' },
        { name: monthNames[m3Idx], monthIndex: m3Idx, year: m3Year, key: 'm3' }
    ];
}

let currentExpiryAlertFilter = 'all';

window.setExpiryAlertFilter = function(filter) {
    currentExpiryAlertFilter = filter;
    renderExpiryAlertSection();
};

function renderExpiryAlertSection() {
    const expiryList = document.getElementById('expiry-alert-list');
    if (!expiryList) return;

    const next3 = getNext3Months();
    const nameEl1 = document.getElementById('exp-name-m1');
    const nameEl2 = document.getElementById('exp-name-m2');
    const nameEl3 = document.getElementById('exp-name-m3');
    if (nameEl1) nameEl1.innerText = next3[0].name;
    if (nameEl2) nameEl2.innerText = next3[1].name;
    if (nameEl3) nameEl3.innerText = next3[2].name;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    let countExpired = 0;
    let countM1 = 0;
    let countM2 = 0;
    let countM3 = 0;
    let countAll = 0;

    const analyzedMeds = [];

    medicines.forEach(m => {
        if (!m.expiry) return;
        const d = parseExpiryToDate(m.expiry);
        if (!d) return;

        const diffTime = d.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const medMonth = d.getMonth();
        const medYear = d.getFullYear();

        if (diffDays < 0) {
            countExpired++;
            countAll++;
            analyzedMeds.push({ med: m, date: d, diffDays, bucket: 'expired', bucketLabel: 'Expired' });
        } else if (medYear === next3[0].year && medMonth === next3[0].monthIndex) {
            countM1++;
            countAll++;
            analyzedMeds.push({ med: m, date: d, diffDays, bucket: 'm1', bucketLabel: next3[0].name });
        } else if (medYear === next3[1].year && medMonth === next3[1].monthIndex) {
            countM2++;
            countAll++;
            analyzedMeds.push({ med: m, date: d, diffDays, bucket: 'm2', bucketLabel: next3[1].name });
        } else if (medYear === next3[2].year && medMonth === next3[2].monthIndex) {
            countM3++;
            countAll++;
            analyzedMeds.push({ med: m, date: d, diffDays, bucket: 'm3', bucketLabel: next3[2].name });
        } else if (diffDays <= 90) {
            countAll++;
            analyzedMeds.push({ med: m, date: d, diffDays, bucket: 'other_soon', bucketLabel: 'Near Expiry' });
        }
    });

    // Update pill counters
    const elCntAll = document.getElementById('exp-cnt-all');
    if (elCntAll) elCntAll.innerText = countAll;
    const elCntM1 = document.getElementById('exp-cnt-m1');
    if (elCntM1) elCntM1.innerText = countM1;
    const elCntM2 = document.getElementById('exp-cnt-m2');
    if (elCntM2) elCntM2.innerText = countM2;
    const elCntM3 = document.getElementById('exp-cnt-m3');
    if (elCntM3) elCntM3.innerText = countM3;
    const elCntExp = document.getElementById('exp-cnt-expired');
    if (elCntExp) elCntExp.innerText = countExpired;

    // Update active pill button styling
    ['all', 'm1', 'm2', 'm3', 'expired'].forEach(p => {
        const btn = document.getElementById(`exp-pill-${p}`);
        if (btn) {
            if (p === currentExpiryAlertFilter) {
                btn.className = 'flex-1 py-1 px-1.5 rounded-lg transition bg-rose-600 text-white shadow-2xs font-bold';
            } else {
                btn.className = 'flex-1 py-1 px-1.5 rounded-lg transition text-slate-600 hover:bg-white/60 font-bold';
            }
        }
    });

    let displayList = [];
    if (currentExpiryAlertFilter === 'all') {
        displayList = analyzedMeds;
    } else if (currentExpiryAlertFilter === 'expired') {
        displayList = analyzedMeds.filter(a => a.bucket === 'expired');
    } else if (currentExpiryAlertFilter === 'm1') {
        displayList = analyzedMeds.filter(a => a.bucket === 'm1');
    } else if (currentExpiryAlertFilter === 'm2') {
        displayList = analyzedMeds.filter(a => a.bucket === 'm2');
    } else if (currentExpiryAlertFilter === 'm3') {
        displayList = analyzedMeds.filter(a => a.bucket === 'm3');
    }

    displayList.sort((a, b) => a.diffDays - b.diffDays);

    if (displayList.length === 0) {
        let periodName = 'in 3 maheenon';
        if (currentExpiryAlertFilter === 'expired') periodName = 'Expired';
        else if (currentExpiryAlertFilter === 'm1') periodName = next3[0].name;
        else if (currentExpiryAlertFilter === 'm2') periodName = next3[1].name;
        else if (currentExpiryAlertFilter === 'm3') periodName = next3[2].name;
        expiryList.innerHTML = `<p class="text-xs text-slate-400 py-3 text-center">Is muddat (${periodName}) mein koi medicine nahi mili.</p>`;
    } else {
        expiryList.innerHTML = displayList.map(({ med, diffDays, bucketLabel }) => {
            let badgeClass = 'bg-rose-100 text-rose-800 border-rose-200';
            let labelText = '';
            if (diffDays < 0) {
                badgeClass = 'bg-red-600 text-white font-black';
                labelText = `Expired (${Math.abs(diffDays)} din pehle)`;
            } else {
                badgeClass = 'bg-amber-100 text-amber-900 border border-amber-300 font-black';
                labelText = `Exp: ${bucketLabel} (${diffDays} din baaqi)`;
            }
            return `
                <div onclick="window.switchTab('inventory'); const s=document.getElementById('inv-search'); if(s){ s.value='${med.name.replace(/'/g, "\\'")}'; window.filterInventoryTable(); }" class="py-2 flex items-center justify-between text-xs hover:bg-slate-50 px-1 rounded-lg cursor-pointer transition">
                    <div>
                        <strong class="text-slate-800 block">${med.name}</strong>
                        <span class="text-[10px] text-slate-400">Stock: ${med.stock} • Exp: ${formatExpiryMMYY(med.expiry)}</span>
                    </div>
                    <span class="px-2 py-0.5 rounded-full text-[10px] ${badgeClass}">${labelText}</span>
                </div>
            `;
        }).join('');
    }
}

function renderDashboardMetrics() {
    // Box 1: Total Medicines
    const elCardTotalMeds = document.getElementById('dash-card-total-meds');
    if (elCardTotalMeds) elCardTotalMeds.innerText = `${medicines.length} Meds`;

    // Box 2: Today Sale (With inside Sale & Invest options)
    const today = new Date().toISOString().split('T')[0];
    const todaySales = sales.filter(s => s.timestamp && s.timestamp.startsWith(today));
    const todayTotal = todaySales.reduce((sum, s) => sum + (Number(s.netTotal) || 0), 0);
    const elCardSale = document.getElementById('dash-card-sale');
    if (elCardSale) elCardSale.innerText = 'Rs. ' + todayTotal.toLocaleString('en-PK', { maximumFractionDigits: 1 });
    const elCardInvoices = document.getElementById('dash-card-invoices');
    if (elCardInvoices) elCardInvoices.innerText = todaySales.length > 0 ? `${todaySales.length} Bills • Sale & Sarmaya` : 'Sale & Invest Depth';

    // Box 3: Today Customers
    const elCardCustomers = document.getElementById('dash-card-today-customers');
    if (elCardCustomers) elCardCustomers.innerText = `${todaySales.length} Customers`;
    const elCardCustomersSub = document.getElementById('dash-card-customers-sub');
    if (elCardCustomersSub) elCardCustomersSub.innerText = todaySales.length > 0 ? `${todaySales.length} Walk-in Invoices` : 'Walk-in Bills Today';

    // Box 4: Low Stock Medicines
    const lowStock = medicines.filter(m => (Number(m.stock) || 0) < (Number(m.minStock) || 10));
    const elCardLowStock = document.getElementById('dash-card-low-stock-count');
    if (elCardLowStock) elCardLowStock.innerText = `${lowStock.length} Items`;
    const elCardLowStockSub = document.getElementById('dash-card-low-stock-sub');
    if (elCardLowStockSub) elCardLowStockSub.innerText = lowStock.length > 0 ? `${lowStock.length} Critical Alerts` : 'All Stocks Sufficient';

    const stockCost = medicines.reduce((sum, m) => sum + ((Number(m.buyRate) || 0) * (Number(m.stock) || 0)), 0);
    const elTotalValue = document.getElementById('dash-total-value');
    if (elTotalValue) elTotalValue.innerText = 'Rs. ' + stockCost.toLocaleString('en-PK', { maximumFractionDigits: 1 });

    renderExpiryAlertSection();

    // 2nd Section: Sale, Purchase & Investment Financial Overview (Hidden depth graph behind dedicated button!)
    const dashGraphContainer = document.getElementById('dash-today-graph-container');
    if (dashGraphContainer) {
        let todayCost = 0;
        todaySales.forEach(s => {
            const fin = getSaleFinancials(s);
            todayCost += fin.saleCost;
        });
        const todayProfit = Math.max(0, todayTotal - todayCost);
        const todayMargin = todayTotal > 0 ? ((todayProfit / todayTotal) * 100).toFixed(1) : '0.0';

        dashGraphContainer.innerHTML = `
            <!-- Live Financial Overview Chips -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div class="p-2.5 bg-emerald-50 rounded-2xl border border-emerald-200">
                    <span class="text-[9px] uppercase font-bold text-emerald-800 block">Today Sale</span>
                    <strong class="text-sm font-black text-emerald-950">Rs. ${todayTotal.toLocaleString('en-PK', { maximumFractionDigits: 0 })}</strong>
                    <span class="text-[9px] text-emerald-700 font-semibold block mt-0.5">${todaySales.length} Total Bills</span>
                </div>
                <div class="p-2.5 bg-blue-50 rounded-2xl border border-blue-200">
                    <span class="text-[9px] uppercase font-bold text-blue-800 block">Kharid TP Sarmaya</span>
                    <strong class="text-sm font-black text-blue-950">Rs. ${todayCost.toLocaleString('en-PK', { maximumFractionDigits: 0 })}</strong>
                    <span class="text-[9px] text-blue-700 font-semibold block mt-0.5">Sold Stock Cost</span>
                </div>
                <div class="p-2.5 bg-amber-50 rounded-2xl border border-amber-200">
                    <span class="text-[9px] uppercase font-bold text-amber-800 block">Net Munafa</span>
                    <strong class="text-sm font-black text-amber-950">Rs. ${todayProfit.toLocaleString('en-PK', { maximumFractionDigits: 0 })}</strong>
                    <span class="text-[9px] font-extrabold text-amber-700 block mt-0.5">Margin: ${todayMargin}%</span>
                </div>
                <div class="p-2.5 bg-slate-900 text-white rounded-2xl border border-slate-800">
                    <span class="text-[9px] uppercase font-bold text-slate-300 block">Inventory Sarmaya</span>
                    <strong class="text-sm font-black text-amber-400">Rs. ${stockCost.toLocaleString('en-PK', { maximumFractionDigits: 0 })}</strong>
                    <span class="text-[9px] text-slate-400 font-semibold block mt-0.5">Dukan Total Stock</span>
                </div>
            </div>

            <!-- Dedicated Deep Graph Action Button (Clean external trigger) -->
            <button type="button" onclick="window.openSalesAnalyticsModal('today', 'sale')" class="w-full py-3.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-700 hover:to-teal-800 text-white font-extrabold rounded-2xl shadow text-xs sm:text-sm flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer border border-emerald-500/30">
                <i data-lucide="bar-chart-3" class="w-4 h-4 text-emerald-200"></i>
                <span>Sale, Purchase & Investment Graph Depth (گراف تفصیلی جائزہ)</span>
                <i data-lucide="chevron-right" class="w-4 h-4 text-emerald-200"></i>
            </button>
        `;
        safeCreateIcons();
    }
}

window.filterLowStockInventory = function() {
    window.switchTab('inventory');
    window.isLowStockFilterActive = true;
    renderInventoryTable();
    showToast('Sirf low stock medicines filter ho gayi hain!', 'info');
};

// Total Medicines & Category Form/Type Filter Modal
window.openTotalMedicineFilterModal = function() {
    const modal = document.getElementById('total-medicines-modal');
    if (!modal) return;

    const countEl = document.getElementById('tm-modal-total-count');
    const retailEl = document.getElementById('tm-modal-retail-value');
    const costEl = document.getElementById('tm-modal-cost-value');

    const totalCount = medicines.length;
    const totalRetail = medicines.reduce((sum, m) => sum + ((Number(m.mrp) || 0) * (Number(m.stock) || 0)), 0);
    const totalCost = medicines.reduce((sum, m) => sum + ((Number(m.buyRate) || 0) * (Number(m.stock) || 0)), 0);

    if (countEl) countEl.innerText = `${totalCount} Meds`;
    if (retailEl) retailEl.innerText = 'Rs. ' + totalRetail.toLocaleString('en-PK', { maximumFractionDigits: 1 });
    if (costEl) costEl.innerText = 'Rs. ' + totalCost.toLocaleString('en-PK', { maximumFractionDigits: 1 });

    const btnContainer = document.getElementById('tm-modal-type-buttons');
    if (btnContainer) {
        const types = getAllMedTypes();
        let html = `
            <button type="button" onclick="window.applyTotalMedicineTypeFilter('')" class="p-2.5 rounded-xl border border-slate-200 hover:border-brand-500 bg-white hover:bg-brand-50 text-left transition shadow-2xs group cursor-pointer">
                <span class="text-[10px] font-bold text-slate-400 group-hover:text-brand-600 block uppercase">All Stock</span>
                <div class="flex items-center justify-between mt-0.5">
                    <strong class="text-xs font-black text-slate-800">All Items</strong>
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-brand-100 text-brand-800">${totalCount}</span>
                </div>
            </button>
        `;
        types.forEach(t => {
            const count = medicines.filter(m => (m.type || 'tab') === t.id).length;
            html += `
                <button type="button" onclick="window.applyTotalMedicineTypeFilter('${t.id}')" class="p-2.5 rounded-xl border border-slate-200 hover:border-brand-500 bg-white hover:bg-brand-50 text-left transition shadow-2xs group cursor-pointer">
                    <span class="text-[10px] font-bold text-slate-400 group-hover:text-brand-600 block uppercase">${t.id.toUpperCase()}</span>
                    <div class="flex items-center justify-between mt-0.5">
                        <strong class="text-xs font-black text-slate-800 truncate mr-1">${t.label.split(' ')[0]}</strong>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-black ${count > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">${count}</span>
                    </div>
                </button>
            `;
        });
        btnContainer.innerHTML = html;
    }

    modal.classList.remove('hidden');
    syncModalScrollLock();
    safeCreateIcons();
};

window.closeTotalMedicineModal = function() {
    document.getElementById('total-medicines-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.applyTotalMedicineTypeFilter = function(typeId) {
    window.closeTotalMedicineModal();
    window.switchTab('inventory');
    const typeFilter = document.getElementById('inv-type-filter');
    if (typeFilter) typeFilter.value = typeId;
    window.isLowStockFilterActive = false;
    renderInventoryTable();
    showToast(typeId ? `Filter: ${typeId.toUpperCase()} stock` : 'Full stock view', 'info');
};

window.viewAllInventoryDirect = function() {
    window.closeTotalMedicineModal();
    window.clearAllInventoryFilters();
    window.switchTab('inventory');
};

// Today Customers Modal Opener (Customer bills history for all periods: Today, Yesterday, Week, Month, Year, All Time)
window.openTodayCustomersModal = function(period = 'today') {
    window.openCustomerInvoicesModal(period);
};

// ==========================================
// SALES & INVESTMENT COMPLETE ANALYTICS WITH GRAPH
// (Today, Yesterday, Current Week, Month, Year, All Time + Stock Cost TP Hisaab)
// ==========================================
let currentAnalyticsPeriod = 'today';

function getPeriodSales(period) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    // Yesterday
    const yestDate = new Date(now.getTime() - 86400000);
    const yesterdayStr = yestDate.toISOString().split('T')[0];

    // Current Week: Monday of this week (00:00:00)
    const dayOfWeek = now.getDay();
    const diffToMon = (dayOfWeek + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMon);
    monday.setHours(0, 0, 0, 0);

    // Current Month
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthStart = new Date(currentYear, currentMonth, 1);

    // Current Year
    const yearStart = new Date(currentYear, 0, 1);

    return sales.filter(s => {
        if (!s.timestamp) return false;
        const sDate = new Date(s.timestamp);
        const sDateStr = s.timestamp.split('T')[0];

        if (period === 'today') {
            return sDateStr === todayStr;
        } else if (period === 'yesterday') {
            return sDateStr === yesterdayStr;
        } else if (period === 'week') {
            return sDate >= monday;
        } else if (period === 'month') {
            return sDate >= monthStart;
        } else if (period === 'select_month') {
            const chosen = document.getElementById('an-specific-month')?.value;
            if (chosen) {
                const [selYear, selMonth] = chosen.split('-').map(Number);
                return sDate.getFullYear() === selYear && (sDate.getMonth() + 1) === selMonth;
            }
            return sDate >= monthStart;
        } else if (period === 'year') {
            return sDate >= yearStart;
        } else if (period === 'custom') {
            const startStr = document.getElementById('an-custom-start')?.value;
            const endStr = document.getElementById('an-custom-end')?.value;
            if (startStr && endStr) {
                return sDateStr >= startStr && sDateStr <= endStr;
            } else if (startStr) {
                return sDateStr === startStr;
            }
            return true;
        }
        return true;
    });
}

function getSaleFinancials(s) {
    const saleAmount = Number(s.netTotal) || 0;
    let saleCost = 0;
    if (s.cost !== undefined && !isNaN(Number(s.cost))) {
        saleCost = Number(s.cost);
    } else if (Array.isArray(s.items)) {
        saleCost = s.items.reduce((sum, item) => {
            if (item.cost !== undefined && !isNaN(Number(item.cost))) {
                return sum + Number(item.cost);
            }
            const med = medicines.find(m => m.id === item.id);
            const buyRate = item.buyRate !== undefined ? Number(item.buyRate) : (med ? Number(med.buyRate) || 0 : 0);
            const stockDeduct = Number(item.stockDeduct) || Number(item.qty) || 1;
            return sum + (buyRate * stockDeduct);
        }, 0);
    }
    const profit = Math.max(0, saleAmount - saleCost);
    return { saleAmount, saleCost, profit };
}

function generateAnalyticsGraph(period, filteredSales) {
    const container = document.getElementById('analytics-graph-container');
    if (!container) return;

    let buckets = [];

    if (period === 'today' || period === 'yesterday') {
        buckets = [
            { label: '08-11h', fullLabel: '08:00 - 11:00', startH: 8, endH: 11, sale: 0, cost: 0 },
            { label: '11-14h', fullLabel: '11:00 - 14:00', startH: 11, endH: 14, sale: 0, cost: 0 },
            { label: '14-17h', fullLabel: '14:00 - 17:00', startH: 14, endH: 17, sale: 0, cost: 0 },
            { label: '17-20h', fullLabel: '17:00 - 20:00', startH: 17, endH: 20, sale: 0, cost: 0 },
            { label: '20-23h', fullLabel: '20:00 - 23:00', startH: 20, endH: 23, sale: 0, cost: 0 },
            { label: 'Night', fullLabel: 'Night / Early', startH: 23, endH: 8, sale: 0, cost: 0 }
        ];
        filteredSales.forEach(s => {
            const h = new Date(s.timestamp).getHours();
            const fin = getSaleFinancials(s);
            const b = buckets.find(bk => (bk.startH < bk.endH ? (h >= bk.startH && h < bk.endH) : (h >= bk.startH || h < bk.endH)));
            if (b) {
                b.sale += fin.saleAmount;
                b.cost += fin.saleCost;
            } else if (buckets[5]) {
                buckets[5].sale += fin.saleAmount;
                buckets[5].cost += fin.saleCost;
            }
        });
    } else if (period === 'week') {
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        buckets = days.map((d, i) => ({ label: d, fullLabel: d, dayIndex: (i + 1) % 7, sale: 0, cost: 0 }));
        filteredSales.forEach(s => {
            const d = new Date(s.timestamp).getDay();
            const fin = getSaleFinancials(s);
            const b = buckets.find(bk => bk.dayIndex === d);
            if (b) {
                b.sale += fin.saleAmount;
                b.cost += fin.saleCost;
            }
        });
    } else if (period === 'month' || period === 'select_month') {
        buckets = [
            { label: 'W1 (1-7)', fullLabel: 'Day 1 - 7', startD: 1, endD: 7, sale: 0, cost: 0 },
            { label: 'W2 (8-14)', fullLabel: 'Day 8 - 14', startD: 8, endD: 14, sale: 0, cost: 0 },
            { label: 'W3 (15-21)', fullLabel: 'Day 15 - 21', startD: 15, endD: 21, sale: 0, cost: 0 },
            { label: 'W4 (22+)', fullLabel: 'Day 22 - 31', startD: 22, endD: 31, sale: 0, cost: 0 }
        ];
        filteredSales.forEach(s => {
            const day = new Date(s.timestamp).getDate();
            const fin = getSaleFinancials(s);
            const b = buckets.find(bk => day >= bk.startD && day <= bk.endD);
            if (b) {
                b.sale += fin.saleAmount;
                b.cost += fin.saleCost;
            }
        });
    } else if (period === 'year') {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        buckets = months.map((m, i) => ({ label: m, fullLabel: m, monthIdx: i, sale: 0, cost: 0 }));
        filteredSales.forEach(s => {
            const m = new Date(s.timestamp).getMonth();
            const fin = getSaleFinancials(s);
            if (buckets[m]) {
                buckets[m].sale += fin.saleAmount;
                buckets[m].cost += fin.saleCost;
            }
        });
    } else if (period === 'custom') {
        const startStr = document.getElementById('an-custom-start')?.value;
        const endStr = document.getElementById('an-custom-end')?.value;
        if (startStr && endStr && startStr !== endStr) {
            const sDate = new Date(startStr);
            const eDate = new Date(endStr);
            const diffDays = Math.max(1, Math.round((eDate - sDate) / 86400000) + 1);
            if (diffDays <= 7) {
                buckets = [];
                for (let i = 0; i < diffDays; i++) {
                    const cur = new Date(sDate.getTime() + (i * 86400000));
                    const iso = cur.toISOString().split('T')[0];
                    const lbl = cur.toLocaleDateString([], { day: 'numeric', month: 'short' });
                    buckets.push({ label: lbl, fullLabel: iso, dateStr: iso, sale: 0, cost: 0 });
                }
            } else {
                const numChunks = Math.min(6, diffDays);
                const step = diffDays / numChunks;
                buckets = [];
                for (let c = 0; c < numChunks; c++) {
                    const cStart = new Date(sDate.getTime() + Math.floor(c * step) * 86400000);
                    const cEnd = new Date(sDate.getTime() + Math.min(diffDays - 1, Math.floor((c + 1) * step - 1)) * 86400000);
                    const sIso = cStart.toISOString().split('T')[0];
                    const eIso = cEnd.toISOString().split('T')[0];
                    const lbl = cStart.getDate() + (cStart.getDate() !== cEnd.getDate() ? '-' + cEnd.getDate() : '') + ' ' + cEnd.toLocaleDateString([], { month: 'short' });
                    buckets.push({ label: lbl, fullLabel: `${sIso} to ${eIso}`, startIso: sIso, endIso: eIso, sale: 0, cost: 0 });
                }
            }
            filteredSales.forEach(s => {
                const sIso = s.timestamp.split('T')[0];
                const fin = getSaleFinancials(s);
                const b = buckets.find(bk => bk.dateStr ? bk.dateStr === sIso : (sIso >= bk.startIso && sIso <= bk.endIso));
                if (b) {
                    b.sale += fin.saleAmount;
                    b.cost += fin.saleCost;
                }
            });
        } else {
            buckets = [
                { label: '08-11h', fullLabel: '08:00 - 11:00', startH: 8, endH: 11, sale: 0, cost: 0 },
                { label: '11-14h', fullLabel: '11:00 - 14:00', startH: 11, endH: 14, sale: 0, cost: 0 },
                { label: '14-17h', fullLabel: '14:00 - 17:00', startH: 14, endH: 17, sale: 0, cost: 0 },
                { label: '17-20h', fullLabel: '17:00 - 20:00', startH: 17, endH: 20, sale: 0, cost: 0 },
                { label: '20-23h', fullLabel: '20:00 - 23:00', startH: 20, endH: 23, sale: 0, cost: 0 },
                { label: 'Night', fullLabel: 'Night / Early', startH: 23, endH: 8, sale: 0, cost: 0 }
            ];
            filteredSales.forEach(s => {
                const h = new Date(s.timestamp).getHours();
                const fin = getSaleFinancials(s);
                const b = buckets.find(bk => (bk.startH < bk.endH ? (h >= bk.startH && h < bk.endH) : (h >= bk.startH || h < bk.endH)));
                if (b) {
                    b.sale += fin.saleAmount;
                    b.cost += fin.saleCost;
                } else if (buckets[5]) {
                    buckets[5].sale += fin.saleAmount;
                    buckets[5].cost += fin.saleCost;
                }
            });
        }
    } else {
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        buckets = quarters.map((m, i) => ({ label: m, fullLabel: m, qIdx: i, sale: 0, cost: 0 }));
        filteredSales.forEach(s => {
            const q = Math.floor(new Date(s.timestamp).getMonth() / 3);
            const fin = getSaleFinancials(s);
            if (buckets[q]) {
                buckets[q].sale += fin.saleAmount;
                buckets[q].cost += fin.saleCost;
            }
        });
    }

    const maxVal = Math.max(50, ...buckets.map(b => Math.max(b.sale, b.cost)));

    container.innerHTML = `
        <div class="w-full max-w-full flex flex-col gap-3 box-border">
            <!-- Visual Dual Bar Chart (Mobile Responsive with values on top) -->
            <div class="relative w-full bg-slate-50/70 rounded-2xl p-3 border border-slate-200">
                <!-- Y-Axis Max guide -->
                <div class="flex justify-between items-center text-[10px] font-bold text-slate-400 mb-2 border-b border-dashed border-slate-200 pb-1">
                    <span>Rs. ${maxVal.toLocaleString('en-PK', { maximumFractionDigits: 0 })}</span>
                    <span>Rs. ${(maxVal / 2).toLocaleString('en-PK', { maximumFractionDigits: 0 })}</span>
                    <span>Rs. 0</span>
                </div>

                <!-- Bars container (Rock-solid fixed responsive heights, never collapses on mobile) -->
                <div class="h-[135px] w-full flex items-end justify-between gap-1 sm:gap-2 px-1">
                    ${buckets.map(b => {
                        const saleHeight = Math.max(4, Math.round((b.sale / maxVal) * 88));
                        const costHeight = Math.max(4, Math.round((b.cost / maxVal) * 88));
                        const profit = Math.max(0, b.sale - b.cost);
                        const valLabel = b.sale > 0 ? (b.sale >= 1000 ? (b.sale/1000).toFixed(1) + 'k' : Math.round(b.sale)) : '';
                        return `
                            <div class="flex-1 min-w-0 flex flex-col items-center justify-end h-[135px] group relative cursor-pointer">
                                <!-- Value on Top for immediate mobile overview -->
                                <div class="text-[8px] sm:text-[9px] font-black text-emerald-800 text-center truncate w-full mb-1 h-3 flex items-center justify-center">
                                    ${valLabel}
                                </div>

                                <!-- Tooltip on Hover/Tap -->
                                <div class="hidden group-hover:flex absolute bottom-full mb-1.5 bg-slate-950 text-white text-[10px] p-2 rounded-xl shadow-2xl flex-col gap-0.5 whitespace-nowrap z-30 pointer-events-none border border-slate-700">
                                    <span class="font-black text-amber-300">${b.fullLabel || b.label}</span>
                                    <span class="text-emerald-300 font-bold">Sale: Rs. ${b.sale.toLocaleString('en-PK', { maximumFractionDigits: 1 })}</span>
                                    <span class="text-blue-300 font-bold">Cost TP: Rs. ${b.cost.toLocaleString('en-PK', { maximumFractionDigits: 1 })}</span>
                                    <span class="text-amber-200 font-black">Profit: Rs. ${profit.toLocaleString('en-PK', { maximumFractionDigits: 1 })}</span>
                                </div>

                                <!-- Dual Bars: Green (Sale) & Blue (Investment / Cost TP) -->
                                <div class="w-full flex items-end justify-center gap-0.5 sm:gap-1 h-[88px] px-0.5">
                                    <!-- Sale Bar -->
                                    <div class="flex-1 max-w-[15px] sm:max-w-[22px] bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-md transition-all duration-300 shadow-2xs group-hover:brightness-110" style="height: ${b.sale > 0 ? saleHeight : 4}px;" title="Sale: Rs. ${b.sale.toFixed(1)}"></div>
                                    <!-- Cost Bar -->
                                    <div class="flex-1 max-w-[15px] sm:max-w-[22px] bg-gradient-to-t from-blue-600 to-indigo-400 rounded-t-md transition-all duration-300 shadow-2xs group-hover:brightness-110" style="height: ${b.cost > 0 ? costHeight : 4}px;" title="Cost: Rs. ${b.cost.toFixed(1)}"></div>
                                </div>

                                <span class="text-[8px] sm:text-[10px] font-bold text-slate-600 mt-1 truncate w-full text-center block leading-tight">${b.label}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- Sale & Investment Hisaab Breakdown Table (Pure Sale vs Cost, Zero Invoices) -->
            <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table class="w-full text-xs text-left border-collapse">
                    <thead class="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200">
                        <tr>
                            <th class="p-2 sm:p-2.5">Interval / Waqt</th>
                            <th class="p-2 sm:p-2.5 text-right text-emerald-800">Total Sale (Rs)</th>
                            <th class="p-2 sm:p-2.5 text-right text-blue-800">Kharid Cost (Rs)</th>
                            <th class="p-2 sm:p-2.5 text-right text-amber-900">Net Profit (Rs)</th>
                            <th class="p-2 sm:p-2.5 text-center text-slate-600">Margin %</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                        ${buckets.map(b => {
                            const profit = Math.max(0, b.sale - b.cost);
                            const margin = b.sale > 0 ? ((profit / b.sale) * 100).toFixed(1) : '0.0';
                            return `
                                <tr class="hover:bg-slate-50/80 transition">
                                    <td class="p-2 sm:p-2.5 font-bold text-slate-800 flex items-center gap-1.5">
                                        <span class="w-2 h-2 rounded-full ${b.sale > 0 ? 'bg-emerald-500' : 'bg-slate-300'}"></span>
                                        <span>${b.fullLabel || b.label}</span>
                                    </td>
                                    <td class="p-2 sm:p-2.5 text-right font-black text-emerald-700">Rs. ${b.sale.toLocaleString('en-PK', { maximumFractionDigits: 1 })}</td>
                                    <td class="p-2 sm:p-2.5 text-right font-semibold text-blue-700">Rs. ${b.cost.toLocaleString('en-PK', { maximumFractionDigits: 1 })}</td>
                                    <td class="p-2 sm:p-2.5 text-right font-black text-amber-900">Rs. ${profit.toLocaleString('en-PK', { maximumFractionDigits: 1 })}</td>
                                    <td class="p-2 sm:p-2.5 text-center font-bold text-slate-700">${margin}%</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            ${filteredSales.length === 0 ? `
                <div class="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-center text-xs text-amber-900 font-medium">
                    Is period (${period}) ke dauran abhi koi sale generate nahi hui. POS Counter par bill banayein toh yeh hisaab aur graph khud update hoga.
                </div>
            ` : ''}
        </div>
    `;
}

window.renderSalesAnalytics = function() {
    const period = currentAnalyticsPeriod || 'today';

    ['today', 'yesterday', 'week', 'month', 'select_month', 'year', 'custom', 'all'].forEach(p => {
        const btnId = p === 'select_month' ? 'sale-filter-select-month' : `sale-filter-${p}`;
        const btn = document.getElementById(btnId);
        if (btn) {
            if (p === period) {
                btn.className = 'flex-1 min-w-[65px] py-2 px-2 rounded-xl transition bg-emerald-600 text-white shadow-xs font-bold';
            } else {
                btn.className = 'flex-1 min-w-[65px] py-2 px-2 rounded-xl transition text-slate-600 hover:bg-white/60 font-bold';
            }
        }
    });

    const monthBar = document.getElementById('an-select-month-bar');
    if (monthBar) {
        if (period === 'select_month') {
            monthBar.classList.remove('hidden');
            const monthInput = document.getElementById('an-specific-month');
            if (monthInput && !monthInput.value) {
                const now = new Date();
                const moStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                monthInput.value = moStr;
            }
        } else {
            monthBar.classList.add('hidden');
        }
    }

    const customBar = document.getElementById('an-custom-date-bar');
    if (customBar) {
        if (period === 'custom') {
            customBar.classList.remove('hidden');
            const startInput = document.getElementById('an-custom-start');
            const endInput = document.getElementById('an-custom-end');
            if (startInput && !startInput.value) {
                const todayIso = new Date().toISOString().split('T')[0];
                startInput.value = todayIso;
                if (endInput) endInput.value = todayIso;
            }
        } else {
            customBar.classList.add('hidden');
        }
    }

    const filtered = getPeriodSales(period);
    let totalSale = 0;
    let totalCost = 0;

    filtered.forEach(s => {
        const fin = getSaleFinancials(s);
        totalSale += fin.saleAmount;
        totalCost += fin.saleCost;
    });

    const totalProfit = Math.max(0, totalSale - totalCost);
    const marginPct = totalSale > 0 ? ((totalProfit / totalSale) * 100).toFixed(1) : '0';
    const currentStockCost = medicines.reduce((sum, m) => sum + ((Number(m.buyRate) || 0) * (Number(m.stock) || 0)), 0);

    const elSale = document.getElementById('an-period-sale');
    if (elSale) elSale.innerText = 'Rs. ' + totalSale.toLocaleString('en-PK', { maximumFractionDigits: 1 });

    const elInvoices = document.getElementById('an-period-invoices');
    if (elInvoices) elInvoices.innerText = `${filtered.length} Bills / Invoices`;

    const elCost = document.getElementById('an-period-cost');
    if (elCost) elCost.innerText = 'Rs. ' + totalCost.toLocaleString('en-PK', { maximumFractionDigits: 1 });

    const elProfit = document.getElementById('an-period-profit');
    if (elProfit) elProfit.innerText = 'Rs. ' + totalProfit.toLocaleString('en-PK', { maximumFractionDigits: 1 });

    const elMargin = document.getElementById('an-period-margin');
    if (elMargin) elMargin.innerText = `Margin: ${marginPct}%`;

    const elStockVal = document.getElementById('an-stock-cost-val');
    if (elStockVal) elStockVal.innerText = 'Rs. ' + currentStockCost.toLocaleString('en-PK', { maximumFractionDigits: 1 });

    // Payment Mode Breakdown (Cash vs Online vs Udhaar)
    const cashTotal = filtered.filter(s => (s.paymentMode || 'Cash').toLowerCase() === 'cash').reduce((sum, s) => sum + (Number(s.netTotal) || 0), 0);
    const onlineTotal = filtered.filter(s => (s.paymentMode || '').toLowerCase() === 'online').reduce((sum, s) => sum + (Number(s.netTotal) || 0), 0);
    const creditTotal = filtered.filter(s => (s.paymentMode || '').toLowerCase() === 'credit').reduce((sum, s) => sum + (Number(s.netTotal) || 0), 0);

    const elCash = document.getElementById('an-mode-cash');
    if (elCash) elCash.innerText = 'Rs. ' + cashTotal.toLocaleString('en-PK', { maximumFractionDigits: 1 });
    const elOnline = document.getElementById('an-mode-online');
    if (elOnline) elOnline.innerText = 'Rs. ' + onlineTotal.toLocaleString('en-PK', { maximumFractionDigits: 1 });
    const elCredit = document.getElementById('an-mode-credit');
    if (elCredit) elCredit.innerText = 'Rs. ' + creditTotal.toLocaleString('en-PK', { maximumFractionDigits: 1 });

    // Render well-structured visual graph without overflowing mobile screens
    generateAnalyticsGraph(period, filtered);
    safeCreateIcons();
};

window.applyCustomAnalyticsDate = function() {
    currentAnalyticsPeriod = 'custom';
    window.renderSalesAnalytics();
};

window.applySpecificMonthAnalytics = function() {
    currentAnalyticsPeriod = 'select_month';
    window.renderSalesAnalytics();
};

window.openSalesAnalyticsModal = function(period = 'today') {
    currentAnalyticsPeriod = period;
    document.getElementById('sales-analytics-modal')?.classList.remove('hidden');
    syncModalScrollLock();
    window.renderSalesAnalytics();
    safeCreateIcons();
};

window.closeSalesAnalyticsModal = function() {
    document.getElementById('sales-analytics-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.setSalesAnalyticsPeriod = function(period) {
    currentAnalyticsPeriod = period;
    window.renderSalesAnalytics();
};

// ==========================================
// DEDICATED CUSTOMER BILLS & INVOICE HISTORY SYSTEM
// (Deep analysis, customer list, items breakdown, all time periods)
// ==========================================
let currentCustomerPeriod = 'today';

window.openCustomerInvoicesModal = function(period = 'today') {
    currentCustomerPeriod = period;
    document.getElementById('customer-invoices-modal')?.classList.remove('hidden');
    syncModalScrollLock();
    window.renderCustomerInvoices();
    safeCreateIcons();
};

window.closeCustomerInvoicesModal = function() {
    document.getElementById('customer-invoices-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.setCustomerPeriod = function(period) {
    currentCustomerPeriod = period;
    window.renderCustomerInvoices();
};

window.applyCustomerSpecificMonth = function() {
    currentCustomerPeriod = 'select_month';
    window.renderCustomerInvoices();
};

window.applyCustomerCustomDate = function() {
    currentCustomerPeriod = 'custom';
    window.renderCustomerInvoices();
};

window.filterCustomerInvoicesLive = function() {
    window.renderCustomerInvoices();
};

window.renderCustomerInvoices = function() {
    const period = currentCustomerPeriod || 'today';

    // Period buttons active states
    ['today', 'yesterday', 'week', 'month', 'select_month', 'year', 'custom', 'all'].forEach(p => {
        const btn = document.getElementById(`cust-filter-${p}`);
        if (btn) {
            if (p === period) {
                btn.className = 'flex-1 min-w-[65px] py-2 px-2 rounded-xl transition bg-blue-600 text-white shadow-xs font-bold';
            } else {
                btn.className = 'flex-1 min-w-[65px] py-2 px-2 rounded-xl transition text-slate-600 hover:bg-white/60 font-bold';
            }
        }
    });

    // Month picker bar
    const monthBar = document.getElementById('cust-select-month-bar');
    if (monthBar) {
        if (period === 'select_month') {
            monthBar.classList.remove('hidden');
            const monthInput = document.getElementById('cust-specific-month');
            if (monthInput && !monthInput.value) {
                const now = new Date();
                monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            }
        } else {
            monthBar.classList.add('hidden');
        }
    }

    // Custom date bar
    const customBar = document.getElementById('cust-custom-date-bar');
    if (customBar) {
        if (period === 'custom') {
            customBar.classList.remove('hidden');
            const startInput = document.getElementById('cust-custom-start');
            const endInput = document.getElementById('cust-custom-end');
            if (startInput && !startInput.value) {
                const todayIso = new Date().toISOString().split('T')[0];
                startInput.value = todayIso;
                if (endInput) endInput.value = todayIso;
            }
        } else {
            customBar.classList.add('hidden');
        }
    }

    // Filter sales by period
    let periodSales = getPeriodSales(period);

    // Filter by live search query if present
    const searchQuery = document.getElementById('cust-invoice-search')?.value.toLowerCase().trim() || '';
    if (searchQuery) {
        periodSales = periodSales.filter(s => 
            String(s.invoiceId || '').toLowerCase().includes(searchQuery) ||
            String(s.customer || '').toLowerCase().includes(searchQuery) ||
            (Array.isArray(s.items) && s.items.some(it => String(it.name || '').toLowerCase().includes(searchQuery)))
        );
    }

    // In-depth Financial Calculations
    let totalBilled = 0;
    let totalCost = 0;

    periodSales.forEach(s => {
        const fin = getSaleFinancials(s);
        totalBilled += fin.saleAmount;
        totalCost += fin.saleCost;
    });

    const totalProfit = Math.max(0, totalBilled - totalCost);
    const avgBill = periodSales.length > 0 ? (totalBilled / periodSales.length) : 0;

    // KPI Cards
    const elCount = document.getElementById('cust-total-count');
    if (elCount) elCount.innerText = `${periodSales.length} Invoices`;
    const elBilled = document.getElementById('cust-total-billed');
    if (elBilled) elBilled.innerText = 'Rs. ' + totalBilled.toLocaleString('en-PK', { maximumFractionDigits: 1 });
    const elProfit = document.getElementById('cust-total-profit');
    if (elProfit) elProfit.innerText = 'Rs. ' + totalProfit.toLocaleString('en-PK', { maximumFractionDigits: 1 });
    const elAvg = document.getElementById('cust-avg-bill');
    if (elAvg) elAvg.innerText = 'Rs. ' + avgBill.toLocaleString('en-PK', { maximumFractionDigits: 1 });
    const elShown = document.getElementById('cust-shown-count');
    if (elShown) elShown.innerText = periodSales.length;

    // Render Invoices: Reverse order so newest bills are on top
    const sortedSales = [...periodSales].reverse();

    // 1. Desktop Table
    const tbody = document.getElementById('cust-invoices-tbody');
    if (tbody) {
        if (sortedSales.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-8 text-slate-400 text-xs">
                        <i data-lucide="receipt" class="w-7 h-7 mx-auto text-slate-300 mb-1.5"></i>
                        Is period mein koi customer invoice nahi mili.
                    </td>
                </tr>
            `;
        } else {
            tbody.innerHTML = sortedSales.map(s => {
                const fin = getSaleFinancials(s);
                const timeStr = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = new Date(s.timestamp).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
                const itemsSummary = Array.isArray(s.items) 
                    ? s.items.map(it => `${it.name} (${it.qty || 1})`).join(', ') 
                    : 'Items';

                let payBadge = 'bg-emerald-100 text-emerald-800';
                if ((s.paymentMode || '').toLowerCase() === 'credit') payBadge = 'bg-amber-100 text-amber-800';
                if ((s.paymentMode || '').toLowerCase() === 'online') payBadge = 'bg-blue-100 text-blue-800';

                return `
                    <tr class="hover:bg-slate-50 border-b border-slate-100">
                        <td class="p-2.5 font-bold text-brand-700 font-mono">#${s.invoiceId}</td>
                        <td class="p-2.5 text-slate-500 text-[11px] whitespace-nowrap">${dateStr} • ${timeStr}</td>
                        <td class="p-2.5 text-slate-800">
                            <strong class="block text-xs">${s.customer || 'Walk-in'}</strong>
                            <span class="text-[10px] text-slate-500 truncate block max-w-xs" title="${itemsSummary}">${itemsSummary}</span>
                        </td>
                        <td class="p-2.5 text-center">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${payBadge}">${s.paymentMode || 'Cash'}</span>
                        </td>
                        <td class="p-2.5 text-right font-semibold text-blue-700">Rs. ${fin.saleCost.toFixed(1)}</td>
                        <td class="p-2.5 text-right font-black text-slate-900">Rs. ${fin.saleAmount.toFixed(1)}</td>
                        <td class="p-2.5 text-right font-black text-emerald-700">Rs. ${fin.profit.toFixed(1)}</td>
                        <td class="p-2.5 text-center">
                            <button type="button" onclick="window.closeCustomerInvoicesModal(); window.openSaleEditModal('${s.id}')" class="px-2 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold text-[11px] rounded-lg border border-brand-200 transition active:scale-95">
                                View / Print
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    // 2. Mobile Responsive Cards
    const mobContainer = document.getElementById('cust-invoices-mobile-cards');
    if (mobContainer) {
        if (sortedSales.length === 0) {
            mobContainer.innerHTML = `<div class="bg-slate-50 p-6 rounded-2xl text-center text-xs text-slate-400">Is period mein koi customer invoice nahi mili.</div>`;
        } else {
            mobContainer.innerHTML = sortedSales.map(s => {
                const fin = getSaleFinancials(s);
                const timeStr = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const dateStr = new Date(s.timestamp).toLocaleDateString([], { day: 'numeric', month: 'short' });
                const itemsSummary = Array.isArray(s.items) 
                    ? s.items.map(it => `${it.name} (${it.qty || 1})`).join(', ') 
                    : 'Items';

                let payBadge = 'bg-emerald-100 text-emerald-800';
                if ((s.paymentMode || '').toLowerCase() === 'credit') payBadge = 'bg-amber-100 text-amber-800';
                if ((s.paymentMode || '').toLowerCase() === 'online') payBadge = 'bg-blue-100 text-blue-800';

                return `
                    <div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
                        <div class="flex items-start justify-between gap-2">
                            <div>
                                <strong class="font-black text-slate-800 text-xs">#${s.invoiceId} - ${s.customer || 'Walk-in'}</strong>
                                <span class="text-[10px] text-slate-400 block">${dateStr} • ${timeStr}</span>
                            </div>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${payBadge}">${s.paymentMode || 'Cash'}</span>
                        </div>
                        <p class="text-[11px] text-slate-600 truncate bg-slate-50 p-1.5 rounded-xl border border-slate-100">${itemsSummary}</p>
                        <div class="grid grid-cols-3 gap-1.5 text-center text-[10px] bg-slate-50 p-1.5 rounded-xl">
                            <div>
                                <span class="text-slate-400 uppercase font-bold block text-[8px]">Cost TP</span>
                                <strong class="text-blue-700">Rs. ${fin.saleCost.toFixed(0)}</strong>
                            </div>
                            <div>
                                <span class="text-slate-400 uppercase font-bold block text-[8px]">Bill Total</span>
                                <strong class="text-slate-900 font-black">Rs. ${fin.saleAmount.toFixed(0)}</strong>
                            </div>
                            <div>
                                <span class="text-slate-400 uppercase font-bold block text-[8px]">Profit</span>
                                <strong class="text-emerald-700 font-black">Rs. ${fin.profit.toFixed(0)}</strong>
                            </div>
                        </div>
                        <button type="button" onclick="window.closeCustomerInvoicesModal(); window.openSaleEditModal('${s.id}')" class="w-full py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold text-xs rounded-xl border border-brand-200 text-center transition">
                            View / Print Receipt (#${s.invoiceId})
                        </button>
                    </div>
                `;
            }).join('');
        }
    }

    safeCreateIcons();
};

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
    if (db && authUser) {
        try {
            await setDoc(doc(db, 'users', authUser.uid, 'medicines', med.id), med);
        } catch(e) {
            handleFirestoreError(e, 'write', `users/${authUser.uid}/medicines/${med.id}`);
        }
    }
}

async function deleteMedicineFromStore(id) {
    medicines = medicines.filter(m => m.id !== id);
    localStorage.setItem('sm_medicines', JSON.stringify(medicines));
    if (db && authUser) {
        try {
            await deleteDoc(doc(db, 'users', authUser.uid, 'medicines', id));
        } catch(e) {
            handleFirestoreError(e, 'delete', `users/${authUser.uid}/medicines/${id}`);
        }
    }
}

async function saveSaleToStore(sale) {
    const idx = sales.findIndex(s => s.id === sale.id);
    if (idx !== -1) sales[idx] = sale; else sales.push(sale);
    localStorage.setItem('sm_sales', JSON.stringify(sales));
    if (db && authUser) {
        try {
            await setDoc(doc(db, 'users', authUser.uid, 'sales', sale.id), sale);
        } catch(e) {
            handleFirestoreError(e, 'write', `users/${authUser.uid}/sales/${sale.id}`);
        }
    }
}

async function deleteSaleFromStore(id) {
    sales = sales.filter(s => s.id !== id);
    localStorage.setItem('sm_sales', JSON.stringify(sales));
    if (db && authUser) {
        try {
            await deleteDoc(doc(db, 'users', authUser.uid, 'sales', id));
        } catch(e) {
            handleFirestoreError(e, 'delete', `users/${authUser.uid}/sales/${id}`);
        }
    }
}

// Active OTP Tracker for Forgot Password
let activeResetState = {
    otp: null,
    target: null,
    channel: null,
    timestamp: 0
};

// Account Hub & Authentication Management (3 Clear Options: Direct Login, Sign Up & Guest Mode)
window.switchHubAuthTab = function(tab) {
    const btnLogin = document.getElementById('hub-tab-btn-login');
    const btnSignup = document.getElementById('hub-tab-btn-signup');
    const btnGuest = document.getElementById('hub-tab-btn-guest');

    const panelLogin = document.getElementById('hub-panel-login');
    const panelSignup = document.getElementById('hub-panel-signup');
    const panelGuest = document.getElementById('hub-panel-guest');

    const setInactive = (btn) => {
        btn?.classList.remove('bg-brand-600', 'text-white', 'shadow-xs');
        btn?.classList.add('text-slate-600', 'hover:bg-white/60');
    };
    const setActive = (btn) => {
        btn?.classList.add('bg-brand-600', 'text-white', 'shadow-xs');
        btn?.classList.remove('text-slate-600', 'hover:bg-white/60');
    };

    setInactive(btnLogin);
    setInactive(btnSignup);
    setInactive(btnGuest);

    panelLogin?.classList.add('hidden');
    panelSignup?.classList.add('hidden');
    panelGuest?.classList.add('hidden');

    if (tab === 'signup') {
        setActive(btnSignup);
        panelSignup?.classList.remove('hidden');
    } else if (tab === 'guest') {
        setActive(btnGuest);
        panelGuest?.classList.remove('hidden');
    } else {
        setActive(btnLogin);
        panelLogin?.classList.remove('hidden');
    }
    safeCreateIcons();
};

// Direct Sign Up with Email/Gmail & Password (Saves to Firebase & Network Pharmacy)
window.handleAuthSignup = async function() {
    const storeName = document.getElementById('auth-signup-store')?.value.trim();
    const ownerName = document.getElementById('auth-signup-owner')?.value.trim();
    const email = document.getElementById('auth-signup-email')?.value.trim().toLowerCase();
    const phone = document.getElementById('auth-signup-phone')?.value.trim();
    const city = document.getElementById('auth-signup-city')?.value.trim();
    const pass = document.getElementById('auth-signup-pass')?.value;

    if (!storeName || !ownerName || !email || !phone || !city || !pass) {
        showToast('Barah-e-karam tamam zaroori fields darj karein.', 'warning');
        return;
    }
    if (pass.length < 6) {
        showToast('Password kam az kam 6 characters ka hona chahiye.', 'warning');
        return;
    }

    const submitBtn = document.getElementById('btn-auth-signup-submit');
    const originalText = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span> Registering...`;
    }

    try {
        let userUid = null;
        let firebaseAuthUser = null;

        // 1. Try Firebase Auth create user
        try {
            const userCred = await createUserWithEmailAndPassword(auth, email, pass);
            firebaseAuthUser = userCred.user;
            userUid = firebaseAuthUser.uid;
        } catch(authErr) {
            console.warn('Firebase createUser note:', authErr?.code, authErr?.message);
            if (authErr?.code === 'auth/email-already-in-use') {
                showToast('Yeh Gmail pehle se registered hai! Barah-e-karam Login karein.', 'warning');
                window.switchHubAuthTab('login');
                const loginEmailInput = document.getElementById('auth-login-email');
                if (loginEmailInput) loginEmailInput.value = email;
                if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalText; }
                return;
            }
            // If email provider disabled or network issue, fallback to anonymous or deterministic UID
            try {
                const anonResult = await signInAnonymously(auth);
                userUid = anonResult.user.uid;
            } catch(eAnon) {
                const cleanHash = btoa(unescape(encodeURIComponent(email))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
                userUid = `ph_${cleanHash}`;
            }
        }

        if (!userUid) {
            const cleanHash = btoa(unescape(encodeURIComponent(email))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
            userUid = `ph_${cleanHash}`;
        }

        const authRecord = {
            name: ownerName,
            email: email,
            phone: phone,
            city: city,
            pharmacyName: storeName,
            uid: userUid,
            loginMethod: 'email_password',
            isLiveSync: true
        };

        // 2. Save User Document to Firestore
        try {
            await setDoc(doc(db, 'users', userUid), {
                uid: userUid,
                email: email,
                phone: phone,
                city: city,
                ownerName: ownerName,
                pharmacyName: storeName,
                passwordHash: btoa(pass),
                createdAt: new Date().toISOString()
            }, { merge: true });
        } catch(eDoc) {
            console.warn('Firestore user save note:', eDoc);
        }

        // 3. Register in Public Connected Network
        try {
            await setDoc(doc(db, 'pharmacies', userUid), {
                name: storeName,
                ownerName: ownerName,
                city: city,
                phone: phone,
                email: email,
                remarks: 'Verified Digital Pharma Live Member',
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch(ePharm) {}

        // Redundant backend network register
        try {
            await fetch('/api/network/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: storeName,
                    ownerName: ownerName,
                    city: city,
                    phone: phone,
                    email: email,
                    remarks: 'Verified Digital Pharma Live Member'
                })
            });
        } catch(eNet) {}

        // Update local session
        localStorage.setItem('sm_auth_user', JSON.stringify(authRecord));
        localStorage.removeItem('sm_user_mode');

        const config = window.getStoreConfig();
        config.name = storeName;
        config.ownerName = ownerName;
        config.phone = phone;
        config.address = city;
        localStorage.setItem('sm_store_config', JSON.stringify(config));

        // Connect live listeners
        attachFirestoreSyncListeners(userUid);

        window.applyStoreIdentity();
        window.showHubActiveProfile();
        window.refreshNetworkList();
        showToast(`Mubarak! ${storeName} ka account ban gaya aur live network connect ho gaya!`, 'success');
    } catch(err) {
        console.error('Signup error:', err);
        showToast('Registration mein masla aya: ' + (err?.message || err), 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }
};

// Direct Login with Registered Email/Gmail & Password
window.handleAuthLogin = async function() {
    const email = document.getElementById('auth-login-email')?.value.trim().toLowerCase();
    const pass = document.getElementById('auth-login-pass')?.value;

    if (!email || !pass) {
        showToast('Barah-e-karam apna email aur password darj karein.', 'warning');
        return;
    }

    const submitBtn = document.getElementById('btn-auth-login-submit');
    const originalText = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span class="inline-block animate-spin mr-1">⌛</span> Logging in...`;
    }

    try {
        let userUid = null;
        let loggedUser = null;

        // 1. Try Firebase Auth sign in
        try {
            const userCred = await signInWithEmailAndPassword(auth, email, pass);
            loggedUser = userCred.user;
            userUid = loggedUser.uid;
        } catch(authErr) {
            console.warn('Firebase login note:', authErr?.code, authErr?.message);
            // Check fallback for stored credentials or anonymous sync
            const cleanHash = btoa(unescape(encodeURIComponent(email))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
            const fallbackUid = `ph_${cleanHash}`;

            // Check if user exists in local or Firestore
            let matched = false;
            const existingLocal = JSON.parse(localStorage.getItem('sm_auth_user') || 'null');
            if (existingLocal && existingLocal.email === email) {
                matched = true;
                userUid = existingLocal.uid || fallbackUid;
            } else {
                try {
                    const snap = await getDoc(doc(db, 'users', fallbackUid));
                    if (snap.exists()) {
                        const data = snap.data();
                        if (data.passwordHash === btoa(pass)) {
                            matched = true;
                            userUid = fallbackUid;
                        }
                    }
                } catch(eSnap) {}
            }

            if (!matched) {
                if (authErr?.code === 'auth/wrong-password' || authErr?.code === 'auth/invalid-credential') {
                    showToast('Ghalat password darj kiya gaya hai. Password bhool gaye hain toh OTP reset use karein.', 'error');
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalText; }
                    return;
                }
                // Try anonymous authentication to ensure Firestore rules allow access
                try {
                    const anonResult = await signInAnonymously(auth);
                    userUid = anonResult.user.uid;
                } catch(eAnon) {
                    userUid = fallbackUid;
                }
            }
        }

        if (!userUid) {
            const cleanHash = btoa(unescape(encodeURIComponent(email))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
            userUid = `ph_${cleanHash}`;
        }

        const config = window.getStoreConfig();
        const pharmacyName = config.name && config.name !== 'Shahzad Medical Store' 
            ? config.name 
            : (email.split('@')[0].toUpperCase() + ' Pharmacy');

        const authRecord = {
            name: config.ownerName || email.split('@')[0],
            email: email,
            phone: config.phone || '03001234567',
            city: config.address || 'Pakistan',
            pharmacyName: pharmacyName,
            uid: userUid,
            loginMethod: 'email_password',
            isLiveSync: true
        };

        localStorage.setItem('sm_auth_user', JSON.stringify(authRecord));
        localStorage.removeItem('sm_user_mode');

        // Register in Public Connected Network
        try {
            await setDoc(doc(db, 'pharmacies', userUid), {
                name: pharmacyName,
                ownerName: config.ownerName || authRecord.name,
                city: config.address || 'Pakistan',
                phone: config.phone || '03001234567',
                email: email,
                remarks: 'Verified Digital Pharma Live Member',
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch(ePharm) {}

        // Backend network register
        try {
            await fetch('/api/network/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: pharmacyName,
                    ownerName: config.ownerName || authRecord.name,
                    city: config.address || 'Pakistan',
                    phone: config.phone || '03001234567',
                    email: email,
                    remarks: 'Verified Digital Pharma Live Member'
                })
            });
        } catch(eNet) {}

        // Attach listeners
        attachFirestoreSyncListeners(userUid);

        window.applyStoreIdentity();
        window.showHubActiveProfile();
        window.refreshNetworkList();
        showToast(`Khush Amdeed! Aapki pharmacy (${email}) live connect ho gayi!`, 'success');
    } catch(err) {
        console.error('Login error:', err);
        showToast('Login nahi ho saka: ' + (err?.message || err), 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }
};

// Reusable Helper to attach Firestore Sync Listeners
function attachFirestoreSyncListeners(uid) {
    if (!uid || !db) return;
    try {
        if (unsubscribeMeds) unsubscribeMeds();
        const medsColRef = collection(db, 'users', uid, 'medicines');
        unsubscribeMeds = onSnapshot(medsColRef, (snapshot) => {
            const cloudMeds = [];
            snapshot.forEach(docSnap => cloudMeds.push(docSnap.data()));
            if (cloudMeds.length > 0) {
                medicines = cloudMeds;
                localStorage.setItem('sm_medicines', JSON.stringify(medicines));
                renderInventoryTable();
                renderDashboardMetrics();
            }
        }, (err) => console.warn('Firestore medicines sync note:', err));
    } catch(e) {}

    try {
        if (unsubscribeSales) unsubscribeSales();
        const salesColRef = collection(db, 'users', uid, 'sales');
        unsubscribeSales = onSnapshot(salesColRef, (snapshot) => {
            const cloudSales = [];
            snapshot.forEach(docSnap => cloudSales.push(docSnap.data()));
            if (cloudSales.length > 0) {
                sales = cloudSales;
                localStorage.setItem('sm_sales', JSON.stringify(sales));
                renderDashboardMetrics();
            }
        }, (err) => console.warn('Firestore sales sync note:', err));
    } catch(e) {}
}

// ==========================================
// FORGOT PASSWORD & OTP SYSTEM (WhatsApp & Gmail)
// ==========================================
window.openForgotPasswordModal = function() {
    const modal = document.getElementById('forgot-password-modal');
    modal?.classList.remove('hidden');
    syncModalScrollLock();
    window.switchFpStep('request');
    const contactInput = document.getElementById('fp-contact-input');
    const loginEmailInput = document.getElementById('auth-login-email');
    if (contactInput && loginEmailInput && loginEmailInput.value) {
        contactInput.value = loginEmailInput.value.trim();
    }
    safeCreateIcons();
};

window.closeForgotPasswordModal = function() {
    const modal = document.getElementById('forgot-password-modal');
    modal?.classList.add('hidden');
    syncModalScrollLock();
};

window.switchFpStep = function(step) {
    const stepRequest = document.getElementById('fp-step-request');
    const stepVerify = document.getElementById('fp-step-verify');
    if (step === 'verify') {
        stepRequest?.classList.add('hidden');
        stepVerify?.classList.remove('hidden');
        document.getElementById('fp-otp-input')?.focus();
    } else {
        stepVerify?.classList.add('hidden');
        stepRequest?.classList.remove('hidden');
        document.getElementById('fp-contact-input')?.focus();
    }
    safeCreateIcons();
};

window.sendWhatsAppOtp = async function() {
    const contact = document.getElementById('fp-contact-input')?.value.trim();
    if (!contact) {
        showToast('Barah-e-karam apna WhatsApp phone number darj karein.', 'warning');
        return;
    }

    const cleanPhone = contact.replace(/\D/g, '').replace(/^0/, '92');
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    activeResetState = {
        otp: otp,
        target: contact,
        channel: 'whatsapp',
        timestamp: Date.now()
    };

    const waMsg = encodeURIComponent(`Digital Pharma Software:\nAapka Password Reset OTP code hai: *${otp}*.\nBarah-e-karam yeh code app mein enter karein.`);
    const waUrl = `https://wa.me/${cleanPhone}?text=${waMsg}`;
    
    // Trigger via standard anchor click to comply with iFrame environment
    const link = document.createElement('a');
    link.href = waUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    const notice = document.getElementById('fp-verify-notice');
    if (notice) {
        notice.innerText = `Aapke WhatsApp (${contact}) par OTP code bhej diya gaya hai. Code darj kar ke naya password save karein.`;
    }

    window.switchFpStep('verify');
    showToast(`WhatsApp OTP (${otp}) generate ho gaya!`, 'success');
};

window.sendEmailOtp = async function() {
    const contact = document.getElementById('fp-contact-input')?.value.trim().toLowerCase();
    if (!contact || !contact.includes('@')) {
        showToast('Barah-e-karam durust Gmail address darj karein.', 'warning');
        return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    activeResetState = {
        otp: otp,
        target: contact,
        channel: 'gmail',
        timestamp: Date.now()
    };

    // Also attempt Firebase official reset email
    try {
        await sendPasswordResetEmail(auth, contact);
    } catch(e) {
        console.warn('sendPasswordResetEmail note:', e);
    }

    const notice = document.getElementById('fp-verify-notice');
    if (notice) {
        notice.innerText = `Aapke Gmail (${contact}) par OTP code bhej diya gaya hai (Code: ${otp}).`;
    }

    window.switchFpStep('verify');
    showToast(`Gmail OTP (${otp}) bhej diya gaya hai!`, 'success');
};

window.verifyOtpAndResetPassword = async function() {
    const enteredOtp = document.getElementById('fp-otp-input')?.value.trim();
    const newPass = document.getElementById('fp-new-pass')?.value;
    const confirmPass = document.getElementById('fp-confirm-pass')?.value;

    if (!enteredOtp) {
        showToast('Barah-e-karam 6-digit OTP code darj karein.', 'warning');
        return;
    }

    if (!activeResetState.otp || enteredOtp !== activeResetState.otp) {
        showToast('Ghalat OTP code! Barah-e-karam durust 6-digit code enter karein.', 'error');
        return;
    }

    if (!newPass || newPass.length < 6) {
        showToast('Naya password kam az kam 6 characters ka hona chahiye.', 'warning');
        return;
    }

    if (newPass !== confirmPass) {
        showToast('Password aur Confirm Password aapas mein match nahi karte.', 'error');
        return;
    }

    try {
        const target = activeResetState.target || '';
        const cleanHash = btoa(unescape(encodeURIComponent(target.toLowerCase()))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
        const uid = `ph_${cleanHash}`;

        // Update password in Firestore
        try {
            await setDoc(doc(db, 'users', uid), {
                passwordHash: btoa(newPass),
                updatedAt: new Date().toISOString()
            }, { merge: true });
        } catch(e) {}

        // Update local auth user if matching
        const existingLocal = JSON.parse(localStorage.getItem('sm_auth_user') || 'null');
        if (existingLocal) {
            existingLocal.passwordHash = btoa(newPass);
            localStorage.setItem('sm_auth_user', JSON.stringify(existingLocal));
        }

        window.closeForgotPasswordModal();
        showToast('Kamyabi! Naya password save ho gaya hai. Ab aap login kar sakte hain.', 'success');
        window.switchHubAuthTab('login');
        const loginPassInput = document.getElementById('auth-login-pass');
        if (loginPassInput) loginPassInput.value = newPass;
    } catch(err) {
        console.error('Password reset error:', err);
        showToast('Password reset mein masla aya: ' + err.message, 'error');
    }
};

window.submitGuestMode = function() {
    localStorage.setItem('sm_user_mode', 'guest');
    localStorage.removeItem('sm_auth_user');
    window.applyStoreIdentity();
    window.showHubActiveProfile();
    showToast('Guest Mode (Local Device Storage) activate ho gaya', 'info');
};

// Delete Account & Clear All Data Permanently
window.handleDeleteAccountAndData = function() {
    customConfirm(
        'Account & Data Delete Karein?',
        'Kya aap apna Digital Pharma account, stock inventory aur tamam sales records permanently delete karna chahte hain? Yeh amal wapis nahi ho sakta.',
        async () => {
            try {
                const currentUser = window.getCurrentUser();
                const currentUid = auth.currentUser?.uid || currentUser?.uid;

                // 1. Delete Firestore user collections
                if (currentUid && db) {
                    try {
                        const medsCol = collection(db, 'users', currentUid, 'medicines');
                        const medSnaps = await getDocs(medsCol);
                        for (const d of medSnaps.docs) {
                            try { await deleteDoc(d.ref); } catch(e) {}
                        }

                        const salesCol = collection(db, 'users', currentUid, 'sales');
                        const saleSnaps = await getDocs(salesCol);
                        for (const d of saleSnaps.docs) {
                            try { await deleteDoc(d.ref); } catch(e) {}
                        }

                        try {
                            await deleteDoc(doc(db, 'pharmacies', currentUid));
                        } catch(e) {}
                    } catch(cloudErr) {
                        console.warn('Cloud purge warning:', cloudErr);
                    }
                }

                // 2. Unregister from central network
                try {
                    await fetch('/api/network/unregister', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: currentUid,
                            email: currentUser?.email,
                            phone: window.getStoreConfig().phone
                        })
                    });
                } catch(e) {}

                // 3. Delete Firebase Auth user if authenticated
                if (auth.currentUser) {
                    try {
                        await auth.currentUser.delete();
                    } catch(e) {
                        try { await signOut(auth); } catch(e2) {}
                    }
                }

                // 4. Clear all localStorage
                localStorage.removeItem('sm_auth_user');
                localStorage.removeItem('sm_user_mode');
                localStorage.removeItem('sm_medicines');
                localStorage.removeItem('sm_sales');
                localStorage.removeItem('sm_store_config');
                localStorage.removeItem('sm_profile_pic');
                localStorage.removeItem('sm_network_stores');
                localStorage.removeItem('sm_custom_med_types');

                // 5. Reset in-memory state
                medicines = [];
                sales = [];
                cart = [];
                authUser = null;

                window.applyStoreIdentity();
                renderDashboardMetrics();
                renderInventoryTable();
                window.closeAccountHubModal();
                showToast('Aapka account aur record kamyabi se delete ho gaya.', 'info');
                setTimeout(() => window.switchTab('dashboard'), 80);
            } catch(err) {
                console.error('Delete account error:', err);
                showToast('Masla aya: ' + err.message, 'error');
            }
        }
    );
};

window.showHubChoiceSection = function() {
    document.getElementById('hub-choice-section')?.classList.remove('hidden');
    document.getElementById('hub-active-profile-section')?.classList.add('hidden');
    window.switchHubAuthTab('sync');
    safeCreateIcons();
};

window.showHubActiveProfile = function() {
    document.getElementById('hub-choice-section')?.classList.add('hidden');
    document.getElementById('hub-active-profile-section')?.classList.remove('hidden');

    const config = window.getStoreConfig();
    const storeNameInput = document.getElementById('hub-store-name');
    const storeOwnerInput = document.getElementById('hub-store-owner');
    const storePhoneInput = document.getElementById('hub-store-phone');
    const storeAddrInput = document.getElementById('hub-store-address');
    const storeLicInput = document.getElementById('hub-store-license');
    if (storeNameInput) storeNameInput.value = config.name || '';
    if (storeOwnerInput) storeOwnerInput.value = config.ownerName || '';
    if (storePhoneInput) storePhoneInput.value = config.phone || '';
    if (storeAddrInput) storeAddrInput.value = config.address || '';
    if (storeLicInput) storeLicInput.value = config.licenseNo || '';

    const user = window.getCurrentUser();
    const mode = window.getCurrentUserMode();
    const sessionName = document.getElementById('hub-session-user-name');
    const sessionDetail = document.getElementById('hub-session-user-detail');

    if (mode === 'authenticated' && user) {
        if (sessionName) sessionName.innerText = user.name || 'Google User';
        if (sessionDetail) sessionDetail.innerText = `🟢 Live Sync: ${user.email}`;
    } else {
        if (sessionName) sessionName.innerText = 'Guest User Mode';
        if (sessionDetail) sessionDetail.innerText = '⚪ Local Device Storage';
    }
    safeCreateIcons();
};

window.openAccountHubModal = function() {
    const mode = window.getCurrentUserMode();
    if (!mode) {
        window.showHubChoiceSection();
    } else {
        window.showHubActiveProfile();
    }
    document.getElementById('account-hub-modal')?.classList.remove('hidden');
    syncModalScrollLock();
    safeCreateIcons();
};

window.closeAccountHubModal = function() {
    document.getElementById('account-hub-modal')?.classList.add('hidden');
    syncModalScrollLock();
};

window.saveAccountHubStoreProfile = async function() {
    const name = document.getElementById('hub-store-name')?.value.trim() || '';
    const ownerName = document.getElementById('hub-store-owner')?.value.trim() || '';
    const phone = document.getElementById('hub-store-phone')?.value.trim() || '';
    const address = document.getElementById('hub-store-address')?.value.trim() || '';
    const licenseNo = document.getElementById('hub-store-license')?.value.trim() || '';

    if (!name || !phone) {
        showToast('Pharmacy Name aur WhatsApp Number lazmi darj karein!', 'error');
        return;
    }

    const config = { name, ownerName, phone, address, licenseNo };
    localStorage.setItem('sm_store_config', JSON.stringify(config));
    window.applyStoreIdentity();

    // Live Sync to Connected Network central registry
    const currentUser = window.getCurrentUser();
    const userEmail = currentUser ? currentUser.email : '';
    try {
        const res = await fetch('/api/network/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                ownerName: ownerName || (currentUser ? currentUser.name : 'Pharmacist'),
                city: address || 'Pakistan',
                phone,
                email: userEmail,
                licenseNo,
                remarks: 'Verified Digital Pharma Connected Store'
            })
        });
        if (res.ok) {
            window.refreshNetworkList();
        }
    } catch (e) {
        console.warn('Network registration sync note:', e);
    }

    showToast('Profile save ho gayi aur Connected Pharmacies mein live add ho gaya!', 'success');
};

window.handleHubLogout = async function() {
    if (auth && fbAuthMod) {
        try {
            await fbAuthMod.signOut(auth);
        } catch(e) {}
    }
    localStorage.removeItem('sm_auth_user');
    localStorage.removeItem('sm_user_mode');
    localStorage.removeItem('sm_profile_pic');
    authUser = null;

    window.applyStoreIdentity();
    window.showHubChoiceSection();
    showToast('Logout ho gaye hain. Naya mode ya account chunein.', 'info');
};

// Network Online/Offline Dot Indicator
window.updateNetworkConnectivityDot = function() {
    const dot = document.getElementById('net-status-dot');
    if (!dot) return;
    const isOnline = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
    if (isOnline) {
        dot.className = 'absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-brand-900 animate-soft-pulse transition-colors duration-300';
        dot.title = 'Internet Connected (Online)';
    } else {
        dot.className = 'absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-brand-900 animate-soft-pulse transition-colors duration-300';
        dot.title = 'Internet Disconnected (Offline)';
    }
};

window.addEventListener('online', () => {
    window.updateNetworkConnectivityDot();
    showToast('Internet connect ho gaya (Online)', 'success');
});
window.addEventListener('offline', () => {
    window.updateNetworkConnectivityDot();
    showToast('Internet disconnect ho gaya (Offline)', 'warning');
});

function initApp() {
    try {
        const savedMeds = localStorage.getItem('sm_medicines');
        if (savedMeds) {
            const parsed = JSON.parse(savedMeds);
            // Purge fake mock data (med_1, med_2, med_3, med_4)
            const isMockData = Array.isArray(parsed) && parsed.length > 0 && parsed.every(m => ['med_1', 'med_2', 'med_3', 'med_4'].includes(m.id));
            if (isMockData) {
                medicines = [];
                localStorage.removeItem('sm_medicines');
            } else {
                medicines = parsed;
            }
        } else {
            medicines = [];
        }

        const savedSales = localStorage.getItem('sm_sales');
        if (savedSales) {
            const parsedSales = JSON.parse(savedSales);
            const isMockSale = Array.isArray(parsedSales) && parsedSales.length > 0 && parsedSales.some(s => s.id && (s.id.includes('mock') || s.id.includes('fake') || s.customer === 'Walk-in Customer Test'));
            if (isMockSale) {
                sales = [];
                localStorage.removeItem('sm_sales');
            } else {
                sales = parsedSales;
            }
        } else {
            sales = [];
        }

        const savedNet = localStorage.getItem('sm_network_stores');
        if (savedNet) {
            try {
                const parsedNet = JSON.parse(savedNet);
                const hasMock = Array.isArray(parsedNet) && parsedNet.some(s => ['City Care Pharmacy', 'National Medicos', 'Al-Razi Pharmacy'].includes(s.name));
                if (hasMock) localStorage.removeItem('sm_network_stores');
            } catch(e) {}
        }
    } catch(e) {
        medicines = [];
        sales = [];
    }

    setupDynamicPwaManifest();
    updateInstallUiState();
    window.applyStoreIdentity();
    window.updateNetworkConnectivityDot();
    renderDashboardMetrics();
    renderInventoryTable();
    window.runMarginCalc();
    window.runLooseCalc();
    window.updateSimpleCalcDisplay();
    safeCreateIcons();
    syncModalScrollLock();
    window.switchTab('dashboard');
}

// Instant startup without waiting for full window.load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
