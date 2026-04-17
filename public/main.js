/**
 * THE FOUNDER ENGINE V9.0 - MASTER OF THE PITCH
 * Raw-First Architecture: Parser is the Heart
 */

const byId = (id) => document.getElementById(id);
const valNum = (id) => parseFloat(byId(id)?.value) || 0;

let lastData = null;
let autoTimer = null;
let engineBusy = false;

// ─── PARSER ───────────────────────────────────────────────────────────────────

function parseRawMatchText(raw) {
  const lines = raw.replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const text = lines.join('\n');
  const result = { stats: {}, proxyXG: false };

  // Provider detection
  if (text.toLowerCase().includes('sofascore')) result.provider = 'Sofascore';
  else if (text.toLowerCase().includes('flashscore') || text.toLowerCase().includes('diretta')) result.provider = 'Flashscore';
  else result.provider = 'Auto-Detect';

  // Teams
  const teamsMatch = text.match(/([A-Za-z├Ç-├┐' .()-]+)\s+vs\s+([A-Za-z├Ç-├┐' .()-]+)/i);
  if (teamsMatch) {
    result.home = teamsMatch[1].trim();
    result.away = teamsMatch[2].trim();
  }

  // Clean string to remove half-time scores like (0:0) or (1-0) to avoid false score extraction
  const cleanScoreText = text.replace(/\(\s*\d{1,2}\s*[:\-]\s*\d{1,2}\s*\)/g, '');

  // Score: look for single-digit:single-digit pattern
  const scoreMatches = Array.from(cleanScoreText.matchAll(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/g));
  for (const match of scoreMatches) {
    const s1 = parseInt(match[1], 10);
    const s2 = parseInt(match[2], 10);
    // Score heurustic: no leading zero for > 0, realistic limits
    if (s1 <= 15 && s2 <= 15) {
      // Prevent matching times like 10:30 or 09:00
      if (match[0].includes(':') && (match[1].startsWith('0') && match[1].length === 2 && s1 > 0)) continue;
      if (match[0].includes(':') && match[2].length === 2 && s2 > 10) continue; // Unlikely to be score 1:45
      
      result.gh = s1;
      result.ga = s2;
      break;
    }
  }

  // Minute - look for MM:SS format where MM is a realistic minute (1-120)
  // Pattern like "53:49" or standalone "53'"
  const timeMatch = text.match(/\b(1?\d{2}|\d{1,2}):(\d{2})\b/g);
  if (timeMatch) {
    for (const t of timeMatch) {
      const [mm, ss] = t.split(':').map(Number);
      if (mm >= 1 && mm <= 120 && ss >= 0 && ss <= 59) {
        // Skip if this looks like a score (both <= 15 and we already have score)
        if (result.gh !== undefined && mm <= 15 && ss <= 15) continue;
        result.minute = mm;
        break;
      }
    }
  }
  // Fallback: look for "53'" style
  if (!result.minute) {
    const minAlt = text.match(/\b(\d{1,3})['ÔÇ▓]/);
    if (minAlt) result.minute = parseInt(minAlt[1], 10);
  }

  // Official XG - look for "XG\n0.48\n0.25" or "XG 0.48-0.25"
  const xgLineIdx = lines.findIndex(l => /^XG$/i.test(l));
  if (xgLineIdx >= 0) {
    const xgh = parseFloat(lines[xgLineIdx + 1]?.replace(',', '.'));
    const xga = parseFloat(lines[xgLineIdx + 2]?.replace(',', '.'));
    if (!isNaN(xgh) && !isNaN(xga)) {
      result.xgh = xgh;
      result.xga = xga;
    }
  }
  // XG inline "0.48-0.25" format in table row
  if (result.xgh === undefined) {
    const xgInline = text.match(/(\d+[.,]\d+)\s*[-ÔÇô]\s*(\d+[.,]\d+)\s*(?=\s|$)/);
    if (xgInline) {
      const v1 = parseFloat(xgInline[1].replace(',', '.'));
      const v2 = parseFloat(xgInline[2].replace(',', '.'));
      if (v1 > 0 || v2 > 0) { result.xgh = v1; result.xga = v2; }
    }
  }

  // Odds Extraction: find rows of tab/multi-space separated numbers in odds range [1.01..50]
  const oddsRows = [];
  lines.forEach(line => {
    const parts = line.split(/\t|\s{2,}/).map(p => p.trim()).filter(p => /^\d+[.,]?\d*$/.test(p));
    if (parts.length >= 3) {
      const nums = parts.map(p => parseFloat(p.replace(',', '.')));
      if (nums.every(n => !isNaN(n) && n >= 1.01 && n <= 50)) {
        oddsRows.push(nums);
      }
    }
  });
  if (oddsRows.length > 0) {
    const lastRow = oddsRows[oddsRows.length - 1];
    if (lastRow.length >= 3) {
      result.odds = { back1: lastRow[0], layX: lastRow[1], back2: lastRow[2] };
    }
  }

  // Stats Crawler: label then Home value then Away value on next lines
  const statDefs = [
    { keys: ['Goal', 'Gol', 'Reti'], stat: 'goals_crawler' },
    { keys: ['Tiri in Porta', 'Shots on Target', 'SOT'], stat: 'sot' },
    { keys: ['Attacchi Pericolosi', 'Dangerous Attacks'], stat: 'da' },
    { keys: ['Tiri Totali', 'Total Shots', 'Tiri Tot'], stat: 'st' },
    { keys: ["Calci d'Angolo", 'Corners', 'Angoli'], stat: 'cor' },
    { keys: ['Possesso Palla', 'Possession', 'Possesso'], stat: 'pos' },
    { keys: ['Attacchi'], stat: 'att' },
  ];

  lines.forEach((line, i) => {
    statDefs.forEach(def => {
      if (def.keys.some(k => line.toLowerCase() === k.toLowerCase() || line.toLowerCase().includes(k.toLowerCase()))) {
        if (line.includes('(1T)') || line.includes('1┬░ Tempo')) return;
        const raw1 = lines[i + 1]?.replace('%', '').replace(',', '.').trim();
        const raw2 = lines[i + 2]?.replace('%', '').replace(',', '.').trim();
        const v1 = parseFloat(raw1);
        const v2 = parseFloat(raw2);
        if (!isNaN(v1) && !isNaN(v2) && !result.stats[def.stat]) {
          result.stats[def.stat] = [v1, v2];
        }
      }
    });
  });

  // Assign goals if found reliably via crawler
  if (result.stats.goals_crawler) {
    result.gh = result.stats.goals_crawler[0];
    result.ga = result.stats.goals_crawler[1];
  }

  // Possession from "55 %" or "55%" inline
  if (!result.stats.pos) {
    const posMatch = text.match(/(\d{2,3})\s*%\s*\n?\s*(\d{2,3})\s*%/);
    if (posMatch) result.stats.pos = [parseFloat(posMatch[1]), parseFloat(posMatch[2])];
  }

  // Proxy XG if official not found
  if (result.xgh === undefined) {
    const s = result.stats;
    const g = (k, i) => (s[k] ? s[k][i] : 0);
    result.xgh = parseFloat(((g('sot',0)*0.18) + (g('da',0)*0.025) + (g('st',0)*0.05) + (g('cor',0)*0.04)).toFixed(2));
    result.xga = parseFloat(((g('sot',1)*0.18) + (g('da',1)*0.025) + (g('st',1)*0.05) + (g('cor',1)*0.04)).toFixed(2));
    result.proxyXG = true;
  }

  if (result.gh === undefined) result.gh = 0;
  if (result.ga === undefined) result.ga = 0;
  if (result.minute === undefined) result.minute = 0;
  if (!result.stats.pos) result.stats.pos = [50, 50];

  return result;
}

// ─── DISPLAY PARSED STATS ────────────────────────────────────────────────────

function displayParsedStats(data) {
  const el = byId('parsedDisplay');
  const s = data.stats;
  const get = (k, i, sfx = '') => s[k] ? `${s[k][i]}${sfx}` : 'ÔÇö';

  if (!data.home) {
    el.innerHTML = '<div class="parsed-empty">Dati non rilevati. Controlla il formato del testo incollato.</div>';
    return;
  }

  byId('matchTitle').textContent = `${data.home} vs ${data.away}`;
  byId('homeLabel').textContent = `MOMENTUM ${data.home.toUpperCase()}`;
  byId('awayLabel').textContent = `MOMENTUM ${data.away.toUpperCase()}`;

  const xgMode = data.proxyXG ? '<span style="color:#f59e0b; font-size:10px;">[PROXY]</span>' : '<span style="color:#2dd4bf; font-size:10px;">[LIVE]</span>';

  el.innerHTML = `
    <div class="stat-row highlight">
      <span class="stat-label">⚽ SCORE</span>
      <span class="stat-home">${data.home}</span>
      <span class="stat-val"><b>${data.gh} : ${data.ga}</b></span>
      <span class="stat-away">${data.away}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">⌚ MINUTO</span>
      <span class="stat-home">—</span>
      <span class="stat-val">${data.minute}'</span>
      <span class="stat-away">—</span>
    </div>
    <div class="stat-row highlight">
      <span class="stat-label">📈 XG ${xgMode}</span>
      <span class="stat-home">${data.xgh?.toFixed(2)}</span>
      <span class="stat-val">vs</span>
      <span class="stat-away">${data.xga?.toFixed(2)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">🎯 Tiri in Porta</span>
      <span class="stat-home">${get('sot',0)}</span>
      <span class="stat-val">SOT</span>
      <span class="stat-away">${get('sot',1)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">💥 Attacchi Pericolosi</span>
      <span class="stat-home">${get('da',0)}</span>
      <span class="stat-val">DA</span>
      <span class="stat-away">${get('da',1)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">👟 Tiri Totali</span>
      <span class="stat-home">${get('st',0)}</span>
      <span class="stat-val">ST</span>
      <span class="stat-away">${get('st',1)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">🚩 Calci d'Angolo</span>
      <span class="stat-home">${get('cor',0)}</span>
      <span class="stat-val">COR</span>
      <span class="stat-away">${get('cor',1)}</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">⚖️ Possesso</span>
      <span class="stat-home">${get('pos',0,'%')}</span>
      <span class="stat-val">POS</span>
      <span class="stat-away">${get('pos',1,'%')}</span>
    </div>
    ${data.odds ? `
    <div class="stat-row highlight">
      <span class="stat-label">💶 Quote Exchange</span>
      <span class="stat-home" style="font-size:13px;">Back1: ${data.odds.back1}</span>
      <span class="stat-val">ODDS</span>
      <span class="stat-away" style="font-size:13px;">LayX: ${data.odds.layX}</span>
    </div>` : ''}
  `;


  byId('providerText').textContent = data.provider;
  byId('modeChip').textContent = data.proxyXG ? 'PROXY XG MODE' : 'XG LIVE MODE';
}

// ─── MOMENTUM ─────────────────────────────────────────────────────────────────

function calcMomentum(data) {
  const s = data.stats;
  const g = (k, i) => (s[k] ? s[k][i] : 0);

  const pos = g('pos', 0) || 50;
  const soth = g('sot', 0), sota = g('sot', 1);
  const dah = g('da', 0), daa = g('da', 1);

  const homeScore = Math.max(0,
    (data.xgh - data.gh) * 30 +
    pos * 0.3 +
    soth * 8 +
    dah * 1.5
  );
  const awayScore = Math.max(0,
    (data.xga - data.ga) * 30 +
    (100 - pos) * 0.3 +
    sota * 8 +
    daa * 1.5
  );
  const total = Math.max(homeScore + awayScore, 1);

  const mHome = Math.round((homeScore / total) * 100);
  const mAway = 100 - mHome;

  byId('mHome').style.width = `${mHome}%`;
  byId('mAway').style.width = `${mAway}%`;
  byId('mHomeTxt').textContent = `${mHome}%`;
  byId('mAwayTxt').textContent = `${mAway}%`;

  const gap = Math.abs(mHome - mAway);
  const trend = gap > 25 ? 'SURGE' : gap > 12 ? 'RISING' : 'STABLE';
  byId('trendTxt').textContent = trend;
  byId('trendDot').style.color = trend === 'SURGE' ? '#2dd4bf' : trend === 'RISING' ? '#f59e0b' : '#94a3b8';

  return { mHome, mAway };
}

// ─── STRATEGY ENGINE ─────────────────────────────────────────────────────────

function updateDynamicStrategies(data, momentum) {
  const { mHome, mAway } = momentum;
  const s = data.stats;
  const get = (k, i) => (s[k] ? s[k][i] : 0);

  const totalXG = (data.xgh || 0) + (data.xga || 0);
  const xgGapH = (data.xgh || 0) - (data.gh || 0);
  const xgGapA = (data.xga || 0) - (data.ga || 0);
  const min = data.minute || 1;

  // DA/min pressure rate (OMNI-ENGINE core metric)
  const dah = get('da', 0), daa = get('da', 1);
  const daTotal = dah + daa;
  const daPerMin = min > 0 ? daTotal / min : 0;
  const daRateH = min > 0 ? dah / min : 0;
  const daRateA = min > 0 ? daa / min : 0;

  // SOT Efficiency
  const soth = get('sot', 0), sota = get('sot', 1);
  const stH = get('st', 0) || 1, stA = get('st', 1) || 1;
  const sotEffH = soth / stH;
  const sotEffA = sota / stA;

  document.querySelectorAll('.strat .item').forEach(el => el.classList.remove('strat-active'));

  // 1. LAY THE DRAW
  // Score locked, significant offensive production from either side
  if (data.gh === data.ga && min >= 35 && min <= 80 &&
      (totalXG > 0.5 || daPerMin > 0.5 || (soth + sota) >= 3))
    byId('strat-ltd')?.classList.add('strat-active');

  // 2. BACK TO LAY
  // One team clearly dominating via DA rate or XG gap
  if ((xgGapH > 0.3 && mHome > 58 && daRateH > 0.35) ||
      (xgGapA > 0.3 && mAway > 58 && daRateA > 0.35))
    byId('strat-btl')?.classList.add('strat-active');

  // 3. SCALP UNDER
  // Very low production, sterile match
  if (min >= 20 && min <= 65 && totalXG < 0.4 &&
      daPerMin < 0.4 && (soth + sota) <= 2 && Math.abs(mHome - mAway) < 15)
    byId('strat-scalp')?.classList.add('strat-active');

  // 4. POWER PLAY
  // Late game, one team surging hard
  if (min > 65 && (mHome > 70 || mAway > 70) && daPerMin > 0.6)
    byId('strat-power')?.classList.add('strat-active');

  // 5. LAY FAVOURITE (crisis mode)
  // Losing team not generating pressure despite good odds
  if ((data.gh > data.ga && xgGapA < 0.1 && daRateA < 0.3) ||
      (data.ga > data.gh && xgGapH < 0.1 && daRateH < 0.3))
    byId('strat-layfav')?.classList.add('strat-active');

  // 6. SCATTERGUN (Dutching)
  // High pressure balanced match with goals expected
  if (totalXG > 0.8 && Math.abs(mHome - mAway) < 25 &&
      (data.gh + data.ga) <= 1 && daPerMin > 0.55)
    byId('strat-scattergun')?.classList.add('strat-active');

  // --- OMNI-ELITE PACK ---

  // 7. ASSALTO AL FORTINO (Lay The Leader)
  // Leader is under siege in the last 15 mins
  if (min >= 75 && ((data.gh > data.ga && daRateA > 0.8 && sota >= 3) || (data.ga > data.gh && daRateH > 0.8 && soth >= 3)))
    byId('strat-fortino')?.classList.add('strat-active');

  // 8. SCALPING DEAD ZONE (Time Decay)
  // Completely dead game, both teams not doing much
  if (min >= 25 && min <= 70 && daTotal / min < 0.35 && totalXG < 0.6)
    byId('strat-deadzone')?.classList.add('strat-active');

  // 9. FADE THE LUCK (Contro-Mercato su Gol Casuale)
  // Team is winning but heavily dominated
  if ((data.gh > data.ga && xgGapA > 1.0 && soth < 2) || (data.ga > data.gh && xgGapH > 1.0 && sota < 2))
    byId('strat-fade')?.classList.add('strat-active');

  // 10. DUTCHING 1° TEMPO (HT Pressure Exploit)
  // Huge pressure right before HT
  if (min >= 28 && min <= 44 && daTotal / min > 1.2 && data.gh === 0 && data.ga === 0 && Math.abs(mHome - mAway) < 15)
    byId('strat-ht')?.classList.add('strat-active');

  updateStrategicGuide(data, { mHome, mAway, daPerMin, daRateH, daRateA, sotEffH, sotEffA, xgGapH, xgGapA, totalXG });
}


// ─── BOOK PREVIEW ─────────────────────────────────────────────────────────────

function generateBookTelegramSignal(data, dynamicBets, corTotal) {
  const hTeam = data.home || 'Casa';
  const aTeam = data.away || 'Ospite';
  const score = `${data.gh||0}-${data.ga||0}`;
  const minute = data.minute ? `${data.minute}'` : 'HT';
  const xgStr = `${(data.xgh||0).toFixed(2)}-${(data.xga||0).toFixed(2)}`;
  const daTotalMin = (data.minute || 1) > 0 ? ((data.stats.da?.[0] || 0) + (data.stats.da?.[1] || 0)) / (data.minute || 1) : 0;
  
  let signalStr = `🎯 PREVIEW LIVE MARKET 🎯
⏳ ${hTeam} ${score} ${aTeam} | Min: ${minute}
📋 XG: ${xgStr} | DA/min: ${daTotalMin.toFixed(2)}

🔍 PICK SUGGERITI:
`;

  dynamicBets.forEach((bet, idx) => {
    signalStr += `${idx + 1}️⃣ ${bet.label}
👉 ${bet.pick} (Quota ref: ${bet.odd})
ℹ️ ${bet.reason}\n\n`;
  });

  if (dynamicBets.length === 0) {
    signalStr += `Attesa. I dati Live non sono ancora stabilizzati per generare picks affidabili.\n\n`;
  }

  signalStr += `---
THE FOUNDER EXCHANGE | 70-WIN EDITION`;

  return signalStr.trim();
}

function updateBookPreview(data) {
  const xgDiff = (data.xgh || 0) - (data.xga || 0);
  const totalXG = (data.xgh || 0) + (data.xga || 0);
  const totalGoals = (data.gh || 0) + (data.ga || 0);
  const min = data.minute || 1;
  const s = data.stats;
  const g = (k, i) => (s[k] ? s[k][i] : 0);
  const daTotal = g('da', 0) + g('da', 1);
  const corTotal = g('cor', 0) + g('cor', 1);
  
  let dynamicBets = [];

  // Goal/No Goal (BTTS)
  if (data.gh > 0 && data.ga > 0) {
    dynamicBets.push({ label: 'GOAL / NO GOAL', pick: 'Entrambe Segnano (WIN)', odd: '-', confidence: 'Alta', reason: 'Pick gi├á maturato. Valutare mercati successivi.' });
  } else if (totalXG > 1.5 && g('sot', 0) > 1 && g('sot', 1) > 1) {
    dynamicBets.push({ label: 'GOAL / NO GOAL', pick: 'Goal (S├¼)', odd: '1.80+', confidence: 'Alta', reason: 'Entrambe le squadre producono SOT e XG elevati (Match aperto).' });
  } else if (totalXG < 0.6 && min > 45) {
    dynamicBets.push({ label: 'GOAL / NO GOAL', pick: 'No Goal', odd: '1.50+', confidence: 'Media', reason: 'Pochissime occasioni prodotte (Match sterile).' });
  }

  let nextOver = totalGoals >= 2 ? 3.5 : (totalGoals === 1 ? 2.5 : 1.5);
  if (totalXG > totalGoals + 0.6 && daTotal / min > 0.5) {
    dynamicBets.push({ label: `UNDER / OVER ${nextOver}`, pick: `Over ${nextOver}`, odd: '1.75+', confidence: 'Alta', reason: `Ritmo forsennato, XG totale reale (${totalXG.toFixed(2)}) chiama altri gol.` });
  } else if (totalXG <= totalGoals + 0.2 && min > 60 && daTotal / min < 0.4) {
    dynamicBets.push({ label: `UNDER / OVER ${nextOver}`, pick: `Under ${nextOver}`, odd: '1.60+', confidence: 'Alta', reason: `Partita sterile, pochissima produzione offensiva al minuto ${min}'.` });
  }

  if (xgDiff > 0.6 && data.gh <= data.ga) {
    dynamicBets.push({ label: 'ASIAN HANDICAP', pick: `${data.home || 'CASA'} -0.5`, odd: '1.90+', confidence: 'Alta', reason: `Pressione assoluta ${data.home || 'Home'} (XG GAP +${xgDiff.toFixed(2)}), risultato stretto.` });
  } else if (xgDiff < -0.6 && data.ga <= data.gh) {
    dynamicBets.push({ label: 'ASIAN HANDICAP', pick: `${data.away || 'OSPITE'} -0.5`, odd: '1.90+', confidence: 'Alta', reason: `Pressione assoluta ${data.away || 'Away'} (XG GAP +${Math.abs(xgDiff).toFixed(2)}), risultato stretto.` });
  }

  if (min > 30 && corTotal / min > 0.15) { 
    let projCorners = Math.round((corTotal / min) * 90);
    dynamicBets.push({ label: 'MERCATO CORNER', pick: `Over ${projCorners - 1}.5 Angoli`, odd: '1.85+', confidence: 'Media', reason: `Alta spinta laterale. Proiezione a fine gara: ${projCorners} corner.` });
  }

  if (xgDiff > 0.3) {
    dynamicBets.push({ label: 'PROSSIMO GOL', pick: `Segna ${data.home || 'CASA'}`, odd: '2.10+', confidence: 'Media', reason: `Avvolgimento e DA/min nettamente a favore di ${data.home || 'Home'}.` });
  } else if (xgDiff < -0.3) {
    dynamicBets.push({ label: 'PROSSIMO GOL', pick: `Segna ${data.away || 'OSPITE'}`, odd: '2.10+', confidence: 'Media', reason: `Avvolgimento e DA/min nettamente a favore di ${data.away || 'Away'}.` });
  }

  if (dynamicBets.length < 4) {
    let baseCombo = xgDiff >= 0 ? '1X + MultiGol 1-4' : 'X2 + MultiGol 1-4';
    if (min < 70) dynamicBets.push({ label: 'COMBO CONSERVATIVA', pick: baseCombo, odd: '1.40+', confidence: 'Alta', reason: 'Copertura statistica basata su inerzia prevalente e trend storico.' });
  }

  if (min < 10) dynamicBets = [{ label: 'ATTESA', pick: 'Attendere 15 min', odd: '-', confidence: 'Bassa', reason: 'I dati Live non sono ancora stabilizzati per generare picks affidabili.' }];

  dynamicBets = dynamicBets.slice(0, 4);

  byId('bookGrid').innerHTML = dynamicBets.map(b => `
    <div class="book-item">
      <div class="conf-badge ${b.confidence === 'Alta' ? 'conf-high' : ''}">${b.confidence}</div>
      <div class="book-label">${b.label}</div>
      <div class="book-pick">${b.pick}</div>
      <div class="book-odd" style="color:var(--accent);">Quota ref: ${b.odd}</div>
      <div class="book-note">${b.reason}</div>
      <button onclick="saveTrackerPick('${b.label}', '${b.pick}', '${b.odd}')" style="margin-top:8px; width:100%; padding:6px; font-size:11px; cursor:pointer; background:var(--bg-card); color:var(--accent); border:1px solid var(--accent); border-radius:4px;">💥 Salva Pick</button>
    </div>
  `).join('');

  byId('bookMeta').textContent = `Modulo: ADVANCED DYNAMIC MARKETS | EV Engine | XG: ${(data.xgh||0).toFixed(2)} - ${(data.xga||0).toFixed(2)}`;

  const telSection = byId('bookTelegramSection');
  const telBox = byId('bookTelegramBox');
  if (telSection && telBox && data.home) {
    telSection.style.display = 'block';
    telBox.textContent = generateBookTelegramSignal(data, dynamicBets, corTotal);
  } else if (telSection) {
    telSection.style.display = 'none';
  }
}

// ─── STRATEGIC GUIDE ─────────────────────────────────────────────────────────────

function generateLiveTelegramSignal(data, inst, metrics = {}) {
  const mHome = metrics.mHome || 50;
  const mAway = metrics.mAway || 50;
  const daPerMin = metrics.daPerMin || 0;
  
  const hTeam = data.home || 'Casa';
  const aTeam = data.away || 'Ospite';
  const score = `${data.gh||0}-${data.ga||0}`;
  const minute = data.minute ? `${data.minute}'` : 'HT';
  const xgStr = `${(data.xgh||0).toFixed(2)}-${(data.xga||0).toFixed(2)}`;
  
  const b1 = data.odds?.back1;
  const lx = data.odds?.layX;
  const b2 = data.odds?.back2;
  let oddsStr = '';
  if (b1 && lx) {
     oddsStr = `\n| Back1: ${b1} / LayX: ${lx}${b2 ? ' / Back2: ' + b2 : ''}`;
  }
  
  let signalStr = `⏳ ${hTeam} ${score} ${aTeam} | Min: ${minute} | XG: ${xgStr}${oddsStr}

BET: ${inst.bet}

📋 ${inst.logic}

🟢 ENTRATA: ${inst.entry}

🔴 USCITA: ${inst.exit}

⚠️ RISCHIO: ${inst.risk}

OMNI-MONITORING
Target: ${(inst.bet === 'WAIT' || inst.bet.includes('MONITOR')) ? "Studio dell'intensità live - No Bet Zone." : "Pressione: " + daPerMin.toFixed(2) + " DA/min | Momentum: " + mHome + "% vs " + mAway + "%"}

---
THE FOUNDER EXCHANGE | 70-WIN EDITION
The Quant Revolution continues.`;

  return signalStr;
}

function updateStrategicGuide(data, metrics = {}) {
  const activeS = document.querySelector('.strat .item.strat-active');
  const guide = byId('strategyGuide');
  if (!guide) return;

  const { daPerMin = 0, daRateH = 0, daRateA = 0, sotEffH = 0, sotEffA = 0, xgGapH = 0, xgGapA = 0, totalXG = 0, mHome = 50, mAway = 50 } = metrics;
  const min = data.minute || 0;
  const homeTeam = data.home || 'Casa';
  const awayTeam = data.away || 'Ospite';

  if (!activeS) {
    // Show pressure summary even when no strategy is active
    guide.innerHTML = `
      <div style="color:var(--muted); margin-bottom:10px;">⏳ Nessuna strategia attiva. Analisi pressione in corso...</div>
      <div style="font-size:12px; display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <div>📈 DA/min: <b style="color:var(--accent)">${daPerMin.toFixed(2)}</b> ${daPerMin > 0.6 ? '🔥 ALTA' : daPerMin > 0.4 ? '🛡️ MEDIA' : '❄️ BASSA'}</div>
        <div>📈 XG Tot: <b style="color:var(--accent)">${totalXG.toFixed(2)}</b></div>
        <div>🏠 ${homeTeam}: ${daRateH.toFixed(2)} DA/min</div>
        <div>✈️ ${awayTeam}: ${daRateA.toFixed(2)} DA/min</div>
        <div>🎯 SOT-Eff H: ${(sotEffH*100).toFixed(0)}%</div>
        <div>🎯 SOT-Eff A: ${(sotEffA*100).toFixed(0)}%</div>
      </div>
      <div style="margin-top:10px; color:var(--warn); font-size:11px;">
        ${daPerMin > 0.6 ? '⚠️ Pressione ALTA ÔÇö monitorare per segnale LTD o BTL.' : 'Attendi che il ritmo di gioco superi la soglia operativa.'}
      </div>`;
    return;
  }

  const instructions = {
    'strat-ltd': {
      bet: 'LAY DRAW (BANCA X)',
      logic: `Score bloccato ${data.gh}:${data.ga} al ${min}'. ${daPerMin.toFixed(2)} DA/min ÔÇö pressione ${daPerMin > 0.6 ? 'ALTA' : 'MEDIA'}. XG ${totalXG.toFixed(2)} suggerisce gol imminente.`,
      entry: `Entrare con LAY X se quota < 3.50. Pressione floor: ${daPerMin.toFixed(2)} DA/min ✔️`,
      exit: `✅ Cash-out al primo gol (Green-up). ⚠️ Uscire al minuto 75-80 se score rimane ${data.gh}:${data.ga} (Rule of 70).`,
      risk: 'Media-Bassa.',
      greenup: { profit: '+30/50%', loss: '-20%', trigger: `Gol o Min 75` }
    },
    'strat-btl': {
      bet: `BACK ${xgGapH > xgGapA ? homeTeam : awayTeam}`,
      logic: `${xgGapH > xgGapA ? homeTeam : awayTeam} domina. DA/min: ${(xgGapH > xgGapA ? daRateH : daRateA).toFixed(2)}/min. XG Gap: +${Math.max(xgGapH, xgGapA).toFixed(2)}.`,
      entry: `Punta ${xgGapH > xgGapA ? homeTeam : awayTeam} se quota > 1.70. Momentum ${Math.max(mHome, mAway)}%.`,
      exit: 'Green-up non appena pareggia o passa davanti. Stop se avversario segna.',
      risk: 'Media.',
      greenup: { profit: '+25/40%', loss: '-15%', trigger: 'Gol dominante' }
    },
    'strat-scalp': {
      bet: 'SCALP UNDER 2.5 / UNDER 1.5',
      logic: `Match sterile. DA/min: ${daPerMin.toFixed(2)} (sotto soglia 0.40). XG: ${totalXG.toFixed(2)}. Nessuna pressione reale.`,
      entry: 'Scalp UNDER per 5-10 minuti. Max 15 tick di esposizione.',
      exit: 'Uscire al primo DA significativo o se DA/min supera 0.50.',
      risk: 'Controllata.',
      greenup: { profit: '+10/20%', loss: '-5%', trigger: 'Time Decay / DA Alert' }
    },
    'strat-power': {
      bet: `OVER 0.5 / BACK ${mHome > mAway ? homeTeam : awayTeam}`,
      logic: `Fase finale al ${min}'. ${mHome > mAway ? homeTeam : awayTeam} in SURGE (${Math.max(mHome, mAway)}%). DA/min: ${daPerMin.toFixed(2)} 🔥`,
      entry: `Entrare su OVER 0.5 o Back ${mHome > mAway ? homeTeam : awayTeam}. Urgenza massima.`,
      exit: 'Lasciare scorrere fino al gol. Stop solo se momentum si inverte bruscamente.',
      risk: 'Alta.',
      greenup: { profit: '+60/100%', loss: '-30%', trigger: 'Goal Late' }
    },
    'strat-layfav': {
      bet: `LAY ${data.gh > data.ga ? homeTeam : awayTeam} (favorito in crisi)`,
      logic: `${data.gh > data.ga ? homeTeam : awayTeam} in vantaggio ma senza produzione. DA/min avversario: ${(data.gh > data.ga ? daRateA : daRateH).toFixed(2)}/min.`,
      entry: 'Bancare il favorito se quota < 1.70 e non produce DA.',
      exit: 'Uscire se favorito segna o se il VA supera 3 SOT.',
      risk: 'Alta.',
      greenup: { profit: '+40/60%', loss: '-25%', trigger: 'Resistenza / Pareggio' }
    },
    'strat-scattergun': {
      bet: 'DUTCHING 1X2 + OVER',
      logic: `Match ad alta intensit├á. DA/min: ${daPerMin.toFixed(2)}. XG: ${totalXG.toFixed(2)}. Equilibrio da sfruttare.`,
      entry: 'Coprire 1X2 con stake proporzionale alle quote. Aggiungere OVER 1.5.',
      exit: 'Uscire al secondo gol con profit protetto.',
      risk: 'Media.',
      greenup: { profit: '+20/35%', loss: '-15%', trigger: 'Secondo Gol' }
    },
    'strat-fortino': {
      bet: `LAY ${data.gh > data.ga ? homeTeam : awayTeam} (Leader Sotto Assedio)`,
      logic: `Minuto ${min}'. ${data.gh > data.ga ? homeTeam : awayTeam} vince ma subisce una pressione brutale: DA/min avversario a ${(data.gh > data.ga ? daRateA : daRateH).toFixed(2)}.`,
      entry: `Banca se quota < 1.30. Sfruttiamo il rapporto Rischio/Rendimento (EV estremo).`,
      exit: 'Green-Up al pareggio. Uscita totale al minuto 88 se il punteggio non cambia.',
      risk: 'Media (Per via della quota bassa)',
      greenup: { profit: '+300/500%', loss: '-10/15%', trigger: 'Pareggio / Min 88' }
    },
    'strat-deadzone': {
      bet: `BACK UNDER ${data.gh + data.ga + 1.5} / SCALP UNDER`,
      logic: `Nessuna squadra sta accelerando. DA complessivo: ${daPerMin.toFixed(2)}. XG totali anemici (${totalXG.toFixed(2)}).`,
      entry: 'Punta sull\'Under corrente. Partita tattica e lenta.',
      exit: 'Mungere il Time Decay per 5-8 minuti. Uscire se DA/min supera 0.50.',
      risk: 'Controllata.',
      greenup: { profit: '+15/20%', loss: '-5%', trigger: 'Time Decay (8 min)' }
    },
    'strat-fade': {
      bet: `LAY ${data.gh > data.ga ? homeTeam : awayTeam} (Fade The Luck)`,
      logic: `Vantaggio immeritato. XG Gap reale: +${Math.max(xgGapH, xgGapA).toFixed(2)} per chi sta perdendo.`,
      entry: 'Bancare chi ha segnato per puro caso (quota in compressione ingiustificata).',
      exit: 'Uscire al pareggio o se la squadra in svantaggio smette di produrre (DA crolla).',
      risk: 'Alta (Contromercato).',
      greenup: { profit: '+40/60%', loss: '-20%', trigger: 'Riequilibrio Score' }
    },
    'strat-ht': {
      bet: `DUTCHING OVER 0.5 HT + OVER 1.5 FT`,
      logic: `Minuto ${min}'. Fase Box-to-Box intensissima (DA/min cumulativo ${daPerMin.toFixed(2)}). Gap momentum nullo. Entrambe vogliono segnare prima del riposo.`,
      entry: 'Coprire mercato Goal HT e Over FT (1.5).',
      exit: 'Uscita massiva al primo gol HT. Perdere stake su mercato HT se non segnano entro il 45\'.',
      risk: 'Media-Alta.',
      greenup: { profit: '+60/80%', loss: 'Stake HT', trigger: 'Gol Precedentemente HT' }
    }
  };

  const inst = activeS ? instructions[activeS.id] : { 
    bet: 'MONITOR (In attesa)', 
    logic: 'Nessuna strategia in trigger. Momentum in fase di accumulo o in attesa di variazioni.', 
    entry: 'Nessun ingresso consigliato al momento. Match sotto osservazione.', 
    exit: `Attendere picco di pressione (DA/min attuale: ${(metrics.daPerMin||0).toFixed(2)}).`, 
    risk: 'Nullo (In attesa).', 
    greenup: { profit: 'N/A', loss: 'N/A', trigger: 'N/A' } 
  };

  guide.innerHTML = `
    <div class="bet-badge">BET: ${inst.bet}</div>
    <div style="color:var(--accent); font-weight:700; margin-bottom:8px; font-size:13px;">📋 ${inst.logic}</div>
    <div style="margin-bottom:6px;"><span style="color:var(--ok); font-weight:700;">🟢 ENTRATA:</span> ${inst.entry}</div>
    <div style="margin-bottom:6px;"><span style="color:var(--warn); font-weight:700;">🔴 USCITA:</span> ${inst.exit}</div>
    <div style="margin-bottom:4px;"><span style="color:var(--muted);">🛡️ RISCHIO:</span> ${inst.risk}</div>
  `;

  const studio = byId('greenupStudio');
  if (studio) {
    studio.style.display = 'flex';
    byId('targetProfit').textContent = inst.greenup.profit;
    byId('stopLoss').textContent = inst.greenup.loss;
    byId('exitTrigger').textContent = inst.greenup.trigger;
  }

  const telSection = byId('liveTelegramSection');
  const telBox = byId('liveTelegramBox');
  if (telSection && telBox && data.home) {
    telSection.style.display = 'block';
    telBox.textContent = generateLiveTelegramSignal(data, inst, metrics);
  } else if (telSection) {
    telSection.style.display = 'none';
  }
}

// ─── EXCHANGE CALCULATOR ─────────────────────────────────────────────────────

function updateExchangeCalc() {
  const b1 = parseFloat(byId('b1')?.value) || 0;
  const lx = parseFloat(byId('lx')?.value) || 0;
  const stake = parseFloat(byId('stake')?.value) || 0;
  const bank = parseFloat(byId('bank')?.value) || 100;

  if (!b1 || !lx || !stake) return;

  // Core exchange calculations
  const backProfit = parseFloat((stake * (b1 - 1)).toFixed(2));
  const layStake = parseFloat((stake * b1 / lx).toFixed(2));
  const layLiability = parseFloat((layStake * (lx - 1)).toFixed(2));
  const breakEven = parseFloat((b1 * stake / (stake + backProfit) + 1).toFixed(2));

  // Green-up targets (30% profit, 20% stop loss as base)
  const greenTarget = parseFloat((backProfit * 0.5).toFixed(2));
  const stopLoss = parseFloat((layLiability * 0.4).toFixed(2));
  const roi = parseFloat(((backProfit / stake) * 100).toFixed(1));

  // Expected Value (simplified: EV = prob_win * profit - prob_lose * stake)
  const impliedProb = b1 > 0 ? 1 / b1 : 0;
  const ev = parseFloat(((impliedProb * backProfit) - ((1 - impliedProb) * stake)).toFixed(2));

  // Update UI
  byId('calcBackProfit').textContent = `€${backProfit}`;
  byId('calcLayLiability').textContent = `€${layLiability}`;
  byId('calcLayStake').textContent = `€${layStake}`;
  byId('calcBreakEven').textContent = breakEven.toFixed(2);
  byId('calcGreenTarget').textContent = `€${greenTarget}`;
  byId('calcStopLoss').textContent = `-€${stopLoss}`;
  byId('calcROI').textContent = `${roi}%`;
  byId('calcEV').textContent = ev >= 0 ? `+€${ev}` : `-€${Math.abs(ev)}`;

  // Trading Signal based on momentum + odds
  updateExchangeSignal(b1, lx, backProfit, layLiability, ev);
}

function updateExchangeSignal(b1, lx, backProfit, layLiability, ev) {
  const badge = byId('exSignalBadge');
  const reason = byId('exSignalReason');
  if (!badge || !reason) return;

  const mHome = parseInt(byId('mHomeTxt')?.textContent) || 0;
  const mAway = 100 - mHome;
  const trend = byId('trendTxt')?.textContent || 'STABLE';
  const hasData = lastData?.home;

  let signal = 'WAIT';
  let color = '#94a3b8';
  let msg = 'In attesa dei dati di match per generare il segnale.';

  if (hasData && b1 > 0 && lx > 0) {
    const xgGapH = (lastData.xgh || 0) - (lastData.gh || 0);
    const xgGapA = (lastData.xga || 0) - (lastData.ga || 0);
    const totalXG = (lastData.xgh || 0) + (lastData.xga || 0);

    if (ev > 0 && mHome > 65 && xgGapH > 0.5 && trend !== 'STABLE') {
      signal = 'BUY HOME';
      color = '#2dd4bf';
      msg = `✅ BACK ${lastData.home} ÔÇö Momentum ${mHome}% + XG Gap +${xgGapH.toFixed(2)}. EV positivo (€${ev}).`;
    } else if (ev > 0 && mAway > 65 && xgGapA > 0.5 && trend !== 'STABLE') {
      signal = 'BUY AWAY';
      color = '#2dd4bf';
      msg = `✅ BACK ${lastData.away} ÔÇö Momentum ${mAway}% + XG Gap +${xgGapA.toFixed(2)}. EV positivo (€${ev}).`;
    } else if (lastData.gh === lastData.ga && totalXG > 1.0 && lastData.minute >= 45) {
      signal = 'LAY DRAW';
      color = '#f59e0b';
      msg = `🛡️ LAY X ÔÇö Score bloccato ${lastData.gh}:${lastData.ga} al ${lastData.minute}' con XG totale ${totalXG.toFixed(2)}. Gol atteso.`;
    } else if (ev < -0.2 || (mHome < 35 && mAway < 35)) {
      signal = 'WAIT';
      color = '#94a3b8';
      msg = '⏱️ Match sterile o EV negativo. Attendere segnale pi├╣ chiaro.';
    } else {
      signal = 'MONITOR';
      color = '#38bdf8';
      msg = `👁️ Match sotto osservazione. Trend: ${trend}. Attendi conferma momentum prima di entrare.`;
    }
  }

  badge.textContent = signal;
  badge.style.background = color === '#2dd4bf' ? 'rgba(45,212,191,0.15)' :
                           color === '#f59e0b' ? 'rgba(245,158,11,0.15)' :
                           color === '#38bdf8' ? 'rgba(56,189,248,0.15)' :
                           'rgba(148,163,184,0.1)';
  badge.style.color = color;
  badge.style.borderColor = color;
  reason.textContent = msg;
}

// ─── MASTER ANALYSIS TRIGGER ──────────────────────────────────────────────────

function runAnalysis() {
  const raw = byId('scanner').value.trim();
  if (!raw) return;

  const data = parseRawMatchText(raw);
  lastData = data;

  displayParsedStats(data);
  const momentum = calcMomentum(data);
  updateDynamicStrategies(data, momentum);
  updateBookPreview(data);

  // Auto-populate Exchange odds from scanner if detected
  if (data.odds) {
    byId('b1').value = data.odds.back1;
    byId('lx').value = data.odds.layX;
  }

  updateExchangeCalc();

  if (data.home) {
    const oddsInfo = data.odds ? ` | Back1: ${data.odds.back1} / LayX: ${data.odds.layX}` : '';
    byId('signal').textContent = `🛡️ ${data.home} ${data.gh}-${data.ga} ${data.away} | Min: ${data.minute}' | XG: ${data.xgh?.toFixed(2)}-${data.xga?.toFixed(2)} | ${data.proxyXG ? 'PROXY XG' : 'XG LIVE'}${oddsInfo}`;
    byId('signal').classList.remove('signal-empty');
  }
}

// ─── AI ENGINE ───────────────────────────────────────────────────────────────

async function runAI() {
  if (engineBusy || !lastData) return;
  engineBusy = true;
  const btn = byId('runBtn');
  btn.textContent = 'ANALYZING...';
  byId('signal').textContent = 'Connessione pipeline AI...';

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastData)
    });
    if (!res.ok) throw new Error('API Offline');
    const result = await res.json();
    byId('signal').textContent = result.analysis || 'Analisi completata.';
  } catch (err) {
    byId('signal').textContent = `⚠️ ${err.message} ÔÇö Usa analisi euristica attiva.`;
  } finally {
    engineBusy = false;
    btn.textContent = 'Analizza con AI Avanzata';
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

function renderPMStats(stats, name) {
    if (!stats) return `<div style="color:var(--muted);">Dati non disponibili per ${name}</div>`;
    
    const getS = (obj, path, sub) => {
        const parts = path.split('.');
        let val = obj;
        for (const p of parts) val = val?.[p];
        return val || 'ÔÇö';
    };

    const renderLast5 = (matches) => {
        if (!matches || matches.length === 0) return 'ÔÇö';
        return matches.map(m => {
            const color = m.trend === 'V' ? 'var(--ok)' : m.trend === 'P' ? 'var(--warn)' : 'var(--danger)';
            return `<div style="display:flex; justify-content:space-between; font-size:10px; margin-bottom:2px; border-bottom:1px solid rgba(255,255,255,0.03);">
                <span style="color:${color}; font-weight:800;">[${m.trend}]</span>
                <span style="color:var(--muted);">${m.score}</span>
            </div>`;
        }).join('');
    };

    return `
      <div class="pm-stat-name">${name}</div>
      <div class="pm-stat-grid-header">
        <span></span><span>TOT</span><span>CASA</span><span>FUORI</span>
      </div>
      <div class="pm-stat-row-split">
        <span class="lbl">Over 2.5 %</span>
        <strong>${getS(stats, 'over_under.total.over25')}</strong>
        <strong>${getS(stats, 'over_under.home.over25')}</strong>
        <strong>${getS(stats, 'over_under.away.over25')}</strong>
      </div>
      <div class="pm-stat-row-split">
        <span class="lbl">BTTS %</span>
        <strong>${getS(stats, 'btts_pct.total')}</strong>
        <strong>${getS(stats, 'btts_pct.home')}</strong>
        <strong>${getS(stats, 'btts_pct.away')}</strong>
      </div>
      <div class="pm-stat-row-split">
        <span class="lbl">Over 1.5 %</span>
        <strong>${getS(stats, 'over_under.total.over15')}</strong>
        <strong>${getS(stats, 'over_under.home.over15')}</strong>
        <strong>${getS(stats, 'over_under.away.over15')}</strong>
      </div>
      <div class="pm-stat-row-split" style="margin-top:8px;">
        <span class="lbl">Angoli Medi</span>
        <strong>${getS(stats, 'corners.total.avg_total')}</strong>
        <strong>${getS(stats, 'corners.home.avg_total')}</strong>
        <strong>${getS(stats, 'corners.away.avg_total')}</strong>
      </div>
      <div class="pm-stat-row-split">
        <span class="lbl">Gialli Medi</span>
        <strong>${getS(stats, 'cards.total.yellow_avg')}</strong>
        <strong>${getS(stats, 'cards.home.yellow_avg')}</strong>
        <strong>${getS(stats, 'cards.away.yellow_avg')}</strong>
      </div>
      <div class="pm-last5-container">
        <div style="font-size:10px; color:var(--accent); font-weight:700; margin-bottom:5px;">ULTIME 5 PARTITE:</div>
        ${renderLast5(stats.last_5)}
      </div>`;
}

function init() {
  byId('importBtn').addEventListener('click', runAnalysis);
  byId('clearBtn').addEventListener('click', () => location.reload());
  byId('runBtn').addEventListener('click', runAI);

  // Auto-analyze on paste with debounce
  byId('scanner').addEventListener('input', () => {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(runAnalysis, 900);
  });

  // Exchange calc: live update on odds/stake change
  ['b1', 'lx', 'stake', 'bank'].forEach(id => {
    byId(id)?.addEventListener('input', updateExchangeCalc);
  });

  const copyBtn = byId('copyLiveTelegramBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const txt = byId('liveTelegramBox')?.textContent || '';
      navigator.clipboard.writeText(txt).then(() => {
        copyBtn.textContent = '✅ Copiato!';
        setTimeout(() => copyBtn.textContent = '📋 Copia per Telegram', 2000);
      });
    });
  }

  const copyBookBtn = byId('copyBookTelegramBtn');
  if (copyBookBtn) {
    copyBookBtn.addEventListener('click', () => {
      const txt = byId('bookTelegramBox')?.textContent || '';
      navigator.clipboard.writeText(txt).then(() => {
        copyBookBtn.textContent = '✅ Copiato!';
        setTimeout(() => copyBookBtn.textContent = '📋 Copia Segnale Book', 2000);
      });
    });
  }
}

