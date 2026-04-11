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

// Serve static files from dist (Flexible Resolution)
const possiblePaths = [
  path.join(__dirname, 'dist'),
  path.join(process.cwd(), 'dist'),
  './dist'
];

let distPath = possiblePaths[0];
for (const p of possiblePaths) {
  try {
    if (readdirSync(p)) {
      distPath = p;
      console.log(`✅ Found dist folder at: ${p}`);
      break;
    }
  } catch(e) {}
}

app.use(express.static(distPath)); 
console.log(`📂 Serving static files from: ${distPath}`);

// ─── Gemini AI Setup ───────────────────────────────────────────────────────────
let availableModels = [];
let model = null;

async function discoverModels() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) return;
  
  try {
    console.log('📡 Fetching real model names from Google via Axios...');
    const response = await axios.get(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    if (response.status === 200) {
        const data = response.data;
        availableModels = data.models ? data.models.map(m => m.name) : [];
        console.log(`✅ DISCOVERED MODELS: ${availableModels.join(', ')}`);
    } else {
        console.warn(`❌ Model listing failed (HTTP ${response.status}). Using hardcoded fallbacks.`);
        availableModels = ['models/gemini-2.5-flash', 'models/gemini-2.0-flash', 'models/gemini-1.5-flash'];
    }
  } catch (err) {
    console.error('❌ Model Discovery Error (Axios):', err.message);
    availableModels = ['models/gemini-2.5-flash', 'models/gemini-2.0-flash', 'models/gemini-1.5-flash'];
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
    console.log(`📡 Fetching: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': HEADERS['User-Agent'],
        'Accept': HEADERS['Accept']
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return await response.text();
  } catch (err) {
    console.error(`❌ Fetch Error for ${url}:`, err.message);
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
    console.log(`📡 Scraping stats from: ${teamUrl}`);
    const html = await fetchWithNative(teamUrl);
    if (!html) throw new Error(`Empty response from team page`);
    const $ = cheerio.load(html);

    const stats = {
      name: $('h1').text().replace('Statistiche', '').trim() || 'Sconosciuta',
      over_under: { total: {}, home: {}, away: {} },
      btts_pct: { total: null, home: null, away: null },
      corners: { 
        total: { avg_total: null },
        home: { avg_total: null },
        away: { avg_total: null }
      },
      cards: { 
        total: { yellow_avg: null },
        home: { yellow_avg: null },
        away: { yellow_avg: null }
      },
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
        if (label.includes('Entrambe Segnano')) {
          stats.btts_pct.total = $(cells[0]).text().trim();
          stats.btts_pct.home = $(cells[1]).text().trim();
          stats.btts_pct.away = $(cells[2]).text().trim();
        }
      }
    });

    const last5Table = $('h3:contains("ULTIME 5 PARTITE")').next('div').find('table');
    last5Table.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 3) {
        stats.last_5.push({ 
          date: $(cells[0]).text().trim(), 
          teams: $(cells[1]).text().trim(), 
          score: $(cells[2]).text().trim(),
          trend: $(tr).find('td.text-center b').text().trim()
        });
      }
    });

    return stats;
  } catch (e) {
    console.error(`❌ Scrape error for ${teamUrl}:`, e.message);
    return null;
  }
}

export async function analyzeWithGemini(hStats, aStats, homeTeam, awayTeam, league) {
  const prompt = `Sei l'analista "THE FOUNDER AI".
Match: ${homeTeam} vs ${awayTeam} (${league})

DATI CASA: ${JSON.stringify(hStats, null, 1)}
DATI FUORI: ${JSON.stringify(aStats, null, 1)}

Istruzioni: Analizza i trend Over/Under e Multigol. Cerca il Valore.
Restituisci solo un JSON con: summary, verdict, confidence_overall, data_source, markets (1X2, Over2.5, BTTS, Multigol Tot, Multigol Team, TOP PICK), telegram_signal.`;

  console.log('🤖 Calling Gemini AI (Protocol Zero - REST)...');
  const apiKey = process.env.GEMINI_API_KEY;
  let finalJson = null;
  let lastError = null;

  const modelToTry = [...new Set([
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.5-flash'
  ])];

  // Try both v1 and v1beta endpoints for every model
  const versions = ['v1', 'v1beta'];

  for (const mName of modelToTry) {
    for (const ver of versions) {
      try {
        const url = `https://generativelanguage.googleapis.com/${ver}/models/${mName}:generateContent?key=${apiKey}`;
        console.log(`📡 Trying REST: ${ver} / ${mName}`);
        
        const response = await axios.post(url, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        }, { timeout: 15000 });

        if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          const text = response.data.candidates[0].content.parts[0].text.trim();
          console.log(`✅ Success via REST (${ver}/${mName})`);
          
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start !== -1 && end !== -1) {
            finalJson = JSON.parse(text.substring(start, end + 1));
            break;
          }
        }
      } catch (err) {
        lastError = err;
        const msg = err.response?.data?.error?.message || err.message;
        console.warn(`❌ REST ${ver}/${mName} failed: ${msg}`);
      }
    }
    if (finalJson) break;
  }

  if (!finalJson) throw lastError || new Error('IA Protocol Zero fallita.');
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

    res.json({
      home_stats: hStats,
      away_stats: aStats,
      analysis,
      logs: [`Found ${home}: ${!!hUrl}`, `Found ${away}: ${!!aUrl}`]
    });
  } catch (err) {
    console.error('💥 Error:', err);
    res.status(500).json({ error: err.message });
  }
});

let serverLogs = [];
const originalLog = console.log;
console.log = (...args) => {
  serverLogs.push(`[${new Date().toLocaleTimeString()}] ${args.join(' ')}`);
  if (serverLogs.length > 50) serverLogs.shift();
  originalLog(...args);
};

app.get('/api/debug/logs', (req, res) => {
  res.send(`<html><body style="background:#18181b; color:#a1a1aa; font-family:monospace; padding:20px;">
    <pre>${serverLogs.join('\n')}</pre>
    <script>setTimeout(() => location.reload(), 5000);</script>
  </body></html>`);
});

app.get('/api/debug/models', async (req, res) => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  try {
    const response = await axios.get(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    res.json(response.data);
  } catch (err) { res.json({ error: err.message }); }
});

app.get('/api/version', (req, res) => {
  res.json({ version: 'V9.8-PROTOCOL-ZERO', build: '2026-04-11T20:47' });
});

// SPA Support
app.get(/^(?!\/api).*$/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`🚀 Engine listening at http://localhost:${port}`);
  initDb();
});

async function initDb() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (MONGODB_URI) {
    try {
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      console.log('📦 MongoDB: OK');
    } catch (e) { console.error('❌ DB Error:', e.message); }
  }
}
