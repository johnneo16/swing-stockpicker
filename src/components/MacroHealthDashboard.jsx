import React, { useEffect, useState } from 'react';
import {
  Activity, Database, Cpu, Clock, Shield, AlertTriangle,
  CheckCircle2, XCircle, Server, Calendar,
} from 'lucide-react';

/**
 * Macro Health Dashboard
 *
 * Single-pane operations view for the SwingPro platform. Polls
 * /api/health/macro every 30s and renders:
 *   - Server: uptime, memory, node version
 *   - Database: file size, table count
 *   - Market: NSE open, holiday status, next trading day
 *   - Scheduler: per-job last-run + cron + enabled
 *   - Killswitch: tripped / clear
 *   - Providers: Angel One configured?
 *   - Counts: open positions, closed trades, picks today, etc.
 *
 * Intended to live under a "System" or "Ops" tab. Read-only.
 */
export default function MacroHealthDashboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('/api/health/macro').then(r => r.json());
        if (cancelled) return;
        if (!r.ok) throw new Error(r.error || 'health check failed');
        setData(r);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const i = setInterval(load, 30 * 1000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  if (loading) {
    return <div className="loading-skeleton skeleton-card" style={{ minHeight: 320 }} />;
  }
  if (error) {
    return (
      <div className="card">
        <div className="empty-state" style={{ padding: 24, color: 'var(--loss)' }}>
          ⚠ {error}
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { server, database, market, scheduler, killswitch, providers, counts, portfolioRisk } = data;
  const uptimeStr = humanUptime(server.uptimeSec);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top: status strip */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Activity size={16} className="inline-icon" /> Platform Health
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Refreshed {new Date(data.generatedAt).toLocaleTimeString()}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          <Stat icon={<Clock size={14} />} label="Uptime" value={uptimeStr} />
          <Stat icon={<Cpu size={14} />} label="Heap" value={`${server.memory.heapUsedMb} MB`} sub={`/ ${server.memory.heapTotalMb} MB`} />
          <Stat icon={<Server size={14} />} label="RSS" value={`${server.memory.rssMb} MB`} sub={server.nodeVersion} />
          <Stat icon={<Database size={14} />} label="DB Size" value={`${database.sizeMb} MB`} sub={`${database.tableCount} tables`} />
          <Stat
            icon={market.nseOpen ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            label="NSE"
            value={market.nseOpen ? 'OPEN' : 'CLOSED'}
            tone={market.nseOpen ? 'profit' : 'muted'}
            sub={market.holiday ? `Holiday: ${market.holiday}` : market.weekend ? 'Weekend' : 'Trading day'}
          />
          <Stat
            icon={killswitch.tripped ? <AlertTriangle size={14} /> : <Shield size={14} />}
            label="Killswitch"
            value={killswitch.tripped ? 'TRIPPED' : 'OK'}
            tone={killswitch.tripped ? 'loss' : 'profit'}
            sub={killswitch.tripped ? killswitch.reason : 'Clear'}
          />
        </div>
      </div>

      {/* Portfolio risk (correlation + VaR) — Varsity Risk-Mgmt ch.3-5, ch.10 */}
      {portfolioRisk && !portfolioRisk.error && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Shield size={16} className="inline-icon" /> Portfolio Risk
              {portfolioRisk.flags?.length > 0 && (
                <span style={{
                  fontSize: '0.65rem', padding: '2px 8px', borderRadius: 4,
                  background: 'rgba(239,68,68,0.15)', color: 'var(--loss)',
                  fontWeight: 700, marginLeft: 6,
                }}>⚠ {portfolioRisk.flags.length} flag{portfolioRisk.flags.length === 1 ? '' : 's'}</span>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 12 }}>
            <Stat
              label="95% 1-day VaR"
              value={`${portfolioRisk.var95.varPct}%`}
              sub={`≈ ₹${portfolioRisk.var95.varRupees.toLocaleString('en-IN')}`}
              tone={portfolioRisk.var95.varPct > 4 ? 'loss' : portfolioRisk.var95.varPct > 2.5 ? 'muted' : 'profit'}
            />
            <Stat
              label="Highest Pair Corr"
              value={portfolioRisk.correlation.maxPair
                ? portfolioRisk.correlation.maxPair.corr.toFixed(2)
                : '—'}
              sub={portfolioRisk.correlation.maxPair
                ? `${portfolioRisk.correlation.maxPair.a} ↔ ${portfolioRisk.correlation.maxPair.b}`
                : 'no pairs'}
              tone={portfolioRisk.correlation.maxPair?.corr > 0.75 ? 'loss' :
                    portfolioRisk.correlation.maxPair?.corr > 0.5  ? 'muted' : 'profit'}
            />
            <Stat
              label="Positions Analysed"
              value={portfolioRisk.correlation.symbols.length}
              sub={`${portfolioRisk.var95.samples}d sample`}
            />
          </div>
          {portfolioRisk.flags?.length > 0 && (
            <div style={{
              padding: '8px 12px', borderRadius: 6,
              background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid var(--loss)',
              fontSize: '0.8rem',
            }}>
              {portfolioRisk.flags.map((f, i) => (
                <div key={i} style={{ color: 'var(--loss)' }}>⚠ {f}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Data counts */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Calendar size={16} className="inline-icon" /> Data Activity
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
          <Stat label="Picks Today" value={counts.picksToday} />
          <Stat label="Open Positions" value={counts.openPositions} />
          <Stat label="Closed Trades" value={counts.closedTrades} />
          <Stat label="Reflections" value={counts.reflections} sub="auto-generated" />
          <Stat label="Backtests" value={counts.backtests} />
          <Stat label="Cron Runs (24h)" value={counts.schedulerRuns24h} />
        </div>
      </div>

      {/* Scheduler jobs */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <Clock size={16} className="inline-icon" />
            Scheduler — {scheduler.jobCount} jobs · {scheduler.running ? 'running' : 'stopped'}
          </div>
        </div>
        <div className="portfolio-table-wrapper">
          <table className="portfolio-table">
            <thead>
              <tr>
                {['Job', 'Cron', 'Enabled', 'Last Run', 'Status'].map(h => (
                  <th key={h} className="portfolio-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scheduler.jobs.map(j => {
                const lr = j.lastRun;
                const statusColor = !lr ? 'var(--text-muted)'
                  : lr.status === 'ok' || lr.status === 'success' ? 'var(--profit)'
                  : 'var(--loss)';
                return (
                  <tr key={j.id} className="portfolio-row">
                    <td className="portfolio-td" style={{ fontWeight: 600 }}>{j.id}</td>
                    <td className="portfolio-td" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{j.cron}</td>
                    <td className="portfolio-td">
                      <span style={{
                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: 4,
                        background: j.enabled ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)',
                        color: j.enabled ? 'var(--profit)' : 'var(--text-muted)', fontWeight: 600,
                      }}>{j.enabled ? 'ON' : 'OFF'}</span>
                    </td>
                    <td className="portfolio-td" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {lr ? new Date(lr.startedAt).toLocaleString() : '—'}
                    </td>
                    <td className="portfolio-td" style={{ fontSize: '0.78rem', color: statusColor }}>
                      {lr ? (lr.message || lr.status) : 'never'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Providers */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Providers</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <ProviderChip
            name="Angel One"
            ok={providers.angelOneConfigured}
            okLabel="Configured"
            failLabel="Not configured"
          />
          <ProviderChip name="Yahoo Finance" ok={true} okLabel="Fallback ready" />
        </div>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, sub, tone }) {
  const valColor =
    tone === 'profit' ? 'var(--profit)' :
    tone === 'loss'   ? 'var(--loss)' :
    tone === 'muted'  ? 'var(--text-muted)' : 'inherit';
  return (
    <div>
      <div style={{
        fontSize: '0.68rem', color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        {icon} {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '1.05rem',
        fontWeight: 600, color: valColor,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ProviderChip({ name, ok, okLabel, failLabel }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', borderRadius: 6,
      background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
    }}>
      {ok ? <CheckCircle2 size={14} style={{ color: 'var(--profit)' }} />
          : <XCircle      size={14} style={{ color: 'var(--loss)' }} />}
      <strong style={{ fontSize: '0.82rem' }}>{name}</strong>
      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
        — {ok ? okLabel : (failLabel || 'unavailable')}
      </span>
    </div>
  );
}

function humanUptime(sec) {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d ${h}h`;
}
