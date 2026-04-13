/**
 * THE FOUNDER ENGINE - V9.6.1 ELITE MASTER FIX
 * Final alignment of IDs and Parser for Absolute Functionality
 */

const byId = (id) => document.getElementById(id);
const valNum = (id) => {
  const v = byId(id)?.value?.replace(',', '.') || '0';
  const num = parseFloat(v);
  return isNaN(num) ? 0 : num;
};

let lastData = null;

// ─── MATH ENGINE ───────────────────────────────────────────

function factorial(n) {
  if (n === 0 || n === 1) return 1;
  let res = 1; for (let i = 2; i <= n; i++) res *= i;
  return res;
}

function poisson(lambda, k) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function getProbRange(lambda, start, end) {
  let p = 0; for (let i = start; i <= end; i++) p += poisson(lambda, i);
  return p;
}

// ─── OMNI-PARSER 2.0 ───────────────────────────────────────

function parseRawMatchText(raw) {
    if (!raw) return {};
    const text = raw.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
    const result = { stats: {}, gh: 0, ga: 0, minute: 0, xgh: 0, xga: 0, home: 'HOME', away: 'AWAY' };

    // 1. Teams
    const teamsMatch = text.match(/([A-ZÀ-Ÿ][a-zà-ÿ' .()-]+)\s+vs\s+([A-ZÀ-Ÿ][a-zà-ÿ' .()-]+)/i);
    if (teamsMatch) {
       result.home = teamsMatch[1].trim();
       result.away = teamsMatch[2].trim();
    }

    // 2. Score
    const scoreMatch = text.match(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/);
    if (scoreMatch) {
        result.gh = parseInt(scoreMatch[1]);
        result.ga = parseInt(scoreMatch[2]);
    }

    // 3. Minute
    const clockMatch = text.match(/\b(\d{1,2}):(\d{2})\b/);
    if (clockMatch) {
        result.minute = parseInt(clockMatch[1]);
    } else {
        const minMatch = text.match(/(?<!\()\b(\d{1,2})['′]/); 
        if (minMatch) result.minute = parseInt(minMatch[1]);
        else if (text.toLowerCase().includes('ft')) result.minute = 90;
    }

    // 4. Stats Precision
    const xgM = text.match(/xG\s*(\d+[.,]\d+)\s*(?:vs|-|\s+)?\s*(\d+[.,]\d+)/i);
    if (xgM) { result.xgh = parseFloat(xgM[1].replace(',', '.')); result.xga = parseFloat(xgM[2].replace(',', '.')); }

    const sotM = text.match(/(?:Tiri in Porta|Shots on goal|sot)\s*(\d+)\s*(?:vs|-|\s+)?\s*(\d+)/i);
    if (sotM) result.stats.sot = [parseInt(sotM[1]), parseInt(sotM[2])];

    const daM = text.match(/(?:Attacchi Pericolosi|Dangerous attacks|da)\s*(\d+)\s*(?:vs|-|\s+)?\s*(\d+)/i);
    if (daM) result.stats.da = [parseInt(daM[1]), parseInt(daM[2])];

    return result;
}

// ─── DYNAMIC BOOK (POISSON) ───────────────────────────────

function updateDynamicBook(data) {
    const grid = byId('bookGrid');
    if (!grid) return;

    const min = data.minute || 0;
    const timeLeft = Math.max(0, 95 - min) / 95;
    const lambdaH = (parseFloat(data.xgh) || 0.1) * (1 + timeLeft);
    const lambdaA = (parseFloat(data.xga) || 0.1) * (1 + timeLeft);

    const pH = (getProbRange(lambdaH, 1, 6) * getProbRange(lambdaA, 0, 0) * 110).toFixed(1);
    const pX = (getProbRange(lambdaH, 0, 2) * getProbRange(lambdaA, 0, 2) * 38).toFixed(1);
    const pA = (getProbRange(lambdaA, 1, 6) * getProbRange(lambdaH, 0, 0) * 110).toFixed(1);
    const pO25 = ((1 - (poisson(lambdaH+lambdaA, 0) + poisson(lambdaH+lambdaA, 1) + poisson(lambdaH+lambdaA, 2))) * 100).toFixed(1);

    grid.innerHTML = `
      <div class="pm-stat-card pm-market-top">
        <div class="pm-stat-name">ANALISI DINAMICA BOOK (V9.6)</div>
        <div class="pm-stat-row"><span>Prematch/Live Win Casa</span><strong>${Math.min(99.1, pH)}%</strong></div>
        <div class="pm-stat-row"><span>Probabilit Pareggio</span><strong>${Math.min(99.1, pX)}%</strong></div>
        <div class="pm-stat-row"><span>Prematch/Live Win Ospite</span><strong>${Math.min(99.1, pA)}%</strong></div>
      </div>
      <div class="pm-stat-card">
        <div class="pm-stat-name">MERCATI UNDER/OVER</div>
        <div class="pm-stat-row"><span>Prob. Over 2.5</span><strong>${Math.min(99.1, pO25)}%</strong></div>
        <div class="pm-stat-row"><span>Clean Sheet Casa</span><strong>${(poisson(lambdaA, 0)*100).toFixed(1)}%</strong></div>
      </div>
    `;
}

// ─── DYNAMIC EXCHANGE ──────────────────────────────────────

function updateDynamicExchange() {
  if (!lastData) return;
  const b1 = valNum('b1'), lx = valNum('lx'), stake = valNum('stake');
  const backProfit = (stake * (b1 - 1) * 0.95);
  const layPrice = lx > 1 ? lx : (b1 * 1.15);
  const layStake = (stake * b1) / layPrice;
  const layLiability = layStake * (layPrice - 1);

  byId('calcBackProfit').textContent = `EUR ${backProfit.toFixed(2)}`;
  byId('calcLayLiability').textContent = `EUR ${layLiability.toFixed(2)}`;
  byId('calcLayStake').textContent = `EUR ${layStake.toFixed(2)}`;
  byId('calcBreakEven').textContent = (layPrice / b1).toFixed(2);

  const badge = byId('exSignalBadge');
  const reason = byId('exSignalReason');
  const xgH = lastData.xgh, xgA = lastData.xga, gh = lastData.gh, ga = lastData.ga, min = lastData.minute;

  let sig = "MONITOR", color = "#94a3b8", desc = "Attendo evoluzione xG...";

  if (min < 30 && xgH > 0.4 && gh === 0) {
      sig = "PT EXPLOSION"; color = "#00e5a0"; desc = "Pressione iniziale intensa. Target Over 0.5 HT pronto.";
  } else if (min >= 45 && gh === ga && (xgH - xgA) > 0.7) {
      sig = "LAY THE DRAW"; color = "#facc15"; desc = "Pareggio instabile. LTD Pro consigliato.";
  } else if (min >= 60 && gh > ga && (xgH - xgA) > 0.6) {
      sig = "LEAD PROTECTION"; color = "#38bdf8"; desc = "Vantaggio meritato supportato dagli xG.";
  } else if (min >= 75 && (xgH + xgA) > (gh + ga + 0.5)) {
      sig = "LATE GOAL"; color = "#fb7185"; desc = "Volume finale elevato. Possibile altro goal.";
  }

  badge.textContent = sig;
  badge.style.borderColor = color; badge.style.color = color; badge.style.background = `${color}11`;
  reason.textContent = desc;

  byId('calcGreenTarget').textContent = `EUR ${(backProfit * 0.35).toFixed(2)}`;
  byId('calcStopLoss').textContent = `EUR ${(layLiability * 0.20).toFixed(2)}`;
  byId('calcROI').textContent = `${((backProfit / stake)*100).toFixed(1)}%`;
  byId('calcEV').textContent = `EUR ${(backProfit * 0.6 - layLiability * 0.4).toFixed(2)}`;
}

// ─── MASTER CONTROLLER ─────────────────────────────────────

window.runAnalysis = function() {
  const raw = byId('scanner').value.trim();
  if (!raw) return;
  try {
    const data = parseRawMatchText(raw);
    lastData = data;

    // Momentum (Fixed formula)
    const tH = (data.xgh * 15) + (data.stats.sot?.[0]||0) * 10 + (data.stats.da?.[0]||0) * 0.1 + 1;
    const tA = (data.xga * 15) + (data.stats.sot?.[1]||0) * 10 + (data.stats.da?.[1]||0) * 0.1 + 1;
    const p1 = Math.round((tH / (tH + tA)) * 100);
    
    byId('mHome').style.width = `${p1}%`;
    byId('mAway').style.width = `${100-p1}%`;
    byId('mHomeTxt').textContent = `${p1}%`;
    byId('mAwayTxt').textContent = `${100-p1}%`;
    byId('homeNameTxt').textContent = (data.home || "CASA").toUpperCase();
    byId('awayNameTxt').textContent = (data.away || "OSPITE").toUpperCase();

    // Population
    byId('parsedDisplay').innerHTML = `
      <div class="stat-row"><div class="stat-label">Minuto</div><div class="stat-home">${data.minute}'</div></div>
      <div class="stat-row"><div class="stat-label">Risultato</div><div class="stat-home">${data.gh} - ${data.ga}</div></div>
      <div class="stat-row"><div class="stat-label">xG Totali</div><div class="stat-home">${(data.xgh||0).toFixed(2)}</div><div class="stat-val">VS</div><div class="stat-away">${(data.xga||0).toFixed(2)}</div></div>
    `;

    updateDynamicBook(data);
    updateDynamicExchange();
    
    byId('modeChip').textContent = "HUB ELITE ATTIVO";
    byId('modeChip').className = "status-val ok";
  } catch (e) {
    console.error("Critical Engine Error:", e);
  }
};

window.switchTab = function(tab) {
  document.querySelectorAll('main').forEach(m => m.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const c = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}Content`);
  const btn = byId(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
  if (c) c.style.display = 'grid';
  if (btn) btn.classList.add('active');
};

document.addEventListener('DOMContentLoaded', () => {
    ['b1', 'lx', 'stake'].forEach(id => {
        byId(id)?.addEventListener('input', updateDynamicExchange);
    });
});
