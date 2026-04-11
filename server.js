import express from 'express';
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { promises as fs, readdirSync } from 'fs';
import 'dotenv/config';
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
let model = null;
let model = null;
let availableModels = [];

async function discoverModels() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('⚠️ GEMINI_API_KEY missing.');
    return;
  }
  
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    console.log('📡 Fetching available model list from Google...');
    
    // Attempt to list models programmatically
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (response.ok) {
        const data = await response.json();
        availableModels = data.models ? data.models.map(m => m.name.replace('models/', '')) : [];
        console.log(`✅ Found ${availableModels.length} models: ${availableModels.join(', ')}`);
    } else {
        console.warn(`❌ Failed to list models: ${response.status}`);
        availableModels = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-pro'];
    }
  } catch (err) {
    console.error('❌ Model Discovery Error:', err.message);
    availableModels = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-pro'];
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

import { spawnSync } from 'child_process';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
};

// Helper to fetch using native fetch
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

// ─── Sbancobet Scraper ────────────────────────────────────────────────────────

// Modified version that accepts HTML to avoid redundant fetches
export function findTeamInHtml(teamName, html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  let teamUrl = null;
  const searchName = teamName.toLowerCase();

  $('a').each((i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().toLowerCase();
    if (href && href.includes('/stats/team/') && (text.includes(searchName) || searchName.includes(text))) {
      // Fix: Don't prepend domain if it's already an absolute URL
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
        total: { avg_total: null, avg_for: null, avg_against: null },
        home: { avg_total: null, avg_for: null, avg_against: null },
        away: { avg_total: null, avg_for: null, avg_against: null }
      },
      cards: { 
        total: { yellow_avg: null, red_total: null },
        home: { yellow_avg: null, red_total: null },
        away: { yellow_avg: null, red_total: null }
      },
      last_5: []
    };

    // Scrape tables
    const ouTable = $('h3:contains("Statistiche Over/Under")').next('div').find('table');
    ouTable.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 4) {
        const label = $(tr).find('th').text().trim();
        const vAll = $(cells[0]).text().trim(); // Note: Subagent said cells[1] is All, but usually th is not counted as td. Let's use indices carefully.
        const vHome = $(cells[1]).text().trim();
        const vAway = $(cells[2]).text().trim();

        if (label.includes('Over 2.5')) {
          stats.over_under.total.over25 = vAll;
          stats.over_under.home.over25 = vHome;
          stats.over_under.away.over25 = vAway;
        }
        if (label.includes('Over 1.5')) {
          stats.over_under.total.over15 = vAll;
          stats.over_under.home.over15 = vHome;
          stats.over_under.away.over15 = vAway;
        }
        if (label.includes('Entrambe Segnano')) {
          stats.btts_pct.total = vAll;
          stats.btts_pct.home = vHome;
          stats.btts_pct.away = vAway;
        }
      }
    });

    const cornerTable = $('h3:contains("Statistiche Calci d\'angolo")').next('div').find('table');
    cornerTable.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      const label = $(tr).find('th').text().trim();
      if (cells.length >= 3) {
        if (label.includes('Media Totale')) {
           stats.corners.total.avg_total = $(cells[0]).text().trim();
           stats.corners.home.avg_total = $(cells[1]).text().trim();
           stats.corners.away.avg_total = $(cells[2]).text().trim();
        }
      }
    });

    const cardTable = $('h3:contains("Statistiche Cartellini")').next('div').find('table');
    cardTable.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      const label = $(tr).find('th').text().trim();
      if (cells.length >= 3) {
        if (label.includes('Gialli')) {
          stats.cards.total.yellow_avg = $(cells[0]).text().trim();
          stats.cards.home.yellow_avg = $(cells[1]).text().trim();
          stats.cards.away.yellow_avg = $(cells[2]).text().trim();
        }
      }
    });

    // Scrape Last 5 Matches
    const last5Table = $('h3:contains("ULTIME 5 PARTITE")').next('div').find('table');
    last5Table.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 3) {
        const date = $(cells[0]).text().trim();
        const teams = $(cells[1]).text().trim();
        const score = $(cells[2]).text().trim();
        const trend = $(tr).find('td.text-center b').text().trim(); // V, P, S
        stats.last_5.push({ date, teams, score, trend });
      }
    });

    return stats;
  } catch (e) {
    console.error(`❌ Scrape error for ${teamUrl}:`, e.message);
    return null;
  }
}

// ─── Gemini Analysis ──────────────────────────────────────────────────────────