init();

// ─── TAB SWITCHER ─────────────────────────────────────────────────────────────

window.switchTab = function(tab) {
  const live = byId('tabLiveContent');
  const pre  = byId('tabPreContent');
  const tracker = byId('tabTrackerContent');
  const btnLive = byId('tabLive');
  const btnPre  = byId('tabPre');
  const btnTracker = byId('tabTracker');

  [live, pre, tracker].forEach(e => e && (e.style.display = 'none'));
  [btnLive, btnPre, btnTracker].forEach(e => e && e.classList.remove('active'));

  if (tab === 'live') {
    live.style.display = '';
    btnLive.classList.add('active');
  } else if (tab === 'pre') {
    pre.style.display = '';
    btnPre.classList.add('active');
  } else if (tab === 'tracker') {
    if (tracker) tracker.style.display = '';
    if (btnTracker) btnTracker.classList.add('active');
    loadTracker();
  }
};

// ─── PRE-MATCH SCOUT ──────────────────────────────────────────────────────────

const RATING_COLOR = { BET: '#00e5a0', VALUE: '#f0c040', WATCH: '#60aaff', SKIP: '#ff4d6d' };
const CONF_COLOR   = { Alta: '#00e5a0', Media: '#f0c040', Bassa: '#999' };

window.runPreMatch = async function() {
  const home   = byId('pmHome')?.value.trim();
  const away   = byId('pmAway')?.value.trim();
  const league = byId('pmLeague')?.value || 'Serie A';

  if (!home || !away) {
    alert('Inserisci entrambe le squadre!');
    return;
  }

  // Show loading
  ['pmStatsSection','pmSummarySection','pmMarketsSection','pmTelegramSection'].forEach(id => {
    byId(id).style.display = 'none';
  });
  const loadSec = byId('pmLoadingSection');
  const loadTxt = byId('pmLoadingText');
  loadSec.style.display = '';
  
  const setLoad = (txt) => { loadTxt.textContent = `🚀 ${txt}`; };
  setLoad(`Inizializzazione caricamento per ${home} vs ${away}...`);

  const btn = byId('scoutBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Analisi...';

  try {
    setLoad('📡 Caricamento dati lega (Sbancobet)...');
    
    const res = await fetch('/api/prematch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ home, away, league })
    });

    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Errore Server ${res.status}`);
    }
    
    setLoad('🧠 Elaborazione dati con Gemini AI...');
    const data = await res.json();

    loadSec.style.display = 'none';

    // Render stats comparison
    byId('pmStatsTitle').textContent = `${home} vs ${away}`;
    byId('pmHomeStats').innerHTML = renderPMStats(data.home_stats, home);
    byId('pmAwayStats').innerHTML = renderPMStats(data.away_stats, away);

    // Render AI summary
    const analysis = data.analysis;
    byId('pmSummaryBox').textContent = analysis.summary || 'Analisi completata.';
    byId('pmVerdictBadge').innerHTML = `
      <span style="display:inline-block; padding:8px 28px; border-radius:30px; font-size:18px; font-weight:800;
        background:${RATING_COLOR[analysis.verdict] || '#60aaff'}22;
        border:2px solid ${RATING_COLOR[analysis.verdict] || '#60aaff'};
        color:${RATING_COLOR[analysis.verdict] || '#60aaff'}; letter-spacing:3px;">
        ${analysis.verdict} ÔÇö Confidenza: ${analysis.confidence_overall}
      </span>`;
    byId('pmSummarySection').style.display = '';

    // Render markets
    renderMarketCards(analysis.markets || []);
    byId('pmMarketsSection').style.display = '';

    // Render telegram
    byId('pmTelegramBox').innerHTML = `
      <div style="font-size:14px; line-height:1.8; color:var(--accent);">
        ${analysis.telegram_signal || 'Segnale non disponibile'}
      </div>
      <button onclick="navigator.clipboard.writeText('${(analysis.telegram_signal||'').replace(/'/g,"\\'")}').then(()=>this.textContent='✅ Copiato!')"
        style="margin-top:10px; padding:6px 18px; border-radius:20px; border:1px solid var(--accent); background:transparent; color:var(--accent); cursor:pointer; font-size:12px;">
        📋 Copia per Telegram
      </button>`;
    byId('pmTelegramSection').style.display = '';

    byId('pmStatsSection').style.display = '';

  } catch (err) {
    loadSec.style.display = 'none';
    byId('pmSummarySection').style.display = '';
    byId('pmSummaryBox').innerHTML = `
        <div style="color:var(--danger); border:1px solid var(--danger); padding:15px; border-radius:8px; background:rgba(244,63,94,0.05);">
            <div style="font-weight:bold; margin-bottom:5px;">❌ ERRORE DI ANALISI</div>
            <div style="font-size:12px;">${err.message}</div>
            <div style="margin-top:10px; font-size:11px; color:var(--muted);">
                Suggerimento: Se l'errore persiste, controlla se i nomi delle squadre sono corretti su Sbancobet (Serie A).
            </div>
        </div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '­ƒöì SCOUT MATCH';
  }
};
function renderMarketCards(markets) {
  const grid = byId('pmMarketsGrid');
  grid.innerHTML = markets.map(m => {
    const col = RATING_COLOR[m.rating] || '#60aaff';
    const confCol = CONF_COLOR[m.confidence] || '#999';
    const isTop = m.name.includes('Miglior Scommessa') || m.name.includes('TOP PICK');
    return `
      <div class="pm-market-card ${isTop ? 'pm-market-top' : ''}" style="border-color:${col}44;">
        <div class="pm-market-header">
          <span class="pm-market-name">${isTop ? '⭐ ' : ''}${m.name}</span>
          <span class="pm-market-rating" style="background:${col}22; color:${col}; border-color:${col};">${m.rating}</span>
        </div>
        <div class="pm-market-pick">${m.pick}</div>
        <div class="pm-market-label" style="color:var(--muted); font-size:12px;">${m.label}</div>
        <div class="pm-market-odds">
          Quota target: <strong style="color:${col};">${m.quota_target}</strong>
          <span class="pm-conf" style="color:${confCol};">🔹 ${m.confidence}</span>
        </div>
        <div class="pm-market-reasoning">${m.reasoning}</div>
      </div>`;
  }).join('');
}

