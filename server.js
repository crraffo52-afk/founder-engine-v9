const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ─── LOGGING & BASE ───────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', version: '9.2.0-CORE', mode: 'Live-Focus' });
});

// ─── AI ANALYSIS FALLBACK ─────────────────────────────────────────────────────

app.post('/api/analyze', (req, res) => {
  const data = req.body;
  if (!data || !data.home) return res.status(400).json({ error: 'Dati match mancanti' });

  // Simulazione AI Engine Locale
  let logic = `Analisi per ${data.home} vs ${data.away}: `;
  if ((data.xgh || 0) > (data.gh || 0) + 0.5) logic += 'Forte pressione offensiva Home rilevata.';
  else logic += 'Match in fase di stasi o equilibrato.';

  res.json({ analysis: logic });
});

// ─── STATIC ROUTING ──────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Founder Engine V9.2-CORE in esecuzione sulla porta ${PORT}`);
});
