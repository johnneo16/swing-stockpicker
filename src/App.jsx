import React, { useState, useEffect, useCallback, useRef, startTransition } from 'react';
import {
  Activity, BarChart3, Package, RefreshCw, Pause, Search, AlertCircle,
  Briefcase, CheckCircle2, XCircle, TrendingUp, TrendingDown, Target,
  ArrowUpRight, ArrowDownRight, Sun, Moon, Info, ShieldAlert, TestTube2, Zap
} from 'lucide-react';
import TradeCard from './components/TradeCard.jsx';
import PortfolioSummary from './components/PortfolioSummary.jsx';
import MarketOverview from './components/MarketOverview.jsx';
import AlertPanel, { generateAlerts } from './components/AlertPanel.jsx';
import RegimePanel from './components/RegimePanel.jsx';
import DailyPnLWidget from './components/DailyPnLWidget.jsx';
import NotificationManager from './components/NotificationManager.jsx';

const LivePositionsTab = React.lazy(() => import('./components/LivePositionsTab.jsx'));
const BacktestsTab     = React.lazy(() => import('./components/BacktestsTab.jsx'));
const TodaysPicksTab   = React.lazy(() => import('./components/TodaysPicksTab.jsx'));

const DEFAULT_CAPITAL = 50000;       // Stocks
const DEFAULT_CAPITAL_ETF = 25000;   // ETFs (half-size bucket per portfolio design)

