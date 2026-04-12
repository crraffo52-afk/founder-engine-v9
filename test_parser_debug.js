const raw = `England Premier League

12/04/2026 17:30
Stamford Bridge
Giornata 32
Chelsea vs Man City
(6) Chelsea

0:0
(0:0)
24:31
Chelsea vs Man City
Man City (2)


📉
Grafico

Stats live

Eventi

Formazioni

Classifiche

⚙️
H2H


Quote
Pre-partita
Inizio
Live

FT

1	X	2	Under	Over	H. U/O
3.60 	3.90 	1.90 	2.00	1.85	3.25 
2.80	3.60	2.25	1.87	1.97	3.0
3.60	3.50	2.00	1.92	1.92	2.5
PT 0:0
FT 0:0
Espandi evento
GT	GT Max	TT	SOD	SOT	SOFT	XG	Corner
🔒	🔒	🔒	🔒	1-0	3-2	0.20-0.11	2-2
24:31
Stats live

Tutto
1° Tempo
2° Tempo

0-15
Filtra Statistiche
14/14

Mostra Filtri
Reimposta
Goal
0
0
Tiri Totali
4
2
Tiri in Porta
1
0
Tiri Fuori Porta
3
2
XG
0.2
0.11
Possesso Palla
34 %
66 %
Attacchi
14
35
Attacchi Pericolosi
9
26
Rigori
0
0
Calci d'Angolo
2
2
Cartellini Gialli
1
0
Cartellini Rossi
0
0
Sostituzioni
0
0
Palla Sicura
7
8`;

function parseRawMatchText(raw) {
  const lines = raw.replace(/\r/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  const text = lines.join('\n');
  const result = { stats: {}, proxyXG: false };

  // Provider detection
  if (text.toLowerCase().includes('sofascore')) result.provider = 'Sofascore';
  else if (text.toLowerCase().includes('flashscore') || text.toLowerCase().includes('diretta')) result.provider = 'Flashscore';
  else result.provider = 'Auto-Detect';

  // Teams
  const teamsMatch = text.match(/([A-Za-zÀ-ÿ' .()-]+)\s+vs\s+([A-Za-zÀ-ÿ' .()-]+)/i);
  if (teamsMatch) {
    result.home = teamsMatch[1].trim();
    result.away = teamsMatch[2].trim();
  }

  const cleanScoreText = text.replace(/\(\s*\d{1,2}\s*[:\-]\s*\d{1,2}\s*\)/g, '');
  const scoreMatches = Array.from(cleanScoreText.matchAll(/\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/g));
  for (const match of scoreMatches) {
    const s1 = parseInt(match[1], 10);
    const s2 = parseInt(match[2], 10);
    if (s1 <= 15 && s2 <= 15) {
      if (match[0].includes(':') && (match[1].startsWith('0') && match[1].length === 2 && s1 > 0)) continue;
      if (match[0].includes(':') && match[2].length === 2 && s2 > 10) continue;
      result.gh = s1;
      result.ga = s2;
      break;
    }
  }

  const timeMatch = text.match(/\b(1?\d{2}|\d{1,2}):(\d{2})\b/g);
  if (timeMatch) {
    for (const t of timeMatch.slice().reverse()) {
      const [mm, ss] = t.split(':').map(Number);
      if (mm >= 1 && mm <= 120 && ss >= 0 && ss <= 59) {
        if (result.gh !== undefined && mm <= 15 && ss <= 15) continue;
        result.minute = mm;
        break;
      }
    }
  }
  if (!result.minute) {
    const minAlt = text.match(/\b(\d{1,3})['′]/);
    if (minAlt) result.minute = parseInt(minAlt[1], 10);
  }

  const xgLineIdx = lines.findIndex(l => /^XG$/i.test(l));
  if (xgLineIdx >= 0) {
    const xgh = parseFloat(lines[xgLineIdx + 1]?.replace(',', '.'));
    const xga = parseFloat(lines[xgLineIdx + 2]?.replace(',', '.'));
    if (!isNaN(xgh) && !isNaN(xga)) {
      result.xgh = xgh;
      result.xga = xga;
    }
  }
  if (result.xgh === undefined) {
    const xgInline = text.match(/(\d+[.,]\d+)\s*[-–]\s*(\d+[.,]\d+)\s*(?=\s|$)/);
    if (xgInline) {
      const v1 = parseFloat(xgInline[1].replace(',', '.'));
      const v2 = parseFloat(xgInline[2].replace(',', '.'));
      if (v1 > 0 || v2 > 0) { result.xgh = v1; result.xga = v2; }
    }
  }

  const statDefs = [
    { keys: ['Goal', 'Gol', 'Reti'], stat: 'goals_crawler' },
    { keys: ['Tiri in Porta', 'Shots on Target', 'SOT'], stat: 'sot' },
    { keys: ['Attacchi Pericolosi', 'Dangerous Attacks'], stat: 'da' },
    { keys: ['Tiri Totali', 'Total Shots', 'Tiri Tot'], stat: 'st' },
    { keys: ["Calci d'Angolo", 'Corners', 'Angoli'], stat: 'cor' },
    { keys: ['Possesso Palla', 'Possession', 'Possesso'], stat: 'pos' },
    { keys: ['Attacchi'], stat: 'att' },
  ];

  lines.forEach((line, i) => {
    statDefs.forEach(def => {
      if (def.keys.some(k => line.toLowerCase() === k.toLowerCase() || line.toLowerCase().includes(k.toLowerCase()))) {
        if (line.includes('(1T)') || line.includes('1° Tempo')) return;
        const raw1 = lines[i + 1]?.replace('%', '').replace(',', '.').trim();
        const raw2 = lines[i + 2]?.replace('%', '').replace(',', '.').trim();
        const v1 = parseFloat(raw1);
        const v2 = parseFloat(raw2);
        if (!isNaN(v1) && !isNaN(v2) && !result.stats[def.stat]) {
          result.stats[def.stat] = [v1, v2];
        }
      }
    });
  });

  return result;
}

console.log(JSON.stringify(parseRawMatchText(raw), null, 2));
