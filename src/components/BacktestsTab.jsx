import React, { useEffect, useState, useCallback } from 'react';
import { TestTube2, TrendingUp, TrendingDown, Award, Clock, Target as TargetIcon, AlertTriangle, PlayCircle, Settings } from 'lucide-react';

/**
 * Backtests tab — list runs, drill into one to see metrics + trade log.
 */
export default function BacktestsTab() {
  const [runs, setRuns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showRunner, setShowRunner] = useState(false);
  const [runnerStatus, setRunnerStatus] = useState(null);

  const loadList = useCallback(async () => {
    try {
      const r = await fetch('/api/backtests?limit=20').then(r => r.json());
      setRuns(r.runs || []);
      if ((r.runs || []).length > 0 && !selectedId) {
        setSelectedId(r.runs[0].id);
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [selectedId]);

  useEffect(() => { loadList(); }, [loadList]);

  // Poll for in-progress backtest status when expecting one
  useEffect(() => {
    if (!runnerStatus || runnerStatus.state !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const s = await fetch('/api/backtests/status').then(r => r.json());
        if (!s.inProgress) {
          // Backtest finished — refresh list
          setRunnerStatus({ state: 'done', runId: runnerStatus.runId });
          await loadList();
          if (runnerStatus.runId) setSelectedId(runnerStatus.runId);
          setTimeout(() => setRunnerStatus(null), 4000);
        }
      } catch (_) {}
    }, 5000);
    return () => clearInterval(interval);
  }, [runnerStatus, loadList]);

  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/backtests/${selectedId}`)
      .then(r => r.json())
      .then(d => setDetail(d))
      .catch(e => setError(e.message));
  }, [selectedId]);

  if (loading) {
    return <div>{[1, 2].map(i => <div key={i} className="loading-skeleton skeleton-card" />)}</div>;
  }

  return (
    <>
      {/* Runner controls */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title"><PlayCircle size={16} className="inline-icon" /> Run New Backtest</div>
          <button
            className="btn-secondary"
            onClick={() => setShowRunner(!showRunner)}
            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          >
            <Settings size={12} /> {showRunner ? 'Hide' : 'Configure'}
          </button>
        </div>
        {runnerStatus && (
          <div style={{
            padding: '8px 12px', borderRadius: 6, marginBottom: showRunner ? 12 : 0,
            background: runnerStatus.state === 'running' ? 'rgba(56,189,248,0.10)' : 'rgba(34,197,94,0.10)',
            color: runnerStatus.state === 'running' ? '#7dd3fc' : '#86efac',
            fontSize: '0.85rem',
          }}>
            {runnerStatus.state === 'running'
              ? <><span className="spinner" /> Backtest #{runnerStatus.runId} in progress — usually takes 3–5 minutes…</>
              : <>✓ Backtest #{runnerStatus.runId} complete</>}
          </div>
        )}
        {showRunner && <BacktestRunner onSubmit={async (cfg) => {
          try {
            const r = await fetch('/api/backtests/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(cfg),
            }).then(r => r.json());
            if (r.runId) {
              setRunnerStatus({ state: 'running', runId: r.runId });
              setShowRunner(false);
              await loadList();
              setSelectedId(r.runId);
            } else if (r.error) {
              setError(r.error);
            }
          } catch (e) { setError(e.message); }
        }} />}
      </div>

      {runs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><TestTube2 size={48} className="text-muted" strokeWidth={1}/></div>
          <div className="empty-title">No backtest runs yet</div>
          <div className="empty-text">Click <strong>Configure</strong> above to run your first backtest, or use the CLI: <code>node scripts/runBacktest.js</code></div>
        </div>
      ) : (
        <BacktestsView
          runs={runs} selectedId={selectedId} setSelectedId={(id) => { setSelectedId(id); setDetail(null); }}
          detail={detail} error={error}
        />
      )}
    </>
  );
}

function BacktestsView({ runs, selectedId, setSelectedId, detail, error }) {
  return (
    <div className="backtests-tab" style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
      {/* Run list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-header" style={{ padding: '12px 16px' }}>
          <div className="card-title"><TestTube2 size={16} className="inline-icon" /> Runs ({runs.length})</div>
        </div>
        <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {runs.map(r => {
            const cfg = r.config_json ? JSON.parse(r.config_json) : {};
            const isSel = r.id === selectedId;
            return (
              <div
                key={r.id}
                onClick={() => { setSelectedId(r.id); setDetail(null); }}
                style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  background: isSel ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                  borderLeft: isSel ? '3px solid var(--accent-cyan)' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>#{r.id}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{(r.started_at || '').slice(0, 10)}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>
                  {r.start_date} → {r.end_date} · {r.universe_size}st · thr {cfg.scoreThreshold || '?'}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: '0.78rem' }}>
                  <span style={{ color: r.total_return_pct >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {r.total_return_pct >= 0 ? '+' : ''}{r.total_return_pct}%
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {r.total_trades || 0}t · {Math.round((r.win_rate || 0) * 100)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail view */}
      <div>
        {detail ? <BacktestDetail run={detail} /> : <div className="loading-skeleton skeleton-card" />}
      </div>

      {error && <div style={{ gridColumn: '1 / -1', color: 'var(--loss)' }}>⚠ {error}</div>}
    </div>
  );
}

function BacktestDetail({ run }) {
  const cfg = run.config_json ? JSON.parse(run.config_json) : {};
  const trades = run.trades || [];

  // Re-aggregate by setup type for visual breakdown
  const bySetup = {};
  for (const t of trades) {
    const k = t.setup_type || 'unknown';
    (bySetup[k] ??= { n: 0, wins: 0, totalPct: 0, totalPnl: 0 });
    bySetup[k].n++;
    if ((t.realized_pnl || 0) > 0) bySetup[k].wins++;
    bySetup[k].totalPct += t.realized_pct || 0;
    bySetup[k].totalPnl += t.realized_pnl || 0;
  }
  const setupRows = Object.entries(bySetup)
    .map(([k, v]) => ({ k, ...v, winRate: v.n ? v.wins / v.n : 0, expectancy: v.n ? v.totalPct / v.n : 0 }))
    .sort((a, b) => b.n - a.n);

  // By confidence bucket
  const byConf = { '70+': { n: 0, wins: 0, totalPct: 0 }, '60-69': { n: 0, wins: 0, totalPct: 0 }, '50-59': { n: 0, wins: 0, totalPct: 0 }, '<50': { n: 0, wins: 0, totalPct: 0 } };
  for (const t of trades) {
    const c = t.confidence;
    const k = c >= 70 ? '70+' : c >= 60 ? '60-69' : c >= 50 ? '50-59' : '<50';
    byConf[k].n++;
    if ((t.realized_pnl || 0) > 0) byConf[k].wins++;
    byConf[k].totalPct += t.realized_pct || 0;
  }

  // By exit reason
  const byExit = {};
  for (const t of trades) byExit[t.exit_reason || 'unknown'] = (byExit[t.exit_reason || 'unknown'] || 0) + 1;

  return (
    <div>
      {/* Summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">
            <Award size={16} className="inline-icon" /> Run #{run.id} — {run.start_date} → {run.end_date}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Universe: {run.universe_size} stocks · Threshold: {cfg.scoreThreshold} · Capital: ₹{(run.capital || 0).toLocaleString('en-IN')}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
          <Metric label="Total Trades" value={run.total_trades} />
          <Metric label="Win Rate" value={`${Math.round((run.win_rate || 0) * 100)}%`} sub={`${run.wins}W / ${run.losses}L`} tone={run.win_rate >= 0.5 ? 'profit' : ''} />
          <Metric label="Avg Win" value={`+${run.avg_win_pct}%`} tone="profit" />
          <Metric label="Avg Loss" value={`${run.avg_loss_pct}%`} tone="loss" />
          <Metric label="Expectancy" value={`${(run.expectancy_pct || 0) >= 0 ? '+' : ''}${run.expectancy_pct}%`} tone={(run.expectancy_pct || 0) >= 0 ? 'profit' : 'loss'} sub="per trade" />
          <Metric label="Profit Factor" value={run.profit_factor} tone={(run.profit_factor || 0) >= 1.5 ? 'profit' : ''} />
          <Metric label="Total Return" value={`${(run.total_return_pct || 0) >= 0 ? '+' : ''}${run.total_return_pct}%`} sub={`₹${(run.total_return || 0).toLocaleString('en-IN')}`} tone={(run.total_return_pct || 0) >= 0 ? 'profit' : 'loss'} />
          <Metric label="Max Drawdown" value={`-${run.max_drawdown_pct}%`} tone="loss" />
          <Metric label="Sharpe" value={run.sharpe_ratio} tone={(run.sharpe_ratio || 0) >= 1 ? 'profit' : ''} />
        </div>
      </div>

      {/* Setup breakdown */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title"><TrendingUp size={16} className="inline-icon" /> By Setup Type</div></div>
        <div className="portfolio-table-wrapper">
          <table className="portfolio-table">
            <thead><tr>{['Setup', 'Trades', 'Win Rate', 'Expectancy', 'Total P&L'].map(h => <th key={h} className="portfolio-th">{h}</th>)}</tr></thead>
            <tbody>
              {setupRows.map(r => (
                <tr key={r.k} className="portfolio-row">
                  <td className="portfolio-td" style={{ fontWeight: 600 }}>{r.k}</td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>{r.n}</td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: r.winRate >= 0.5 ? 'var(--profit)' : '' }}>
                    {Math.round(r.winRate * 100)}%
                  </td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: r.expectancy >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                    {r.expectancy >= 0 ? '+' : ''}{r.expectancy.toFixed(2)}%
                  </td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: r.totalPnl >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                    ₹{r.totalPnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confidence bucket + Exit reasons (side by side) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header"><div className="card-title"><Award size={16} className="inline-icon" /> By Confidence</div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(byConf).map(([k, v]) => v.n > 0 && (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <span style={{ fontWeight: 600, minWidth: 60 }}>{k}</span>
                <span style={{ fontFamily: 'var(--font-mono)', minWidth: 40 }}>n={v.n}</span>
                <span style={{ fontFamily: 'var(--font-mono)', minWidth: 60, color: v.wins / v.n >= 0.5 ? 'var(--profit)' : '' }}>
                  {Math.round((v.wins / v.n) * 100)}%
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', marginLeft: 'auto', color: (v.totalPct / v.n) >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                  {(v.totalPct / v.n) >= 0 ? '+' : ''}{(v.totalPct / v.n).toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title"><Clock size={16} className="inline-icon" /> Exit Reasons</div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(byExit).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                <span className={`exit-reason exit-${k}`} style={{ minWidth: 80 }}>{k}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span>
                <div style={{ marginLeft: 'auto', height: 8, width: `${(v / trades.length) * 100}%`, maxWidth: 140, background: exitColor(k), borderRadius: 4 }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Trade list */}
      <div className="card">
        <div className="card-header"><div className="card-title"><TargetIcon size={16} className="inline-icon" /> Trades ({trades.length})</div></div>
        <div className="portfolio-table-wrapper" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          <table className="portfolio-table">
            <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-elevated)', zIndex: 1 }}>
              <tr>{['Stock', 'Setup', 'Entry', 'Exit', 'Days', 'P&L %', 'R', 'Reason', 'Conf'].map(h => <th key={h} className="portfolio-th">{h}</th>)}</tr>
            </thead>
            <tbody>
              {trades.map(t => (
                <tr key={t.id} className="portfolio-row">
                  <td className="portfolio-td" style={{ fontWeight: 600 }}>{t.symbol}</td>
                  <td className="portfolio-td" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t.setup_type}</td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                    {(t.entry_date || '').slice(0, 10)}<br/>
                    <span style={{ fontSize: '0.7rem' }}>₹{t.entry_price}</span>
                  </td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                    {(t.exit_date || '').slice(0, 10)}<br/>
                    <span style={{ fontSize: '0.7rem' }}>₹{t.exit_price}</span>
                  </td>
                  <td className="portfolio-td">{t.holding_days}</td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: t.realized_pct >= 0 ? 'var(--profit)' : 'var(--loss)', fontWeight: 600 }}>
                    {t.realized_pct >= 0 ? '+' : ''}{t.realized_pct}%
                  </td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>{t.rr_realized != null ? `${t.rr_realized}R` : '—'}</td>
                  <td className="portfolio-td"><span className={`exit-reason exit-${t.exit_reason}`} style={{ fontSize: '0.7rem' }}>{t.exit_reason}</span></td>
                  <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>{t.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 600,
        color: tone === 'profit' ? 'var(--profit)' : tone === 'loss' ? 'var(--loss)' : 'inherit',
      }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function BacktestRunner({ onSubmit }) {
  const [universe,  setUniverse]  = useState('extended');
  const [startDate, setStartDate] = useState('2022-01-01');
  const [endDate,   setEndDate]   = useState('2024-12-31');
  const [threshold, setThreshold] = useState(50);
  const [capital,   setCapital]   = useState(50000);
  const [volSizing, setVolSizing] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    await onSubmit({
      universe,
      startDate, endDate,
      threshold: parseInt(threshold, 10),
      capital: parseInt(capital, 10),
      volAdjustedSizing: volSizing,
    });
    setSubmitting(false);
  };

  const Field = ({ label, children }) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</span>
      {children}
    </label>
  );

  const inputStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
    padding: '6px 10px',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-mono)',
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, alignItems: 'end' }}>
      <Field label="Universe">
        <select value={universe} onChange={e => setUniverse(e.target.value)} style={inputStyle}>
          <option value="default">Default (50)</option>
          <option value="extended">Extended (198)</option>
        </select>
      </Field>
      <Field label="Start Date">
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="End Date">
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Score Threshold">
        <input type="number" min="20" max="90" value={threshold} onChange={e => setThreshold(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Capital (₹)">
        <input type="number" min="10000" step="10000" value={capital} onChange={e => setCapital(e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Vol-Adj Sizing">
        <select value={volSizing ? 'on' : 'off'} onChange={e => setVolSizing(e.target.value === 'on')} style={inputStyle}>
          <option value="on">On (recommended)</option>
          <option value="off">Off (flat 1.5%)</option>
        </select>
      </Field>
      <button
        className="btn-secondary"
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          background: 'var(--accent-cyan)',
          color: '#000',
          fontWeight: 600,
          padding: '7px 16px',
          alignSelf: 'end',
        }}
      >
        {submitting ? <span className="spinner" /> : <PlayCircle size={14} />} Run
      </button>
    </div>
  );
}

function exitColor(reason) {
  switch (reason) {
    case 'target': case 'target_gap': return 'var(--profit)';
    case 'stop': case 'stop_gap':     return 'var(--loss)';
    case 'time':                       return '#f59e0b';
    case 'panic_loss':                return '#ef4444';
    default:                           return 'var(--text-muted)';
  }
}