// Fallback portfolio used only when backend is offline
const makeFallbackPortfolio = (capital) => ({
  totalCapital: capital, capitalDeployed: 0, remainingCash: capital, cashReserveTarget: Math.round(capital * 0.25),
  totalRiskExposure: 0, riskExposurePercent: 0, activeTradeCount: 0, maxTrades: 5,
  deploymentPercent: 0, sectorDistribution: {},
});

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
  const [activeTab, setActiveTab] = useState('today');
  const [capital, setCapital] = useState(() => {
    const saved = localStorage.getItem('swingpro-capital');
    return saved ? Number(saved) : DEFAULT_CAPITAL;
  });
  const [etfCapital, setEtfCapital] = useState(() => {
    const saved = localStorage.getItem('swingpro-capital-etf');
    return saved ? Number(saved) : DEFAULT_CAPITAL_ETF;
  });
  // The "active" capital follows scanMode — used for PortfolioSummary,
  // DailyPnLWidget, and any endpoint call scoped to the current asset class.
  const activeCapital = scanMode === 'etf' ? etfCapital : capital;

  const [trades, setTrades] = useState([]);        // raw scan results (used to seed alerts only now)
  const [holdings, setHoldings] = useState([]);    // stock paper positions (Dashboard source when mode=stocks)
  const [etfHoldings, setEtfHoldings] = useState([]); // ETF paper positions (Dashboard source when mode=etf)
  const [etfTrades, setEtfTrades] = useState([]);
  const [portfolio, setPortfolio] = useState(() => makeFallbackPortfolio(capital));
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
  const [highConvictionOnly, setHighConvictionOnly] = useState(() =>
    localStorage.getItem('swingpro-highconv') === 'true'
  );

  const previousTradesRef = useRef([]);
  const autoRefreshTimer = useRef(null);
  const countdownTimer = useRef(null);

  // Dashboard sources from currently-held positions, filtered by asset class.
  // When the user toggles Stocks/ETFs, the corresponding holdings render.
  // Closed positions auto-disappear from the dashboard.
  const rawTrades = scanMode === 'stocks' ? holdings : etfHoldings;
  const activeTrades = highConvictionOnly ? rawTrades.filter(t => (t.confidenceScore || 0) >= 60) : rawTrades;
  const activePortfolio = scanMode === 'stocks' ? portfolio : (etfPortfolio || portfolio);

  const toggleHighConviction = useCallback(() => {
    setHighConvictionOnly(prev => {
      const next = !prev;
      localStorage.setItem('swingpro-highconv', String(next));
      return next;
    });
  }, []);

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

  const handleCapitalChange = useCallback((newCapital) => {
    const val = Math.max(1000, Math.round(newCapital));
    // Edit the pool corresponding to the currently active asset class
    if (scanMode === 'etf') {
      setEtfCapital(val);
      localStorage.setItem('swingpro-capital-etf', String(val));
      setEtfPortfolio(prev => prev ? ({
        ...prev,
        totalCapital: val,
        remainingCash: Math.round(val - (prev.capitalDeployed || 0)),
        cashReserveTarget: Math.round(val * 0.15),
        riskExposurePercent: prev.totalRiskExposure ? Math.round((prev.totalRiskExposure / val) * 10000) / 100 : 0,
        deploymentPercent: prev.capitalDeployed ? Math.round((prev.capitalDeployed / val) * 10000) / 100 : 0,
      }) : prev);
    } else {
      setCapital(val);
      localStorage.setItem('swingpro-capital', String(val));
      setPortfolio(prev => ({
        ...prev,
        totalCapital: val,
        remainingCash: Math.round(val - (prev.capitalDeployed || 0)),
        cashReserveTarget: Math.round(val * 0.15),
        riskExposurePercent: prev.totalRiskExposure ? Math.round((prev.totalRiskExposure / val) * 10000) / 100 : 0,
        deploymentPercent: prev.capitalDeployed ? Math.round((prev.capitalDeployed / val) * 10000) / 100 : 0,
      }));
    }
  }, [scanMode]);

  const fetchMarketOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/market-overview');
      if (res.ok) {
        const data = await res.json();
        setMarketData(data);
      }
    } catch { /* keep sample */ }
  }, []);

  // Load currently-held positions (the dashboard's primary data source in stocks mode).
  // Cheap: just a DB read + in-memory enrichment, no external API calls.
  // Called on mount, after every scan, and on a 30s auto-poll while open.
  const loadHoldings = useCallback(async () => {
    try {
      // Fetch stock + ETF holdings + portfolios in parallel.
      // Each class uses its own capital base (₹50K stocks, ₹25K ETFs).
      const [stockCards, etfCards, stockPort, etfPort] = await Promise.all([
        fetch('/api/positions/cards?mode=paper&assetClass=stock').then(r => r.json()),
        fetch('/api/positions/cards?mode=paper&assetClass=etf').then(r => r.json()),
        fetch(`/api/portfolio/live?mode=paper&assetClass=stock&capital=${capital}`).then(r => r.json()),
        fetch(`/api/portfolio/live?mode=paper&assetClass=etf&capital=${etfCapital}`).then(r => r.json()),
      ]);

      setHoldings(stockCards.cards || []);
      setEtfHoldings(etfCards.cards || []);

      // Convert portfolio/live response → shape PortfolioSummary expects.
      // Cap base passed in determines reserve target sizing.
      const toPortfolio = (r, capBase) => r && !r.error ? ({
        totalCapital:        r.totalCapital ?? capBase,
        capitalDeployed:     r.capitalDeployed ?? 0,
        remainingCash:       r.cashRemaining ?? capBase,
        cashReserveTarget:   Math.round(capBase * 0.15),
        totalRiskExposure:   r.openRisk ?? 0,
        riskExposurePercent: r.initialRiskPct ?? 0,
        activeTradeCount:    r.activePositions ?? 0,
        maxTrades:           5,
        deploymentPercent:   r.deploymentPct ?? 0,
        sectorDistribution:  r.sectorDistribution ?? {},
        unrealizedPnl:       r.unrealizedPnl ?? 0,
        unrealizedPct:       r.unrealizedPct ?? 0,
      }) : null;

      const stockP = toPortfolio(stockPort, capital);
      const etfP   = toPortfolio(etfPort,   etfCapital);
      if (stockP) setPortfolio(stockP);
      if (etfP)   setEtfPortfolio(etfP);
      setIsLive(true);
    } catch (err) {
      // Holdings load failure isn't fatal — just keep what we have
      console.warn('loadHoldings failed:', err);
    }
  }, [capital, etfCapital]);

  const runScan = useCallback(async (silent = false) => {
    if (!silent) setScanning(true);
    setError(null);

    // Abort after 120 seconds to prevent infinite loading
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    try {
      const capitalParam = `&capital=${capital}`;
      const endpoint = scanMode === 'etf' ? `/api/scan-etf?refresh=true${capitalParam}` : `/api/scan?refresh=true${capitalParam}`;
      const res = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();

      if (data.trades && data.trades.length > 0) {
        const newAlerts = generateAlerts(data.trades, previousTradesRef.current);
        previousTradesRef.current = data.trades;

        if (scanMode === 'stocks') {
          setTrades(data.trades);
          setPortfolio(data.portfolio || makeFallbackPortfolio(capital));
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
      loadHoldings(); // refresh dashboard holdings in case the scan added new tracks
    } catch (err) {
      clearTimeout(timeoutId);
      setIsLive(false);
      
      // If it's a silent initial run but hits the 120s AbortController timeout, 
      // we STILL want to show the warning rather than silently saying "Offline".
      if (err.name === 'AbortError') {
        setError('Market scan is taking longer than expected (large universe). The server is processing in the background — please wait a moment and click Scan again.');
      } else if (!silent) {
        setError('Backend not reachable. Start the server with: node server.js');
      }
    } finally {
      if (!silent) setScanning(false);
      setInitialLoad(false);
    }
  }, [scanMode, capital, fetchMarketOverview]);

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

  // Initial load + 30s polling for held positions (drives Dashboard in stocks mode).
  // 30s cadence catches MTM updates and position closures quickly while staying cheap.
  useEffect(() => {
    loadHoldings();
    const interval = setInterval(loadHoldings, 30_000);
    return () => clearInterval(interval);
  }, [loadHoldings]);

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
          <img src="/favicon.png" alt="SwingPro Logo" className="header-logo" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
          <div>
            <h1 className="header-title">SwingPro</h1>
            <p className="header-subtitle">AI-Powered NSE Swing Trading</p>
          </div>
        </div>

        {/* Zone 2: Mode Toggle — color-coded by asset class */}
        <div className="mode-toggle" role="group" aria-label="Asset class">
          <button
            data-class="stocks"
            className={`mode-btn ${scanMode === 'stocks' ? 'active' : ''}`}
            onClick={() => handleScanModeChange('stocks')}
            aria-pressed={scanMode === 'stocks'}
          >
            Stocks
          </button>
          <button
            data-class="etf"
            className={`mode-btn ${scanMode === 'etf' ? 'active' : ''}`}
            onClick={() => handleScanModeChange('etf')}
            aria-pressed={scanMode === 'etf'}
          >
            ETFs
          </button>
        </div>

        {/* Zone 3: Actions */}
        <div className="header-actions">
          <NotificationManager />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />

          <button
            className={`auto-refresh-toggle ${highConvictionOnly ? 'active' : ''}`}
            onClick={toggleHighConviction}
            title={highConvictionOnly ? 'Showing score ≥ 60 only — click to show all' : 'Show high-conviction picks only (score ≥ 60)'}
          >
            <Target size={14} />
            <span className="auto-refresh-label">{highConvictionOnly ? 'High Conv.' : 'All Picks'}</span>
          </button>

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
        {['today', 'dashboard', 'trades', 'portfolio', 'live', 'backtests'].map(tab => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => handleTabChange(tab)}
          >
            {tab === 'today'      ? <><Sun size={14} className="tab-icon"/> Today</>
              : tab === 'dashboard'  ? <><Activity size={14} className="tab-icon"/> Dashboard</>
              : tab === 'trades'   ? <><BarChart3 size={14} className="tab-icon"/> {scanMode === 'etf' ? 'ETFs' : 'Trade Setups'}{activeTrades.length > 0 ? ` (${activeTrades.length})` : ''}{highConvictionOnly ? <span style={{ marginLeft: 4, fontSize: '0.6rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>★</span> : null}</>
              : tab === 'portfolio'? <><Briefcase size={14} className="tab-icon"/> Portfolio</>
              : tab === 'live'     ? <><Target size={14} className="tab-icon"/> Live</>
              :                       <><TestTube2 size={14} className="tab-icon"/> Backtests</>}
          </button>
        ))}
      </div>

      {/* ============ TODAY'S PICKS TAB ============ */}
      {activeTab === 'today' && (
        <React.Suspense fallback={<div className="loading-skeleton skeleton-card" />}>
          <TodaysPicksTab activeClass={scanMode} />
        </React.Suspense>
      )}

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
                <div className="empty-title">
                  {scanMode === 'stocks' ? 'No Open Positions' : 'No ETF Setups Found'}
                </div>
                <div className="empty-text">
                  {scanMode === 'stocks'
                    ? (isLive === false
                        ? 'Backend offline — start the server with bash scripts/startAutopilot.sh'
                        : 'Auto-pilot will track new picks at 09:00 IST on the next weekday. Or run a scan now to see fresh candidates in the Today tab.')
                    : (isLive === false
                        ? 'Start the backend server and click Scan to discover live ETF setups.'
                        : 'Market may be closed or no ETF setups meet criteria. Try during market hours (9:15 AM – 3:30 PM IST).')}
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
                <DailyPnLWidget capital={activeCapital} activeClass={scanMode} />
                <PortfolioSummary portfolio={activePortfolio} capital={activeCapital} onCapitalChange={handleCapitalChange} />
                <RegimePanel />
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
            <PortfolioSummary portfolio={activePortfolio} capital={activeCapital} onCapitalChange={handleCapitalChange} />
          </div>
        </div>
      )}

      {/* ============ LIVE (Paper Trading) TAB ============ */}
      {activeTab === 'live' && (
        <React.Suspense fallback={<div className="loading-skeleton skeleton-card" />}>
          <LivePositionsTab capital={activeCapital} activeClass={scanMode} />
        </React.Suspense>
      )}

      {/* ============ BACKTESTS TAB ============ */}
      {activeTab === 'backtests' && (
        <React.Suspense fallback={<div className="loading-skeleton skeleton-card" />}>
          <BacktestsTab />
        </React.Suspense>
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
