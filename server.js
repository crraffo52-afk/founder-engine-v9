import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── GEMINI AI SETUP ───────────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY || "AIzaSyB4At3SgZV3p19HL9QWfm-rmSWXI4RzOnc";
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

// ─── LOGGING & BASE ───────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', version: '9.3.2-MASTER-ESM', mode: 'Live-Focus' });
});

// ─── AI ANALYSIS ENDPOINT ─────────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const data = req.body;
  if (!data || !data.home) return res.status(400).json({ error: 'Dati match mancanti' });

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `Analizza come un trader professionista di Betfair Exchange questo match live:
    Match: ${data.home} vs ${data.away}
    Minuto: ${data.minute}'
    Punteggio: ${data.gh}-${data.ga}
    xG: ${data.xgh}-${data.xga}
    Statistiche: ${JSON.stringify(data.stats)}
    
    Fornisci un'analisi brevissima (max 2 righe) con suggerimento operativo (punta/banca/no bet).`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    res.json({ analysis: text });
  } catch (err) {
    console.error('💥 Gemini Error:', err.message);
    res.json({ analysis: `⚠️ Errore AI: ${err.message}. Analisi manuale consigliata.` });
  }
});

// ─── STATIC ROUTING ──────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Founder Engine V9.3.2 (ESM) pronto sulla porta ${PORT}`);
});
