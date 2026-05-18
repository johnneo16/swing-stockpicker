import React, { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, RefreshCw, ArrowUpRight, ArrowDownRight, Target, Shield, Clock,
  CheckCircle2, AlertTriangle, Activity, ExternalLink, PlayCircle,
  ChevronDown, ChevronRight, Brain, ThumbsUp, ThumbsDown, Lightbulb,
} from 'lucide-react';

const EquityCurveChart         = React.lazy(() => import('./EquityCurveChart.jsx'));
const PredictedVsActualWidget  = React.lazy(() => import('./PredictedVsActualWidget.jsx'));
const SetupPerformanceBreakdown = React.lazy(() => import('./SetupPerformanceBreakdown.jsx'));

const API = (path) => path; // same-origin

/**
 * Live (paper-trading) positions tab.
 * Lists open positions from /api/positions with mark-to-market P&L,
 * lets the user refresh prices + run the exit cycle.
 */
export default function LivePositionsTab({ capital = 50000, activeClass = 'stocks' }) {
  // Map UI scanMode → DB asset_class
  const ac = activeClass === 'etf' ? 'etf' : 'stock';
  const [positions, setPositions] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [history, setHistory]     = useState([]);
  const [stats, setStats]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exiting, setExiting]     = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const [error, setError]         = useState(null);
  const [expandedTradeId, setExpandedTradeId] = useState(null);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [posRes, portRes, histRes, statsRes] = await Promise.all([
        fetch(API(`/api/positions?mode=paper&assetClass=${ac}`)).then(r => r.json()),
        fetch(API(`/api/portfolio/live?mode=paper&assetClass=${ac}&capital=${capital}`)).then(r => r.json()),
        fetch(API(`/api/trades/history?mode=paper&assetClass=${ac}&limit=20`)).then(r => r.json()),
        fetch(API(`/api/journal/stats?mode=paper`)).then(r => r.json()),
      ]);
      setPositions(posRes.positions || []);
      setPortfolio(portRes);
      setHistory(histRes.trades || []);
      setStats(statsRes);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [capital]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refreshPrices = async () => {
    setRefreshing(true);
    try {
      const r = await fetch(API('/api/positions/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'paper' }),
      }).then(r => r.json());
      setPositions(r.positions || []);
      // Refresh portfolio summary too
      const port = await fetch(API(`/api/portfolio/live?mode=paper&assetClass=${ac}&capital=${capital}`)).then(r => r.json());
      setPortfolio(port);
    } catch (e) { setError(e.message); }
    setRefreshing(false);
  };

  const runExitCycle = async () => {
    setExiting(true);
    try {
      const r = await fetch(API('/api/positions/exit-cycle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'paper' }),
      }).then(r => r.json());
      setActionLog(r.actions || []);
      await loadAll();
    } catch (e) { setError(e.message); }
    setExiting(false);
  };

  if (loading) {
    return (
      <div>{[1, 2, 3].map(i => <div key={i} className="loading-skeleton skeleton-card" />)}</div>
    );
  }

  return (
    <div className="live-positions-tab">
      {error && (
        <div className="alert-banner" style={{ background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#fca5a5', fontSize: '0.85rem' }}>
          ⚠ {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="positions-toolbar" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn-secondary" onClick={refreshPrices} disabled={refreshing}>
          {refreshing ? <span className="spinner" /> : <RefreshCw size={14} />} Mark to Market
        </button>
        <button className="btn-secondary" onClick={runExitCycle} disabled={exiting || positions.length === 0}>
          {exiting ? <span className="spinner" /> : <PlayCircle size={14} />} Run Exit Cycle
        </button>
        <span style={{ flex: 1 }} />
        {actionLog.length > 0 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--accent-cyan)' }}>
            ✓ Last cycle: {actionLog.length} action{actionLog.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Equity Curve + Predicted-vs-Actual — side-by-side analytics row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16, marginBottom: 16 }}>
        <React.Suspense fallback={<div className="loading-skeleton skeleton-card" style={{ minHeight: 280 }} />}>
          <EquityCurveChart assetClass={ac} />
        </React.Suspense>
        <React.Suspense fallback={<div className="loading-skeleton skeleton-card" style={{ minHeight: 280 }} />}>
          <PredictedVsActualWidget assetClass={ac} />
        </React.Suspense>
      </div>

      {/* Setup Performance — third analytics card, full-width below */}
      <div style={{ marginBottom: 16 }}>
        <React.Suspense fallback={<div className="loading-skeleton skeleton-card" style={{ minHeight: 280 }} />}>
          <SetupPerformanceBreakdown assetClass={ac} />
        </React.Suspense>
      </div>

      {/* Portfolio summary card */}
      {portfolio && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title">
              <Briefcase size={16} className="inline-icon" /> Paper Portfolio
            </div>
          </div>
          <div className="portfolio-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, padding: '0 4px' }}>
            <Stat label="Capital" value={`₹${(portfolio.totalCapital || 0).toLocaleString('en-IN')}`} />
            <Stat label="Deployed" value={`₹${(portfolio.capitalDeployed || 0).toLocaleString('en-IN')}`} sub={`${portfolio.deploymentPct || 0}%`} />
            <Stat label="Cash Free" value={`₹${(portfolio.cashRemaining || 0).toLocaleString('en-IN')}`} />
            <Stat
              label="Unrealized P&L"
              value={`₹${(portfolio.unrealizedPnl || 0).toLocaleString('en-IN')}`}
              tone={(portfolio.unrealizedPnl || 0) >= 0 ? 'profit' : 'loss'}
              sub={`${(portfolio.unrealizedPct || 0)}%`}
            />
            <Stat label="Open Risk" value={`₹${(portfolio.openRisk || 0).toLocaleString('en-IN')}`} sub={`${portfolio.initialRiskPct || 0}% R`} />
            <Stat label="Active" value={`${portfolio.activePositions || 0}`} sub="positions" />
          </div>
          {portfolio.overconcentratedSector && (
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: 6, fontSize: '0.8rem', color: 'var(--warning)' }}>
              ⚠ Sector overconcentration: {portfolio.overconcentratedSector} ({portfolio.maxSectorCount} positions)
            </div>
          )}
        </div>
      )}

      {/* Realized P&L stats — only shown after >=1 closed trade */}
      {stats && stats.totalTrades > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title"><Activity size={16} className="inline-icon" /> Journal — Realized Performance</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{stats.totalTrades} closed trade{stats.totalTrades === 1 ? '' : 's'} · {stats.openTrades} open</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
            <Stat label="Win Rate" value={`${Math.round(stats.winRate * 100)}%`} sub={`${stats.wins}W / ${stats.losses}L`} tone={stats.winRate >= 0.5 ? 'profit' : ''} />
            <Stat label="Avg Win" value={`+${stats.avgWinPct}%`} tone="profit" />
            <Stat label="Avg Loss" value={`${stats.avgLossPct}%`} tone="loss" />
            <Stat label="Expectancy" value={`${stats.expectancyPct >= 0 ? '+' : ''}${stats.expectancyPct}%`} tone={stats.expectancyPct >= 0 ? 'profit' : 'loss'} sub="per trade" />
            <Stat label="Profit Factor" value={stats.profitFactor ?? '—'} tone={(stats.profitFactor || 0) >= 1.5 ? 'profit' : ''} />
            <Stat label="Realized P&L" value={`₹${(stats.totalPnl || 0).toLocaleString('en-IN')}`} tone={stats.totalPnl >= 0 ? 'profit' : 'loss'} />
            <Stat label="Max Drawdown" value={`-${stats.maxDrawdownPct}%`} tone="loss" />
            <Stat label="Avg Hold" value={`${stats.avgHoldingDays}d`} />
          </div>
          {/* System-grade metrics (Varsity Trading Systems + Risk Mgmt) */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
              System-Grade Metrics
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 14 }}>
              <Stat label="Sharpe" value={stats.sharpe ?? '—'} sub="risk-adj. return" tone={(stats.sharpe || 0) > 1 ? 'profit' : (stats.sharpe || 0) < 0 ? 'loss' : ''} />
              <Stat label="Sortino" value={stats.sortino ?? '—'} sub="downside-adj." tone={(stats.sortino || 0) > 1.5 ? 'profit' : (stats.sortino || 0) < 0 ? 'loss' : ''} />
              <Stat label="SQN" value={stats.sqn ?? '—'} sub={sqnGrade(stats.sqn)} tone={(stats.sqn || 0) > 2.5 ? 'profit' : (stats.sqn || 0) < 1 ? 'loss' : ''} />
              <Stat label="MAR" value={stats.mar ?? '—'} sub="return / maxDD" tone={(stats.mar || 0) > 0.5 ? 'profit' : (stats.mar || 0) < 0 ? 'loss' : ''} />
              <Stat label="Total Return" value={`${stats.totalReturnPct >= 0 ? '+' : ''}${stats.totalReturnPct}%`} tone={stats.totalReturnPct >= 0 ? 'profit' : 'loss'} />
            </div>
          </div>
          {/* System decay alarm */}
          {stats.decay && (stats.decay.status === 'decay_warning' || stats.decay.status === 'severe_decay') && (
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 6,
              background: stats.decay.status === 'severe_decay' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
              borderLeft: `3px solid ${stats.decay.status === 'severe_decay' ? 'var(--loss)' : 'var(--warning)'}`,
              fontSize: '0.82rem', lineHeight: 1.5,
            }}>
              <strong style={{ color: stats.decay.status === 'severe_decay' ? 'var(--loss)' : 'var(--warning)' }}>
                ⚠ System {stats.decay.status === 'severe_decay' ? 'decay (severe)' : 'decay warning'}:
              </strong>{' '}
              Last {stats.decay.recentN} trades' expectancy {stats.decay.recentExpectancyPct}% is{' '}
              {Math.abs(stats.decay.driftSigma)}σ below the baseline {stats.decay.baselineExpectancyPct}%.{' '}
              Consider re-backtesting + tightening entry filters before opening new positions.
            </div>
          )}
        </div>
      )}

      {/* Action log from last exit cycle */}
      {actionLog.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title"><Activity size={16} className="inline-icon" /> Last Exit Cycle</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actionLog.map((a, i) => (
              <div key={i} style={{ fontSize: '0.82rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 600, minWidth: 80 }}>{a.symbol}</span>
                <span style={{ padding: '2px 8px', borderRadius: 4, background: actionTypeColor(a.type), color: '#fff', fontSize: '0.7rem', fontWeight: 600 }}>
                  {a.type}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{a.reason}</span>
                {a.exitPrice && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>₹{a.exitPrice}</span>}
                {a.newStop && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>→ stop ₹{a.newStop}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positions table */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><Target size={16} className="inline-icon" /> Open Positions</div>
        </div>
        {positions.length > 0 ? (
          <div className="portfolio-table-wrapper">
            <table className="portfolio-table">
              <thead>
                <tr>{['Stock', 'CMP', 'P&L', 'R', 'Stop', 'Target', 'Held', 'Flags'].map(h => <th key={h} className="portfolio-th">{h}</th>)}</tr>
              </thead>
              <tbody>
                {positions.map(p => (
                  <tr key={p.id} className="portfolio-row">
                    <td className="portfolio-td" style={{ fontWeight: 600 }}>
                      {p.symbol}
                      <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{p.setupType}</span>
                    </td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>₹{(p.lastPrice || 0).toLocaleString('en-IN')}</td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: p.unrealizedPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                      ₹{p.unrealizedPnl?.toLocaleString('en-IN')}
                      <span style={{ display: 'block', fontSize: '0.7rem' }}>{p.unrealizedPct >= 0 ? '+' : ''}{p.unrealizedPct}%</span>
                    </td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>{p.rMultiple != null ? `${p.rMultiple}R` : '—'}</td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>₹{p.currentStop}</td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>₹{p.target}</td>
                    <td className="portfolio-td">{p.heldDays}d {p.estimatedDays && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>/ {p.estimatedDays}d</span>}</td>
                    <td className="portfolio-td">
                      {p.beMoved      && <span title="Stop at break-even" style={{ marginRight: 4 }}>🔵</span>}
                      {p.partialTaken && <span title="Partial exit booked" style={{ marginRight: 4 }}>½</span>}
                      {p.trailActive  && <span title="Trailing stop active" style={{ marginRight: 4 }}>📈</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <div className="empty-icon"><Briefcase size={36} className="text-muted" strokeWidth={1}/></div>
            <div className="empty-title">No open positions</div>
            <div className="empty-text">Open a paper trade by clicking a TradeCard's setup → "Open Position" (coming soon) or POST /api/positions/open from a scan result.</div>
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Clock size={16} className="inline-icon" /> Recent Closed Trades</div>
          </div>
          <div className="portfolio-table-wrapper">
            <table className="portfolio-table">
              <thead>
                <tr>{['', 'Stock', 'Entry', 'Exit', 'P&L', '%', 'Days', 'Reason'].map((h, i) => <th key={i} className="portfolio-th">{h}</th>)}</tr>
              </thead>
              <tbody>
                {history.map(t => {
                  const isExpanded = expandedTradeId === t.id;
                  const hasReflection = !!t.reflection_json;
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        className="portfolio-row"
                        style={{ cursor: hasReflection ? 'pointer' : 'default' }}
                        onClick={() => hasReflection && setExpandedTradeId(isExpanded ? null : t.id)}
                      >
                        <td className="portfolio-td" style={{ width: 24, color: 'var(--text-muted)' }}>
                          {hasReflection ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                        </td>
                        <td className="portfolio-td" style={{ fontWeight: 600 }}>
                          {t.symbol}
                          <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t.setup_type}</span>
                        </td>
                        <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>₹{t.entry_price}</td>
                        <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>₹{t.exit_price}</td>
                        <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: t.realized_pnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                          ₹{(t.realized_pnl || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: t.realized_pct >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                          {t.realized_pct >= 0 ? '+' : ''}{t.realized_pct}%
                        </td>
                        <td className="portfolio-td">{t.holding_days}d</td>
                        <td className="portfolio-td">
                          <span className={`exit-reason exit-${t.exit_reason}`} style={{ fontSize: '0.7rem' }}>{t.exit_reason}</span>
                        </td>
                      </tr>
                      {isExpanded && hasReflection && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, background: 'rgba(148,163,184,0.04)' }}>
                            <ReflectionPanel reflectionJson={t.reflection_json} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontWeight: 600, color: tone === 'profit' ? 'var(--profit)' : tone === 'loss' ? 'var(--loss)' : 'inherit' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function sqnGrade(sqn) {
  // Van Tharp's SQN grading bands
  if (sqn == null) return '—';
  if (sqn > 7)   return 'holy grail';
  if (sqn > 5)   return 'superb';
  if (sqn > 3)   return 'excellent';
  if (sqn > 2.5) return 'good';
  if (sqn > 1.6) return 'average';
  if (sqn > 1)   return 'below avg';
  return 'broken';
}

function ReflectionPanel({ reflectionJson }) {
  let r;
  try { r = typeof reflectionJson === 'string' ? JSON.parse(reflectionJson) : reflectionJson; }
  catch (_) { return <div style={{ padding: 12, fontSize: '0.78rem', color: 'var(--text-muted)' }}>Could not parse reflection.</div>; }
  if (!r) return null;

  const rating = r.setupRating ?? 5;
  const ratingColor = rating >= 7 ? 'var(--profit)' : rating >= 4 ? 'var(--warning)' : 'var(--loss)';

  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--text-muted)' }}>
          <Brain size={13} /> Reflection
        </div>
        <span style={{
          fontSize: '0.72rem', padding: '2px 8px', borderRadius: 4,
          background: 'rgba(148,163,184,0.12)', color: ratingColor, fontWeight: 700,
          fontFamily: 'var(--font-mono)',
        }}>
          Setup {rating}/10
        </span>
        {r.rMultiple != null && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {r.rMultiple >= 0 ? '+' : ''}{r.rMultiple}R {r.targetR != null && <>/ target {r.targetR}R</>}
          </span>
        )}
        <span style={{
          fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4,
          background: r.wouldRetake ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          color: r.wouldRetake ? 'var(--profit)' : 'var(--loss)', fontWeight: 600,
        }}>
          {r.wouldRetake ? '↻ Would retake' : '⌀ Would skip'}
        </span>
        {Array.isArray(r.tags) && r.tags.length > 0 && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {r.tags.map(tag => (
              <span key={tag} style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 3, background: 'rgba(56,189,248,0.1)', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>{tag}</span>
            ))}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <ReflectionBlock icon={<ThumbsUp size={12} />} label="What worked" text={r.whatWorked} color="var(--profit)" />
        <ReflectionBlock icon={<ThumbsDown size={12} />} label="What didn't" text={r.whatDidntWork} color="var(--loss)" />
      </div>

      {r.lesson && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-start',
          padding: '10px 12px', borderRadius: 6,
          background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid var(--warning)',
        }}>
          <Lightbulb size={14} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.45 }}>
            <strong style={{ color: 'var(--warning)', marginRight: 6 }}>Lesson:</strong>{r.lesson}
          </div>
        </div>
      )}
    </div>
  );
}

function ReflectionBlock({ icon, label, text, color }) {
  return (
    <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 0.6, color, marginBottom: 4, fontWeight: 600 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {text || '—'}
      </div>
    </div>
  );
}

function actionTypeColor(type) {
  switch (type) {
    case 'close':         return 'rgba(239,68,68,0.85)';
    case 'partial_exit':  return 'rgba(34,197,94,0.85)';
    case 'move_stop':     return 'rgba(56,189,248,0.85)';
    default:              return 'rgba(148,163,184,0.85)';
  }
}
