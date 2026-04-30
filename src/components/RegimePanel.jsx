import React, { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Zap, Shield } from 'lucide-react';

/**
 * Market regime panel — VIX / FII-DII / regime classification.
 * Sits in the dashboard sidebar between MarketOverview and AlertPanel.
 */
export default function RegimePanel() {
  const [snap, setSnap]   = useState(null);
  const [loading, setLoad] = useState(true);
  const [err, setErr]     = useState(null);

  useEffect(() => {
    fetch('/api/regime')
      .then(r => r.json())
      .then(d => { setSnap(d); setLoad(false); })
      .catch(e => { setErr(e.message); setLoad(false); });
  }, []);

  if (loading) return <div className="card loading-skeleton skeleton-sidebar" style={{ minHeight: 180 }} />;
  if (err)     return null;
  if (!snap)   return null;

  const regimeColor = regimeToColor(snap.regime);
  const regimeIcon  = regimeToIcon(snap.regime);
  const niftyUp = (snap.niftyChange ?? 0) >= 0;
  const vixUp   = (snap.vixChange   ?? 0) >= 0;
  const fiiPos  = (snap.fiiNet      ?? 0) >= 0;
  const diiPos  = (snap.diiNet      ?? 0) >= 0;

  return (
    <div className="card regime-panel">
      <div className="card-header" style={{ paddingBottom: 6 }}>
        <div className="card-title"><Activity size={14} className="inline-icon" /> Market Regime</div>
      </div>

      {/* Regime label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: regimeColor.bg, border: `1px solid ${regimeColor.border}`, borderRadius: 6, marginBottom: 10 }}>
        {regimeIcon}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: regimeColor.fg, textTransform: 'capitalize' }}>
            {(snap.regime || 'unknown').replace(/_/g, ' ')}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 1 }}>
            {snap.trend} · {snap.volatility} vol
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {snap.niftyClose != null && (
          <Stat
            label="Nifty 50"
            value={snap.niftyClose.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            sub={`${niftyUp ? '+' : ''}${snap.niftyChange}%`}
            tone={niftyUp ? 'profit' : 'loss'}
          />
        )}
        {snap.vix != null && (
          <Stat
            label="India VIX"
            value={snap.vix.toFixed(2)}
            sub={`${vixUp ? '+' : ''}${snap.vixChange}%`}
            tone={vixUp ? 'loss' : 'profit'}
          />
        )}
        {snap.fiiNet != null && (
          <Stat
            label="FII (₹Cr)"
            value={snap.fiiNet.toFixed(0)}
            tone={fiiPos ? 'profit' : 'loss'}
          />
        )}
        {snap.diiNet != null && (
          <Stat
            label="DII (₹Cr)"
            value={snap.diiNet.toFixed(0)}
            tone={diiPos ? 'profit' : 'loss'}
          />
        )}
      </div>

      {/* Bias hint */}
      {snap.bias?.prefer?.length > 0 && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: 'rgba(56, 189, 248, 0.06)', borderRadius: 6, fontSize: '0.7rem' }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Favors:</div>
          <div style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
            {snap.bias.prefer.slice(0, 2).join(', ')}
          </div>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        {snap.fromCache ? 'cached' : 'live'} · {snap.date}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 600,
        color: tone === 'profit' ? 'var(--profit)' : tone === 'loss' ? 'var(--loss)' : 'inherit',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: tone === 'profit' ? 'var(--profit)' : tone === 'loss' ? 'var(--loss)' : 'var(--text-muted)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function regimeToColor(regime) {
  switch (regime) {
    case 'risk_on_uptrend':
    case 'low_vol_trending':
      return { bg: 'rgba(34, 197, 94, 0.10)', border: 'rgba(34, 197, 94, 0.35)', fg: '#86efac' };
    case 'high_fear_mean_revert':
    case 'risk_off_drawdown':
      return { bg: 'rgba(239, 68, 68, 0.10)', border: 'rgba(239, 68, 68, 0.35)', fg: '#fca5a5' };
    case 'low_vol_complacent':
      return { bg: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.35)', fg: '#fcd34d' };
    default:
      return { bg: 'rgba(148, 163, 184, 0.10)', border: 'rgba(148, 163, 184, 0.35)', fg: '#cbd5e1' };
  }
}

function regimeToIcon(regime) {
  switch (regime) {
    case 'risk_on_uptrend':
    case 'low_vol_trending':         return <TrendingUp size={18} style={{ color: '#86efac' }} />;
    case 'high_fear_mean_revert':    return <Zap         size={18} style={{ color: '#fca5a5' }} />;
    case 'risk_off_drawdown':        return <TrendingDown size={18} style={{ color: '#fca5a5' }} />;
    case 'low_vol_complacent':       return <Shield      size={18} style={{ color: '#fcd34d' }} />;
    default:                          return <Activity    size={18} style={{ color: '#cbd5e1' }} />;
  }
}
