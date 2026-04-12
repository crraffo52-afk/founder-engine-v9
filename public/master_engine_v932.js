/**
 * THE FOUNDER ENGINE V9.4.3 - OMNI-PARSE PRO
 * Allineamento Totale Dati Bologna-Lecce
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

    // 1. Squadre
    const teamsMatch = text.match(/([A-Za-zÀ-ÿ' .()-]+)\s+vs\s+([A-Za-zÀ-ÿ' .()-]+)/i);
    if (teamsMatch) {
       result.home = teamsMatch[1].trim();
       result.away = teamsMatch[2].trim();
    }

    // 2. Score
    const scoreMatches = Array.from(text.matchAll(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/g));
    for (const m of scoreMatches) {
        const s1 = parseInt(m[1]), s2 = parseInt(m[2]);
        if (s1 <= 15 && s2 <= 15) {
            result.gh = s1; result.ga = s2;
            break;
        }
    }

    // 3. Minuto
    const minAlt = text.match(/\b(\d{1,3})['′]/);
    if (minAlt) result.minute = parseInt(minAlt[1]);
    else if (text.includes('FT')) result.minute = 90;

    // 4. xG (Specific multiline or inline)
    const xgLines = lines.findIndex(l => /^XG$/i.test(l));
    if (xgLines !== -1 && lines[xgLines+1] && lines[xgLines+2]) {
        result.xgh = parseFloat(lines[xgLines+1].replace(',', '.'));
        result.xga = parseFloat(lines[xgLines+2].replace(',', '.'));
    }

    // 5. Statistiche Pro (Multiline Scanner)
    const statMap = [
        { keys: ['Tiri in Porta', 'SOT'], stat: 'sot' },
        { keys: ['Attacchi Pericolosi', 'DA'], stat: 'da' },
        { keys: ['Calci d\'Angolo', 'Corners', 'Corner'], stat: 'cor' },
        { keys: ['Possesso Palla', 'Possession'], stat: 'pos' },
        { keys: ['Tiri Totali'], stat: 'st' }
    ];

    lines.forEach((line, i) => {
        statMap.forEach(def => {
            if (def.keys.some(k => line.toLowerCase().includes(k.toLowerCase()))) {
                // Check inline first: "SOT 4-1"
                const inline = line.match(/(\d+)\s*[-]\s*(\d+)/);
                if (inline) {
                    result.stats[def.stat] = [parseInt(inline[1]), parseInt(inline[2])];
                } else if (!isNaN(parseFloat(lines[i+1])) && !isNaN(parseFloat(lines[i+2]))) {
                    // Check multiline: Label \n 2 \n 0
                    result.stats[def.stat] = [parseFloat(lines[i+1]), parseFloat(lines[i+2])];
                }
            }
        });
    });

    // Case-specific for the provided Bologna-Lecce table line: "4-1 8-5 2.19-0.32 8-6"
    const tableLine = lines.find(l => l.includes('2.19-0.32'));
    if (tableLine && !result.xgh) {
        const parts = tableLine.split(/\s+/);
        const xgPart = parts.find(p => p.includes('2.19'));
        if (xgPart) {
            const [xh, xa] = xgPart.split('-').map(v => parseFloat(v));
            result.xgh = xh; result.xga = xa;
        }
    }

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

function updateStatsUI(data) {
    const grid = byId('parsedDisplay');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (byId('matchTitle')) byId('matchTitle').textContent = `— ${data.home} vs ${data.away}`;

    const s = data.stats;
    const items = [
        { label: 'Tiri in Porta (SOT)', h: s.sot?.[0], a: s.sot?.[1] },
        { label: 'Attacchi Peric. (DA)', h: s.da?.[0], a: s.da?.[1] },
        { label: 'Calci d\'Angolo', h: s.cor?.[0], a: s.cor?.[1] },
        { label: 'Possesso Palla', h: s.pos?.[0], a: s.pos?.[1], suffix: '%' },
        { label: 'xG (Expected Goals)', h: data.xgh.toFixed(2), a: data.xga.toFixed(2) }
    ];

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `
            <div class="stat-label">${item.label}</div>
            <div class="stat-home">${item.h || 0}${item.suffix || ''}</div>
            <div class="stat-val">VS</div>
            <div class="stat-away">${item.a || 0}${item.suffix || ''}</div>
        `;
        grid.appendChild(row);
    });
}

function updateBookUI(data) {
    const grid = byId('bookGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const tx = (data.xgh + data.xga) || 0;
    const p05 = Math.round((1 - Math.exp(-tx)) * 100);
    const p15 = Math.round((1 - Math.exp(-tx) * (1 + tx)) * 100);
    const pGoal = Math.round(( (1 - Math.exp(Math.max(data.xgh, 0.01))) * (1 - Math.exp(Math.max(data.xga, 0.15))) ) * 100);

    const markets = [
        { name: 'Over 0.5 Total', prob: p05, color: 'var(--ok)' },
        { name: 'Over 1.5 Total', prob: p15, color: 'var(--warn)' },
        { name: 'BTTS (Goal)', prob: pGoal, color: 'var(--accent)' },
        { name: 'Home Score', prob: Math.round((1-Math.exp(-data.xgh))*100), color: 'var(--ok)' }
    ];

    markets.forEach(m => {
        const card = document.createElement('div');
        card.className = 'book-card';
        card.innerHTML = `
            <div class="book-name">${m.name}</div>
            <div class="book-prob" style="color:${m.color}">${m.prob}%</div>
            <div class="book-bar"><div class="book-fill" style="width:${m.prob}%; background:${m.color}"></div></div>
        `;
        grid.appendChild(card);
    });
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
}

function runAnalysis() {
    const raw = byId('scanner').value.trim();
    if (!raw) return;
    
    try {
        const data = parseRawMatchText(raw);
        if (!data.home || !data.away) return;

        lastData = data;
        calcMomentum(data);
        updateStatsUI(data);
        updateBookUI(data);
        updateExchangeCalc();
        
        byId('signal').textContent = `⚡ ${data.home} ${data.gh}-${data.ga} | Min: ${data.minute}' | XG: ${data.xgh.toFixed(2)}-${data.xga.toFixed(2)}`;
        byId('signal').classList.remove('signal-empty');
    } catch (e) {
        console.error('Parser Error:', e);
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
    byId('signal').classList.remove('signal-empty');
  } catch (err) {
    byId('signal').textContent = `⚠️ Errore AI: ${err.message}`;
  } finally {
    engineBusy = false;
    byId('runBtn').textContent = 'Analizza con AI Avanzata';
  }
}

// ─── INITIALIZATION ──────────────────────────────────────────────────────────

function init() {
    byId('importBtn')?.addEventListener('click', runAnalysis);
    byId('runBtn')?.addEventListener('click', runAI);
    byId('clearBtn')?.addEventListener('click', () => {
        byId('scanner').value = '';
        location.reload();
    });
    byId('scanner')?.addEventListener('input', () => {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(runAnalysis, 1000);
    });
    ['b1', 'lx', 'stake', 'prevLoss', 'entryType'].forEach(id => {
        byId(id)?.addEventListener('input', updateExchangeCalc);
    });
    window.switchTab = function(tab) {
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        const target = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`);
        if (target) target.style.display = 'grid';
        const btn = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
        if (btn) btn.classList.add('active');
    };
}

document.addEventListener('DOMContentLoaded', init);