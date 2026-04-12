/**
 * THE FOUNDER ENGINE V9.5.0 - ELITE RESTORE
 * Ripristino stabilità 11 Aprile - NO AI
 */

const byId = (id) => document.getElementById(id);
const valNum = (id) => parseFloat(byId(id)?.value) || 0;

let lastData = null;
let autoTimer = null;

// ─── PARSER TRADIZIONALE (STABILE IERI) ──────────────────────────────────────

function parseRawMatchText(raw) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const text = lines.join(' ');
    const result = { stats: {}, proxyXG: false };

    // Squadre
    const teamsMatch = text.match(/([A-Za-zÀ-ÿ' .()-]+)\s+vs\s+([A-Za-zÀ-ÿ' .()-]+)/i);
    if (teamsMatch) {
       result.home = teamsMatch[1].trim();
       result.away = teamsMatch[2].trim();
    }

    // Score
    const scoreMatches = Array.from(text.matchAll(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/g));
    for (const m of scoreMatches) {
        const s1 = parseInt(m[1]), s2 = parseInt(m[2]);
        if (s1 <= 15 && s2 <= 15) {
            result.gh = s1; result.ga = s2;
            break;
        }
    }

    // Minuto
    const minAlt = text.match(/\b(\d{1,3})['′]/);
    if (minAlt) result.minute = parseInt(minAlt[1]);
    else if (text.includes('FT')) result.minute = 90;

    // xG (Expected Goals)
    const xgMatch = text.match(/XG\s+([\d.]+)\s+([\d.]+)/i) || text.match(/([\d.]+)-([\d.]+)/);
    if (xgMatch) {
        result.xgh = parseFloat(xgMatch[1]);
        result.xga = parseFloat(xgMatch[2]);
    }

    // Stats Grid Scanner (Bologna vs Lecce multi-line support)
    const statDef = [
        { key: 'Tiri in Porta', id: 'sot' },
        { key: 'Attacchi Pericolosi', id: 'da' },
        { key: 'Possesso Palla', id: 'pos' },
        { key: 'Calci d\'Angolo', id: 'cor' }
    ];

    lines.forEach((line, i) => {
        statDef.forEach(def => {
            if (line.includes(def.key)) {
                if (!isNaN(parseFloat(lines[i+1])) && !isNaN(parseFloat(lines[i+2]))) {
                    result.stats[def.id] = [parseFloat(lines[i+1]), parseFloat(lines[i+2])];
                }
            }
        });
    });

    if (result.xgh === undefined) {
        // Fallback xG formula (Stabile V9)
        const s = result.stats;
        const g = (k, i) => (s[k] ? s[k][i] : 0);
        result.xgh = (g('sot',0)*0.18) + (g('da',0)*0.02) + (g('cor',0)*0.05);
        result.xga = (g('sot',1)*0.18) + (g('da',1)*0.02) + (g('cor',1)*0.05);
        result.proxyXG = true;
    }

    result.gh = result.gh || 0;
    result.ga = result.ga || 0;
    result.minute = result.minute || 0;
    return result;
}

// ─── RENDERING UI ─────────────────────────────────────────────────────────────

function updateStatsUI(data) {
    const grid = byId('parsedDisplay');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (byId('matchTitle')) byId('matchTitle').textContent = `— ${data.home} vs ${data.away}`;

    const items = [
        { label: 'Tiri in Porta', val: `${data.stats.sot?.[0] || 0} - ${data.stats.sot?.[1] || 0}` },
        { label: 'Attacchi Peric.', val: `${data.stats.da?.[0] || 0} - ${data.stats.da?.[1] || 0}` },
        { label: 'xG (Expected Goals)', val: `${data.xgh.toFixed(2)} - ${data.xga.toFixed(2)}` },
        { label: 'Possesso Palla', val: `${data.stats.pos?.[0] || 0}% - ${data.stats.pos?.[1] || 0}%` }
    ];

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `
            <div class="stat-label">${item.label}</div>
            <div class="stat-home">${item.val.split('-')[0]}</div>
            <div class="stat-val">VS</div>
            <div class="stat-away">${item.val.split('-')[1]}</div>
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

    const markets = [
        { name: 'Over 0.5 Total', prob: p05, color: 'var(--ok)' },
        { name: 'Over 1.5 Total', prob: p15, color: 'var(--warn)' },
        { name: 'Home Score', prob: Math.round((1-Math.exp(-data.xgh))*100), color: 'var(--accent)' }
    ];

    markets.forEach(m => {
        const card = document.createElement('div');
        card.className = 'book-item';
        card.innerHTML = `
            <div class="stat-label">${m.name}</div>
            <div class="stat-home" style="color:${m.color}">${m.prob}%</div>
        `;
        grid.appendChild(card);
    });
}

function calcMomentum(data) {
    const threatH = Math.max(0, data.xgh - data.gh);
    const threatA = Math.max(0, data.xga - data.ga);
    const total = Math.max(threatH + threatA, 0.1);

    const mHome = Math.round((threatH / total) * 100);
    const mAway = 100 - mHome;

    byId('mHome').style.width = `${mHome}%`;
    byId('mAway').style.width = `${mAway}%`;
    byId('mHomeTxt').textContent = `${mHome}%`;
    byId('mAwayTxt').textContent = `${mAway}%`;
}

function updateExchangeCalc() {
    const b1 = valNum('b1'), lx = valNum('lx'), stake = valNum('stake');
    const backProfit = (stake * (b1 - 1) * 0.95).toFixed(2);
    const layStake = ((stake * b1) / lx).toFixed(2);
    const layLiability = (layStake * (lx - 1)).toFixed(2);
    
    byId('calcBackProfit').textContent = `€${backProfit}`;
    byId('calcLayLiability').textContent = `€${layLiability}`;
    byId('calcLayStake').textContent = `€${layStake}`;

    // STRATEGY TRIGGERS (Restored yesterday)
    const badge = byId('exSignalBadge');
    const reason = byId('exSignalReason');
    
    if (lastData && lastData.minute > 0) {
        if (lastData.minute < 30 && lastData.gh === 0 && lastData.ga === 0 && lastData.xgh > 0.4) {
            badge.textContent = 'PT EXPLOSION';
            badge.style.borderColor = 'var(--ok)';
            badge.style.color = 'var(--ok)';
            reason.textContent = 'Elevato xG iniziale. Possibile Over 0.5 HT.';
        } else {
            badge.textContent = 'MONITOR';
            badge.style.borderColor = 'var(--muted)';
            badge.style.color = 'var(--muted)';
            reason.textContent = 'In attesa di parametri ottimali per LTD o PT.';
        }
    }
}

// ─── CORE ─────────────────────────────────────────────────────────────

window.runAnalysis = function() {
    const raw = byId('scanner').value.trim();
    if (!raw) return;
    try {
        const data = parseRawMatchText(raw);
        if (!data.home) return;
        lastData = data;
        calcMomentum(data);
        updateStatsUI(data);
        updateBookUI(data);
        updateExchangeCalc();
        byId('signal').textContent = `Match Analizzato: ${data.home} ${data.gh}-${data.ga} (${data.minute}')`;
        byId('signal').classList.remove('signal-empty');
    } catch (e) { console.error('Error', e); }
}

window.switchTab = function(tab) {
    document.querySelectorAll('main').forEach(m => m.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`).style.display = 'grid';
    byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
    byId('scanner').addEventListener('input', () => {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(window.runAnalysis, 1000);
    });
    ['b1', 'lx', 'stake'].forEach(id => byId(id).addEventListener('input', updateExchangeCalc));
});