import React from 'react';
import { Bell, Sparkles, Flame, AlertTriangle, BarChart2 } from 'lucide-react';

export default function AlertPanel({ alerts }) {
  const getIcon = (type) => {
    switch (type) {
      case 'new': return <Sparkles size={16} className="text-accent" />;
      case 'high-confidence': return <Flame size={16} style={{ color: 'var(--profit)' }} />;
      case 'warning': return <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />;
      case 'info': return <BarChart2 size={16} className="text-muted" />;
      default: return <Bell size={16} />;
    }
  };

  return (
    <div className="card" id="alert-panel">
      <div className="card-header">
        <div className="card-title"><span className="icon"><Bell size={16} className="inline-icon text-accent"/></span> Alerts</div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {alerts.length} signal{alerts.length !== 1 ? 's' : ''}
        </span>
      </div>

      {alerts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No alerts yet. Run a scan to generate signals.
        </div>
      ) : (
        <div className="alert-list">
          {alerts.map((alert, i) => (
            <div key={i} className="alert-item">
              <span className="alert-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {getIcon(alert.type)}
              </span>
              <div className="alert-content">
                <div className="alert-title">{alert.title}</div>
                <div className="alert-message">{alert.message}</div>
              </div>
              <span className="alert-time">{alert.time}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Generate alerts from trade data
 */
export function generateAlerts(trades, previousTrades = []) {
  const alerts = [];
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  // New trade setups identified
  trades.forEach(trade => {
    const wasPrevious = previousTrades.some(p => p.symbol === trade.symbol);
    if (!wasPrevious) {
      alerts.push({
        icon: '🆕',
        title: `New Setup: ${trade.symbol}`,
        message: `${trade.name} — ${trade.executionStrategy.split('—')[0].trim()} at ₹${trade.entryPrice}`,
        time: timeStr,
        type: 'new',
      });
    }
  });

  // High-confidence alerts
  trades.forEach(trade => {
    if (trade.confidenceScore >= 70) {
      alerts.push({
        icon: '🔥',
        title: `High Confidence: ${trade.symbol}`,
        message: `Score ${trade.confidenceScore}/100 — Strong ${trade.riskLevel} risk setup`,
        time: timeStr,
        type: 'high-confidence',
      });
    }
  });

  // Risk warnings
  trades.forEach(trade => {
    if (trade.validationWarnings?.length > 0) {
      alerts.push({
        icon: '⚠️',
        title: `Risk Warning: ${trade.symbol}`,
        message: trade.validationWarnings[0],
        time: timeStr,
        type: 'warning',
      });
    }
  });

  // Portfolio-level alert
  if (trades.length > 0) {
    alerts.push({
      icon: '📊',
      title: 'Scan Complete',
      message: `${trades.length} actionable trade${trades.length !== 1 ? 's' : ''} found across ${new Set(trades.map(t => t.sector)).size} sectors`,
      time: timeStr,
      type: 'info',
    });
  }

  return alerts;
}
