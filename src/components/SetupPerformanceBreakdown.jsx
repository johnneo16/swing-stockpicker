import React, { useEffect, useState } from 'react';
import { Layers, TrendingUp, TrendingDown } from 'lucide-react';

/**
 * Performance breakdown by setup type.
 *
 * Compares predicted (most-recent backtest) vs actual (paper journal)
 * stats per setup type — so you can see which setups are working in
 * the wild without changing the engine.
 *
 * For each setup type, shows:
 *   - n (trade count)
 *   - win rate
 *   - expectancy per trade
 *   - total realized P&L
 *
 * Two stacked sections:
 *   1. ACTUAL (from journal)    — small N initially
 *   2. PREDICTED (from backtest) — large N, the baseline
 */
export default function SetupPerformanceBreakdown({ assetClass = 'stock' }) {
  const [actualBySetup, setActualBySetup] = useState({});
  const [predictedBySetup, setPredictedBySetup] = useState({});
  const [predictedRun, setPredictedRun] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [journal, runsRes] = await Promise.all([
          fetch(`/api/journal/stats?mode=paper&assetClass=${assetClass}`).then(r => r.json()),
          fetch('/api/backtests?limit=15').then(r => r.json()),
        ]);
        if (cancelled) return;

        // Actual bySetup is already in journal stats
        setActualBySetup(journal.bySetup || {});

        // Find best predicted run for this asset class
        const runs = (runsRes.runs || [])
          .filter(r => (r.total_trades || 0) >= 10)
          .filter(r => (r.asset_class || 'stock') === assetClass)
          .sort((a, b) => (b.universe_size || 0) - (a.universe_size || 0));
        const ref = runs[0];

        if (ref) {
          // Fetch run details (includes trades) so we can aggregate by setup
          const runDetail = await fetch(`/api/backtests/${ref.id}`).then(r => r.json());
          if (cancelled) return;
          setPredictedRun(ref);

          const bySetup = {};
          for (const t of runDetail.trades || []) {
            const k = t.setup_type || 'unknown';
            (bySetup[k] ??= { n: 0, wins: 0, totalPct: 0, totalPnl: 0 });
            bySetup[k].n++;
            if ((t.realized_pnl ?? 0) > 0) bySetup[k].wins++;
            bySetup[k].totalPct += t.realized_pct ?? 0;
            bySetup[k].totalPnl += t.realized_pnl ?? 0;
          }
          // Compute derived stats
          for (const k of Object.keys(bySetup)) {
            const v = bySetup[k];
            v.winRate    = v.n > 0 ? v.wins / v.n : 0;
            v.expectancy = v.n > 0 ? v.totalPct / v.n : 0;
          }
          setPredictedBySetup(bySetup);
        }
      } catch (_) {}
      if (!cancelled) setLoading(false);
    };
    load();
    const i = setInterval(load, 5 * 60 * 1000); // refresh every 5 min
    return () => { cancelled = true; clearInterval(i); };
  }, [assetClass]);

  if (loading) {
    return <div className="card loading-skeleton skeleton-card" style={{ minHeight: 280 }} />;
  }

  const hasActual = Object.keys(actualBySetup).length > 0;
  const hasPredicted = Object.keys(predictedBySetup).length > 0;

  if (!hasActual && !hasPredicted) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Layers size={16} className="inline-icon" /> Setup Performance</div>
        </div>
        <div className="empty-state" style={{ padding: 24 }}>
          <div className="empty-text">No backtest or journal data yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card setup-performance-card">
      <div className="card-header">
        <div className="card-title">
          <Layers size={16} className="inline-icon" />
          <span>Setup Performance</span>
          <span style={{
            fontSize: '0.6rem', padding: '1px 7px', borderRadius: 3,
            background: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 0.06, fontWeight: 700, marginLeft: 4,
          }}>{assetClass}</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {predictedRun && <>Baseline: backtest #{predictedRun.id}</>}
        </div>
      </div>

      {/* Actual section (live paper journal) */}
      {hasActual && (
        <Section
          label="Actual (Paper Journal)"
          rows={sortRows(actualBySetup)}
          source="live"
        />
      )}

      {/* Predicted section (backtest baseline) */}
      {hasPredicted && (
        <Section
          label="Predicted (Backtest Baseline)"
          rows={sortRows(predictedBySetup)}
          source="backtest"
          style={{ marginTop: hasActual ? 16 : 0 }}
        />
      )}

      <div style={{
        marginTop: 12, padding: '8px 10px',
        fontSize: '0.7rem', color: 'var(--text-muted)',
        background: 'rgba(148,163,184,0.06)', borderRadius: 4,
      }}>
        <strong>Tip:</strong> When journal n grows (≥5 per setup), compare to
        backtest to spot which setups are working. Setups that diverge sharply
        from backtest are candidates for engine attention.
      </div>
    </div>
  );
}

function Section({ label, rows, source, style }) {
  return (
    <div style={style}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 0.5fr 0.7fr 0.9fr 1fr',
        gap: 8,
        padding: '4px 0',
        fontSize: '0.65rem',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div>Setup</div>
        <div style={{ textAlign: 'right' }}>N</div>
        <div style={{ textAlign: 'right' }}>Win %</div>
        <div style={{ textAlign: 'right' }}>Exp.</div>
        <div style={{ textAlign: 'right' }}>P&L</div>
      </div>
      {rows.map(r => (
        <div key={r.k} style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 0.5fr 0.7fr 0.9fr 1fr',
          gap: 8,
          padding: '6px 0',
          fontSize: '0.78rem',
          alignItems: 'baseline',
          borderBottom: '1px solid rgba(255,255,255,0.02)',
        }}>
          <div style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
            {r.k}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-muted)' }}>
            {r.n}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', textAlign: 'right',
            color: r.winRate >= 0.5 ? 'var(--profit)' : r.winRate >= 0.4 ? 'var(--warning)' : 'var(--loss)',
            fontWeight: 600,
          }}>
            {Math.round(r.winRate * 100)}%
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', textAlign: 'right',
            color: r.expectancy >= 0 ? 'var(--profit)' : 'var(--loss)',
            fontWeight: 600,
          }}>
            {r.expectancy >= 0 ? '+' : ''}{r.expectancy.toFixed(2)}%
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', textAlign: 'right',
            color: r.totalPnl >= 0 ? 'var(--profit)' : 'var(--loss)',
          }}>
            {r.totalPnl >= 0 ? '+' : '−'}₹{Math.abs(r.totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      ))}
    </div>
  );
}

function sortRows(bySetup) {
  return Object.entries(bySetup)
    .map(([k, v]) => ({ k, ...v }))
    .sort((a, b) => (b.totalPnl ?? 0) - (a.totalPnl ?? 0));
}
