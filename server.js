import express from 'express';
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { promises as fs } from 'fs';
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
import { readdirSync } from 'fs';
try {
  console.log('📂 Root content:', readdirSync('.'));
} catch(e) {}

app.use(express.json());

// Health check endpoint
app.get('/ping', (req, res) => res.send('pong'));

// Serve static files from dist
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath)); 
console.log(`📂 Serving static files from: ${distPath}`);

// ─── Gemini AI Setup ───────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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

export async function searchSbancobetTeam(teamName, leagueUrl) {
  if (!leagueUrl) {
    console.error('❌ Error: leagueUrl is undefined');
    return null;
  }

  try {
    console.log(`📡 Searching for ${teamName} at ${leagueUrl}`);
    const html = await fetchWithNative(leagueUrl);
    if (!html) throw new Error(`Empty response from league page`);
    const $ = cheerio.load(html);
    
    let teamUrl = null;
    const searchName = teamName.toLowerCase();

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().toLowerCase();
      if (href && href.includes('/stats/team/') && (text.includes(searchName) || searchName.includes(text))) {
        teamUrl = `https://sbancobet.net${href}`;
        return false;
      }
    });

    return teamUrl;
  } catch (e) {
    console.error(`❌ Search error for ${teamName}:`, e.message);
    return null;
  }
}

export async function scrapeSbancobetStats(teamUrl) {

  try {
    console.log(`📡 Scraping stats from: ${teamUrl}`);
    const html = await fetchWithNative(teamUrl);
    if (!html) throw new Error(`Empty response from team page`);
    const $ = cheerio.load(html);

    const stats = {
      name: $('h1').text().replace('Statistiche', '').trim() || 'Sconosciuta',
      over_under: {},
      btts_pct: null,
      corners: { avg_total: null, avg_for: null, avg_against: null },
      cards: { yellow_avg: null, red_total: null }
    };

    // Scrape tables
    const ouTable = $('h3:contains("Statistiche Over/Under")').next('div').find('table');
    ouTable.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      if (cells.length >= 2) {
        const label = $(tr).find('th').text().trim();
        const value = $(cells[0]).text().trim(); 
        if (label.includes('Over 2.5')) stats.over_under.over25 = value;
        if (label.includes('Over 1.5')) stats.over_under.over15 = value;
        if (label.includes('Over 3.5')) stats.over_under.over35 = value;
        if (label.includes('Entrambe Segnano')) stats.btts_pct = value;
      }
    });

    const cornerTable = $('h3:contains("Statistiche Calci d\'angolo")').next('div').find('table');
    cornerTable.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      const label = $(tr).find('th').text().trim();
      if (label.includes('Media Totale')) stats.corners.avg_total = $(cells[0]).text().trim();
      if (label.includes('Media a favore')) stats.corners.avg_for = $(cells[0]).text().trim();
      if (label.includes('Media contro')) stats.corners.avg_against = $(cells[0]).text().trim();
    });

    const cardTable = $('h3:contains("Statistiche Cartellini")').next('div').find('table');
    cardTable.find('tr').each((i, tr) => {
      const cells = $(tr).find('td');
      const label = $(tr).find('th').text().trim();
      if (label.includes('Gialli')) stats.cards.yellow_avg = $(cells[0]).text().trim();
      if (label.includes('Rossi')) stats.cards.red_total = $(cells[0]).text().trim();
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
  const statsBlock = hasData ? `
## DATI TREND SBANCOBET (Stagione Corrente)

### ${homeTeam} (CASA)
- Over 2.5 %: ${homeStats?.over_under?.over25 || 'N/D'}
- BTTS (GG) %: ${homeStats?.btts_pct || 'N/D'}
- Media Angoli Tot: ${homeStats?.corners?.avg_total || 'N/D'}
- Media Cartellini Gialli: ${homeStats?.cards?.yellow_avg || 'N/D'}

### ${awayTeam} (TRASFERTA)
- Over 2.5 %: ${awayStats?.over_under?.over25 || 'N/D'}
- BTTS (GG) %: ${awayStats?.btts_pct || 'N/D'}
- Media Angoli Tot: ${awayStats?.corners?.avg_total || 'N/D'}
- Media Cartellini Gialli: ${awayStats?.cards?.yellow_avg || 'N/D'}` 
  : `Dati Sbancobet non disponibili. Usa la tua conoscenza per ${homeTeam} e ${awayTeam} in ${league}.`;

  const prompt = `
Analizza ${homeTeam} vs ${awayTeam} (${league}) usando questi trend SBANCOBET.
Genera un report premium per The Founder Engine.

${statsBlock}

Restituisci JSON:
{
  "summary": "...",
  "verdict": "BET | VALUE | WATCH | SKIP",
  "confidence_overall": "Alta | Media | Bassa",
  "data_source": "Sbancobet + Gemini AI",
  "markets": [
    { "name": "1X2", "pick": "1|X|2", "label": "...", "rating": "...", "confidence": "...", "quota_target": "...", "reasoning": "..." },
    { "name": "Over/Under 2.5", "pick": "...", "label": "...", "rating": "...", "confidence": "...", "quota_target": "...", "reasoning": "..." },
    { "name": "BTTS (GG/NG)", "pick": "...", "label": "...", "rating": "...", "confidence": "...", "quota_target": "...", "reasoning": "..." },
    { "name": "Under/Over Angoli", "pick": "...", "label": "...", "rating": "...", "confidence": "...", "quota_target": "...", "reasoning": "..." },
    { "name": "⭐ TOP PICK", "pick": "...", "label": "TOP PICK", "rating": "BET", "confidence": "Alta", "quota_target": "...", "reasoning": "..." }
  ],
  "telegram_signal": "⚽ THE FOUNDER SCOUT | ${homeTeam} vs ${awayTeam} ..."
}`;

  console.log('🤖 Calling Gemini AI...');
  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const cleaned = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned);
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

app.post('/api/prematch', async (req, res) => {
  const { home, away, league } = req.body;
  if (!home || !away) return res.status(400).json({ error: 'Squadre mancanti' });

  console.log(`🔍 SCOUT REQUEST: ${home} vs ${away} (${league})`);

  try {
    const lUrl = LEAGUE_MAP[league] || LEAGUE_MAP['Serie A'];
    
    // Find URLs
    const [hUrl, aUrl] = await Promise.all([
      searchSbancobetTeam(home, lUrl),
      searchSbancobetTeam(away, lUrl)
    ]);

    // Scrape stats
    const [hStats, aStats] = await Promise.all([
      hUrl ? scrapeSbancobetStats(hUrl) : null,
      aUrl ? scrapeSbancobetStats(aUrl) : null
    ]);

    // AI Analysis
    const analysis = await analyzeWithGemini(hStats, aStats, home, away, league);

    res.json({
      home_stats: hStats,
      away_stats: aStats,
      analysis
    });

  } catch (err) {
    console.error('💥 Prematch endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/analyze', (req, res) => {
  res.json({ analysis: "Live monitoring active.", telegram_signal: "WAIT" });
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
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

if (process.argv[1] === fileURLToPath(import.meta.url) || !process.argv[1]) {
  initDb().then(() => {
    app.listen(port, () => {
      console.log(`🚀 Professional AI Engine listening at http://localhost:${port}`);
      console.log(`🤖 Gemini AI: CONNECTED ✅`);
    });
  });
}