// ─── TRACKER LOGIC ────────────────────────────────────────────────────────────

window.saveTrackerPick = async function(label, pick, oddRef) {
  if (!lastData || !lastData.home) return alert('Dati match mancanti!');
  const match = `${lastData.home} - ${lastData.away}`;
  
  // Richiedi dati reali per l'Exchange
  let defOdd = document.getElementById('lx')?.value || document.getElementById('b1')?.value || oddRef.replace('+', '') || '2.0';
  let defStake = document.getElementById('stake')?.value || '10';
  
  const input = prompt(`Salvataggio Exchange: Inserisci QUOTA e STAKE (es. "3.50 20").\nDefault: ${defOdd} quota, €${defStake} stake.`, `${defOdd} ${defStake}`);
  if (input === null) return; // Cancelled
  
  const parts = input.trim().split(/\s+/);
  const odd = parseFloat(parts[0]) || parseFloat(defOdd);
  const stake = parts.length > 1 ? parseFloat(parts[1]) : parseFloat(defStake);
  
  try {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match, label, pick, odd, stake })
    });
    if (res.ok) {
      alert(`✅ Trade salvato! (Quota: ${odd}, Stake: €${stake})`);
      loadTracker();
    }
  } catch (e) {
    console.error('Save error', e);
  }
};

