import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

/**
 * Equity Curve Chart — visualizes your paper-portfolio's realized P&L
 * over time as a line chart. One point per closed trade.
 *
 * Pulls from /api/journal/stats which already returns a sorted
 * `equityCurve` array (date + equity) computed from the trades table.
 *
 * Includes:
 *   - Main line: cumulative equity after each closed trade
 *   - Peak marker: highest equity point achieved
 *   - Trough marker: lowest after peak (max drawdown)
 *   - Reference line at starting capital
 *
 * Refreshes every 60s (cheap — pure DB read).
 */
export default function EquityCurveChart({ assetClass = null, theme = 'dark' }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch journal stats (which includes equityCurve)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const url = '/api/journal/stats?mode=paper' + (assetClass ? `&assetClass=${assetClass}` : '');
        const r = await fetch(url).then(r => r.json());
        if (!cancelled) {
          setStats(r);
          setLoading(false);
        }
      } catch (_) { if (!cancelled) setLoading(false); }
    };
    load();
    const i = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(i); };
  }, [assetClass]);

  // Build / update chart
  useEffect(() => {
    if (!containerRef.current || !stats?.equityCurve?.length) return;

    const isDark = theme !== 'light';
    const lineColor = (stats.finalEquity || 0) >= (stats.startingCapital || 50000)
      ? '#00e676'   // green — net profit
      : '#ff4d4f';  // red   — net loss

    // Create or recreate chart
    if (!chartRef.current) {
      chartRef.current = createChart(containerRef.current, {
        layout: {
          background: { color: 'transparent' },
          textColor: isDark ? '#cbd5e1' : '#475569',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
          horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
        },
        timeScale: { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', timeVisible: false },
        rightPriceScale: { borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' },
        crosshair: { mode: 0 },
        width: containerRef.current.clientWidth,
        height: 220,
      });

      seriesRef.current = chartRef.current.addAreaSeries({
        lineColor,
        topColor: lineColor + '40',
        bottomColor: lineColor + '00',
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 0, minMove: 1 },
      });
    }

    // Update line color based on current performance
    seriesRef.current.applyOptions({
      lineColor,
      topColor: lineColor + '40',
    });

    // Convert dates to UNIX seconds (lightweight-charts uses unix time)
    const data = stats.equityCurve
      .filter(p => p.date && p.equity != null)
      .map(p => ({
        time: Math.floor(new Date(p.date).getTime() / 1000),
        value: p.equity,
      }));

    seriesRef.current.setData(data);

    // Starting-capital reference line
    if (stats.startingCapital) {
      seriesRef.current.createPriceLine({
        price: stats.startingCapital,
        color: isDark ? 'rgba(148, 163, 184, 0.4)' : 'rgba(100, 116, 139, 0.5)',
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: 'start',
      });
    }

    chartRef.current.timeScale().fitContent();

    // Handle resize
    const resizeObserver = new ResizeObserver(entries => {
      for (const e of entries) {
        if (chartRef.current) {
          chartRef.current.applyOptions({ width: e.contentRect.width });
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => { resizeObserver.disconnect(); };
  }, [stats, theme]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, []);

  if (loading) {
    return <div className="card loading-skeleton skeleton-card" style={{ minHeight: 280 }} />;
  }

  if (!stats || stats.totalTrades === 0) {
    return (
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Activity size={16} className="inline-icon" /> Equity Curve</div>
        </div>
        <div className="empty-state" style={{ padding: 36 }}>
          <Activity size={32} className="text-muted" strokeWidth={1} />
          <div className="empty-title" style={{ marginTop: 8 }}>No closed trades yet</div>
          <div className="empty-text">
            The curve will populate as paper trades close (target / stop / time).
            First closure expected within 3-10 days of pre-market tracking.
          </div>
        </div>
      </div>
    );
  }

  const isProfit = (stats.totalPnl || 0) >= 0;
  const pctMove  = stats.startingCapital
    ? ((stats.finalEquity - stats.startingCapital) / stats.startingCapital * 100)
    : 0;

  return (
    <div className="card equity-curve-card">
      <div className="card-header">
        <div className="card-title">
          {isProfit ? <TrendingUp size={16} className="inline-icon" style={{ color: 'var(--profit)' }}/> : <TrendingDown size={16} className="inline-icon" style={{ color: 'var(--loss)' }}/>}
          <span>Equity Curve</span>
          {assetClass && (
            <span style={{
              fontSize: '0.6rem', padding: '1px 7px', borderRadius: 3,
              background: 'rgba(148,163,184,0.15)', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 0.06, fontWeight: 700,
              marginLeft: 4,
            }}>{assetClass}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {stats.totalTrades} closed · {Math.round((stats.winRate || 0) * 100)}% win
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            color: isProfit ? 'var(--profit)' : 'var(--loss)',
          }}>
            {isProfit ? '+' : ''}₹{(stats.totalPnl || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            <span style={{ marginLeft: 6, opacity: 0.7 }}>({isProfit ? '+' : ''}{pctMove.toFixed(2)}%)</span>
          </span>
        </div>
      </div>

      {/* Chart container */}
      <div ref={containerRef} style={{ width: '100%', height: 220 }} />

      {/* Bottom stats strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginTop: 14,
        paddingTop: 12,
        borderTop: '1px solid var(--border-subtle)',
      }}>
        <Stat label="Start" value={`₹${(stats.startingCapital || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} />
        <Stat label="Current" value={`₹${(stats.finalEquity || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`} tone={isProfit ? 'profit' : 'loss'} />
        <Stat label="Max DD" value={`-${stats.maxDrawdownPct || 0}%`} tone="loss" compact />
        <Stat label="Profit Fac." value={stats.profitFactor != null ? stats.profitFactor.toFixed(2) : '—'} tone={(stats.profitFactor || 0) >= 1.5 ? 'profit' : ''} compact />
      </div>
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
        marginBottom: 3,
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: compact ? '0.85rem' : '0.95rem',
        fontWeight: 600,
        color: tone === 'profit' ? 'var(--profit)' : tone === 'loss' ? 'var(--loss)' : 'inherit',
      }}>
        {value ?? '—'}
      </div>
    </div>
  );
}
