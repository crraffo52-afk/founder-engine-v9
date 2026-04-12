/**
 * THE FOUNDER ENGINE V9.2 - CORE EDITION
 * Hub Strategico di Precisione (Senza Global Radar)
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

    const teamsMatch = text.match(/([A-Za-zÀ-ÿ' .()-]+)\s+vs\s+([A-Za-zÀ-ÿ' .()-]+)/i);
    if (teamsMatch) {
       result.home = teamsMatch[1].trim();
       result.away = teamsMatch[2].trim();
    }

    const cleanScoreText = text.replace(/\(\s*\d{1,2}\s*[:\-]\s*\d{1,2}\s*\)/g, '');
    const scoreMatches = Array.from(cleanScoreText.matchAll(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/g));
    for (const m of scoreMatches) {
        const s1 = parseInt(m[1]), s2 = parseInt(m[2]);
        if (s1 <= 15 && s2 <= 15) {
            result.gh = s1; result.ga = s2;
            break;
        }
    }

    const timeMatch = text.match(/\b(\d{1,3}):(\d{2})\b/);
    if (timeMatch) result.minute = parseInt(timeMatch[1]);
    else {
        const minAlt = text.match(/\b(\d{1,3})['′]/);
        if (minAlt) result.minute = parseInt(minAlt[1]);
    }

    const xghMatch = text.match(/XG\s*\n?\s*(\d+[.,]\d+)\s*\n?\s*(\d+[.,]\d+)/i);
    if (xghMatch) {
        result.xgh = parseFloat(xghMatch[1].replace(',', '.'));
        result.xga = parseFloat(xghMatch[2].replace(',', '.'));
    } else {
        const inlineXG = text.match(/XG\s*(\d+[.,]\d+)\s*[-–]\s*(\d+[.,]\d+)/i);
        if (inlineXG) {
            result.xgh = parseFloat(inlineXG[1].replace(',', '.'));
            result.xga = parseFloat(inlineXG[2].replace(',', '.'));
        }
    }

    const statDefs = [
        { keys: ['Tiri in Porta', 'SOT'], stat: 'sot' },
        { keys: ['Attacchi Pericolosi', 'Dangerous Attacks'], stat: 'da' },
        { keys: ["Calci d'Angolo", 'Corners'], stat: 'cor' },
        { keys: ['Possesso Palla', 'Possession'], stat: 'pos' },
    ];

    lines.forEach((line, i) => {
        statDefs.forEach(def => {
            if (def.keys.some(k => line.toLowerCase().includes(k.toLowerCase()))) {
                const v1 = parseFloat(lines[i+1]);
                const v2 = parseFloat(lines[i+2]);
                if (!isNaN(v1) && !isNaN(v2)) result.stats[def.stat] = [v1, v2];
            }
        });
    });

    if (result.xgh === undefined) {
        const s = result.stats;
        const g = (k, i) => (s[k] ? s[k][i] : 0);
        result.xgh = parseFloat(((g('sot',0)*0.18) + (g('da',0)*0.025) + (g('cor',0)*0.06)).toFixed(2));
        result.xga = parseFloat(((g('sot',1)*0.18) + (g('da',1)*0.025) + (g('cor',1)*0.06)).toFixed(2));
        result.proxyXG = true;
    }

    result.gh = result.gh || 0;
    result.ga = result.ga || 0;
    result.minute = result.minute || 0;
    return result;
}

// ─── ANALYSIS ENGINE ──────────────────────────────────────────────────────────

function calcMomentum(data) {
    const min = Math.max(data.minute, 1);
    const threatH = Math.max(0, data.xgh - data.gh);
    const threatA = Math.max(0, data.xga - data.ga);
    const dah = data.stats.da?.[0] || 0;
    const daa = data.stats.da?.[1] || 0;

    const hScore = (threatH * 40) + (dah * 2) + (data.xgh * 10);
    const aScore = (threatA * 40) + (daa * 2) + (data.xga * 10);
    const total = Math.max(hScore + aScore, 1);

    const mHome = Math.round((hScore / total) * 100);
    const mAway = 100 - mHome;

    byId('mHome').style.width = `${mHome}%`;
    byId('mAway').style.width = `${mAway}%`;
    byId('mHomeTxt').textContent = `${mHome}%`;
    byId('mAwayTxt').textContent = `${mAway}%`;
    return { mHome, mAway };
}

function updateExchangeCalc() {
    const b1 = valNum('b1'), lx = valNum('lx'), stake = valNum('stake');
    const type = byId('entryType')?.value || 'PRIMARY';
    const prevLoss = valNum('prevLoss');

    if (byId('recoveryBox')) byId('recoveryBox').style.display = type === 'RECOVERY' ? 'block' : 'none';

    let activeStake = stake;
    if (type === 'RECOVERY' && prevLoss > 0 && b1 > 1) {
        activeStake = parseFloat((prevLoss / ((b1 - 1) * 0.95)).toFixed(2));
        byId('stake').value = activeStake;
    }

    const backProfit = parseFloat((activeStake * (b1 - 1) * 0.95).toFixed(2));
    const layStake = parseFloat(((activeStake * b1) / lx).toFixed(2));
    const layLiability = parseFloat((layStake * (lx - 1)).toFixed(2));
    
    byId('calcBackProfit').textContent = `€${backProfit}`;
    byId('calcLayLiability').textContent = `€${layLiability}`;
    byId('calcLayStake').textContent = `€${layStake}`;
    
    if (byId('calcBankroll')) byId('calcBankroll').textContent = `€${Math.ceil(layLiability * 5)}`;
    
    updateExchangeSignal(b1, lx, backProfit, layLiability);
}

function updateExchangeSignal(b1, lx, backProfit, layLiability) {
    const badge = byId('exSignalBadge');
    if (!badge || !lastData) return;
    
    const daPerMin = ((lastData.stats.da?.[0] || 0) + (lastData.stats.da?.[1] || 0)) / Math.max(lastData.minute, 1);
    const totalXG = lastData.xgh + lastData.xga;
    
    let signal = 'WAIT', color = '#94a3b8';
    if (lastData.minute >= 15 && lastData.minute <= 35 && lastData.gh === 0 && daPerMin > 0.8) {
        signal = '🔥 PT EXPLOSION'; color = '#f59e0b';
    } else if (totalXG > 1.2 && lastData.minute > 45 && lx < 3.5) {
        signal = 'LAY DRAW (LTD)'; color = '#f59e0b';
    }
    
    badge.textContent = signal;
    badge.style.color = color;
    badge.style.borderColor = color;
}

// ─── TABS & CORE ─────────────────────────────────────────────────────────────

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    const target = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`);
    if (target) target.style.display = 'grid';
    
    const btn = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    if (btn) btn.classList.add('active');
};

window.autoSuggestLayer = function(data) {
    const typeEl = byId('entryType');
    if (!typeEl) return;
    const min = data.minute || 0, totalGoals = data.gh + data.ga;
    if (totalGoals === 0 && min >= 15 && min <= 40) typeEl.value = 'PRIMARY';
    else if (totalGoals > 0 && min < 75) typeEl.value = 'RECOVERY';
    else if (min >= 75) typeEl.value = 'SCALP';
    updateExchangeCalc();
};

function runAnalysis() {
    const raw = byId('scanner').value.trim();
    if (!raw) return;
    const data = parseRawMatchText(raw);
    lastData = data;
    
    calcMomentum(data);
    updateExchangeCalc();
    window.autoSuggestLayer(data);
    
    byId('signal').textContent = `⚡ ${data.home || 'Match'} ${data.gh}-${data.ga} | Min: ${data.minute}' | XG: ${data.xgh?.toFixed(2)}-${data.xga?.toFixed(2)}`;
    byId('signal').classList.remove('signal-empty');
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

// ─── INITIALIZATION ──────────────────────────────────────────────────────────

function init() {
    byId('importBtn')?.addEventListener('click', runAnalysis);
    byId('runBtn')?.addEventListener('click', runAI);
    byId('scanner')?.addEventListener('input', () => {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(runAnalysis, 1000);
    });
    ['b1', 'lx', 'stake', 'prevLoss', 'entryType'].forEach(id => {
        byId(id)?.addEventListener('input', updateExchangeCalc);
    });
    window.switchTab('live');
}

document.addEventListener('DOMContentLoaded', init);
init();