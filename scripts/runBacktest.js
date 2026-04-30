/**
 * CLI: run a backtest of the SwingPro engine and persist results.
 *
 * Usage:
 *   node scripts/runBacktest.js
 *   node scripts/runBacktest.js --start 2023-01-01 --end 2024-12-31 --capital 50000 --threshold 60
 *   node scripts/runBacktest.js --universe extended --threshold 50
 */

import 'dotenv/config';
import STOCK_UNIVERSE          from '../src/engine/stockUniverse.js';
import STOCK_UNIVERSE_EXTENDED from '../src/engine/stockUniverseExtended.js';
import { runBacktest }         from '../src/backtest/engine.js';
import { backtestRepo }        from '../src/persistence/db.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const universe = args.universe === 'extended' ? STOCK_UNIVERSE_EXTENDED : STOCK_UNIVERSE;

  const config = {
    startDate:      args.start     || '2023-01-01',
    endDate:        args.end       || '2024-12-31',
    capital:        parseInt(args.capital || '50000', 10),
    scoreThreshold: parseInt(args.threshold || '60', 10),
    includeLowConf: args.lowconf === 'true',
    minRR:          parseFloat(args.minrr || '1.5'),
    maxConcurrent:  parseInt(args['max-concurrent'] || '5', 10),
    maxPerSector:   parseInt(args['max-sector'] || '3', 10),
    maxHoldingDays: parseInt(args['max-days'] || '25', 10),
    rebalanceEvery: parseInt(args.rebalance || '1', 10),
    volAdjustedSizing: args['flat-sizing'] !== 'true' && args['flat-sizing'] !== true,
    baseRiskPercent: parseFloat(args['risk-pct'] || '0.015'),
  };

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  SwingPro Backtest');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Universe:        ', args.universe || 'default', `(${universe.length} stocks)`);
  console.log('Window:          ', config.startDate, '→', config.endDate);
  console.log('Capital:         ', `₹${config.capital.toLocaleString('en-IN')}`);
  console.log('Score threshold: ', config.scoreThreshold);
  console.log('Min R:R:         ', config.minRR);
  console.log('Max concurrent:  ', config.maxConcurrent);
  console.log('Max per sector:  ', config.maxPerSector);
  console.log('Max holding days:', config.maxHoldingDays);
  console.log();

  const runId = backtestRepo.start({
    startDate: config.startDate,
    endDate:   config.endDate,
    capital:   config.capital,
    universeSize: universe.length,
    config,
    notes: `CLI run, universe=${args.universe || 'default'}`,
  });
  console.log(`📁 Run ID: ${runId}`);

  const result = await runBacktest(universe, config);

  // Persist trades + metrics
  backtestRepo.saveTrades(runId, result.trades);
  backtestRepo.finish(runId, {
    total_trades:    result.metrics.totalTrades,
    wins:            result.metrics.wins,
    losses:          result.metrics.losses,
    win_rate:        result.metrics.winRate,
    avg_win_pct:     result.metrics.avgWinPct,
    avg_loss_pct:    result.metrics.avgLossPct,
    expectancy_pct:  result.metrics.expectancyPct,
    total_return:    result.metrics.totalReturn,
    total_return_pct: result.metrics.totalReturnPct,
    max_drawdown_pct: result.metrics.maxDrawdownPct,
    sharpe_ratio:    result.metrics.sharpeRatio,
    profit_factor:   result.metrics.profitFactor,
  });

  // ─── Print report ───
  printReport(result);
  console.log(`\n💾 Saved to backtest_runs id=${runId}\n`);
}

function printReport(r) {
  const m = r.metrics;
  console.log('\n━━━━━━━━━━━━━━━━━━━━ RESULTS ━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total trades:       ${m.totalTrades}`);
  console.log(`Wins / Losses:      ${m.wins} / ${m.losses}`);
  console.log(`Win rate:           ${(m.winRate * 100).toFixed(1)}%`);
  console.log(`Avg win:            ${m.avgWinPct >= 0 ? '+' : ''}${m.avgWinPct}%`);
  console.log(`Avg loss:           ${m.avgLossPct}%`);
  console.log(`Expectancy / trade: ${m.expectancyPct >= 0 ? '+' : ''}${m.expectancyPct}%`);
  console.log(`Profit factor:      ${m.profitFactor}`);
  console.log(`Avg holding:        ${m.avgHoldingDays} days`);
  console.log(`Avg MAE / MFE:      ${m.avgMAE}R / ${m.avgMFE}R`);
  console.log();
  console.log(`Total return:       ₹${m.totalReturn.toLocaleString('en-IN')}  (${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct}%)`);
  console.log(`Final equity:       ₹${m.finalEquity.toLocaleString('en-IN')}`);
  console.log(`Max drawdown:       ${m.maxDrawdownPct}%`);
  console.log(`Sharpe (annual):    ${m.sharpeRatio}`);
  console.log();

  // Setup type breakdown
  console.log('━━━ By Setup Type ━━━');
  const sortedSetups = Object.entries(m.bySetup).sort((a, b) => b[1].n - a[1].n);
  for (const [k, v] of sortedSetups) {
    console.log(`  ${k.padEnd(28)} n=${String(v.n).padStart(3)}  win=${(v.winRate * 100).toFixed(0).padStart(3)}%  exp=${v.expectancy >= 0 ? '+' : ''}${v.expectancy.toFixed(2)}%`);
  }

  // Confidence bucket breakdown
  console.log('\n━━━ By Confidence Bucket ━━━');
  for (const k of ['70+', '60-69', '50-59', '40-49', '<40']) {
    const v = m.byConfidence[k];
    if (!v) continue;
    console.log(`  ${k.padEnd(8)} n=${String(v.n).padStart(3)}  win=${(v.winRate * 100).toFixed(0).padStart(3)}%  exp=${v.expectancy >= 0 ? '+' : ''}${v.expectancy.toFixed(2)}%`);
  }

  // Exit reasons
  console.log('\n━━━ Exit Reasons ━━━');
  for (const [k, v] of Object.entries(m.byExitReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(15)} ${v}`);
  }
}

main().catch(err => { console.error('❌', err); process.exit(1); });
