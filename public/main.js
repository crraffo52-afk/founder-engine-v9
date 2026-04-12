/**
 * THE FOUNDER ENGINE V9.0 - Master of the Pitch Edition
 * Full Suite: Live + Pre-Match + Exchange + Tracker
 */

const byId = (id) => document.getElementById(id);
const valNum = (id) => {
    const v = byId(id)?.value?.replace(',', '.') || '0';
    const num = parseFloat(v);
    return isNaN(num) ? 0 : num;
};

let lastData = null;

// ─── POWER-PARSER V9.0 ────────────────────────────────────────────────────────

function parseRawMatchText(raw) {
    if (!raw) return {};
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const text = lines.join(' ');
    const result = { stats: {}, gh: 0, ga: 0, minute: 0 };

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
        if (s1 <= 20 && s2 <= 20) {
            result.gh = s1; result.ga = s2;
            break;
        }
    }

    // Minuto
    const minAlt = text.match(/\b(\d{1,3})['′]/);
    if (minAlt) result.minute = parseInt(minAlt[1]);
    else if (text.includes('FT')) result.minute = 90;

    // Stats Grid
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
            if (line.toLowerCase() === def.key.toLowerCase() || (def.key.length > 3 && line.includes(def.key))) {
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

    return result;
}

// ─── UI UPDATES ─────────────────────────────────────────────────────────────

function updateStatsUI(data) {
    const grid = byId('parsedDisplay');
    if (!grid) return;
    grid.innerHTML = itemsToHtml(data);
}

function itemsToHtml(data) {
    const items = [
        { label: 'Tiri in Porta', home: (data.stats.sot?.[0]||0), away: (data.stats.sot?.[1]||0) },
        { label: 'Attacchi Peric.', home: (data.stats.da?.[0]||0), away: (data.stats.da?.[1]||0) },
        { label: 'xG (Expected)', home: (data.xgh||0).toFixed(2), away: (data.xga||0).toFixed(2) }
    ];
    return items.map(t => `
        <div class="stat-row">
            <div class="stat-label">${t.label}</div>
            <div class="stat-home">${t.home}</div>
            <div class="stat-val">VS</div>
            <div class="stat-away">${t.away}</div>
        </div>
    `).join('');
}

function calcMomentum(data) {
    const threatH = Math.max(0, (data.xgh || 0) - (data.gh || 0));
    const threatA = Math.max(0, (data.xga || 0) - (data.ga || 0));
    const total = Math.max(threatH + threatA, 0.1);

    const mHome = Math.round((threatH / total) * 100);
    const mAway = 100 - mHome;

    byId('mHome').style.width = `${mHome}%`;
    byId('mAway').style.width = `${mAway}%`;
    byId('mHomeTxt').textContent = `${mHome}%`;
    byId('mAwayTxt').textContent = `${mAway}%`;
}

// ─── EXCHANGE PRO CALCULATIONS ────────────────────────────────────────────────

function updateExchangeCalc() {
    const b1 = valNum('b1'), lx = valNum('lx'), stake = valNum('stake');
    
    // Basic
    const backProfit = (stake * (b1 - 1) * 0.95);
    const layStake = ((stake * b1) / lx);
    const layLiability = (layStake * (lx - 1));
    const breakEven = (stake * (b1 - 1) / (stake)).toFixed(2);

    byId('calcBackProfit').textContent = `€${backProfit.toFixed(2)}`;
    byId('calcLayLiability').textContent = `€${layLiability.toFixed(2)}`;
    byId('calcLayStake').textContent = `€${layStake.toFixed(2)}`;
    byId('calcBreakEven').textContent = (lx / b1).toFixed(2);

    // Green-up Studio
    const targetGreen = (backProfit * 0.35).toFixed(2);
    const stopLoss = (layLiability * 0.20).toFixed(2);
    const roi = ((backProfit / stake) * 100).toFixed(2);
    const ev = (backProfit * 0.6 - layLiability * 0.4).toFixed(2);

    byId('calcGreenTarget').textContent = `€${targetGreen}`;
    byId('calcStopLoss').textContent = `-€${stopLoss}`;
    byId('calcROI').textContent = `${roi}%`;
    byId('calcEV').textContent = `€${ev}`;

    updateStrategySignal();
}

function updateStrategySignal() {
    const badge = byId('exSignalBadge');
    const reason = byId('exSignalReason');
    if (!badge || !reason || !lastData) return;

    const min = lastData.minute;
    const score = `${lastData.gh}-${lastData.ga}`;

    if (min < 30 && score === '0-0' && lastData.xgh > 0.45) {
        badge.textContent = 'PT EXPLOSION';
        badge.className = 'ex-signal-badge ok';
        reason.textContent = 'Pressione iniziale altissima (Casa). Possibile Over 0.5 HT.';
    } else if (min >= 45 && min <= 75 && lastData.gh === lastData.ga && (lastData.xgh > lastData.xga + 0.6)) {
        badge.textContent = 'LAY THE DRAW';
        badge.className = 'ex-signal-badge warn';
        reason.textContent = 'Match in stallo xG sbilanciato. Ottimo momento per LTD.';
    } else {
        badge.textContent = 'MONITOR';
        badge.className = 'ex-signal-badge';
        reason.textContent = 'Parametri in osservazione. In attesa di trigger V9.0.';
    }
}

// ─── HUB COMMANDS ─────────────────────────────────────────────────────────────

window.runAnalysis = function() {
    const raw = byId('scanner').value.trim();
    if (!raw) return;
    try {
        const data = parseRawMatchText(raw);
        if (!data.home) return;
        lastData = data;
        calcMomentum(data);
        updateStatsUI(data);
        updateExchangeCalc();
        byId('signal').textContent = `Match Analizzato: ${data.home} ${data.gh}-${data.ga} (${data.minute}')`;
    } catch (e) { console.error('V9.0 Error', e); }
};

window.switchTab = function(tab) {
    document.querySelectorAll('main').forEach(m => m.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    if (tab === 'live') {
        byId('tabLiveContent').style.display = 'grid';
        byId('tabLive').classList.add('active');
    } else if (tab === 'pre') {
        byId('tabPreContent').style.display = 'grid';
        byId('tabPre').classList.add('active');
    } else {
        byId('tabTrackerContent').style.display = 'grid';
        byId('tabTracker').classList.add('active');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('Founder Engine V9.0 Master Online');
    ['b1', 'lx', 'stake', 'bank'].forEach(id => {
        byId(id)?.addEventListener('input', updateExchangeCalc);
    });
    byId('scanner').addEventListener('input', () => {
        clearTimeout(window.autoT);
        window.autoT = setTimeout(window.runAnalysis, 1200);
    });
});
