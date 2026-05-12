import React, { useEffect, useState } from 'react';
import { Target, GitCompare, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

/**
 * Predicted (Backtest) vs Actual (Paper-trade journal) comparison widget.
 *
 * The acceptance criterion to graduate from paper to live trading:
 *   actual expectancy is within 30% of backtest expectancy.
 *
 * This widget makes that gap visible at a glance.
 *
 * Sources:
 *   - /api/journal/stats — actual realized stats from paper trades
 *   - /api/backtests — most recent backtest run for the same asset class
 *
 * Shows side-by-side: win rate, expectancy, profit factor, max DD.
 * Highlights gap with color: 🟢 within 30%, 🟡 within 50%, 🔴 beyond 50%.
 */
export default function PredictedVsActualWidget({ assetClass = 'stock' }) {
  const [actual, setActual]       = useState(null);
  const [predicted, setPredicted] = useState(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [journalRes, backtestsRes] = await Promise.all([
          fetch(`/api/journal/stats?mode=paper&assetClass=${assetClass}`).then(r => r.json()),
          fetch('/api/backtests?limit=15').then(r => r.json()),
        ]);
        if (cancelled) return;

        // Find the most recent backtest run for this asset class with real trades.
        // Filter out runs with 0 trades (e.g., the buggy run #12) and prefer
        // the run with the largest universe (most representative).
        const runs = (backtestsRes.runs || [])
          .filter(r => (r.total_trades || 0) >= 10)
          .filter(r => {
            // asset_class column may be absent on legacy runs — treat null as 'stock'
            const cls = r.asset_class || 'stock';
            return cls === assetClass;
          });
        const ref = runs.sort((a, b) => (b.universe_size || 0) - (a.universe_size || 0))[0] || null;

        setActual(journalRes);
        setPredicted(ref);
      } catch (_) {}
      if (!cancelled) setLoading(false);
    };
    load();
    const i = setInterval(load, 60_000);  // refresh hourly is enough; using 60s for testing
    return () => { cancelled = true; clearInterval(i); };
  }, [assetClass]);

  if (loading) return <div className="card loading-skeleton skeleton-card" style={{ minHeight: 220 }} />;

  if (!predicted) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="card-title"><GitCompare size={16} className="inline-icon" /> Predicted vs Actual</div>
        </div>
        <div className="empty-state" style={{ padding: 24 }}>
          <Target size={32} className="text-muted" strokeWidth={1} />
          <div className="empty-title" style={{ marginTop: 8 }}>No backtest baseline yet</div>
          <div className="empty-text">Run a backtest from the Backtests tab to establish the predicted edge for comparison.</div>
        </div>
      </div>
    );
  }

  const hasActual = (actual?.totalTrades || 0) > 0;

  // Metric definitions
  const metrics = [
    {
      key: 'winRate',
      label: 'Win rate',
      predicted: Math.round((predicted.win_rate || 0) * 100),
      actual:    hasActual ? Math.round((actual.winRate || 0) * 100) : null,
      format:    v => `${v}%`,
      higherIsBetter: true,
    },
    {
      key: 'expectancy',
      label: 'Expectancy / trade',
      predicted: predicted.expectancy_pct,
      actual:    hasActual ? actual.expectancyPct : null,
      format:    v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%',
      higherIsBetter: true,
      primary:   true, // The gold-standard signal
    },
    {
      key: 'profitFactor',
      label: 'Profit factor',
      predicted: predicted.profit_factor,
      actual:    hasActual ? actual.profitFactor : null,
      format:    v => v != null ? v.toFixed(2) : '—',
      higherIsBetter: true,
    },
    {
      key: 'maxDD',
      label: 'Max drawdown',
      predicted: predicted.max_drawdown_pct,
      actual:    hasActual ? actual.maxDrawdownPct : null,
      format:    v => '-' + v + '%',
      higherIsBetter: false, // smaller drawdown is better
    },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">
          <GitCompare size={16} className="inline-icon" />
          <span>Predicted vs Actual</span>
          <span style={{
            fontSize: '0.6rem', padding: '1px 7px', borderRadius: 3,
            background: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.06, fontWeight: 700, marginLeft: 4,
          }}>{assetClass}</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Predicted: backtest #{predicted.id} ({predicted.start_date} → {predicted.end_date})
        </div>
      </div>

      {/* Header row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
        gap: 10,
        padding: '0 8px 8px',
        fontSize: '0.65rem',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div>Metric</div>
        <div style={{ textAlign: 'right' }}>Predicted</div>
        <div style={{ textAlign: 'right' }}>Actual</div>
        <div style={{ textAlign: 'right' }}>Gap</div>
      </div>

      {/* Metric rows */}
      {metrics.map(m => {
        const gap = (m.actual != null && m.predicted != null && m.predicted !== 0)
          ? ((m.actual - m.predicted) / Math.abs(m.predicted)) * 100
          : null;
        const verdict = gapVerdict(gap, m.higherIsBetter);
        return (
          <div key={m.key} style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
            gap: 10,
            padding: '10px 8px',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
            alignItems: 'baseline',
            background: m.primary ? 'rgba(0, 230, 118, 0.04)' : 'transparent',
          }}>
            <div style={{ fontSize: '0.82rem', fontWeight: m.primary ? 600 : 500, color: m.primary ? 'var(--profit)' : 'var(--text-secondary)' }}>
              {m.label}{m.primary && <span style={{ fontSize: '0.6rem', marginLeft: 4, opacity: 0.7 }}>★</span>}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
              {m.format(m.predicted ?? 0)}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.92rem', textAlign: 'right', fontWeight: 600,
              color: m.actual != null ? (verdict.toneActual === 'profit' ? 'var(--profit)' : verdict.toneActual === 'loss' ? 'var(--loss)' : 'var(--text-primary)') : 'var(--text-muted)',
            }}>
              {m.actual != null ? m.format(m.actual) : '—'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600, color: verdict.color }}>
              {gap != null ? `${gap >= 0 ? '+' : ''}${gap.toFixed(0)}%` : '—'}
              {gap != null && <span style={{ marginLeft: 4 }}>{verdict.icon}</span>}
            </div>
          </div>
        );
      })}

      {/* Verdict banner */}
      <div style={{
        marginTop: 12,
        padding: '10px 12px',
        borderRadius: 6,
        background: verdictBannerBg(actual, predicted),
        fontSize: '0.78rem',
        lineHeight: 1.5,
      }}>
        <strong>{verdictLabel(actual, predicted)}</strong>
        <div style={{ color: 'var(--text-muted)', marginTop: 2, fontSize: '0.72rem' }}>
          {actualTradeDescription(actual)}
        </div>
      </div>
    </div>
  );
}

