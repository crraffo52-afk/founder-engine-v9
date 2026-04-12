/**
 * THE FOUNDER ENGINE V9.2 - OMNI-DYNAMIC HUB Edition
 * Master of the Pitch - Dynamic Multi-Layer Era
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
  const teamsMatch = text.match(/([A-Za-zÀ-ÿ' .()-]+)\s+vs\s+([A-Za-zÀ-ÿ' .()-]+)/i);
  if (teamsMatch) {
    result.home = teamsMatch[1].trim();
    result.away = teamsMatch[2].trim();
  }

  // Clean string to remove half-time scores like (0:0) or (1-0)
  const cleanScoreText = text.replace(/\(\s*\d{1,2}\s*[:\-]\s*\d{1,2}\s*\)/g, '');

  // Score
  const scoreMatches = Array.from(cleanScoreText.matchAll(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/g));
  for (const match of scoreMatches) {
    const s1 = parseInt(match[1], 10);
    const s2 = parseInt(match[2], 10);
    if (s1 <= 15 && s2 <= 15) {
      if (match[0].includes(':') && (match[1].startsWith('0') && match[1].length === 2 && s1 > 0)) continue;
      if (match[0].includes(':') && match[2].length === 2 && s2 > 10) continue; 
      result.gh = s1;
      result.ga = s2;
      break;
    }
  }

  // Minute
  const timeMatch = text.match(/\b(1?\d{2}|\d{1,2}):(\d{2})\b/g);
  if (timeMatch) {
    for (const t of timeMatch.slice().reverse()) {
      const [mm, ss] = t.split(':').map(Number);
      if (mm >= 1 && mm <= 120 && ss >= 0 && ss <= 59) {
        if (result.gh !== undefined && mm <= 15 && ss <= 15) continue;
        result.minute = mm;
        break;
      }
    }
  }

  if (!result.minute) {
    const minAlt = text.match(/\b(\d{1,3})['′]/);
    if (minAlt) result.minute = parseInt(minAlt[1], 10);
  }

  // Official XG
  const xgLineIdx = lines.findIndex(l => /^XG$/i.test(l));
  if (xgLineIdx >= 0) {
    const xgh = parseFloat(lines[xgLineIdx + 1]?.replace(',', '.'));
    const xga = parseFloat(lines[xgLineIdx + 2]?.replace(',', '.'));
    if (!isNaN(xgh) && !isNaN(xga)) {
      result.xgh = xgh;
      result.xga = xga;
    }
  }

  if (result.xgh === undefined) {
    const xgInline = text.match(/(\d+[.,]\d+)\s*[-–]\s*(\d+[.,]\d+)\s*(?=\s|$)/);
    if (xgInline) {
      const v1 = parseFloat(xgInline[1].replace(',', '.'));
      const v2 = parseFloat(xgInline[2].replace(',', '.'));
      if (v1 > 0 || v2 > 0) { result.xgh = v1; result.xga = v2; }
    }
  }

  // Odds Extraction
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

  // Stats Crawler
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
        if (line.includes('(1T)') || line.includes('1° Tempo')) return;
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

  if (result.stats.goals_crawler) {
    result.gh = result.stats.goals_crawler[0];
    result.ga = result.stats.goals_crawler[1];
  }

  if (!result.stats.pos) {
    const posMatch = text.match(/(\d{2,3})\s*%\s*\n?\s*(\d{2,3})\s*%/);
    if (posMatch) result.stats.pos = [parseFloat(posMatch[1]), parseFloat(posMatch[2])];
  }

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
  const get = (k, i, sfx = '') => s[k] ? `${s[k][i]}${sfx}` : '—';
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
      <span class="stat-label">⏱ MINUTO</span>
      <span class="stat-home">—</span>
      <span class="stat-val">${data.minute}'</span>
      <span class="stat-away">—</span>
    </div>
    <div class="stat-row highlight">
      <span class="stat-label">📊 XG ${xgMode}</span>
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
      <span class="stat-label">📐 Tiri Totali</span>
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
      <span class="stat-label">⚙️ Possesso</span>
      <span class="stat-home">${get('pos',0,'%')}</span>
      <span class="stat-val">POS</span>
      <span class="stat-away">${get('pos',1,'%')}</span>
    </div>
    ${data.odds ? `
    <div class="stat-row highlight">
      <span class="stat-label">💹 Quote Exchange</span>
      <span class="stat-home" style="font-size:13px;">Back1: ${data.odds.back1}</span>
      <span class="stat-val">ODDS</span>
      <span class="stat-away" style="font-size:13px;">LayX: ${data.odds.layX}</span>
    </div>` : ''}
  `;
  byId('providerText').textContent = data.provider;
  byId('modeChip').textContent = data.proxyXG ? 'PROXY XG MODE' : 'XG LIVE MODE';
}

function calcMomentum(data) {
  const s = data.stats;
  const g = (k, i) => (s[k] ? s[k][i] : 0);
  const pos = g('pos', 0) || 50;
  const soth = g('sot', 0), sota = g('sot', 1);
  const sth = g('st', 0) || 1, sta = g('st', 1) || 1;
  const dah = g('da', 0), daa = g('da', 1);
  const min = data.minute || 1;
  const effH = Math.min(soth / sth, 1);
  const effA = Math.min(sota / sta, 1);
  const timeDecay = Math.min(min / 90, 1) + 0.5;
  const threatH = Math.max(0, data.xgh - data.gh);
  const threatA = Math.max(0, data.xga - data.ga);
  const homeScore = Math.max(0, (threatH * 35 * timeDecay) + (data.xgh * 10) + (pos * 0.3) + (soth * 6 * effH) + (dah * 1.8));
  const awayScore = Math.max(0, (threatA * 35 * timeDecay) + (data.xga * 10) + ((100 - pos) * 0.3) + (sota * 6 * effA) + (daa * 1.8));
  const total = Math.max(homeScore + awayScore, 1);
  const mHome = Math.round((homeScore / total) * 100);
  const mAway = Math.round((awayScore / total) * 100);
  byId('mHome').style.width = `${mHome}%`;
  byId('mAway').style.width = `${mAway}%`;
  byId('mHomeTxt').textContent = `${mHome}%`;
  byId('mAwayTxt').textContent = `${mAway}%`;
  const gap = Math.abs(mHome - mAway);
  const trend = gap > 35 ? 'SURGE' : gap > 15 ? 'RISING' : 'STABLE';
  byId('trendTxt').textContent = trend;
  byId('trendDot').style.color = trend === 'SURGE' ? '#2dd4bf' : trend === 'RISING' ? '#f59e0b' : '#94a3b8';
  return { mHome, mAway };
}

function updateDynamicStrategies(data, momentum) {
  const { mHome, mAway } = momentum;
  const s = data.stats;
  const get = (k, i) => (s[k] ? s[k][i] : 0);
  const totalXG = (data.xgh || 0) + (data.xga || 0);
  const xgGapH = (data.xgh || 0) - (data.gh || 0);
  const xgGapA = (data.xga || 0) - (data.ga || 0);
  const min = data.minute || 1;
  const dah = get('da', 0), daa = get('da', 1);
  const daTotal = dah + daa;
  const daPerMin = min > 0 ? daTotal / min : 0;
  const daRateH = min > 0 ? dah / min : 0;
  const daRateA = min > 0 ? daa / min : 0;
  const soth = get('sot', 0), sota = get('sot', 1);
  const stH = get('st', 0) || 1, stA = get('st', 1) || 1;
  document.querySelectorAll('.strat .item').forEach(el => el.classList.remove('strat-active'));
  if (data.gh === data.ga && min >= 45 && min <= 75 && (totalXG > 1.2 || daPerMin >= 0.85 || mHome > 65 || mAway > 65)) byId('strat-ltd')?.classList.add('strat-active');
  if ((xgGapH >= 0.5 && mHome >= 60 && daRateH >= 0.5) || (xgGapA >= 0.5 && mAway >= 60 && daRateA >= 0.5)) byId('strat-btl')?.classList.add('strat-active');
  if (min >= 20 && min <= 60 && totalXG <= 0.6 && daPerMin <= 0.4 && (soth + sota) <= 3) byId('strat-scalp')?.classList.add('strat-active');
  if (min > 70 && (mHome >= 75 || mAway >= 75) && (daRateH >= 0.6 || daRateA >= 0.6)) byId('strat-power')?.classList.add('strat-active');
  updateStrategicGuide(data, { mHome, mAway, daPerMin, daRateH, daRateA, xgGapH, xgGapA, totalXG });
}

function updateBookPreview(data) {
  const xgDiff = (data.xgh || 0) - (data.xga || 0);
  const totalXG = (data.xgh || 0) + (data.xga || 0);
  const totalGoals = (data.gh || 0) + (data.ga || 0);
  const min = data.minute || 1;
  const s = data.stats;
  const g = (k, i) => (s[k] ? s[k][i] : 0);
  const daTotal = g('da', 0) + g('da', 1);
  const daPerMin = daTotal / min;
  let dynamicBets = [];
  const xgTarget = daPerMin >= 1.0 ? 0.30 : 0.40;
  if (min >= 15 && min <= 35 && totalGoals === 0 && daPerMin >= 0.8 && totalXG >= xgTarget) {
    dynamicBets.push({ label: 'PT EXPLOSION', pick: 'Over 0.5 Goal nel PT', odd: '1.80+', confidence: 'Alta', reason: `Pressione: ${daPerMin.toFixed(2)} DA/min.` });
  }
  if (data.gh > 0 && data.ga > 0) dynamicBets.push({ label: 'GOAL / NO GOAL', pick: 'Entrambe Segnano (WIN)', odd: '-', confidence: 'Alta', reason: 'Pick già maturato.' });
  else if (totalXG >= 1.6 && g('sot', 0) >= 2 && g('sot', 1) >= 2 && min < 75) dynamicBets.push({ label: 'GOAL / NO GOAL', pick: 'Goal (Sì)', odd: '1.70+', confidence: 'Alta', reason: `XG: ${totalXG.toFixed(2)}.` });
  let nextOver = totalGoals >= 2 ? 3.5 : (totalGoals === 1 ? 2.5 : 1.5);
  if (totalXG > totalGoals + 0.8 && daPerMin > 0.85) dynamicBets.push({ label: `UNDER / OVER ${nextOver}`, pick: `Over ${nextOver}`, odd: '1.80+', confidence: 'Alta', reason: `Ritmo Elite (${daPerMin.toFixed(2)} DA/min).` });
  dynamicBets = dynamicBets.slice(0, 4);
  byId('bookGrid').innerHTML = dynamicBets.map(b => `
    <div class="book-item">
      <div class="conf-badge ${b.confidence === 'Alta' ? 'conf-high' : ''}">${b.confidence}</div>
      <div class="book-label">${b.label}</div>
      <div class="book-pick">${b.pick}</div>
      <div class="book-odd">Quota ref: ${b.odd}</div>
      <div class="book-note">${b.reason}</div>
      <button onclick="saveTrackerPick('${b.label}', '${b.pick}', '${b.odd}')" class="pm-btn pm-btn-outline" style="margin-top:8px; width:100%; font-size:11px;">💾 Salva Pick</button>
    </div>
  `).join('');
}

function updateStrategicGuide(data, metrics = {}) {
  const activeS = document.querySelector('.strat .item.strat-active');
  const guide = byId('strategyGuide');
  if (!guide) return;
  const { daPerMin = 0, xgGapH = 0, xgGapA = 0, totalXG = 0 } = metrics;
  const min = data.minute || 0;
  if (!activeS) {
    guide.innerHTML = `<div style="color:var(--muted);">⏳ Analisi pressione: DA/min ${daPerMin.toFixed(2)}, XG Tot ${totalXG.toFixed(2)}</div>`;
    return;
  }
  guide.innerHTML = `<div class="bet-badge">BET ATTIVA: ${activeS.innerText}</div><div style="font-size:12px; margin-top:5px;">Pressione Rilevata: ${daPerMin.toFixed(2)} DA/min. XG Gap: ${Math.max(xgGapH, xgGapA).toFixed(2)}.</div>`;
}

// ─── EXCHANGE CALCULATOR ─────────────────────────────────────────────────────

function updateExchangeCalc() {
  const b1 = parseFloat(byId('b1')?.value) || 0;
  const lx = parseFloat(byId('lx')?.value) || 0;
  const stakeValue = parseFloat(byId('stake')?.value) || 10;
  const type = byId('entryType')?.value || 'PRIMARY';
  const prevLoss = parseFloat(byId('prevLoss')?.value) || 0;
  const recBox = byId('recoveryBox');
  if (recBox) recBox.style.display = type === 'RECOVERY' ? 'block' : 'none';
  if (!b1 || !lx) return;
  const commission = 0.05;
  let activeStake = stakeValue;
  if (type === 'RECOVERY' && prevLoss > 0) {
    activeStake = parseFloat((prevLoss / ((b1 - 1) * (1 - commission))).toFixed(2));
    byId('stake').value = activeStake;
  }
  const grossProfit = activeStake * (b1 - 1);
  const backProfit = parseFloat((grossProfit * (1 - commission)).toFixed(2));
  const layStake = parseFloat(((activeStake * b1) / lx).toFixed(2));
  const layLiability = parseFloat((layStake * (lx - 1)).toFixed(2));
  const breakEven = parseFloat((b1 * activeStake / (activeStake + backProfit) + 1).toFixed(2));
  const roi = parseFloat(((backProfit / activeStake) * 100).toFixed(1));
  const impliedProb = b1 > 0 ? 1 / b1 : 0;
  const trueProb = impliedProb * 0.95;
  const ev = parseFloat(((trueProb * backProfit) - ((1 - trueProb) * activeStake)).toFixed(2));
  byId('calcBackProfit').textContent = `€${backProfit}`;
  byId('calcLayLiability').textContent = `€${layLiability}`;
  byId('calcLayStake').textContent = `€${layStake}`;
  byId('calcBreakEven').textContent = breakEven.toFixed(2);
  byId('calcROI').textContent = `${roi}%`;
  byId('calcEV').textContent = ev >= 0 ? `+€${ev}` : `-€${Math.abs(ev)}`;
  const recBank = Math.max(100, Math.ceil(layLiability * 5));
  const bankEl = byId('calcBankroll');
  if (bankEl) bankEl.textContent = `€${recBank}`;
  updateExchangeSignal(b1, lx, backProfit, layLiability, ev);
}

function updateExchangeSignal(b1, lx, backProfit, layLiability, ev) {
  const badge = byId('exSignalBadge');
  const reason = byId('exSignalReason');
  if (!badge || !reason) return;
  const mHome = parseInt(byId('mHomeTxt')?.textContent) || 0;
  const hasData = lastData?.home;
  let signal = 'WAIT', color = '#94a3b8', msg = 'In attesa.';
  if (hasData && b1 > 0 && lx > 0) {
    const totalXG = (lastData.xgh || 0) + (lastData.xga || 0);
    const daPerMin = ((lastData.stats.da?.[0] || 0) + (lastData.stats.da?.[1] || 0)) / Math.max(lastData.minute, 1);
    if (lastData.minute >= 15 && lastData.minute <= 35 && lastData.gh === 0 && lastData.ga === 0 && daPerMin >= 0.8 && totalXG >= 0.3) {
      signal = '🔥 PT EXPLOSION'; color = '#f59e0b'; msg = `Pressione: ${daPerMin.toFixed(2)} DA/min.`;
    } else if (ev >= 0.5 && mHome >= 75) {
      signal = 'BUY HOME (ELITE)'; color = '#2dd4bf'; msg = `Back ${lastData.home} — EV: €${ev}.`;
    } else if (lastData.gh === lastData.ga && totalXG >= 1.2 && lastData.minute >= 45 && lx <= 3.5) {
      signal = 'LAY DRAW (LTD)'; color = '#f59e0b'; msg = `LTD @ ${lx}.`;
    } else {
       signal = 'MONITOR'; color = '#38bdf8'; msg = `Attendi Surge.`;
    }
  }
  badge.textContent = signal;
  badge.style.color = color;
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
  if (data.odds) { byId('b1').value = data.odds.back1; byId('lx').value = data.odds.layX; }
  updateExchangeCalc();
  if (typeof window.autoSuggestLayer === 'function') window.autoSuggestLayer(data);
  if (data.home) {
    byId('signal').textContent = `⚡ ${data.home} ${data.gh}-${data.ga} ${data.away} | Min: ${data.minute}' | XG: ${data.xgh?.toFixed(2)}-${data.xga?.toFixed(2)}`;
    byId('signal').classList.remove('signal-empty');
  }
}

async function runAI() {
  if (engineBusy || !lastData) return;
  engineBusy = true;
  byId('runBtn').textContent = 'ANALYZING...';
  try {
    const res = await fetch('/api/analyze', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(lastData) });
    const result = await res.json();
    byId('signal').textContent = result.analysis || 'Analisi completata.';
  } catch (err) {
    byId('signal').textContent = `⚠️ Analisi locale attiva.`;
  } finally {
    engineBusy = false;
    byId('runBtn').textContent = 'Analizza con AI Avanzata';
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

window.autoSuggestLayer = function(data) {
  const typeEl = byId('entryType');
  if (!typeEl) return;
  const min = data.minute || 0, totalGoals = (data.gh || 0) + (data.ga || 0);
  if (totalGoals === 0 && min >= 15 && min <= 35) typeEl.value = 'PRIMARY';
  else if (totalGoals > 0 && min >= 75) typeEl.value = 'SCALP';
  else if (totalGoals > 0 && min < 75) typeEl.value = 'RECOVERY';
  else typeEl.value = 'PRIMARY';
  updateExchangeCalc();
};

function init() {
  byId('importBtn')?.addEventListener('click', runAnalysis);
  byId('clearBtn')?.addEventListener('click', () => location.reload());
  byId('runBtn')?.addEventListener('click', runAI);
  byId('scanner')?.addEventListener('input', () => { clearTimeout(autoTimer); autoTimer = setTimeout(runAnalysis, 900); });
  ['b1', 'lx', 'stake', 'prevLoss', 'entryType'].forEach(id => { byId(id)?.addEventListener('input', updateExchangeCalc); });
}

init();

window.switchTab = function(tab) {
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  const target = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`);
  if (target) target.style.display = 'grid';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)?.classList.add('active');
};