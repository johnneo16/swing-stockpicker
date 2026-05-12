import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Day's simple P&L widget for the Dashboard sidebar.
 *
 * Mode-aware:
 *   • activeClass='stocks'      → shows stocks-only Day P&L
 *   • activeClass='etf'         → shows ETFs-only Day P&L
 *   • activeClass='combined'    → shows both with a split visualization
 *
 * Refreshes every 30s (cheap — just reads the DB-cached snapshot).
 */
export default function DailyPnLWidget({ capital = 50000, activeClass = 'stocks' }) {
  const [stockData, setStockData] = useState(null);
  const [etfData, setEtfData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [s, e] = await Promise.all([
          fetch(`/api/equity/today?capital=${capital}&assetClass=stock`).then(r => r.json()),
          fetch(`/api/equity/today?capital=${capital}&assetClass=etf`).then(r => r.json()),
        ]);
        setStockData(s);
        setEtfData(e);
      } catch (_) {}
      setLoading(false);
    };
    load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, [capital]);

  if (loading) return <div className="card loading-skeleton skeleton-sidebar" style={{ minHeight: 140 }} />;
  if (!stockData && !etfData) return null;

  // Choose primary view based on activeClass
  const primary = activeClass === 'etf' ? etfData : stockData;
  const other   = activeClass === 'etf' ? stockData : etfData;
  const primaryLabel = activeClass === 'etf' ? 'ETF' : 'Stock';
  const otherLabel   = activeClass === 'etf' ? 'Stock' : 'ETF';
  const primaryColor = activeClass === 'etf' ? 'var(--asset-etf)' : 'var(--asset-stock)';

  const pnl = primary?.dayPnlTotal ?? 0;
  const pct = primary?.dayPnlPct ?? 0;
  const isUp = pnl >= 0;
  const tone = isUp ? 'profit' : 'loss';
  const Arrow = isUp ? TrendingUp : TrendingDown;
  const sign = isUp ? '+' : '';

  return (
    <div className="card daily-pnl-widget" style={{
      // Inset box-shadow gives the colored accent WITHOUT changing card height,
      // so the widget stays aligned with sibling sidebar cards (Portfolio,
      // Regime, MarketOverview, AlertPanel)
      boxShadow: `inset 0 2px 0 ${primaryColor}`,
      position: 'relative',
    }}>
      <div className="card-header" style={{ paddingBottom: 4 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Arrow size={14} className="inline-icon" style={{ color: `var(--${tone})` }} />
          <span>Today's P&amp;L</span>
          <span style={{
            fontSize: '0.6rem', padding: '1px 7px', borderRadius: 3,
            background: primaryColor + '22', color: primaryColor,
            textTransform: 'uppercase', letterSpacing: 0.06, fontWeight: 700,
          }}>{primaryLabel}</span>
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{primary?.date}</div>
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
        <Stat label="Open P&L" value={primary?.dayPnlOpen ?? 0} tone={(primary?.dayPnlOpen ?? 0) >= 0 ? 'profit' : 'loss'} />
        <Stat label={`Closed (${primary?.closedTodayCount ?? 0})`} value={primary?.dayPnlClosed ?? 0} tone={(primary?.dayPnlClosed ?? 0) >= 0 ? 'profit' : 'loss'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
        <Stat label="Deployed" value={primary?.deployedCapital ?? 0} compact />
        <Stat label="Cumulative unreal." value={primary?.unrealizedTotal ?? 0} tone={(primary?.unrealizedTotal ?? 0) >= 0 ? 'profit' : 'loss'} compact />
      </div>

      {/* Other-class row — show only if there's any data on it */}
      {other && (other.positionCount > 0 || other.closedTodayCount > 0) && (
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border-subtle)',
          borderLeft: `3px solid ${activeClass === 'etf' ? 'var(--asset-stock)' : 'var(--asset-etf)'}`,
          borderRadius: 6,
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {otherLabel}s today
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.88rem', fontWeight: 600,
            color: (other.dayPnlTotal ?? 0) >= 0 ? 'var(--profit)' : 'var(--loss)',
          }}>
            {(other.dayPnlTotal ?? 0) >= 0 ? '+' : '−'}₹{Math.abs(other.dayPnlTotal ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            <span style={{ marginLeft: 4, opacity: 0.6, fontSize: '0.7rem' }}>
              ({other.positionCount}p)
            </span>
          </span>
        </div>
      )}

      {/* Breakdown toggle */}
      {primary?.breakdown?.length > 0 && (
        <>
          <button
            onClick={() => setShowBreakdown(s => !s)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: '0.7rem', color: 'var(--text-muted)', padding: '4px 0', marginTop: 6,
            }}
          >
            {showBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showBreakdown ? 'Hide' : 'Show'} per-{primaryLabel.toLowerCase()} breakdown
          </button>
          {showBreakdown && (
            <div style={{ marginTop: 6, borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
              {primary.breakdown
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

      {primary?.positionsWithDayData < primary?.positionCount && (
        <div style={{ marginTop: 8, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          {primary.positionCount - primary.positionsWithDayData} position(s) awaiting first MTM for day data
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