/** Map gap % → color and tone */
function gapVerdict(gap, higherIsBetter) {
  if (gap == null) return { color: 'var(--text-muted)', icon: '', toneActual: '' };
  const absGap = Math.abs(gap);
  const actuallyBetter = higherIsBetter ? gap > 0 : gap < 0;

  if (absGap <= 30) {
    return {
      color: 'var(--profit)',
      icon: actuallyBetter ? '↗' : '✓',
      toneActual: actuallyBetter ? 'profit' : ''
    };
  } else if (absGap <= 60) {
    return {
      color: 'var(--warning)',
      icon: actuallyBetter ? '↗' : '⚠',
      toneActual: actuallyBetter ? 'profit' : 'loss'
    };
  } else {
    return {
      color: 'var(--loss)',
      icon: actuallyBetter ? '↗' : '✗',
      toneActual: actuallyBetter ? 'profit' : 'loss'
    };
  }
}

function verdictBannerBg(actual, predicted) {
  if (!actual?.totalTrades) return 'rgba(148, 163, 184, 0.08)';
  const expGap = predicted.expectancy_pct
    ? ((actual.expectancyPct - predicted.expectancy_pct) / Math.abs(predicted.expectancy_pct)) * 100
    : 0;
  if (Math.abs(expGap) <= 30) return 'rgba(0, 230, 118, 0.08)';
  if (Math.abs(expGap) <= 60) return 'rgba(250, 204, 21, 0.08)';
  return 'rgba(255, 77, 79, 0.08)';
}

function verdictLabel(actual, predicted) {
  if (!actual?.totalTrades) return 'Waiting for first closed trades…';
  if (actual.totalTrades < 10) return `Sample too small for verdict (n=${actual.totalTrades}, need ≥10)`;
  const expGap = predicted.expectancy_pct
    ? ((actual.expectancyPct - predicted.expectancy_pct) / Math.abs(predicted.expectancy_pct)) * 100
    : 0;
  if (Math.abs(expGap) <= 30) return '✅ Engine tracking backtest within tolerance — edge confirmed';
  if (Math.abs(expGap) <= 60) return '🟡 Engine drifting from backtest — watch closely';
  return expGap > 0
    ? '⚠ Engine outperforming backtest dramatically — likely sample-size noise'
    : '🔴 Engine underperforming backtest — investigate before going live';
}

function actualTradeDescription(actual) {
  if (!actual?.totalTrades) return '';
  return `${actual.totalTrades} closed trade${actual.totalTrades === 1 ? '' : 's'} so far · ${actual.wins}W / ${actual.losses}L · realized ₹${(actual.totalPnl ?? 0).toLocaleString('en-IN')}`;
}
