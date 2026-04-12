
// ─── GLOBAL SCANNER (INPLAYGURU CLONE) ─────────────────────────────────────────

window.fetchGlobalScanner = async function() {
  const table = byId('globalScannerTable');
  const countSpan = byId('globalScannerCount');
  if(!table) return;

  table.innerHTML = '<tr><td colspan="8" style="padding:20px; text-align:center;"><div class="spinner" style="margin:auto; border-color:var(--accent); border-right-color:transparent; width:24px; height:24px; border-style:solid; border-width:2px; border-radius:50%; animation:spin 1s linear infinite;"></div></td></tr>';

  try {
    const res = await fetch('/api/scanner-live');
    if (!res.ok) throw new Error('API request failed');
    const matches = await res.json();
    
    countSpan.textContent = `(${matches.length} Live)`;

    if (matches.length === 0) {
      table.innerHTML = '<tr><td colspan="8" style="padding:20px; text-align:center; color:var(--muted);">Nessuna partita in corso trovata.</td></tr>';
      return;
    }

    // Process each match using OMNI-ENGINE math
    const processed = matches.map(m => {
      const min = Math.max(m.minute || 1, 1);
      const totalXG = m.xgh + m.xga;
      const threatH = Math.max(0, m.xgh - m.gh);
      const threatA = Math.max(0, m.xga - m.ga);
      const dah = m.stats.da[0], daa = m.stats.da[1];
      const soth = m.stats.sot[0], sota = m.stats.sot[1];
      const posH = m.stats.pos[0];
      
      const timeDecay = Math.min(min / 90, 1) + 0.5;
      const homeScore = Math.max(0, (threatH * 35 * timeDecay) + (m.xgh * 10) + (posH * 0.3) + (soth * 6) + (dah * 1.8));
      const awayScore = Math.max(0, (threatA * 35 * timeDecay) + (m.xga * 10) + ((100 - posH) * 0.3) + (sota * 6) + (daa * 1.8));
      
      const totScore = Math.max(homeScore + awayScore, 1);
      const mHome = Math.round((homeScore / totScore) * 100);
      const mAway = 100 - mHome;
      
      const daTotal = dah + daa;
      const daPerMin = daTotal / min;
      
      let signal = 'WAIT';
      let signalColor = 'var(--muted)';
      const gap = Math.abs(mHome - mAway);
      const isSurge = gap > 40;
      
      // Auto-Detect Signal Without Odds
      if (isSurge && mHome > 70 && threatH > 0.4 && min > 45) { signal = 'BUY HOME (SURGE)'; signalColor = '#2dd4bf'; }
      else if (isSurge && mAway > 70 && threatA > 0.4 && min > 45) { signal = 'BUY AWAY (SURGE)'; signalColor = '#2dd4bf'; }
      else if (m.gh === m.ga && totalXG > 1.2 && daPerMin > 0.8 && min > 50 && min < 80) { signal = 'LAY DRAW (LTD)'; signalColor = '#f59e0b'; }
      else if (daPerMin > 1.2 && totalXG > m.gh + m.ga + 0.5) { signal = 'OVER ALERT'; signalColor = '#38bdf8'; }

      return { ...m, mHome, mAway, daPerMin, isSurge, signal, signalColor };
    });

    // Sort: SURGE signals first, then by DA/min
    processed.sort((a, b) => {
      if (a.signal !== 'WAIT' && b.signal === 'WAIT') return -1;
      if (a.signal === 'WAIT' && b.signal !== 'WAIT') return 1;
      return b.daPerMin - a.daPerMin;
    });

    table.innerHTML = processed.map(p => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); background:${p.signal !== 'WAIT' ? 'rgba(45,212,191,0.05)' : 'transparent'};">
        <td style="padding:10px; vertical-align:middle;">
          <span style="color:${p.minute > 75 ? 'var(--danger)' : 'var(--accent)'}; font-weight:bold;">${p.minute}'</span>
        </td>
        <td style="padding:10px; vertical-align:middle; font-weight:500;">
          <div style="font-size:10px; color:var(--muted);">${p.league}</div>
          ${p.home} <br> ${p.away}
        </td>
        <td style="padding:10px; vertical-align:middle; text-align:center;">
          <span style="padding:4px 8px; background:var(--bg-lighter); font-weight:bold; border-radius:4px;">${p.gh} - ${p.ga}</span>
        </td>
        <td style="padding:10px; vertical-align:middle; color:var(--muted);">${p.xgh.toFixed(2)} - ${p.xga.toFixed(2)}</td>
        <td style="padding:10px; vertical-align:middle;">
          <span style="color:${p.daPerMin > 1.0 ? 'var(--ok)' : 'var(--text)'}; font-weight:bold;">${p.daPerMin.toFixed(2)}</span>
        </td>
        <td style="padding:10px; vertical-align:middle; color:var(--muted);">${p.stats.sot[0]} - ${p.stats.sot[1]}</td>
        <td style="padding:10px; vertical-align:middle;">
          <div style="display:flex; width:80px; height:8px; border-radius:4px; overflow:hidden; background:var(--bg-lighter);">
            <div style="width:${p.mHome}%; background:var(--ok);"></div>
            <div style="width:${100 - p.mHome}%; background:var(--danger);"></div>
          </div>
          <div style="font-size:10px; margin-top:4px; color:var(--muted);">${p.mHome}% - ${100 - p.mHome}%</div>
        </td>
        <td style="padding:10px; vertical-align:middle;">
          <span style="padding:4px 8px; font-size:11px; font-weight:bold; border-radius:12px; background:${p.signalColor}22; color:${p.signalColor}; border:1px solid ${p.signalColor}55;">
            ${p.signal}
          </span>
        </td>
      </tr>
    `).join('');

  } catch (err) {
    table.innerHTML = `<tr><td colspan="8" style="padding:20px; text-align:center; color:var(--danger);">Errore caricamento radar: ${err.message}</td></tr>`;
  }
};
