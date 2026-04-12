function updateExchangeCalc() {
  const b1 = parseFloat(byId('b1')?.value) || 0;
  const lx = parseFloat(byId('lx')?.value) || 0;
  const stakeValue = parseFloat(byId('stake')?.value) || 10;
  const type = byId('entryType')?.value || 'PRIMARY';
  const prevLoss = parseFloat(byId('prevLoss')?.value) || 0;

  const recBox = byId('recoveryBox');
  if (recBox) recBox.style.display = type === 'RECOVERY' ? 'block' : 'none';

  if (!b1 || !lx) return;

  const commission = 0.05;
  let activeStake = stakeValue;

  if (type === 'RECOVERY' && prevLoss > 0) {
    activeStake = parseFloat((prevLoss / ((b1 - 1) * (1 - commission))).toFixed(2));
    byId('stake').value = activeStake;
  }

  const grossProfit = activeStake * (b1 - 1);
  const backProfit = parseFloat((grossProfit * (1 - commission)).toFixed(2));
  const layStake = parseFloat(((activeStake * b1) / lx).toFixed(2));
  const layLiability = parseFloat((layStake * (lx - 1)).toFixed(2));
  const breakEven = parseFloat((b1 * activeStake / (activeStake + backProfit) + 1).toFixed(2));

  const greenTarget = parseFloat((backProfit * 0.35).toFixed(2));
  const stopLoss = parseFloat((activeStake * 0.15).toFixed(2));
  const roi = parseFloat(((backProfit / activeStake) * 100).toFixed(1));

  const impliedProb = b1 > 0 ? 1 / b1 : 0;
  const trueProb = impliedProb * 0.95;
  const ev = parseFloat(((trueProb * backProfit) - ((1 - trueProb) * activeStake)).toFixed(2));

  byId('calcBackProfit').textContent = `€${backProfit}`;
  byId('calcLayLiability').textContent = `€${layLiability}`;
  byId('calcLayStake').textContent = `€${layStake}`;
  byId('calcBreakEven').textContent = breakEven.toFixed(2);
  byId('calcGreenTarget').textContent = `€${greenTarget}`;
  byId('calcStopLoss').textContent = `-€${stopLoss}`;
  byId('calcROI').textContent = `${roi}%`;
  byId('calcEV').textContent = ev >= 0 ? `+€${ev}` : `-€${Math.abs(ev)}`;
  
  const recBank = Math.max(100, Math.ceil(layLiability * 5));
  const bankEl = byId('calcBankroll');
  if (bankEl) bankEl.textContent = `€${recBank}`;

  updateExchangeSignal(b1, lx, backProfit, layLiability, ev);
}
