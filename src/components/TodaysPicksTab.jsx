import React, { useEffect, useState, useCallback } from 'react';
import {
  Sun, CheckCircle2, XCircle, AlertTriangle, Activity, Play,
  RefreshCw, Power, Zap, Calendar, Settings,
} from 'lucide-react';

/**
 * Today's Picks tab — single-pane view of:
 *   - Today's curated picks (auto-tracked vs blocked, with reasons)
 *   - Scheduler status & job toggles
 *   - Killswitch state + reset
 *   - Recent scheduler runs
 *
 * This is the main "set it and forget it" view.
 */
export default function TodaysPicksTab() {
  const [picks, setPicks]       = useState([]);
  const [scheduler, setSched]   = useState(null);
  const [logs, setLogs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [busyJob, setBusyJob]   = useState(null);
  const [error, setError]       = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [picksRes, statusRes, logsRes] = await Promise.all([
        fetch('/api/picks/today').then(r => r.json()),
        fetch('/api/scheduler/status').then(r => r.json()),
        fetch('/api/scheduler/log?limit=20').then(r => r.json()),
      ]);
      setPicks(picksRes.picks || []);
      setSched(statusRes);
      setLogs(logsRes.runs || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
    const i = setInterval(loadAll, 30000);
    return () => clearInterval(i);
  }, [loadAll]);

  const runJob = async (id) => {
    setBusyJob(id);
    try {
      await fetch(`/api/scheduler/jobs/${id}/run`, { method: 'POST' }).then(r => r.json());
      await loadAll();
    } catch (e) { setError(e.message); }
    setBusyJob(null);
  };

  const toggleJob = async (id, currentlyEnabled) => {
    try {
      await fetch(`/api/scheduler/jobs/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      await loadAll();
    } catch (e) { setError(e.message); }
  };

  const resetKillswitch = async () => {
    try {
      await fetch('/api/scheduler/killswitch/reset', { method: 'POST' });
      await loadAll();
    } catch (e) { setError(e.message); }
  };

  if (loading) {
    return <div>{[1, 2, 3].map(i => <div key={i} className="loading-skeleton skeleton-card" />)}</div>;
  }

  const tracked = picks.filter(p => p.auto_tracked === 1);
  const blocked = picks.filter(p => p.blocked_reason);
  const killswitchTripped = scheduler?.settings?.['killswitch:tripped_at'];

  return (
    <div className="todays-picks-tab">
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#fca5a5' }}>
          ⚠ {error}
        </div>
      )}

      {killswitchTripped && (
        <div className="card" style={{ marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)' }}>
          <div className="card-header">
            <div className="card-title" style={{ color: '#fca5a5' }}>
              <AlertTriangle size={16} className="inline-icon" /> Killswitch Tripped
            </div>
          </div>
          <div style={{ fontSize: '0.85rem', marginBottom: 10 }}>
            <strong>Reason:</strong> {scheduler?.settings?.['killswitch:reason'] || 'unknown'}<br/>
            <strong>Tripped at:</strong> {killswitchTripped}
          </div>
          <button className="btn-secondary" onClick={resetKillswitch}>
            <Power size={14} /> Reset Killswitch & Re-enable Pre-Market Tracking
          </button>
        </div>
      )}

      {/* Today's picks summary */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">
            <Sun size={16} className="inline-icon" /> Today's Picks — {new Date().toISOString().slice(0, 10)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
            <span style={{ color: 'var(--profit)' }}>{tracked.length} tracked</span>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <span style={{ color: 'var(--warning)' }}>{blocked.length} blocked</span>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <button
              className="btn-secondary"
              onClick={() => runJob('pre-market')}
              disabled={busyJob === 'pre-market'}
              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
            >
              {busyJob === 'pre-market' ? <span className="spinner"/> : <Play size={12}/>} Run Pre-Market Now
            </button>
          </div>
        </div>

        {picks.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-icon"><Sun size={36} className="text-muted" strokeWidth={1}/></div>
            <div className="empty-title">No picks yet for today</div>
            <div className="empty-text">
              The pre-market job runs at 09:00 IST on weekdays. Click "Run Pre-Market Now"
              to trigger it manually.
            </div>
          </div>
        ) : (
          <div className="portfolio-table-wrapper">
            <table className="portfolio-table">
              <thead>
                <tr>{['', 'Stock', 'Setup', 'Conf', 'Entry', 'Stop', 'Target', 'R:R', 'Status'].map(h => <th key={h} className="portfolio-th">{h}</th>)}</tr>
              </thead>
              <tbody>
                {picks.map(p => (
                  <tr key={p.id} className="portfolio-row">
                    <td className="portfolio-td" style={{ width: 24 }}>
                      {p.auto_tracked === 1
                        ? <CheckCircle2 size={16} style={{ color: 'var(--profit)' }} />
                        : <XCircle size={16} style={{ color: 'var(--warning)' }} />}
                    </td>
                    <td className="portfolio-td" style={{ fontWeight: 600 }}>
                      {p.symbol}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{p.sector}</span>
                    </td>
                    <td className="portfolio-td" style={{ fontSize: '0.78rem' }}>
                      {p.setup_type || '—'}
                      {p.earnings_flag === 'blackout' && (
                        <span style={{ marginLeft: 6, padding: '1px 6px', background: 'rgba(239,68,68,0.2)', color: '#fca5a5', borderRadius: 3, fontSize: '0.65rem', fontWeight: 600 }}>
                          🚨 EARNINGS
                        </span>
                      )}
                    </td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>{p.confidence}</td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>₹{p.entry_price}</td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: 'var(--loss)' }}>₹{p.stop_loss}</td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', color: 'var(--profit)' }}>₹{p.target_price}</td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)' }}>1:{p.rr}</td>
                    <td className="portfolio-td">
                      {p.blocked_reason
                        ? <span style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>⚠ {p.blocked_reason}</span>
                        : p.auto_tracked === 1
                          ? <span style={{ fontSize: '0.7rem', color: 'var(--profit)', fontWeight: 600 }}>✓ tracked</span>
                          : <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>candidate</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Scheduler / Automation panel */}
      {scheduler && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">
            <div className="card-title"><Settings size={16} className="inline-icon" /> Background Workers</div>
            <div style={{ fontSize: '0.75rem', color: scheduler.running ? 'var(--profit)' : 'var(--warning)' }}>
              {scheduler.running ? '● running' : '○ stopped'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            {(scheduler.jobs || []).map(j => (
              <div key={j.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                background: 'rgba(148,163,184,0.04)', borderRadius: 6,
                opacity: j.enabled ? 1 : 0.55,
              }}>
                <button
                  onClick={() => toggleJob(j.id, j.enabled)}
                  title={j.enabled ? 'Disable this worker' : 'Enable this worker'}
                  style={{
                    background: j.enabled ? 'var(--profit)' : 'var(--text-muted)',
                    width: 36, height: 18, borderRadius: 9, border: 0,
                    position: 'relative', cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2, left: j.enabled ? 20 : 2,
                    width: 14, height: 14, borderRadius: 7, background: '#fff',
                    transition: 'left 0.15s',
                  }} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span>{j.id}</span>
                    <code style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'rgba(148,163,184,0.1)', padding: '1px 5px', borderRadius: 3 }}>{j.cron}</code>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{j.description}</div>
                  {j.lastRun && (
                    <div style={{ fontSize: '0.7rem', color: j.lastRun.status === 'ok' ? 'var(--profit)' : 'var(--loss)', marginTop: 2 }}>
                      Last run: {j.lastRun.message} ({j.lastRun.startedAt?.slice(11, 19)})
                    </div>
                  )}
                </div>
                <button
                  className="btn-secondary"
                  onClick={() => runJob(j.id)}
                  disabled={busyJob === j.id || !j.enabled}
                  style={{ padding: '4px 10px', fontSize: '0.7rem', flexShrink: 0 }}
                >
                  {busyJob === j.id ? <span className="spinner"/> : <Play size={11}/>} Run
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent log */}
      {logs.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Activity size={16} className="inline-icon" /> Recent Worker Activity</div>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {logs.map(l => (
              <div key={l.id} style={{
                display: 'flex', gap: 12, padding: '6px 10px',
                borderBottom: '1px solid var(--border-subtle)',
                fontSize: '0.78rem',
              }}>
                <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 110 }}>
                  {(l.started_at || '').slice(11, 19)}
                </span>
                <span style={{ minWidth: 130, fontWeight: 600 }}>{l.job_id}</span>
                <span style={{
                  padding: '0 7px', borderRadius: 3, fontSize: '0.65rem', fontWeight: 600,
                  background: l.status === 'ok' ? 'rgba(34,197,94,0.15)' : l.status === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(56,189,248,0.15)',
                  color:      l.status === 'ok' ? '#86efac' : l.status === 'error' ? '#fca5a5' : '#7dd3fc',
                  textTransform: 'uppercase', alignSelf: 'center',
                }}>
                  {l.status}
                </span>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{l.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
