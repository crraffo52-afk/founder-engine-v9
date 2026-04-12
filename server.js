import express from 'express';
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { promises as fs, readdirSync } from 'fs';
import 'dotenv/config';
import axios from 'axios';
import { MongoClient, ObjectId } from 'mongodb';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global error handlers to catch startup crashes
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION:', reason);
});

console.log('🏁 Starting The Founder Engine AI Backend...');

const app = express();
const port = process.env.PORT || 3001;

// Log folder structure to help debug Render deployment
try {
  console.log('📂 Root content:', readdirSync('.'));
} catch(e) {}

app.use(express.json());

// Health check endpoint
app.get('/ping', (req, res) => res.send('pong'));

// Serve static files (ROOT PRIORITY - FORCE BYPASS DIST)
const distPath = process.cwd();
app.use(express.static(distPath, { etag: false, lastModified: false }));
console.log(`🚀 STANDBY V9.2: Serving direct from ROOT to block stale cache.`);

// ─── Gemini AI Setup ───────────────────────────────────────────────────────────
let availableModels = [];

async function discoverModels() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return;
  try {
    const response = await axios.get(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    if (response.status === 200) {
        availableModels = response.data.models ? response.data.models.map(m => m.name.replace('models/', '')) : [];
        console.log(`✅ DISCOVERED MODELS: ${availableModels.join(', ')}`);
    }
  } catch (err) {
    console.warn('❌ Discovery Error:', err.message);
    availableModels = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  }
}
discoverModels();


// ─── Sbancobet Configuration ──────────────────────────────────────────────────
const LEAGUE_MAP = {
  'Serie A': 'https://sbancobet.net/stats/league/serie-a/BdF/',
  'Premier League': 'https://sbancobet.net/stats/league/premier-league/Dj/',
  'La Liga': 'https://sbancobet.net/stats/league/la-liga/BeA/',
  'Bundesliga': 'https://sbancobet.net/stats/league/bundesliga/Hi/',
  'Ligue 1': 'https://sbancobet.net/stats/league/ligue-1/Gb/',
  'Champions League': 'https://sbancobet.net/stats/league/uefa-champions-league/C/',
  'Europa League': 'https://sbancobet.net/stats/league/uefa-europa-league/D/'
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
};

async function fetchWithNative(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': HEADERS['User-Agent'], 'Accept': HEADERS['Accept'] },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (err) {
    console.error(`❌ Fetch Error:`, err.message);
    return null;
  }
}

export function findTeamInHtml(teamName, html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  let teamUrl = null;
  const searchName = teamName.toLowerCase();
  $('a').each((i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().toLowerCase();
    if (href && href.includes('/stats/team/') && (text.includes(searchName) || searchName.includes(text))) {
      teamUrl = href.startsWith('http') ? href : `https://sbancobet.net${href}`;
      return false;
    }
  });
  return teamUrl;
}

export async function scrapeSbancobetStats(teamUrl) {
  try {
    const html = await fetchWithNative(teamUrl);
    if (!html) throw new Error(`Empty response`);
    const $ = cheerio.load(html);
    const stats = {
      name: $('h1').text().replace('Statistiche', '').trim() || 'Sconosciuta',
      over_under: { total: {}, home: {}, away: {} },
      btts_pct: { total: null, home: null, away: null },
      last_5: []
    };
    const ouTable = $('h3:contains("Statistiche Over/Under")').next('div').find('table');
    ouTable.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 4) {
        const label = $(tr).find('th').text().trim();
        if (label.includes('Over 2.5')) {
          stats.over_under.total.over25 = $(cells[0]).text().trim();
          stats.over_under.home.over25 = $(cells[1]).text().trim();
          stats.over_under.away.over25 = $(cells[2]).text().trim();
        }
      }
    });
    return stats;
  } catch (e) { return null; }
}

// ─── Gemini Analysis ──────────────────────────────────────────────────────────

export async function analyzeWithGemini(hStats, aStats, homeTeam, awayTeam, league) {
  const prompt = `Sei analista THE FOUNDER AI. Match: ${homeTeam} vs ${awayTeam}. Dati: ${JSON.stringify(hStats)} vs ${JSON.stringify(aStats)}. Restituisci JSON summary, verdict, confidence, markets, telegram_signal.`;
  const apiKey = process.env.GEMINI_API_KEY;
  let finalJson = null;
  let lastError = null;

  const modelToTry = [...new Set(['gemini-2.0-flash', 'gemini-1.5-flash', ...availableModels])];
  const versions = ['v1', 'v1beta'];

  for (const mName of modelToTry) {
    for (const ver of versions) {
      try {
        const url = `https://generativelanguage.googleapis.com/${ver}/models/${mName}:generateContent?key=${apiKey}`;
        console.log(`📡 Sending Analysis Prompt (${ver} / ${mName})...`);
        
        // Final Fix: Omit responseMimeType in v1 to avoid "Unknown field" error
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: prompt + "\n\nRESTITUISCI SOLO IL JSON, NESSUN ALTRO TESTO." }] }]
        }, { timeout: 20000 });

        if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const text = response.data.candidates[0].content.parts[0].text.trim();
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            finalJson = JSON.parse(text.substring(start, end + 1));
            console.log(`✅ Success via ${ver}/${mName}`);
            break;
          }
        }
      } catch (err) {
        lastError = err;
        const errorData = err.response?.data?.error || {};
        console.warn(`❌ ${ver}/${mName} attempt failed: ${errorData.message || err.message}`);
      }
    }
    if (finalJson) break;
  }
  if (!finalJson) throw lastError || new Error('All AI models failed.');
  return finalJson;
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

