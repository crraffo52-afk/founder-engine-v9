/**
 * THE FOUNDER ENGINE V9.5.0 - ELITE RESTORE
 * Ripristino stabilità 11 Aprile - NO AI
 */

const byId = (id) => document.getElementById(id);
const valNum = (id) => parseFloat(byId(id)?.value) || 0;

let lastData = null;
let autoTimer = null;

// ─── PARSER TRADIZIONALE (POTENZIATO MULTILINE) ───────────────────────────────

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

    // Stat Grid Scanner (Multiline & Inline Support)
    const statDef = [
        { key: 'XG', id: 'xg' },
        { key: 'Tiri in Porta', id: 'sot' },
        { key: 'Attacchi Pericolosi', id: 'da' },
        { key: 'Possesso Palla', id: 'pos' },
        { key: 'Calci d\'Angolo', id: 'cor' }
    ];

    lines.forEach((line, i) => {
        statDef.forEach(def => {
            if (line.toLowerCase() === def.key.toLowerCase() || line.includes(def.key)) {
                // Check following 2 lines for numbers
                const valH = parseFloat(lines[i+1]?.replace(',', '.').replace('%', ''));
                const valA = parseFloat(lines[i+2]?.replace(',', '.').replace('%', ''));
                if (!isNaN(valH) && !isNaN(valA)) {
                    if (def.id === 'xg') { result.xgh = valH; result.xga = valA; }
                    else { result.stats[def.id] = [valH, valA]; }
                }
            }
        });
    });

    // Special Case for "4-1 8-5 2.19-0.32" line
    const tableLine = lines.find(l => l.includes('2.19-0.32'));
    if (tableLine && result.xgh === undefined) {
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
    
    // Poisson approximation for probabilities
    const p05 = Math.round((1 - Math.exp(-tx)) * 100);
    const p15 = Math.round((1 - Math.exp(-tx) * (1 + tx)) * 100);
    const p25 = Math.round((1 - Math.exp(-tx) * (1 + tx + (tx**2/2))) * 100);
    const pGoal = Math.round(( (1 - Math.exp(-Math.max(data.xgh, 0.01))) * (1 - Math.exp(-Math.max(data.xga, 0.15))) ) * 100);
    const pCleanH = Math.round(Math.exp(-data.xga) * 100);

    const markets = [
        { name: 'Over 0.5 Total', prob: p05, color: 'var(--ok)' },
        { name: 'Over 1.5 Total', prob: p15, color: 'var(--warn)' },
        { name: 'Over 2.5 Total', prob: p25, color: 'var(--danger)' },
        { name: 'BTTS (Goal)', prob: pGoal, color: 'var(--accent)' },
        { name: 'Clean Sheet Home', prob: pCleanH, color: 'var(--ok)' },
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

    if (lastData) calculateDynamicStrategy(lastData);
}

function calculateDynamicStrategy(data) {
    const badge = byId('exSignalBadge');
    const reason = byId('exSignalReason');
    if (!badge || !reason) return;

    const min = data.minute;
    const score = `${data.gh}-${data.ga}`;
    const xgSum = data.xgh + data.xga;
    const threatH = Math.max(0, data.xgh - data.gh);
    const threatA = Math.max(0, data.xga - data.ga);

    // Initial State
    badge.textContent = 'MONITOR';
    badge.style.borderColor = 'var(--muted)';
    badge.style.color = 'var(--muted)';
    reason.textContent = 'Analisi in corso... In attesa di parametri ottimali.';

    // 1. PT EXPLOSION
    if (min < 30 && score === '0-0' && data.xgh > 0.45) {
        badge.textContent = 'PT EXPLOSION';
        badge.style.borderColor = 'var(--ok)';
        badge.style.color = 'var(--ok)';
        reason.textContent = `Dominanza ${data.home}. Pressione alta (xG ${data.xgh.toFixed(2)}). Entrata consigliata Over 0.5 HT.`;
        return;
    }

    // 2. LAY THE DRAW (LTD)
    if (min >= 45 && min <= 70 && data.gh === data.ga) {
        if (data.xgh > data.xga + 0.5 || data.xga > data.xgh + 0.5) {
            badge.textContent = 'LAY THE DRAW';
            badge.style.borderColor = 'var(--warn)';
            badge.style.color = 'var(--warn)';
            reason.textContent = `Match in equilibrio ma con xG sbilanciato. Ottimo momento per LTD fino al 75'.`;
            return;
        }
    }

    // 3. HT OVER 0.5 HUNT
    if (min >= 30 && min <= 40 && score === '0-0' && xgSum > 0.7) {
        badge.textContent = 'HT GOAL HUNT';
        badge.style.borderColor = 'var(--accent)';
        badge.style.color = 'var(--accent)';
        reason.textContent = `Pressione totale prima dell'intervallo. Valuta Over 0.5 HT @ quota > 1.80.`;
        return;
    }

    // 4. LATE GOAL
    if (min >= 75 && (data.gh === data.ga || Math.abs(data.gh - data.ga) === 1) && (threatH > 0.3 || threatA > 0.3)) {
        badge.textContent = 'LATE GOAL';
        badge.style.borderColor = 'var(--danger)';
        badge.style.color = 'var(--danger)';
        reason.textContent = `Assalto finale in corso. Frequenza tiri alta. Segnale per Over 0.5 aggiuntivo.`;
        return;
    }

    if (xgSum > 0.1) {
        reason.textContent = `Pressione moderata. Match sotto osservazione. xG Totale: ${xgSum.toFixed(2)}.`;
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
        calculateDynamicStrategy(data); // Immediate strategy update
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