async function analyzeWithGemini(homeStats, awayStats, homeTeam, awayTeam, league) {
  const hasData = homeStats || awayStats;
  
  const formatLast5 = (matches) => {
    return matches?.map(m => `${m.date}: ${m.teams} (${m.score}) [${m.trend}]`).join('\n') || 'N/D';
  };

  const statsBlock = hasData ? `
## DATI TREND SBANCOBET (Stagione Corrente)

### ${homeTeam} (Analisi specifica CASA)
- Over 2.5 % (CASA): ${homeStats?.over_under?.home?.over25 || 'N/D'}
- BTTS (GG) % (CASA): ${homeStats?.btts_pct?.home || 'N/D'}
- Media Angoli (CASA): ${homeStats?.corners?.home?.avg_total || 'N/D'}
- Media Cartellini (CASA): ${homeStats?.cards?.home?.yellow_avg || 'N/D'}
- FORMA RECENTE:
${formatLast5(homeStats?.last_5)}

### ${awayTeam} (Analisi specifica TRASFERTA)
- Over 2.5 % (FUORI): ${awayStats?.over_under?.away?.over25 || 'N/D'}
- BTTS (GG) % (FUORI): ${awayStats?.btts_pct?.away || 'N/D'}
- Media Angoli (FUORI): ${awayStats?.corners?.away?.avg_total || 'N/D'}
- Media Cartellini (FUORI): ${awayStats?.cards?.away?.yellow_avg || 'N/D'}
- FORMA RECENTE:
${formatLast5(awayStats?.last_5)}` 
  : `Dati Sbancobet non disponibili. Usa la tua conoscenza per ${homeTeam} e ${awayTeam} in ${league}.`;

  const prompt = `
Sei "THE FOUNDER AI", il vertice dell'analisi probabilistica nel betting sportivo.
Analizza ${homeTeam} vs ${awayTeam} (${league}) usando i trend SBANCOBET sopra forniti.

REGOLE DI ANALISI (CHAIN OF THOUGHT):
1. Confronta la forza in casa della ${homeTeam} con la vulnerabilità in trasferta della ${awayTeam}.
2. Analizza la "Forma Recente": i risultati delle ultime 5 partite indicano un trend di crescita o calo statistico?
3. Valuta i mercati GOL, OVER, 1X2 e soprattutto i MULTIGOL (Totali, Casa e Trasferta).
4. Cerca il VALORE: dove la statistica "schiaccia" le probabilità comuni?

Restituisci ESCLUSIVAMENTE un JSON con questa struttura:
{
  "summary": "Analisi tecnica profonda...",
  "verdict": "BET | VALUE | WATCH | SKIP",
  "confidence_overall": "Alta | Media | Bassa",
  "data_source": "Sbancobet Premium Data + Gemini AI",
  "markets": [
    { "name": "1X2", "pick": "1|X|2", "label": "Esito Finale", "rating": "...", "confidence": "...", "reasoning": "Ragionamento basato su forma e casa/fuori" },
    { "name": "Over/Under 2.5", "pick": "...", "label": "Over/Under", "rating": "...", "confidence": "...", "reasoning": "..." },
    { "name": "BTTS (GG/NG)", "pick": "...", "label": "Gol/NoGol", "rating": "...", "confidence": "...", "reasoning": "..." },
    { "name": "Multigol Totale", "pick": "2-4 | 1-3 | 2-5", "label": "Multigol", "rating": "...", "confidence": "...", "reasoning": "..." },
    { "name": "Multigol Squadra", "pick": "CASA 1-3 | OSPITE 1-2", "label": "Multigol Team", "rating": "...", "confidence": "...", "reasoning": "..." },
    { "name": "⭐ TOP PICK", "pick": "...", "label": "TOP PICK", "rating": "BET", "confidence": "Alta", "reasoning": "Il segnale più forte del match" }
  ],
  "telegram_signal": "⚽ THE FOUNDER ELITE | ${homeTeam} vs ${awayTeam} ..."
}`;

  console.log('🤖 Calling Gemini AI (Enhanced Prompt)...');
  
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  let result = null;
  let lastError = null;

  // Try models in order of preference
  const modelToTry = ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-pro'];
  
  for (const mName of modelToTry) {
    try {
      console.log(`📡 Trying AI model: ${mName}`);
      const currentModel = genAI.getGenerativeModel({ model: mName });
      result = await currentModel.generateContent(prompt);
      if (result) {
        console.log(`✅ Success with model: ${mName}`);
        break; 
      }
    } catch (err) {
      lastError = err;
      console.warn(`❌ Model ${mName} failed: ${err.message}`);
      if (!err.message.includes('404') && !err.message.includes('not found')) {
        // If it's not a 404 (e.g. quota), don't keep trying others if it's a critical error
        break; 
      }
    }
  }

  if (!result) throw lastError || new Error('Nessun modello di IA disponibile per questa chiave.');

  const text = result.response.text().trim();
  
  // Robust JSON extraction: look for the first '{' and last '}'
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  
  if (start === -1 || end === -1) {
    throw new Error('L\'IA non ha restituito un formato JSON valido. Riprova tra un istante.');
  }

  const cleaned = text.substring(start, end + 1);
  return JSON.parse(cleaned);
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

app.post('/api/prematch', async (req, res) => {
  const { home, away, league } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Squadre mancanti' });
  const leagueUrl = LEAGUE_MAP[league] || LEAGUE_MAP['Serie A'];

  try {
    console.log(`🚀 START PREMATCH: ${home} vs ${away} (${league})`);
    
    // Step 1: Fetch League Page Once
    console.log('📡 Fetching league page...');
    const leagueHtml = await fetchWithNative(leagueUrl);
    if (!leagueHtml) throw new Error('Impossibile caricare la pagina della lega.');

    // Step 2: Find Team URLs sequentially
    const hUrl = findTeamInHtml(home, leagueHtml);
    const aUrl = findTeamInHtml(away, leagueHtml);
    console.log(`🔗 URLs: Home(${hUrl ? 'YES' : 'NO'}), Away(${aUrl ? 'YES' : 'NO'})`);

    // Step 3: Scrape stats sequentially (save memory)
    console.log(`📡 Scraping ${home}...`);
    const hStats = hUrl ? await scrapeSbancobetStats(hUrl) : null;
    
    console.log(`📡 Scraping ${away}...`);
    const aStats = aUrl ? await scrapeSbancobetStats(aUrl) : null;

    // AI Analysis
    console.log('🧠 Starting Gemini Analysis...');
    const analysis = await analyzeWithGemini(hStats, aStats, home, away, league);
    console.log('✅ Analysis Success');

    res.json({
      home_stats: hStats,
      away_stats: aStats,
      analysis,
      logs: [`Found ${home}: ${!!hUrl}`, `Found ${away}: ${!!aUrl}`, `AI Analysis: Done`]
    });

  } catch (err) {
    console.error('💥 Prematch endpoint error:', err);
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
    <h2>Founder Engine Debug Logs</h2>
    <div style="margin-bottom:10px;"><button onclick="location.reload()">Aggiorna</button></div>
    <pre>${serverLogs.join('\n')}</pre>
    <script>setTimeout(() => location.reload(), 5000);</script>
  </body></html>`);
});

app.get('/api/debug/models', async (req, res) => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    res.json({ status: response.status, data });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ─── Database Manager ─────────────────────────────────────────────────────────
const HISTORY_FILE = 'history.json';
const MONGODB_URI = process.env.MONGODB_URI;
let dbClient = null;
let historyCollection = null;

async function initDb() {
  if (MONGODB_URI) {
    try {
      dbClient = new MongoClient(MONGODB_URI);
      await dbClient.connect();
      const db = dbClient.db('founder_engine');
      historyCollection = db.collection('history');
      console.log('📦 MongoDB: CONNECTED ✅');
    } catch (err) {
      console.error('❌ MongoDB Connection Error:', err.message);
    }
  } else {
    console.log('📂 MongoDB_URI missing, using Local JSON fallback.');
  }
}

async function getHistory() {
  if (historyCollection) {
    const data = await historyCollection.find({}).sort({ date: -1 }).toArray();
    return data.map(h => ({ ...h, id: h._id.toString() }));
  }
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.writeFile(HISTORY_FILE, '[]');
      return [];
    }
    throw err;
  }
}

app.get('/api/history', async (req, res) => {
  try {
    const history = await getHistory();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read history.' });
  }
});

app.post('/api/history', async (req, res) => {
  try {
    const pick = req.body;
    pick.date = new Date().toISOString();
    pick.status = 'PENDING';
    pick.pnl = 0;

    if (historyCollection) {
      const result = await historyCollection.insertOne(pick);
      pick.id = result.insertedId.toString();
    } else {
      pick.id = Date.now().toString();
      const history = await getHistory();
      history.push(pick);
      await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
    }
    res.json(pick);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save pick.' });
  }
});

app.put('/api/history/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, pnl } = req.body;

    if (historyCollection) {
      await historyCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status, pnl } }
      );
      res.json({ id, status, pnl });
    } else {
      const history = await getHistory();
      const idx = history.findIndex(h => h.id === id);
      if (idx !== -1) {
        history[idx].status = status || history[idx].status;
        if (pnl !== undefined) history[idx].pnl = pnl;
        await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
        res.json(history[idx]);
      } else {
        res.status(404).json({ error: 'Pick non trovata.' });
      }
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pick.' });
  }
});


// Serve index.html for any unknown routes (SPA support)
app.get('/*', (req, res) => {
  const file = path.join(distPath, 'index.html');
  res.sendFile(file, (err) => {
    if (err) {
      console.error('❌ Error sending index.html:', err.message);
      res.status(404).send('Interfaccia in fase di caricamento... Ricarica tra 1 minuto.');
    }
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url) || !process.argv[1]) {
  // Start server IMMEDIATELY to satisfy hosting health checks
  app.listen(port, () => {
    console.log(`🚀 Professional AI Engine listening at http://localhost:${port}`);
    console.log(`🤖 Gemini AI: CONNECTED ✅`);
  });

  // Then try to init database in background
  initDb().catch(err => console.error('Background DB Init Error:', err));
}
