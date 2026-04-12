/**
 * THE FOUNDER ENGINE V9.6.5 - ULTIMATE DYNAMIC HUB
 * Strategy Layer + Multi-Parse Pro + Total Stability
 */

const byId = (id) => document.getElementById(id);
const valNum = (id) => {
    const v = byId(id)?.value?.replace(',', '.') || '0';
    return parseFloat(v) || 0;
};

let lastData = null;
let autoTimer = null;

// ─── POWER-PARSER 9.6.5 (UNBREAKABLE) ────────────────────────────────────────

function parseRawMatchText(raw) {
    if (!raw) return {};
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const text = lines.join(' ');
    const result = { stats: {}, proxyXG: false, gh:0, ga:0, minute:0 };

    // Squadre
    const teamsMatch = text.match(/([A-Za-zÀ-ÿ' .()-]+)\s+vs\s+([A-Za-zÀ-ÿ' .()-]+)/i);
    if (teamsMatch) {
       result.home = teamsMatch[1].trim();
       result.away = teamsMatch[2].trim();
    }

    // Score Inline (es. 2:0)
    const scoreMatches = Array.from(text.matchAll(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/g));
    for (const m of scoreMatches) {
        const s1 = parseInt(m[1]), s2 = parseInt(m[2]);
        if (s1 <= 20 && s2 <= 20) {
            result.gh = s1; result.ga = s2;
            break;
        }
    }

    // Minuto
    const minAlt = text.match(/\b(\d{1,3})['′]/);
    if (minAlt) result.minute = parseInt(minAlt[1]);
    else if (text.includes('FT')) result.minute = 90;

    // Multiline Stats & Score
    const statDef = [
        { key: 'Goal', id: 'score' },
        { key: 'XG', id: 'xg' },
        { key: 'Tiri in Porta', id: 'sot' },
        { key: 'Attacchi Pericolosi', id: 'da' },
        { key: 'Possesso Palla', id: 'pos' },
        { key: 'Calci d\'Angolo', id: 'cor' }
    ];

    lines.forEach((line, i) => {
        statDef.forEach(def => {
            const isMatch = line.toLowerCase() === def.key.toLowerCase() || 
                           (def.key.length > 3 && line.includes(def.key));
            if (isMatch) {
                const valH = parseFloat(lines[i+1]?.replace(',', '.').replace('%', ''));
                const valA = parseFloat(lines[i+2]?.replace(',', '.').replace('%', ''));
                if (!isNaN(valH) && !isNaN(valA)) {
                    if (def.id === 'xg') { result.xgh = valH; result.xga = valA; }
                    else if (def.id === 'score') { result.gh = valH; result.ga = valA; }
                    else { result.stats[def.id] = [valH, valA]; }
                }
            }
        });
    });

    // Fallback xG Calculation
    if (result.xgh === undefined) {
        const s = result.stats;
        const g = (k, i) => (s[k] ? s[k][i] : 0);
        result.xgh = (g('sot',0)*0.18) + (g('da',0)*0.02) + (g('cor',0)*0.05);
        result.xga = (g('sot',1)*0.18) + (g('da',1)*0.02) + (g('cor',1)*0.05);
        result.proxyXG = true;
    }

    return result;
}

// ─── UI RENDERING ─────────────────────────────────────────────────────────────

function updateStatsUI(data) {
    const grid = byId('parsedDisplay');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (byId('matchTitle')) byId('matchTitle').textContent = `— ${data.home || 'Match'} ${data.gh}-${data.ga} (${data.minute}')`;

    const items = [
        { label: 'Tiri in Porta', home: (data.stats.sot?.[0]||0), away: (data.stats.sot?.[1]||0) },
        { label: 'Attacchi Peric.', home: (data.stats.da?.[0]||0), away: (data.stats.da?.[1]||0) },
        { label: 'xG (Expected Goals)', home: (data.xgh||0).toFixed(2), away: (data.xga||0).toFixed(2) },
        { label: 'Possesso Palla', home: (data.stats.pos?.[0]||0)+'%', away: (data.stats.pos?.[1]||0)+'%' }
    ];

    grid.innerHTML = items.map(item => `
        <div class="stat-row">
            <div class="stat-label">${item.label}</div>
            <div class="stat-home">${item.home}</div>
            <div class="stat-val">VS</div>
            <div class="stat-away">${item.away}</div>
        </div>
    `).join('');
}

function updateBookUI(data) {
    const grid = byId('bookGrid');
    if (!grid) return;

    const tx = (data.xgh + data.xga) || 0.01;
    const p05 = Math.round((1 - Math.exp(-tx)) * 100);
    const p15 = Math.round((1 - Math.exp(-tx) * (1 + tx)) * 100);
    const p25 = Math.round((1 - Math.exp(-tx) * (1 + tx + (tx**2/2))) * 100);
    const pGoal = Math.round(((1 - Math.exp(-Math.max(data.xgh, 0.1))) * (1 - Math.exp(-Math.max(data.xga, 0.1)))) * 100);
    const pCleanH = Math.round(Math.exp(-data.xga) * 100);

    const markets = [
        { name: 'Over 0.5 Total', prob: p05, col: 'var(--ok)' },
        { name: 'Over 1.5 Total', prob: p15, col: 'var(--warn)' },
        { name: 'Over 2.5 Total', prob: p25, col: 'var(--danger)' },
        { name: 'BTTS (Goal)', prob: pGoal, col: 'var(--accent)' },
        { name: 'Clean Sheet Home', prob: pCleanH, col: 'var(--ok)' },
        { name: 'Score Progress', prob: Math.round((1 - Math.exp(-data.xgh)) * 100), col: 'var(--accent)' }
    ];

    grid.innerHTML = markets.map(m => `
        <div class="book-item">
            <div class="stat-label">${m.name}</div>
            <div class="stat-home" style="color:${m.col}; font-size:24px;">${m.prob}%</div>
        </div>
    `).join('');
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

// ─── DYNAMIC STRATEGY ENGINE ──────────────────────────────────────────────────

function calculateDynamicStrategy(data) {
    const badge = byId('exSignalBadge');
    const reason = byId('exSignalReason');
    if (!badge || !reason) return;

    const min = data.minute;
    const xgH = data.xgh || 0;
    const xgA = data.xga || 0;
    const score = `${data.gh}-${data.ga}`;

    // Reset
    badge.textContent = 'MONITOR';
    badge.className = 'ex-signal-badge';
    badge.style.borderColor = 'var(--muted)';
    badge.style.color = 'var(--muted)';
    reason.textContent = 'In attesa di parametri ottimali...';

    // 1. FT VERDICT
    if (min >= 90) {
        badge.textContent = 'MATCH ENDED';
        badge.style.borderColor = 'var(--accent)';
        badge.style.color = '#fff';
        const winner = data.gh > data.ga ? data.home : (data.ga > data.gh ? data.away : 'Pareggio');
        reason.textContent = `Match terminato ${score}. Analisi xG: ${(xgH+xgA).toFixed(2)}. ${winner} ha confermato il trend.`;
        return;
    }

    // 2. PT EXPLOSION (0-30')
    if (min < 30 && score === '0-0' && xgH > 0.45) {
        badge.textContent = 'PT EXPLOSION';
        badge.style.borderColor = 'var(--ok)';
        badge.style.color = 'var(--ok)';
        reason.textContent = `Pressione alta Casa (${xgH.toFixed(2)}). Segnale per Over 0.5 HT o Punta Casa.`;
        return;
    }

    // 3. LAY THE DRAW (45-70')
    if (min >= 45 && min <= 75 && data.gh === data.ga) {
        if (xgH > xgA + 0.6 || xgA > xgH + 0.6) {
            badge.textContent = 'LAY THE DRAW';
            badge.style.borderColor = 'var(--warn)';
            badge.style.color = 'var(--warn)';
            reason.textContent = `Match in stallo xG sbilanciato. Ottimo momento per LTD fino al 75'.`;
            return;
        }
    }

    // 4. HT GOAL HUNT (30-45')
    if (min >= 30 && min < 45 && score === '0-0' && (xgH+xgA) > 0.8) {
        badge.textContent = 'HT GOAL HUNT';
        badge.style.borderColor = 'var(--accent)';
        badge.style.color = 'var(--accent)';
        reason.textContent = `Pressione totale prima del riposo. Valuta Over 0.5 HT @ quota > 1.90.`;
        return;
    }

    // 5. LATE GOAL (75'+)
    if (min >= 75 && (xgH > data.gh + 0.4 || xgA > data.ga + 0.4)) {
        badge.textContent = 'LATE GOAL';
        badge.style.borderColor = 'var(--danger)';
        badge.style.color = 'var(--danger)';
        reason.textContent = `Assalto finale in corso. Diffusione tiri alta. Segnale per Over 0.5 aggiuntivo.`;
        return;
    }

    if ((xgH + xgA) > 0.1) {
        reason.textContent = `Match attivo (xG: ${(xgH+xgA).toFixed(2)}). Nessun segnale forte al momento.`;
    }
}

// ─── EXCHANGE CALCULATOR ──────────────────────────────────────────────────────

window.updateExchangeCalc = function() {
    const b1 = valNum('b1'), lx = valNum('lx'), stake = valNum('stake');
    const backProfit = (stake * (b1 - 1) * 0.95).toFixed(2);
    const layStake = ((stake * b1) / lx).toFixed(2);
    const layLiability = (layStake * (lx - 1)).toFixed(2);
    
    byId('calcBackProfit').textContent = `€${backProfit}`;
    byId('calcLayLiability').textContent = `€${layLiability}`;
    byId('calcLayStake').textContent = `€${layStake}`;

    if (lastData) calculateDynamicStrategy(lastData);
};

// ─── CORE HUB ─────────────────────────────────────────────────────────────────

window.runAnalysis = function() {
    console.log('Founder Engine: Running Analysis...');
    const raw = byId('scanner').value.trim();
    if (!raw) return;

    try {
        const data = parseRawMatchText(raw);
        if (!data.home && !data.xgh) {
            console.warn('Parser: No valid data found.');
            return;
        }
        
        lastData = data;
        calcMomentum(data);
        updateStatsUI(data);
        updateBookUI(data);
        window.updateExchangeCalc();
        
        byId('signal').textContent = `Match Analizzato con Successo: ${data.home||'Team'} ${data.gh}-${data.ga} (${data.minute}')`;
        byId('signal').classList.remove('signal-empty');
        
    } catch (e) {
        console.error('Analysis Failed', e);
    }
};

window.switchTab = function(tab) {
    document.querySelectorAll('main').forEach(m => m.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`).style.display = 'grid';
    byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('Founder Engine V9.6.5 Online');
    byId('scanner').addEventListener('input', () => {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(window.runAnalysis, 1200);
    });
});