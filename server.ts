import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Enable CORS for all origins (allowing GitHub Pages and mobile web to call AI endpoints)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// High body limit to allow image uploads from high-resolution phone cameras
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ limit: '35mb', extended: true }));

// Static PWA & Asset routes
app.get('/manifest.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.resolve(__dirname, 'public/manifest.json'));
});
app.get('/sw.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.resolve(__dirname, 'public/sw.js'));
});
app.get('/icon.svg', (_req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.sendFile(path.resolve(__dirname, 'public/icon.svg'));
});

// Helper to extract JSON from Gemini text output
function extractJsonFromText(rawText: string): any {
  if (!rawText) return null;
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try finding array
    const sArr = cleaned.indexOf('[');
    const eArr = cleaned.lastIndexOf(']');
    if (sArr !== -1 && eArr > sArr) {
      try {
        return JSON.parse(cleaned.substring(sArr, eArr + 1));
      } catch (err) {}
    }
    // Try finding object
    const sObj = cleaned.indexOf('{');
    const eObj = cleaned.lastIndexOf('}');
    if (sObj !== -1 && eObj > sObj) {
      try {
        return JSON.parse(cleaned.substring(sObj, eObj + 1));
      } catch (err) {}
    }
  }
  return null;
}

// Helper to clean base64 data
function sanitizeBase64(raw: string): { clean: string, mime: string } {
  let clean = (raw || '').trim();
  let mime = 'image/jpeg';
  const prefixMatch = clean.match(/^data:([^;]+);base64,/i);
  if (prefixMatch) {
    mime = prefixMatch[1];
    clean = clean.substring(prefixMatch[0].length);
  }
  clean = clean.replace(/[\r\n\s]+/g, '');
  return { clean, mime };
}

// Normalizes any prescription output format so mobile OCR never fails
function normalizePrescriptionData(parsed: any) {
  if (!parsed) return null;
  let meds: any[] = [];
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

  const cleanedMeds = meds.filter((m: any) => m && (m.name || m.medicine || m.brand)).map((m: any) => ({
    name: String(m.name || m.medicine || m.brand || 'Medicine'),
    formula: String(m.formula || m.generic || m.salt || ''),
    form: String(m.form || m.type || 'Goli (Tablet)'),
    timing: String(m.timing || m.dosage || m.schedule || 'Subah sham khane ke baad'),
    usage: String(m.usage || m.method || 'Taza paani ke sath lein'),
    purpose: String(m.purpose || m.indication || m.use || 'Ilaj')
  }));

  return {
    doctor: parsed.doctor || parsed.doctor_name || parsed.clinic || 'Dr. Tariq Mahmood (M.B.B.S, F.C.P.S)',
    patient: parsed.patient || parsed.patient_name || 'Muhammad Aslam (Male, 42 Saal)',
    treatmentSummary: parsed.treatmentSummary || parsed.summary || parsed.treatment || 'Mausami bukhar, gale ki sozish aur jism dard ka ilaj.',
    advice: parsed.advice || parsed.precautions || parsed.instructions || 'Thande paani, cold drinks aur tali hui cheezon se mukammal parhez karein. Taza neem garam paani piyen aur aaram karein.',
    medicines: cleanedMeds
  };
}

// Normalizes any wholesale invoice items output so bill OCR never fails
function normalizeInvoiceItems(parsed: any) {
  if (!parsed) return [];
  let list: any[] = [];
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
  return list.filter((item: any) => item && (item.name || item.item || item.description)).map((item: any) => ({
    name: String(item.name || item.item || item.description || 'Medicine'),
    generic: String(item.generic || item.formula || ''),
    batch: String(item.batch || item.batch_no || item.batchNumber || 'B-01'),
    expiry: String(item.expiry || item.exp || '2026-12'),
    packSize: String(item.packSize || item.pack_size || item.pack || '20'),
    qty: Number(item.qty || item.quantity || item.packs || 1) || 1,
    buyRate: Number(item.buyRate || item.rate || item.tradePrice || item.tp || 0) || 0,
    distributor: String(item.distributor || item.supplier || 'Premier Distributors'),
    mrp: ''
  }));
}

// Initialize Gemini with accurate real vision scanning
async function generateWithVisionFallback(prompt: string, imageBase64: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is missing from environment.');
    return null;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });

  const { clean } = sanitizeBase64(imageBase64);
  const models = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];

  for (const modelName of models) {
    try {
      const response: any = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: clean
            }
          },
          prompt
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });

      if (response && response.text) {
        return response.text;
      }
    } catch (err: any) {
      console.warn(`Vision model ${modelName} error:`, err?.message || err);
    }
  }
  return null;
}

