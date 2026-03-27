import React, { useState, useEffect, useCallback, useRef, startTransition } from 'react';
import { 
  Activity, BarChart3, Package, RefreshCw, Pause, Search, AlertCircle, 
  Briefcase, CheckCircle2, XCircle, TrendingUp, TrendingDown, Target, 
  ArrowUpRight, ArrowDownRight, Sun, Moon, Info, ShieldAlert
} from 'lucide-react';
import TradeCard from './components/TradeCard.jsx';
import PortfolioSummary from './components/PortfolioSummary.jsx';
import MarketOverview from './components/MarketOverview.jsx';
import AlertPanel, { generateAlerts } from './components/AlertPanel.jsx';

// Fallback portfolio used only when backend is offline
const FALLBACK_PORTFOLIO = {
  totalCapital: 50000, capitalDeployed: 0, remainingCash: 50000, cashReserveTarget: 12500,
  totalRiskExposure: 0, riskExposurePercent: 0, activeTradeCount: 0, maxTrades: 5,
  deploymentPercent: 0, sectorDistribution: {},
};

const SAMPLE_MARKET = {
  indices: {
    nifty50: { name: 'NIFTY 50', price: 23344.75, change: 128.45, changePercent: 0.55 },
    bankNifty: { name: 'BANK NIFTY', price: 49872.30, change: -45.80, changePercent: -0.09 },
    sensex: { name: 'SENSEX', price: 77414.92, change: 412.50, changePercent: 0.54 },
  },
  marketMood: 'Bullish',
  isMarketOpen: false,
};

const AUTO_REFRESH_INTERVAL = 60 * 1000;

// ============================================================
// Index Ticker Component (memoized)
// ============================================================
const IndexTicker = React.memo(function IndexTicker({ marketData }) {
  const indices = marketData?.indices || {};

  const renderItem = (data, label) => {
    if (!data) return null;
    const isUp = (data.changePercent || 0) >= 0;
    return (
      <div className="ticker-item" key={label}>
        <span className="ticker-name">{label}</span>
        <span className="ticker-price">
          {data.price?.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </span>
        <span className={`ticker-change ${isUp ? 'up' : 'down'}`}>
          {isUp ? <TrendingUp size={12} className="inline-icon" /> : <TrendingDown size={12} className="inline-icon" />} 
          {' '}{Math.abs(data.change || 0).toFixed(2)} ({isUp ? '+' : ''}{data.changePercent?.toFixed(2)}%)
        </span>
      </div>
    );
  };

  return (
    <div className="index-ticker">
      {renderItem(indices.nifty50, 'NIFTY 50')}
      <div className="ticker-divider" />
      {renderItem(indices.sensex, 'SENSEX')}
      <div className="ticker-divider" />
      {renderItem(indices.bankNifty, 'BANK NIFTY')}
      <div className="ticker-divider" />
      <div className="ticker-item" style={{ opacity: 0.8 }}>
        <span className="ticker-name">Mood</span>
        <span className="ticker-price" style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          color: marketData?.marketMood === 'Bullish' ? 'var(--profit)'
            : marketData?.marketMood === 'Bearish' ? 'var(--loss)' : 'var(--warning)'
        }}>
          {marketData?.marketMood === 'Bullish' ? <div className="status-dot scanning"/> 
            : marketData?.marketMood === 'Bearish' ? <div className="status-dot offline"/> : <div className="status-dot warning"/>}
          {' '}{marketData?.marketMood || 'Unknown'}
        </span>
      </div>
    </div>
  );
});

// ============================================================
// Theme Toggle
// ============================================================
const ThemeToggle = React.memo(function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className={`theme-toggle-switch ${theme === 'light' ? 'is-light' : ''}`}
      onClick={onToggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      <span className="tts-moon" aria-hidden="true"><Moon size={12} /></span>
      <span className="tts-track"><span className="tts-thumb" /></span>
      <span className="tts-sun" aria-hidden="true"><Sun size={12} /></span>
    </button>
  );
});

