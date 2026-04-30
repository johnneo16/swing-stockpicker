import React, { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, RefreshCw, ArrowUpRight, ArrowDownRight, Target, Shield, Clock,
  CheckCircle2, AlertTriangle, Activity, ExternalLink, PlayCircle,
} from 'lucide-react';

const API = (path) => path; // same-origin

/**
 * Live (paper-trading) positions tab.
 * Lists open positions from /api/positions with mark-to-market P&L,
 * lets the user refresh prices + run the exit cycle.
 */
export default function LivePositionsTab({ capital = 50000 }) {
  const [positions, setPositions] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [history, setHistory]     = useState([]);
  const [stats, setStats]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exiting, setExiting]     = useState(false);
  const [actionLog, setActionLog] = useState([]);
  const [error, setError]         = useState(null);

  const loadAll = useCallback(async () => {
    try {
      setError(null);
      const [posRes, portRes, histRes, statsRes] = await Promise.all([
        fetch(API('/api/positions?mode=paper')).then(r => r.json()),
        fetch(API(`/api/portfolio/live?mode=paper&capital=${capital}`)).then(r => r.json()),
        fetch(API('/api/trades/history?mode=paper&limit=20')).then(r => r.json()),
        fetch(API('/api/journal/stats?mode=paper')).then(r => r.json()),
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
      const port = await fetch(API(`/api/portfolio/live?mode=paper&capital=${capital}`)).then(r => r.json());
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
                <tr>{['Stock', 'Entry', 'Exit', 'P&L', '%', 'Days', 'Reason'].map(h => <th key={h} className="portfolio-th">{h}</th>)}</tr>
              </thead>
              <tbody>
                {history.map(t => (
                  <tr key={t.id} className="portfolio-row">
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
                ))}
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

function actionTypeColor(type) {
  switch (type) {
    case 'close':         return 'rgba(239,68,68,0.85)';
    case 'partial_exit':  return 'rgba(34,197,94,0.85)';
    case 'move_stop':     return 'rgba(56,189,248,0.85)';
    default:              return 'rgba(148,163,184,0.85)';
  }
}