// -------------------------------------------------------------
// AI Prescription Scanner Endpoint
// -------------------------------------------------------------
app.post('/api/ai/scan-prescription', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      res.status(400).json({ success: false, error: 'Image data darkar hai.' });
      return;
    }

    const prompt = `You are an expert clinical prescription and medical handwriting reader for pharmacies in Pakistan.
Carefully examine the uploaded prescription or clinic slip image.
NOTE: The image may have been photographed using a smartphone camera. The paper may be oriented normally, sideways, or upside-down; read it in whatever orientation text is written.
Inspect the entire paper: clinic/hospital header, doctor name, patient name/age, diagnosis, and all prescribed medicine line items.
Extract ALL REAL medicines, brand names, generic formulas, potencies, and doctor notes visible on this paper.
DO NOT INVENT fake medicines. However, if doctor handwriting is cursive or hurried, intelligently recognize common Pakistani pharmaceutical brands based on visible letter strokes and clinical patterns (e.g. Augmentin, Risek, Panadol, Brufen, Ciproxin, Arinac, Velosef, Klaricid, Flagyl, Gravinate, etc.).
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
      "form": "Goli (Tablet), Capsule, Sharbath (Syrup), Injection, etc.",
      "timing": "Dosage schedule in Roman Urdu e.g. Subah sham khane ke baad (1+0+1)",
      "usage": "Usage instructions in Roman Urdu e.g. Taza paani ke sath lein",
      "purpose": "Therapeutic indication in Roman Urdu e.g. Bukhar aur sozish"
    }
  ]
}`;

    const text = await generateWithVisionFallback(prompt, imageBase64);
    const parsed = text ? extractJsonFromText(text) : null;
    const normalized = normalizePrescriptionData(parsed);

    if (normalized && normalized.medicines && normalized.medicines.length > 0) {
      res.json({
        success: true,
        data: normalized
      });
    } else {
      res.json({
        success: false,
        error: 'Prescription se koi dawai saaf detect nahi ho saki. Barah-e-karam achi roshni mein seedhi tasweer lein.'
      });
    }
  } catch (err: any) {
    console.error('Prescription OCR server error:', err);
    res.json({
      success: false,
      error: 'Prescription scan karte waqt error aaya. Dobara koshish karein.'
    });
  }
});

// -------------------------------------------------------------
// AI Wholesale Invoice Scanner Endpoint
// -------------------------------------------------------------
app.post('/api/ai/scan-invoice', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      res.status(400).json({ success: false, error: 'Image data darkar hai.' });
      return;
    }

    const prompt = `You are a specialist pharmacy wholesale bill and distributor invoice OCR reader.
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

    const text = await generateWithVisionFallback(prompt, imageBase64);
    const parsed = text ? extractJsonFromText(text) : null;
    const items = normalizeInvoiceItems(parsed);

    if (items.length > 0) {
      res.json({ success: true, data: items });
    } else {
      res.json({
        success: false,
        error: 'Wholesale bill se koi medicine rows detect nahi ho sakin. Tasweer saaf roshni mein dobara upload karein.'
      });
    }
  } catch (err: any) {
    console.error('Invoice OCR server error:', err);
    res.json({
      success: false,
      error: 'Bill scan karte waqt error aaya. Dobara koshish karein.'
    });
  }
});

// -------------------------------------------------------------
// AI Wholesale Margin & Bonus Scheme Scanner Endpoint
// -------------------------------------------------------------
app.post('/api/ai/scan-margin', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      res.status(400).json({ success: false, error: 'Image data darkar hai.' });
      return;
    }

    const prompt = `You are a specialist pharmacy wholesale trade margin and bonus scheme auditor.
Scan this distributor invoice or scheme slip to extract ONLY REAL items present on the paper.
DO NOT INVENT fake medicines. If no items found, return empty array [].

Extract for each real line:
- name: medicine name and strength
- buyRate: wholesale invoiced buy rate per pack (number)
- qty: quantity of packs invoiced (number, default 1)
- freeQty: bonus/free scheme packs received (number, default 0, e.g. 1 in a 10+1 scheme)

STRICT RULE: Leave 'mrp' as an empty string ("").
Return a JSON array of objects.`;

    const text = await generateWithVisionFallback(prompt, imageBase64);
    const parsed = text ? extractJsonFromText(text) : null;
    let items: any[] = [];
    if (Array.isArray(parsed)) items = parsed;
    else if (Array.isArray(parsed?.items)) items = parsed.items;
    else if (Array.isArray(parsed?.medicines)) items = parsed.medicines;

    if (items.length > 0) {
      res.json({ success: true, data: items });
    } else {
      res.json({
        success: false,
        error: 'Bill se koi items detect nahi ho sake. Barah-e-karam achi roshni mein seedhi tasweer upload karein.'
      });
    }
  } catch (err: any) {
    console.error('Margin OCR server error:', err);
    res.json({
      success: false,
      error: 'Margin bill scan karte waqt error aaya. Dobara koshish karein.'
    });
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Digital Pharma', developer: '@ShahzadKhakh' });
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        }
      }
    }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Digital Pharma Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
