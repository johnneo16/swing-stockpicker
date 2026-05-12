import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';

/**
 * Browser-native Notifications via the Web Notification API.
 *
 * Pulls every 30s from /api/scheduler/log + /api/trades/history and
 * fires a notification on any of these material events:
 *   • Killswitch tripped
 *   • A paper trade closed (target/stop/time exit)
 *   • Daily-summary job emitted EOD report
 *   • Pre-market job tracked new picks
 *
 * No service worker, no push backend — runs entirely in the browser tab.
 * Notifications still surface on macOS Notification Center while the tab
 * is in the background, so you can use the laptop normally.
 *
 * State stored in localStorage keys: notif-* for cross-refresh dedup.
 */

const LS_PERMISSION_REQUESTED = 'notif:permission-requested';
const LS_LAST_LOG_ID         = 'notif:last-log-id';
const LS_LAST_TRADE_ID       = 'notif:last-trade-id';
const LS_ENABLED             = 'notif:enabled';

// Used as the default notification icon — falls back to favicon
const NOTIF_ICON = '/jarvis.svg';

function notify(title, body, tag = 'swingpro') {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, {
      body,
      tag,                // collapses duplicates with same tag
      icon: NOTIF_ICON,
      badge: NOTIF_ICON,
      silent: false,
    });
    // Auto-dismiss after 12s on desktop notifications that don't auto-close
    setTimeout(() => { try { n.close(); } catch (_) {} }, 12000);
  } catch (_) { /* notifications might be blocked or unsupported */ }
}

export default function NotificationManager() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [enabled, setEnabled] = useState(
    () => (localStorage.getItem(LS_ENABLED) ?? 'true') === 'true'
  );
  const pollRef = useRef(null);

  // Auto-request permission on first mount if not asked before
  useEffect(() => {
    if (permission !== 'default') return;
    if (localStorage.getItem(LS_PERMISSION_REQUESTED) === 'true') return;
    // Don't auto-prompt — wait for user gesture (toggle button)
  }, [permission]);

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return;
    localStorage.setItem(LS_PERMISSION_REQUESTED, 'true');
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      notify('🤖 SwingPro Notifications Enabled',
             'You\'ll receive alerts for trade closures, killswitch trips, and daily summaries.',
             'enabled');
    }
  };

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem(LS_ENABLED, String(next));
    if (next && permission === 'default') requestPermission();
  };

  // Polling loop — runs every 30s while enabled + permission granted
  useEffect(() => {
    if (!enabled || permission !== 'granted') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    const checkForEvents = async () => {
      try {
        // 1. Scheduler log — killswitch trips, daily summaries, etc.
        const logRes = await fetch('/api/scheduler/log?limit=30').then(r => r.json());
        const runs = logRes.runs || [];
        const lastSeenId = parseInt(localStorage.getItem(LS_LAST_LOG_ID) || '0', 10);
        const newRuns = runs.filter(r => r.id > lastSeenId);

        for (const r of newRuns.reverse()) { // process oldest-first
          if (r.job_id === 'risk-killswitch' && r.message?.includes('TRIPPED')) {
            notify('🛑 KILLSWITCH TRIPPED', r.message, 'killswitch-' + r.id);
          } else if (r.job_id === 'daily-summary' && r.status === 'ok') {
            notify('📊 Daily Summary', r.message, 'daily-summary-' + r.id);
          } else if ((r.job_id === 'pre-market' || r.job_id === 'pre-market-etf') && r.status === 'ok') {
            // Only notify if at least one was tracked (skip "0 tracked" cases)
            try {
              const detail = r.detail_json ? JSON.parse(r.detail_json) : {};
              if (detail.tracked?.length > 0) {
                notify(`📈 Pre-Market — ${detail.tracked.length} new picks`, r.message, 'pre-market-' + r.id);
              }
            } catch (_) {}
          }
        }
        if (runs.length > 0) localStorage.setItem(LS_LAST_LOG_ID, String(runs[0].id));

        // 2. Closed trades — any new ones since last check
        const tradesRes = await fetch('/api/trades/history?mode=paper&limit=10').then(r => r.json());
        const trades = tradesRes.trades || [];
        const lastSeenTrade = parseInt(localStorage.getItem(LS_LAST_TRADE_ID) || '0', 10);
        const newTrades = trades.filter(t => t.id > lastSeenTrade);

        for (const t of newTrades.reverse()) {
          const isWin = (t.realized_pnl ?? 0) > 0;
          const pct = (t.realized_pct ?? 0).toFixed(2);
          const reason = (t.exit_reason || 'closed').replace(/_/g, ' ');
          const title = isWin
            ? `✅ ${t.symbol} +${pct}% — ${reason}`
            : `❌ ${t.symbol} ${pct}% — ${reason}`;
          const body = `₹${(t.realized_pnl ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} P&L · ${t.holding_days || 0}d held`;
          notify(title, body, 'trade-' + t.id);
        }
        if (trades.length > 0) localStorage.setItem(LS_LAST_TRADE_ID, String(trades[0].id));

      } catch (_) { /* silent — keep polling */ }
    };

    // Run once immediately, then every 30s
    checkForEvents();
    pollRef.current = setInterval(checkForEvents, 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [enabled, permission]);

  // Render a compact bell button in whatever container renders us
  // (typically the header). Click → request permission / toggle.
  return (
    <button
      onClick={permission === 'default' ? requestPermission : toggle}
      className="notif-toggle"
      title={
        permission === 'unsupported' ? 'Your browser does not support notifications'
        : permission === 'denied' ? 'Notifications blocked — re-enable in browser settings'
        : permission === 'default' ? 'Click to enable browser notifications'
        : enabled ? 'Notifications ON — click to mute' : 'Notifications muted — click to enable'
      }
      style={{
        background: 'transparent',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        width: 32, height: 32,
        cursor: permission === 'unsupported' || permission === 'denied' ? 'not-allowed' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: (enabled && permission === 'granted') ? 'var(--accent-indigo)' : 'var(--text-muted)',
        transition: 'all var(--transition-fast)',
      }}
      disabled={permission === 'unsupported'}
    >
      {(enabled && permission === 'granted') ? <Bell size={14} /> : <BellOff size={14} />}
    </button>
  );
}
