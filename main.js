/**
 * THE FOUNDER ENGINE V9.2 - OMNI-DYNAMIC HUB
 * Full Recovery Build - 2026-04-12
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

// ─── TRACKER & TABS ───────────────────────────────────────────────────────────

window.switchTab = function(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    
    const target = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`);
    if (target) target.style.display = 'grid';
    
    const btn = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    if (btn) btn.classList.add('active');

    if (tab === 'global') fetchGlobalScanner();
};

window.fetchGlobalScanner = async function() {
    const table = byId('globalScannerTable');
    if (!table) return;
    table.innerHTML = `<tr><td colspan="8" style="padding:20px; text-align:center;">📡 Radar OMNI-RECOVERY in funzione...</td></tr>`;
    try {
        const res = await fetch('/api/scanner-live');
        const data = await res.json();
        if (data.length === 0) {
            table.innerHTML = `<tr><td colspan="8" style="padding:20px; text-align:center; color:var(--muted)">Nessun match live rilevato nel Radar.</td></tr>`;
            return;
        }
        table.innerHTML = data.map(p => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding:10px; color:var(--accent); font-weight:bold;">${p.minute}'</td>
                <td style="padding:10px; font-size:12px;"><strong>${p.home} vs ${p.away}</strong><br><small>${p.league}</small></td>
                <td style="padding:10px; text-align:center;"><b>${p.gh} - ${p.ga}</b></td>
                <td style="padding:10px; color:var(--muted);">${p.xgh.toFixed(2)} - ${p.xga.toFixed(2)}</td>
                <td style="padding:10px; color:var(--ok); font-weight:bold;">${((p.stats.da[0]+p.stats.da[1])/p.minute).toFixed(2)}</td>
                <td style="padding:10px; color:var(--muted);">${p.stats.sot[0]}-${p.stats.sot[1]}</td>
                <td style="padding:10px; text-align:center;"><button onclick="document.getElementById('scanner').value='${p.home} vs ${p.away} ${p.gh}:${p.ga} ${p.minute}:00 Stats live XG ${p.xgh}-${p.xga} Dangerous Attacks ${p.stats.da[0]}-${p.stats.da[1]}'; switchTab('live'); runAnalysis();" style="padding:4px 8px; font-size:10px; background:var(--bg-lighter); color:var(--accent); border:1px solid var(--accent); border-radius:4px; cursor:pointer;">ANALIZZA</button></td>
            </tr>
        `).join('');
        byId('globalScannerCount').textContent = `(${data.length} MATCH ATTIVI)`;
    } catch (e) {
        table.innerHTML = `<tr><td colspan="8" style="padding:20px; text-align:center; color:var(--danger)">Errore Radar: ${e.message}</td></tr>`;
    }
};

function init() {
    byId('importBtn')?.addEventListener('click', runAnalysis);
    byId('scanner')?.addEventListener('input', () => {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(runAnalysis, 1000);
    });
    ['b1', 'lx', 'stake', 'prevLoss', 'entryType'].forEach(id => {
        byId(id)?.addEventListener('input', updateExchangeCalc);
    });
    // Inizializza al tab live
    window.switchTab('live');
}

document.addEventListener('DOMContentLoaded', init);
init();