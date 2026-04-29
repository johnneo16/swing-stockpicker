/**
 * Performance metrics for a list of completed simulated trades.
 *
 * Returns:
 *  - totalTrades, wins, losses
 *  - winRate, avgWinPct, avgLossPct
 *  - expectancyPct
 *  - profitFactor
 *  - totalReturn, totalReturnPct (compounded equity curve)
 *  - maxDrawdownPct
 *  - sharpeRatio (annualized, daily-trade approximation)
 *  - byMonth, bySetupType, byConfidenceBucket
 */

export function computeMetrics(trades, startingCapital = 50000) {
  if (!trades || trades.length === 0) {
    return zeroMetrics();
  }

  // Sort chronologically by entry date for equity curve
  const sorted = [...trades].sort((a, b) => new Date(a.entryDate) - new Date(b.entryDate));

  const wins   = sorted.filter(t => t.pnl > 0);
  const losses = sorted.filter(t => t.pnl < 0);

  const winRate     = wins.length / sorted.length;
  const avgWinPct   = wins.length   ? mean(wins.map(t => t.pnlPct))   : 0;
  const avgLossPct  = losses.length ? mean(losses.map(t => t.pnlPct)) : 0;
  const expectancyPct = winRate * avgWinPct + (1 - winRate) * avgLossPct;

  const grossProfit = sum(wins.map(t => t.pnl));
  const grossLoss   = Math.abs(sum(losses.map(t => t.pnl)));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // Equity curve — compound percentage returns trade-by-trade
  // (assumes one trade at a time using a fixed % of capital — simplification for first cut)
  let equity = startingCapital;
  let peak   = startingCapital;
  let maxDD  = 0;
  const equityCurve = [];
  const dailyReturns = [];

  for (const t of sorted) {
    const prev = equity;
    equity   = equity + t.pnl;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak * 100;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push({ date: t.exitDate, equity });
    dailyReturns.push(equity / prev - 1);
  }

  const totalReturn    = equity - startingCapital;
  const totalReturnPct = (equity / startingCapital - 1) * 100;

  // Sharpe: annualized using avg trade-return / stddev × sqrt(N)
  // Approximation only — assumes trades are roughly evenly spaced.
  const meanRet = mean(dailyReturns);
  const sdRet   = stddev(dailyReturns);
  const sharpe  = sdRet > 0 ? (meanRet / sdRet) * Math.sqrt(252 / Math.max(1, daysSpan(sorted) / sorted.length)) : 0;

  // Bucketed views
  const bySetup = groupAggregate(sorted, t => t.setupType || 'unknown');
  const byConf  = groupAggregate(sorted, t => confidenceBucket(t.confidence));
  const byMonth = groupAggregate(sorted, t => (t.entryDate || '').slice(0, 7));
  const byExitReason = countBy(sorted, t => t.exitReason || 'unknown');

  return {
    totalTrades:    sorted.length,
    wins:           wins.length,
    losses:         losses.length,
    winRate:        round4(winRate),
    avgWinPct:      round2(avgWinPct),
    avgLossPct:     round2(avgLossPct),
    expectancyPct:  round2(expectancyPct),
    profitFactor:   isFinite(profitFactor) ? round2(profitFactor) : null,
    totalReturn:    round2(totalReturn),
    totalReturnPct: round2(totalReturnPct),
    maxDrawdownPct: round2(maxDD),
    sharpeRatio:    round2(sharpe),
    avgHoldingDays: round1(mean(sorted.map(t => t.holdingDays || 0))),
    avgMAE:         round2(mean(sorted.map(t => t.mae || 0))),
    avgMFE:         round2(mean(sorted.map(t => t.mfe || 0))),
    bySetup,
    byConfidence:   byConf,
    byMonth,
    byExitReason,
    equityCurve:    equityCurve.slice(-200),
    startingCapital,
    finalEquity:    round2(equity),
  };
}

function zeroMetrics() {
  return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, avgWinPct: 0,
    avgLossPct: 0, expectancyPct: 0, profitFactor: 0, totalReturn: 0, totalReturnPct: 0,
    maxDrawdownPct: 0, sharpeRatio: 0, avgHoldingDays: 0, avgMAE: 0, avgMFE: 0,
    bySetup: {}, byConfidence: {}, byMonth: {}, byExitReason: {}, equityCurve: [] };
}

function confidenceBucket(c) {
  if (c == null) return 'unknown';
  if (c >= 70) return '70+';
  if (c >= 60) return '60-69';
  if (c >= 50) return '50-59';
  if (c >= 40) return '40-49';
  return '<40';
}

function groupAggregate(trades, keyFn) {
  const groups = {};
  for (const t of trades) {
    const k = keyFn(t);
    (groups[k] ??= []).push(t);
  }
  const out = {};
  for (const [k, arr] of Object.entries(groups)) {
    const wins = arr.filter(t => t.pnl > 0);
    out[k] = {
      n:           arr.length,
      winRate:     round4(wins.length / arr.length),
      expectancy:  round2(mean(arr.map(t => t.pnlPct || 0))),
      totalPnl:    round2(sum(arr.map(t => t.pnl || 0))),
    };
  }
  return out;
}

function countBy(arr, keyFn) {
  const out = {};
  for (const x of arr) {
    const k = keyFn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

const sum   = a => a.reduce((s, x) => s + x, 0);
const mean  = a => a.length ? sum(a) / a.length : 0;
const stddev = a => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1));
};
const round1 = x => Math.round(x * 10) / 10;
const round2 = x => Math.round(x * 100) / 100;
const round4 = x => Math.round(x * 10000) / 10000;
const daysSpan = trades => {
  if (trades.length < 2) return 1;
  const first = new Date(trades[0].entryDate);
  const last  = new Date(trades[trades.length - 1].exitDate || trades[trades.length - 1].entryDate);
  return Math.max(1, (last - first) / 86400000);
};