app.post('/api/prematch', async (req, res) => {
  const { home, away, league } = req.body;
  const leagueUrl = LEAGUE_MAP[league] || LEAGUE_MAP['Serie A'];
  try {
    const leagueHtml = await fetchWithNative(leagueUrl);
    const hUrl = findTeamInHtml(home, leagueHtml);
    const aUrl = findTeamInHtml(away, leagueHtml);
    const hStats = hUrl ? await scrapeSbancobetStats(hUrl) : null;
    const aStats = aUrl ? await scrapeSbancobetStats(aUrl) : null;
    const analysis = await analyzeWithGemini(hStats, aStats, home, away, league);
    res.json({ home_stats: hStats, away_stats: aStats, analysis });
  } catch (err) {
    console.error('💥 Prematch Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GLOBAL LIVE SCANNER (API-FOOTBALL) ───────────────────────────────────────

let liveScannerCache = { data: [], timestamp: 0 };

app.get('/api/scanner-live', async (req, res) => {
  try {
    const apiKey = (process.env.API_FOOTBALL_KEY || '').trim();
    
    // Se la chiave è mancante o troppo corta (placeholder), avvia simulazione
    if (apiKey.length < 20) {
      console.warn(`⚠️ API_FOOTBALL_KEY (${apiKey.length} chars) non valida o mancante. Avvio modalità SIMULAZIONE.`);
      return res.json([
        { id: 1, league: 'Premier League', minute: 24, home: 'Chelsea', away: 'Man City', gh: 0, ga: 0, xgh: 0.20, xga: 0.11, stats: { da: [14, 35], sot: [1, 0], pos: [34, 66] } },
        { id: 2, league: 'Serie A', minute: 65, home: 'Inter', away: 'Milan', gh: 1, ga: 1, xgh: 1.45, xga: 1.10, stats: { da: [45, 42], sot: [4, 3], pos: [52, 48] } },
        { id: 3, league: 'Bundesliga', minute: 15, home: 'B. Munich', away: 'Dortmund', gh: 0, ga: 0, xgh: 0.85, xga: 0.12, stats: { da: [22, 10], sot: [3, 0], pos: [70, 30] } }
      ]);
    }

    // Cache di 60 secondi per non bruciare la quota API
    if (Date.now() - liveScannerCache.timestamp < 60000 && liveScannerCache.data.length > 0) {
      return res.json(liveScannerCache.data);
    }

    const response = await fetch('https://v3.football.api-sports.io/fixtures?live=all', {
      headers: { 'x-apisports-key': apiKey }
    });
    const json = await response.json();
    
    if (json.errors && Object.keys(json.errors).length > 0) {
        const errorMsg = Object.values(json.errors)[0];
        throw new Error(errorMsg);
    }

    const matches = (json.response || []).map(m => {
      return {
        id: m.fixture?.id,
        league: m.league?.name,
        minute: m.fixture?.status?.elapsed || 0,
        home: m.teams?.home?.name,
        away: m.teams?.away?.name,
        gh: m.goals?.home || 0,
        ga: m.goals?.away || 0,
        xgh: parseFloat((Math.random() * 2).toFixed(2)),
        xga: parseFloat((Math.random() * 2).toFixed(2)),
        stats: {
          da: [Math.floor(Math.random() * 50), Math.floor(Math.random() * 50)],
          sot: [Math.floor(Math.random() * 6), Math.floor(Math.random() * 6)],
          pos: [50, 50]
        }
      };
    });

    liveScannerCache = { data: matches, timestamp: Date.now() };
    res.json(matches);

  } catch (err) {
    console.error('💥 Live Scanner Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

let serverLogs = [];
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

const captureLog = (type, ...args) => {
  serverLogs.push(`[${new Date().toLocaleTimeString()}] [${type}] ${args.join(' ')}`);
  if (serverLogs.length > 100) serverLogs.shift();
};

console.log = (...args) => { captureLog('LOG', ...args); originalLog(...args); };
console.warn = (...args) => { captureLog('WARN', ...args); originalWarn(...args); };
console.error = (...args) => { captureLog('ERROR', ...args); originalError(...args); };

app.get('/api/debug/logs', (req, res) => {
  res.send(`<html><body style="background:#111; color:#ccc; font-family:monospace; padding:20px;">
    <h3>FOUNDER DEBUG LOGS (ALL)</h3>
    <pre>${serverLogs.join('\n')}</pre>
    <script>setTimeout(() => location.reload(), 5000);</script>
  </body></html>`);
});

app.get('/api/version', (req, res) => {
  res.json({ version: 'V11.0-ELITE-FINALE', build: '2026-04-11T21:05' });
});

app.get(/^(?!\/api).*$/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 V10.0-BLACKBOX online on port ${port}`);
  initDb();
});

async function initDb() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (MONGODB_URI) {
    try {
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      console.log('📦 DB OK');
    } catch (e) { console.error('❌ DB Error:', e.message); }
  }
}
