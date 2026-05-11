import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Day's simple P&L widget for the Dashboard sidebar.
 *
 * Shows what your broker app would call "Today's P&L" — the daily
 * mark-to-market change vs each position's previous close, plus any
 * P&L realized on trades closed today.
 *
 * Refreshes every 30s (cheap — just reads the DB-cached snapshot).
 */
export default function DailyPnLWidget({ capital = 50000 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/equity/today?capital=${capital}`);
        if (res.ok) setData(await res.json());
      } catch (_) {}
      setLoading(false);
    };
    load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, [capital]);

  if (loading) return <div className="card loading-skeleton skeleton-sidebar" style={{ minHeight: 140 }} />;
  if (!data) return null;

  const pnl = data.dayPnlTotal ?? 0;
  const pct = data.dayPnlPct ?? 0;
  const isUp = pnl >= 0;
  const tone = isUp ? 'profit' : 'loss';
  const Arrow = isUp ? TrendingUp : TrendingDown;
  const sign = isUp ? '+' : '';

  return (
    <div className="card daily-pnl-widget">
      <div className="card-header" style={{ paddingBottom: 4 }}>
        <div className="card-title">
          <Arrow size={14} className="inline-icon" style={{ color: `var(--${tone})` }} />
          Today's P&amp;L
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{data.date}</div>
      </div>

      {/* Headline */}
      <div style={{ padding: '6px 0 10px' }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.6rem',
          fontWeight: 700,
          color: `var(--${tone})`,
          lineHeight: 1.1,
        }}>
          {sign}₹{Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: `var(--${tone})`, marginTop: 2 }}>
          {sign}{pct.toFixed(2)}% on deployed
        </div>
      </div>

      {/* Sub-stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
        <Stat label="Open P&L" value={data.dayPnlOpen} tone={data.dayPnlOpen >= 0 ? 'profit' : 'loss'} />
        <Stat label={`Closed (${data.closedTodayCount})`} value={data.dayPnlClosed} tone={data.dayPnlClosed >= 0 ? 'profit' : 'loss'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
        <Stat label="Deployed" value={data.deployedCapital} compact />
        <Stat label="Cumulative unreal." value={data.unrealizedTotal} tone={data.unrealizedTotal >= 0 ? 'profit' : 'loss'} compact />
      </div>

      {/* Breakdown toggle */}
      {data.breakdown?.length > 0 && (
        <>
          <button
            onClick={() => setShowBreakdown(s => !s)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: '0.7rem', color: 'var(--text-muted)', padding: '4px 0', marginTop: 2,
            }}
          >
            {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showBreakdown ? 'Hide' : 'Show'} per-position breakdown
          </button>
          {showBreakdown && (
            <div style={{ marginTop: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
              {data.breakdown
                .slice()
                .sort((a, b) => (b.dayPnl ?? 0) - (a.dayPnl ?? 0))
                .map(b => (
                  <div key={b.symbol} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                    fontSize: '0.72rem', padding: '3px 0',
                  }}>
                    <span style={{ fontWeight: 600 }}>{b.symbol}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      color: (b.dayPnl ?? 0) >= 0 ? 'var(--profit)' : 'var(--loss)',
                    }}>
                      {(b.dayPnl ?? 0) >= 0 ? '+' : ''}₹{Math.abs(b.dayPnl ?? 0).toFixed(0)}
                      {b.dayChangePct != null && (
                        <span style={{ marginLeft: 6, opacity: 0.7, fontSize: '0.65rem' }}>
                          ({b.dayChangePct >= 0 ? '+' : ''}{b.dayChangePct.toFixed(2)}%)
                        </span>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}

      {data.positionsWithDayData < data.positionCount && (
        <div style={{ marginTop: 8, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          {data.positionCount - data.positionsWithDayData} position(s) awaiting first MTM for day data
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, compact }) {
  return (
    <div>
      <div style={{
        fontSize: compact ? '0.62rem' : '0.65rem',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: compact ? '0.82rem' : '0.92rem',
        fontWeight: 600,
        color: tone === 'profit' ? 'var(--profit)' : tone === 'loss' ? 'var(--loss)' : 'inherit',
      }}>
        {(value ?? 0) >= 0 ? '+' : '−'}₹{Math.abs(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
      </div>
    </div>
  );
}