// ============================================================
// Main App
// ============================================================
export default function App() {
  const [scanMode, setScanMode] = useState('stocks');
  const [activeTab, setActiveTab] = useState('dashboard');

  const [trades, setTrades] = useState([]);
  const [etfTrades, setEtfTrades] = useState([]);
  const [portfolio, setPortfolio] = useState(FALLBACK_PORTFOLIO);
  const [etfPortfolio, setEtfPortfolio] = useState(null);
  const [marketData, setMarketData] = useState(SAMPLE_MARKET);
  const [alerts, setAlerts] = useState([]);

  const [isLive, setIsLive] = useState('loading');
  const [scanning, setScanning] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [scanTime, setScanTime] = useState(null);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [nextRefreshIn, setNextRefreshIn] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  const previousTradesRef = useRef([]);
  const autoRefreshTimer = useRef(null);
  const countdownTimer = useRef(null);

  const activeTrades = scanMode === 'stocks' ? trades : etfTrades;
  const activePortfolio = scanMode === 'stocks' ? portfolio : (etfPortfolio || portfolio);

  // Theme sync
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const metaTheme = document.getElementById('meta-theme-color');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0a0e14' : '#f0f3fa');
    }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(prev => prev === 'dark' ? 'light' : 'dark'), []);

  const fetchMarketOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/market-overview');
      if (res.ok) {
        const data = await res.json();
        setMarketData(data);
      }
    } catch { /* keep sample */ }
  }, []);

  const runScan = useCallback(async (silent = false) => {
    if (!silent) setScanning(true);
    setError(null);
    try {
      const endpoint = scanMode === 'etf' ? '/api/scan-etf?refresh=true' : '/api/scan?refresh=true';
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();

      if (data.trades && data.trades.length > 0) {
        const newAlerts = generateAlerts(data.trades, previousTradesRef.current);
        previousTradesRef.current = data.trades;

        if (scanMode === 'stocks') {
          setTrades(data.trades);
          setPortfolio(data.portfolio || FALLBACK_PORTFOLIO);
        } else {
          setEtfTrades(data.trades);
          setEtfPortfolio(data.portfolio);
        }

        setAlerts(prev => [...newAlerts, ...prev].slice(0, 30));
        setScanTime(data.scannedAt || new Date().toISOString());
        setIsLive(true);
        setNextRefreshIn(AUTO_REFRESH_INTERVAL / 1000);
      } else if (!silent) {
        setIsLive(false);
        setError(`No actionable ${scanMode === 'etf' ? 'ETF' : 'stock'} setups found right now. Market may be closed or no setups meet criteria.`);
      } else {
        setIsLive(false);
      }
      fetchMarketOverview();
    } catch {
      setIsLive(false);
      if (!silent) {
        setError('Backend not reachable. Start the server with: node server.js');
      }
    } finally {
      if (!silent) setScanning(false);
      setInitialLoad(false);
    }
  }, [scanMode, fetchMarketOverview]);

  // Auto-refresh timers
  useEffect(() => {
    if (autoRefresh) {
      autoRefreshTimer.current = setInterval(() => runScan(true), AUTO_REFRESH_INTERVAL);
      setNextRefreshIn(AUTO_REFRESH_INTERVAL / 1000);
      countdownTimer.current = setInterval(() => {
        setNextRefreshIn(prev => prev <= 1 ? AUTO_REFRESH_INTERVAL / 1000 : prev - 1);
      }, 1000);
    }
    return () => {
      if (autoRefreshTimer.current) clearInterval(autoRefreshTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      setNextRefreshIn(null);
    };
  }, [autoRefresh, runScan]);

  useEffect(() => { fetchMarketOverview(); }, [fetchMarketOverview]);

  useEffect(() => {
    runScan(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = useCallback((tab) => {
    startTransition(() => setActiveTab(tab));
  }, []);

  const handleScanModeChange = useCallback((mode) => {
    setScanMode(mode);
    setInitialLoad(true);
    setTimeout(() => setInitialLoad(false), 0);
  }, []);

  const isLoading = initialLoad && isLive === 'loading';

  return (
    <div className="app">
      <IndexTicker marketData={marketData} />

      {/* ---- Header ---- */}
      <header className="header">
        {/* Zone 1: Brand */}
        <div className="header-brand">
          <div className="brand-logo-sq">
            <span>S</span>
          </div>
          <div>
            <h1 className="header-title">SwingPro</h1>
            <p className="header-subtitle">AI-Powered NSE Swing Trading</p>
          </div>
        </div>

        {/* Zone 2: Mode Toggle */}
        <div className="mode-toggle">
          <button
            className={`mode-btn ${scanMode === 'stocks' ? 'active' : ''}`}
            onClick={() => handleScanModeChange('stocks')}
          >
            <BarChart3 size={14} className="inline-icon" /> Stocks
          </button>
          <button
            className={`mode-btn ${scanMode === 'etf' ? 'active' : ''}`}
            onClick={() => handleScanModeChange('etf')}
          >
            <Package size={14} className="inline-icon" /> ETFs
          </button>
        </div>

        {/* Zone 3: Actions */}
        <div className="header-actions">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />

          <button
            className={`auto-refresh-toggle ${autoRefresh ? 'active' : ''}`}
            onClick={() => setAutoRefresh(prev => !prev)}
            title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          >
            {autoRefresh ? <RefreshCw size={14} className="spin-icon" /> : <Pause size={14} />}
            <span className="auto-refresh-label">{autoRefresh ? 'Auto' : 'Manual'}</span>
            {autoRefresh && nextRefreshIn && <span className="countdown-text">{nextRefreshIn}s</span>}
          </button>

          <div className="header-status">
            <span className={`status-dot ${scanning || isLoading ? 'scanning' : isLive === true ? '' : 'offline'}`} />
            <span className="status-label">
              {scanning || isLoading ? 'Fetching…' : isLive === true ? 'Live' : 'Offline'}
            </span>
          </div>

          <button
            className="btn-scan"
            id="scan-button"
            onClick={() => runScan(false)}
            disabled={scanning || isLoading}
          >
            {scanning ? <span className="spinner" /> : <Search size={16} />}
            <span>{scanning ? 'Scanning…' : `Scan ${scanMode === 'etf' ? 'ETFs' : 'Market'}`}</span>
          </button>
        </div>
      </header>

      {/* ---- Status sub-bar ---- */}
      {scanTime && (
        <div className="status-bar">
          <span className="status-item">
            <RefreshCw size={12} className="inline-icon text-muted" /> Last scan: {new Date(scanTime).toLocaleString('en-IN')}
          </span>
          <span className="status-item">
            <div className={`status-dot ${marketData?.isMarketOpen ? '' : 'offline'}`} /> 
            {marketData?.isMarketOpen ? 'NSE Market Open' : 'NSE Market Closed'}
          </span>
        </div>
      )}

      {/* ---- Error banner ---- */}
      {error && !isLoading && (
        <div className="error-banner">
          <ShieldAlert size={16} className="inline-icon" /> {error}
        </div>
      )}

      {/* ---- Offline notice ---- */}
      {!isLoading && isLive === false && !error && (
        <div className="info-banner">
          <Info size={16} className="inline-icon" /> Backend offline — showing empty dashboard. Start the server (<code>node server.js</code>) and click <strong>Scan</strong>.
        </div>
      )}

      {/* ---- Tabs ---- */}
      <div className="tabs" id="main-tabs">
        {['dashboard', 'trades', 'portfolio'].map(tab => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => handleTabChange(tab)}
          >
            {tab === 'dashboard' ? <><Activity size={14} className="tab-icon"/> Dashboard</>
              : tab === 'trades' ? <><BarChart3 size={14} className="tab-icon"/> {scanMode === 'etf' ? 'ETFs' : 'Trade Setups'}{activeTrades.length > 0 ? ` (${activeTrades.length})` : ''}</>
              : <><Briefcase size={14} className="tab-icon"/> Portfolio</>}
          </button>
        ))}
      </div>

      {/* ============ DASHBOARD TAB ============ */}
      {activeTab === 'dashboard' && (
        <div className="dashboard-grid">
          <div className="main-content">
            {isLoading ? (
              <>{[1, 2, 3, 4, 5].map(i => <div key={i} className="loading-skeleton skeleton-card" />)}</>
            ) : activeTrades.length > 0 ? (
              <>
                {/* 5-STOCK LAYOUT FIX */}
                {activeTrades.slice(0, 5).map(trade => <TradeCard key={trade.symbol} trade={trade} />)}
                {activeTrades.length > 5 && (
                  <div style={{ textAlign: 'center', padding: '12px' }}>
                    <button className="btn-view-all" onClick={() => handleTabChange('trades')}>
                      View all {activeTrades.length} {scanMode === 'etf' ? 'ETFs' : 'trades'} <ArrowUpRight size={14} className="inline-icon" />
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon"><Search size={48} className="text-muted" strokeWidth={1}/></div>
                <div className="empty-title">No {scanMode === 'etf' ? 'ETF Setups' : 'Trade Setups'} Found</div>
                <div className="empty-text">
                  {isLive === false
                    ? 'Start the backend server and click Scan to discover live setups.'
                    : 'Market may be closed or no setups meet the current criteria. Try scanning during market hours (9:15 AM – 3:30 PM IST).'}
                </div>
                <button className="btn-scan" style={{ marginTop: '20px' }} onClick={() => runScan(false)} disabled={scanning}>
                  {scanning ? <span className="spinner" /> : <Search size={16} />} {scanning ? 'Scanning…' : `Scan ${scanMode === 'etf' ? 'ETFs' : 'Market'}`}
                </button>
              </div>
            )}
          </div>

          <div className="sidebar">
            {isLoading ? (
              <>{[1, 2].map(i => <div key={i} className="loading-skeleton skeleton-sidebar" />)}</>
            ) : (
              <>
                <PortfolioSummary portfolio={activePortfolio} />
                <MarketOverview marketData={marketData} />
                <AlertPanel alerts={alerts} />
              </>
            )}
          </div>
        </div>
      )}

      {/* ============ TRADES TAB ============ */}
      {activeTab === 'trades' && (
        <div>
          {isLoading ? (
            <>{[1, 2, 3, 4, 5].map(i => <div key={i} className="loading-skeleton skeleton-card" />)}</>
          ) : activeTrades.length > 0 ? (
            activeTrades.map(trade => <TradeCard key={trade.symbol} trade={trade} />)
          ) : (
            <div className="empty-state">
              <div className="empty-icon"><BarChart3 size={48} className="text-muted" strokeWidth={1} /></div>
              <div className="empty-title">No {scanMode === 'etf' ? 'ETF' : 'Trade'} Setups</div>
              <div className="empty-text">Run a scan to discover actionable swing setups.</div>
            </div>
          )}
        </div>
      )}

      {/* ============ PORTFOLIO TAB ============ */}
      {activeTab === 'portfolio' && (
        <div className="dashboard-grid">
          <div className="main-content">
            <div className="card" style={{ marginBottom: '20px' }}>
              <div className="card-header">
                <div className="card-title">
                  <span className="icon"><Briefcase size={16} className="inline-icon text-accent" /></span> Active {scanMode === 'etf' ? 'ETF ' : ''}Positions
                </div>
              </div>
              {activeTrades.length > 0 ? (
                <div className="portfolio-table-wrapper">
                  <table className="portfolio-table">
                    <thead>
                      <tr>
                        {['Stock', 'CMP', 'Chg%', 'Entry', 'SL', 'Target', 'Qty', 'Capital', 'Score'].map(h => (
                          <th key={h} className="portfolio-th">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeTrades.map(t => (
                        <tr key={t.symbol} className="portfolio-row">
                          <td className="portfolio-td" style={{ fontWeight: 600 }}>
                            {t.symbol}
                            <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{t.sector}</span>
                          </td>
                          <td className="portfolio-td mono-cell cyan-cell">₹{(t.currentMarketPrice || t.entryPrice).toLocaleString('en-IN')}</td>
                          <td className="portfolio-td mono-cell" style={{ color: (t.dayChange || 0) >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                            {(t.dayChange || 0) >= 0 ? '+' : ''}{t.dayChange || 0}%
                          </td>
                          <td className="portfolio-td mono-cell">₹{t.entryPrice}</td>
                          <td className="portfolio-td mono-cell loss-cell">₹{t.stopLoss}</td>
                          <td className="portfolio-td mono-cell profit-cell">₹{t.targetPrice}</td>
                          <td className="portfolio-td mono-cell">{t.quantity}</td>
                          <td className="portfolio-td mono-cell">₹{t.capitalRequired?.toLocaleString('en-IN')}</td>
                          <td className="portfolio-td">
                            <span className={`confidence-score ${t.confidenceScore >= 65 ? 'high' : t.confidenceScore >= 45 ? 'medium' : 'low'}`} style={{ fontSize: '1rem' }}>
                              {t.confidenceScore}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  {isLoading ? 'Loading positions…' : 'No active positions — run a scan to find setups.'}
                </div>
              )}
            </div>
          </div>
          <div className="sidebar">
            <PortfolioSummary portfolio={activePortfolio} />
          </div>
        </div>
      )}

      {/* Mobile sticky bottom bar */}
      <div className="mobile-action-bar">
        <button className="btn-scan mobile-scan-btn" onClick={() => runScan(false)} disabled={scanning || isLoading}>
          {scanning ? <span className="spinner" /> : <Search size={16} />}
          {scanning ? 'Scanning…' : `Scan ${scanMode === 'etf' ? 'ETFs' : 'Market'}`}
        </button>
        <div className="header-status">
          <span className={`status-dot ${scanning || isLoading ? 'scanning' : isLive === true ? '' : 'offline'}`} />
          <span>{scanning || isLoading ? 'Fetching…' : isLive === true ? 'Live' : 'Offline'}</span>
        </div>
      </div>
    </div>
  );
}
