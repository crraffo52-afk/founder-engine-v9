/**
 * THE FOUNDER ENGINE - MASTER OF THE PITCH EDITION (V9.0)
 * Original stable logic restored with Unicode Clean formatting.
 */

const byId = (id) => document.getElementById(id);
const valNum = (id) => {
  const v = byId(id)?.value?.replace(',', '.') || '0';
  const num = parseFloat(v);
  return isNaN(num) ? 0 : num;
};

let lastData = null;

// ─── UTILS ───────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('main').forEach(m => m.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  
  const content = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`);
  const btn = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
  
  if (content) content.style.display = 'grid';
  if (btn) btn.classList.add('active');
}

// ─── POWER-PARSER V9.0 ───────────────────────────────────────

function parseRawMatchText(raw) {
    if (!raw) return {};
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const text = lines.join(' ');
    const result = { stats: {}, gh: 0, ga: 0, minute: 0 };

    // Teams
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

    // Minute
    const minMatch = text.match(/\b(\d{1,3})['′]/);
    if (minMatch) {
      result.minute = parseInt(minMatch[1]);
    } else if (text.includes('FT')) {
      result.minute = 90;
    }

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

// ─── UI ──────────────────────────────────────────────────────

function runAnalysis() {
  const raw = byId('scanner').value.trim();
  if (!raw) return;
  try {
    const data = parseRawMatchText(raw);
    if (!data.home) return;
    lastData = data;
    
    // Update Momentum
    const threatH = Math.max(0, (data.xgh||0) - (data.gh||0));
    const threatA = Math.max(0, (data.xga||0) - (data.ga||0));
    const total = Math.max(threatH + threatA, 0.1);
    const mHome = Math.round((threatH / total) * 100);
    const mAway = 100 - mHome;
    
    byId('mHome').style.width = `${mHome}%`;
    byId('mAway').style.width = `${mAway}%`;
    byId('mHomeTxt').textContent = `${mHome}%`;
    byId('mAwayTxt').textContent = `${mAway}%`;
    byId('homeNameTxt').textContent = data.home.toUpperCase();
    byId('awayNameTxt').textContent = data.away.toUpperCase();

    // Populate Stats
    const display = byId('parsedDisplay');
    display.innerHTML = `
      <div class="stat-row"><div class="stat-label">Minuto</div><div class="stat-home">${data.minute}'</div></div>
      <div class="stat-row"><div class="stat-label">Tiri Porta</div><div class="stat-home">${data.stats.sot?.[0]||0}</div><div class="stat-val">VS</div><div class="stat-away">${data.stats.sot?.[1]||0}</div></div>
      <div class="stat-row"><div class="stat-label">xG</div><div class="stat-home">${(data.xgh||0).toFixed(2)}</div><div class="stat-val">VS</div><div class="stat-away">${(data.xga||0).toFixed(2)}</div></div>
    `;

    updateExchange();
    byId('signalBadge').textContent = 'Analisi completata';
    byId('signalReason').textContent = `Match: ${data.home} vs ${data.away} analizzato con successo.`;
  } catch (e) {
    console.error(e);
  }
}

function updateExchange() {
  const b1 = valNum('b1'), lx = valNum('lx'), stake = valNum('stake');
  const backProfit = (stake * (b1 - 1) * 0.95);
  const layStake = ((stake * b1) / lx);
  const layLiability = (layStake * (lx - 1));

  byId('calcBackProfit').textContent = `EUR ${backProfit.toFixed(2)}`;
  byId('calcLayLiability').textContent = `EUR ${layLiability.toFixed(2)}`;
  byId('calcLayStake').textContent = `EUR ${layStake.toFixed(2)}`;
  byId('calcBreakEven').textContent = (lx / b1).toFixed(2);
  
  // Strategy
  const badge = byId('exSignalBadge');
  if (lastData && lastData.xgh > 1.5) {
      badge.textContent = 'PT EXPLOSION';
      badge.style.color = '#00e5a0';
  } else {
      badge.textContent = 'MONITOR';
      badge.style.color = '#94a3b8';
  }
}

window.runAnalysis = runAnalysis;
window.switchTab = switchTab;

document.addEventListener('DOMContentLoaded', () => {
  ['b1', 'lx', 'stake', 'bank'].forEach(id => {
    byId(id)?.addEventListener('input', updateExchange);
  });
});