window.updateTrackerStatus = async function(id, action) {
  let pnl = 0;
  let finalStatus = action;

  if (action === 'CASHOUT') {
    const input = prompt("Inserisci il PnL reale (es. +4.50 o -1.20):", "0.00");
    if (input === null) return;
    pnl = parseFloat(input);
    if (isNaN(pnl)) return alert("Valore non valido!");
  } else if (action === 'FULL_WIN') {
    // We let the API update UI, but wait we need to calculate max pnl?
    // Max PnL string parsing requires knowing if it was back or lay.
    // For simplicity, we just prompt also for FULL WIN/LOSS or let user insert cashout for everything.
    const input = prompt("Inserisci PnL netto finale per la vittoria:", "+10.00");
    if (input === null) return;
    pnl = parseFloat(input);
    finalStatus = 'WIN';
  } else if (action === 'FULL_LOSS') {
    const input = prompt("Inserisci Perdita (Liability/Stake) in negativo:", "-10.00");
    if (input === null) return;
    pnl = parseFloat(input);
    finalStatus = 'LOSE';
  } else if (action === 'VOID') {
    pnl = 0;
    finalStatus = 'VOID';
  }

  try {
    await fetch(`/api/history/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: finalStatus, pnl })
    });
    loadTracker();
  } catch (e) {
    console.error('Update error', e);
  }
};

window.copyOutcomeSignal = function(btn, match, label, pick, odd, status, pnl) {
  const pnlNum = parseFloat(pnl) || 0;
  const isWin = pnlNum > 0 || status === 'WIN';
  const isLoss = pnlNum < 0 || status === 'LOSE';
  const isCashout = status === 'CASHOUT';
  
  let header = isWin ? '✅ WIN/GREEN-UP CONFERMATO ✅' : (isLoss ? '❌ STOP LOSS / LOSE ❌' : '⚪ VOID / PAREGGIO ⚪');
  let outcomeText = isCashout ? `Cashout (PnL: €${pnlNum.toFixed(2)})` : `${status} (PnL: €${pnlNum.toFixed(2)})`;
  if (pnlNum > 0 && isCashout) outcomeText = `+${outcomeText}`; // visual aesthetic
  
  const msg = `${header}
⚽ ${match}
📋 Mercato: ${label}
👉 Pick: ${pick} (Quota ref: ${odd})

💰 ESITO: ${outcomeText}

---
THE FOUNDER EXCHANGE | 70-WIN EDITION`;
  
  navigator.clipboard.writeText(msg).then(() => {
    const oldTxt = btn.textContent;
    btn.textContent = '✅ Copiato!';
    setTimeout(() => btn.textContent = oldTxt, 2000);
  });
};

window.loadTracker = async function() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) return;
    const history = await res.json();
    
    let wins = 0, losses = 0, totalPnl = 0;
    
    // Sort descending by date
    history.sort((a,b) => new Date(b.date) - new Date(a.date));
    history.forEach(h => {
      if (h.status === 'WIN' || h.status === 'CASHOUT') {
        if (h.pnl > 0) wins++;
        else if (h.pnl < 0) losses++; // Cashout negativo ├¿ considerato loss nelle stat
        totalPnl += parseFloat(h.pnl) || 0;
      } else if (h.status === 'LOSE') {
        losses++;
        totalPnl += parseFloat(h.pnl) || 0;
      }
    });
    
    const totalFinished = wins + losses;
    const winRate = totalFinished > 0 ? ((wins / totalFinished) * 100).toFixed(1) : 0;
    
    byId('trTotal').textContent = history.length;
    byId('trWinRate').textContent = `${winRate}%`;
    byId('trPnL').textContent = `€${totalPnl.toFixed(2)}`;
    byId('trPnL').className = `ex-metric-val ${totalPnl >= 0 ? 'ok' : 'danger'}`;
    
    const recent = history.filter(h => h.status !== 'PENDING' && h.status !== 'VOID').slice(0, 10);
    const recentWins = recent.filter(h => (h.pnl || 0) > 0).length;
    const strike = recent.length > 0 ? ((recentWins / recent.length) * 100).toFixed(0) : 0;
    byId('trStrike').textContent = `${strike}% (${recentWins}/${recent.length})`;

    const tbody = byId('trackerTableBody');
    if (history.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:20px; text-align:center; color:var(--muted)">Nessun salvataggio trovato.</td></tr>';
      return;
    }

    tbody.innerHTML = history.map(h => {
      const dateStr = new Date(h.date).toLocaleDateString() + ' ' + new Date(h.date).toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'});
      const isPending = h.status === 'PENDING';
      const isWinOrGreen = h.status === 'WIN' || (h.status === 'CASHOUT' && h.pnl > 0);
      const isLossOrRed = h.status === 'LOSE' || (h.status === 'CASHOUT' && h.pnl < 0);
      
      const rowStyle = isWinOrGreen ? 'border-left: 3px solid var(--ok); background:rgba(45,212,191,0.05);' : 
                       isLossOrRed ? 'border-left: 3px solid var(--danger); background:rgba(244,63,94,0.05);' : 
                       'border-left: 3px solid var(--muted);';
      
      const actions = isPending ? `
        <button onclick="updateTrackerStatus('${h.id}', 'CASHOUT')" style="background:var(--accent); border:none; padding:4px 8px; border-radius:4px; font-weight:bold; cursor:pointer; color:#18181b;" title="Cashout manuale">C-OUT</button>
        <button onclick="updateTrackerStatus('${h.id}', 'FULL_WIN')" style="background:var(--ok); border:none; padding:4px 8px; border-radius:4px; font-weight:bold; cursor:pointer; margin-left:4px;" title="Full Win">✅</button>
        <button onclick="updateTrackerStatus('${h.id}', 'FULL_LOSS')" style="background:var(--danger); border:none; padding:4px 8px; border-radius:4px; font-weight:bold; cursor:pointer; margin-left:4px;" title="Full Loss">❌</button>
      ` : `<span style="color:var(--muted); font-size:11px; margin-right: 10px;">PnL: €${(h.pnl||0).toFixed(2)}</span><button onclick="copyOutcomeSignal(this, \`${h.match}\`, \`${h.label}\`, \`${h.pick}\`, \`${h.odd}\`, \`${h.status}\`, \`${h.pnl}\`)" style="background:rgba(56,189,248,0.2); border:1px solid var(--accent); padding:2px 8px; border-radius:12px; font-size:10px; font-weight:bold; cursor:pointer; color:var(--accent);">📢 Telegram</button>`;
      
      const badgeColor = isWinOrGreen ? 'var(--ok)' : isLossOrRed ? 'var(--danger)' : 'var(--muted)';
      const statusBadge = `<span style="padding:2px 8px; border-radius:12px; background:${badgeColor}22; color:${badgeColor}; font-weight:bold; font-size:11px;">${h.status}</span>`;
      const stakeStr = h.stake ? `Stk: €${h.stake}` : '';

      return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.05); ${rowStyle}">
        <td style="padding:10px; color:var(--muted);">${dateStr}</td>
        <td style="padding:10px; font-weight:bold;">${h.match}</td>
        <td style="padding:10px;">${h.label}</td>
        <td style="padding:10px; color:var(--accent);">${h.pick}</td>
        <td style="padding:10px;">Q: ${h.odd} <br><small style="color:var(--muted)">${stakeStr}</small></td>
        <td style="padding:10px;">${statusBadge}</td>
        <td style="padding:10px;">${actions}</td>
      </tr>
      `;
    }).join('');

  } catch (e) {
    console.error('Load tracker failed', e);
  }
};


