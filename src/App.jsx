import React, { useState, useEffect, useCallback, useRef, startTransition } from 'react';
import TradeCard from './components/TradeCard.jsx';
import PortfolioSummary from './components/PortfolioSummary.jsx';
import MarketOverview from './components/MarketOverview.jsx';
import AlertPanel, { generateAlerts } from './components/AlertPanel.jsx';

// ---- Sample / Demo Data ----
const SAMPLE_TRADES = [
  {
    symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto',
    currentMarketPrice: 745.50, dayChange: 1.82,
    entryPrice: 745.50, stopLoss: 718.30, targetPrice: 813.50, riskRewardRatio: 2.5,
    riskAmount: 750, quantity: 27, capitalRequired: 20128, percentOfCapital: 40.26,
    technicalReasoning: 'Price above EMA 20 & 50 — uptrend confirmed. RSI 54.2. ADX 28 — strong trend.',
    fundamentalStrength: 'PE: 8.2 | ROE: 28.5% | D/E: 1.1. Fundamental rating: Good (7.2/10).',
    sentimentInsight: 'Positive momentum today (+1.82%)',
    institutionalActivity: 'Volume 1.34x above average',
    confidenceScore: 72, riskLevel: 'Low',
    whyThisWorks: 'Strong uptrend with aligned EMAs. ADX confirms strong trending move.',
    whyThisCanFail: 'Near resistance — potential rejection.',
    executionStrategy: 'Trend continuation — enter on minor pullback to EMA 20',
    scoreBreakdown: { trend: 13, momentum: 14, volume: 8, priceAction: 10, riskReward: 10, psychology: 7, fundamentals: 7, marketContext: 5 },
    fundamentals: { peRatio: 8.2, roe: 28.5, debtToEquity: 1.1, revenueGrowth: 12.3, profitMargin: 7.8, marketCap: 2.5e12, fiftyTwoWeekHigh: 810, fiftyTwoWeekLow: 580, fundamentalScore: 7.2, fundamentalRating: 'Good' },
    validationWarnings: [],
  },
  {
    symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking',
    currentMarketPrice: 1642.75, dayChange: 0.94,
    entryPrice: 1642.75, stopLoss: 1598.00, targetPrice: 1755.00, riskRewardRatio: 2.51,
    riskAmount: 750, quantity: 16, capitalRequired: 26284, percentOfCapital: 52.57,
    technicalReasoning: 'Price above EMA 20. RSI 58.7. MACD bullish crossover. BB squeeze — breakout imminent.',
    fundamentalStrength: 'PE: 19.5 | ROE: 16.8% | D/E: 0.1. Fundamental rating: Excellent (8.5/10).',
    sentimentInsight: 'Positive momentum today (+0.94%)',
    institutionalActivity: 'Volume 1.52x above average',
    confidenceScore: 68, riskLevel: 'Low',
    whyThisWorks: 'Fresh MACD crossover. Strong fundamentals (Excellent).',
    whyThisCanFail: 'Trend not fully aligned.',
    executionStrategy: 'Breakout entry — buy on close above resistance with volume',
    scoreBreakdown: { trend: 11, momentum: 14, volume: 9, priceAction: 8, riskReward: 10, psychology: 5, fundamentals: 8.5, marketContext: 5 },
    fundamentals: { peRatio: 19.5, roe: 16.8, debtToEquity: 0.1, revenueGrowth: 18.2, profitMargin: 32.5, marketCap: 12.4e12, fiftyTwoWeekHigh: 1780, fiftyTwoWeekLow: 1420, fundamentalScore: 8.5, fundamentalRating: 'Excellent' },
    validationWarnings: [],
  },
  {
    symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy',
    currentMarketPrice: 1285.40, dayChange: -0.35,
    entryPrice: 1285.40, stopLoss: 1252.00, targetPrice: 1369.00, riskRewardRatio: 2.5,
    riskAmount: 750, quantity: 22, capitalRequired: 28278, percentOfCapital: 56.56,
    technicalReasoning: 'Price above EMA 20 & 50. RSI 48.1. Consolidating. ADX 22 — trend strengthening.',
    fundamentalStrength: 'PE: 28.3 | ROE: 9.2% | D/E: 0.4. Fundamental rating: Average (5.8/10).',
    sentimentInsight: 'Negative move today (-0.35%)',
    institutionalActivity: 'Normal volume',
    confidenceScore: 55, riskLevel: 'Medium',
    whyThisWorks: 'Strong uptrend with aligned EMAs. Good R:R near support.',
    whyThisCanFail: 'Volume below average.',
    executionStrategy: 'Wait for breakout — set alert at resistance level',
    scoreBreakdown: { trend: 12, momentum: 8, volume: 4, priceAction: 8, riskReward: 7, psychology: 6, fundamentals: 5.8, marketContext: 5 },
    fundamentals: { peRatio: 28.3, roe: 9.2, debtToEquity: 0.4, revenueGrowth: 8.1, profitMargin: 8.5, marketCap: 17.3e12, fiftyTwoWeekHigh: 1420, fiftyTwoWeekLow: 1100, fundamentalScore: 5.8, fundamentalRating: 'Average' },
    validationWarnings: ['Trade uses 56.56% of capital — consider reducing size'],
  },
];

const SAMPLE_PORTFOLIO = {
  totalCapital: 50000, capitalDeployed: 37500, remainingCash: 12500, cashReserveTarget: 12500,
  totalRiskExposure: 3750, riskExposurePercent: 7.5, activeTradeCount: 3, maxTrades: 5,
  deploymentPercent: 75, sectorDistribution: { Auto: 1, Banking: 1, Energy: 1 },
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
// Index Ticker Component (memoized for performance)
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
          {isUp ? '▲' : '▼'} {Math.abs(data.change || 0).toFixed(2)} ({isUp ? '+' : ''}{data.changePercent?.toFixed(2)}%)
        </span>
      </div>
    );
  };

  return (
    <div className="index-ticker">
      {renderItem(indices.nifty50, 'NIFTY 50')}
      <div className="ticker-divider"></div>
      {renderItem(indices.sensex, 'SENSEX')}
      <div className="ticker-divider"></div>
      {renderItem(indices.bankNifty, 'BANK NIFTY')}
      <div className="ticker-divider"></div>
      <div className="ticker-item" style={{ opacity: 0.7 }}>
        <span className="ticker-name">Mood</span>
        <span className="ticker-price" style={{
          color: marketData?.marketMood === 'Bullish' ? 'var(--profit)'
            : marketData?.marketMood === 'Bearish' ? 'var(--loss)' : 'var(--warning)'
        }}>
          {marketData?.marketMood === 'Bullish' ? '🟢' : marketData?.marketMood === 'Bearish' ? '🔴' : '🟡'} {marketData?.marketMood || 'Unknown'}
        </span>
      </div>
    </div>
  );
});

// ============================================================
// Theme Toggle Slider — CSS pill switch with sun/moon icons
// ============================================================
const ThemeToggle = React.memo(function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className={`theme-toggle-switch ${theme === 'light' ? 'is-light' : ''}`}
      onClick={onToggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      <span className="tts-moon" aria-hidden="true">🌙</span>
      <span className="tts-track">
        <span className="tts-thumb" />
      </span>
      <span className="tts-sun" aria-hidden="true">☀️</span>
    </button>
  );
});

// ============================================================
// Main App
// ============================================================
export default function App() {
  const [scanMode, setScanMode] = useState('stocks');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [trades, setTrades] = useState(SAMPLE_TRADES);
  const [etfTrades, setEtfTrades] = useState([]);
  const [portfolio, setPortfolio] = useState(SAMPLE_PORTFOLIO);
  const [etfPortfolio, setEtfPortfolio] = useState(null);
  const [marketData, setMarketData] = useState(SAMPLE_MARKET);
  const [alerts, setAlerts] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [scanTime, setScanTime] = useState(null);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [nextRefreshIn, setNextRefreshIn] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  const previousTradesRef = useRef([]);
  const autoRefreshTimer = useRef(null);
  const countdownTimer = useRef(null);

  // Current display data based on mode
  const activeTrades = scanMode === 'stocks' ? trades : etfTrades;
  const activePortfolio = scanMode === 'stocks' ? portfolio : (etfPortfolio || portfolio);

  // Theme sync — also update browser chrome theme-color meta tag
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const metaTheme = document.getElementById('meta-theme-color');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#0a0e1a' : '#f8fafc');
    }
  }, [theme]);

  const toggleTheme = useCallback(() => setTheme(prev => prev === 'dark' ? 'light' : 'dark'), []);

  useEffect(() => { setAlerts(generateAlerts(SAMPLE_TRADES)); }, []);

  const fetchMarketOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/market-overview');
      if (res.ok) {
        const data = await res.json();
        setMarketData(data);
        setIsLive(true);
      }
    } catch { /* fall back to sample */ }
  }, []);

  const runScan = useCallback(async (silent = false) => {
    if (!silent) setScanning(true);
    setError(null);
    try {
      const endpoint = scanMode === 'etf' ? '/api/scan-etf?refresh=true' : '/api/scan?refresh=true';
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error('Scan failed');
      const data = await res.json();

      if (data.trades && data.trades.length > 0) {
        const newAlerts = generateAlerts(data.trades, previousTradesRef.current);
        previousTradesRef.current = data.trades;

        if (scanMode === 'stocks') {
          setTrades(data.trades);
          setPortfolio(data.portfolio);
        } else {
          setEtfTrades(data.trades);
          setEtfPortfolio(data.portfolio);
        }

        setAlerts(prev => [...newAlerts, ...prev].slice(0, 30));
        setScanTime(data.scannedAt || new Date().toISOString());
        setIsLive(true);
        setNextRefreshIn(AUTO_REFRESH_INTERVAL / 1000);
      } else if (!silent) {
        setError(`No actionable ${scanMode === 'etf' ? 'ETF' : 'stock'} setups found. Market may be closed or no setups meet criteria.`);
      }

      fetchMarketOverview();
    } catch (err) {
      console.error('Scan error:', err);
      if (!silent) {
        setError('Backend not reachable. Showing sample data. Start the server with: node server.js');
      }
    } finally {
      if (!silent) setScanning(false);
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

  // Fetch market overview on mount
  useEffect(() => { fetchMarketOverview(); }, [fetchMarketOverview]);

  // ✅ Auto-fetch data on first DOM load (silent — no loading spinner shown)
  useEffect(() => {
    runScan(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // fire once on mount only

  // Non-blocking tab switch using React's startTransition
  const handleTabChange = useCallback((tab) => {
    startTransition(() => setActiveTab(tab));
  }, []);

  return (
    <div className="app">
      {/* Index Ticker Bar */}
      <IndexTicker marketData={marketData} />

      {/* Header */}
      <header className="header">
        <div className="header-brand">
          <img src="/logo.png" alt="SwingPro" className="header-logo" loading="eager" />
          <div>
            <h1 className="header-title">SwingPro</h1>
            <p className="header-subtitle">AI-Powered NSE Swing Trading</p>
          </div>
        </div>
        <div className="header-actions">
          {/* Stocks / ETF toggle */}
          <div className="mode-toggle">
            <button className={`mode-btn ${scanMode === 'stocks' ? 'active' : ''}`} onClick={() => setScanMode('stocks')}>
              📊 Stocks
            </button>
            <button className={`mode-btn ${scanMode === 'etf' ? 'active' : ''}`} onClick={() => setScanMode('etf')}>
              📦 ETFs
            </button>
          </div>

          {/* Light / Dark toggle */}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />

          <button
            className={`auto-refresh-toggle ${autoRefresh ? 'active' : ''}`}
            onClick={() => setAutoRefresh(prev => !prev)}
          >
            {autoRefresh ? '🔄' : '⏸️'}
            <span className="auto-refresh-label">{autoRefresh ? 'Auto' : 'Manual'}</span>
            {autoRefresh && nextRefreshIn && <span className="countdown-text">{nextRefreshIn}s</span>}
          </button>

          <div className="header-status">
            <span className={`status-dot ${scanning ? 'scanning' : isLive ? '' : 'offline'}`}></span>
            <span className="status-text">{scanning ? 'Scanning...' : isLive ? 'Live' : 'Sample'}</span>
          </div>

          <button className="btn-scan" id="scan-button" onClick={() => runScan(false)} disabled={scanning}>
            {scanning ? <span className="spinner"></span> : '🔍'}
            {scanning ? 'Wait...' : 'Scan'}
          </button>
        </div>
      </header>

      {/* Sample disclaimer — hidden once live data is fetched */}
      {!isLive && (
        <div className="info-banner">
          ℹ️ Fetching live data… or showing sample data if backend is offline. Click{' '}
          <strong>Scan {scanMode === 'etf' ? 'ETFs' : 'Market'}</strong> to refresh.
        </div>
      )}

      {/* Tabs */}
      <div className="tabs" id="main-tabs">
        {['dashboard', 'trades', 'portfolio'].map(tab => (
          <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => handleTabChange(tab)}>
            {tab === 'dashboard' ? '📊 Dashboard' : tab === 'trades' ? `📋 ${scanMode === 'etf' ? 'ETFs' : 'Trades'}` : '💼 Portfolio'}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="error-banner">
          ⚠️ {error}
        </div>
      )}

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div className="dashboard-grid">
          <div className="main-content">
            {scanning ? (
              <>{[1,2,3].map(i => <div key={i} className="loading-skeleton skeleton-card"></div>)}</>
            ) : activeTrades.length > 0 ? (
              <>
                {activeTrades.slice(0, 3).map(trade => <TradeCard key={trade.symbol} trade={trade} />)}
                {activeTrades.length > 3 && (
                  <div style={{ textAlign: 'center', padding: '12px' }}>
                    <button className="tab active" style={{ cursor: 'pointer' }} onClick={() => handleTabChange('trades')}>
                      View all {activeTrades.length} {scanMode === 'etf' ? 'ETFs' : 'trades'} →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">{scanMode === 'etf' ? '📦' : '📈'}</div>
                <div className="empty-title">No {scanMode === 'etf' ? 'ETF Setups' : 'Trades'} Yet</div>
                <div className="empty-text">
                  Click &quot;Scan {scanMode === 'etf' ? 'ETFs' : 'Market'}&quot; to find high-confidence swing setups.
                </div>
              </div>
            )}
            {scanTime && (
              <div className="scan-timestamp">
                Last scan: {new Date(scanTime).toLocaleString('en-IN')}
                {marketData?.isMarketOpen ? ' • 🟢 Market Open' : ' • 🔴 Market Closed'}
              </div>
            )}
          </div>
          <div className="sidebar">
            <PortfolioSummary portfolio={activePortfolio} />
            <MarketOverview marketData={marketData} />
            <AlertPanel alerts={alerts} />
          </div>
        </div>
      )}

      {/* Trades / ETFs Tab */}
      {activeTab === 'trades' && (
        <div>
          {activeTrades.map(trade => <TradeCard key={trade.symbol} trade={trade} />)}
          {activeTrades.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">{scanMode === 'etf' ? '📦' : '📋'}</div>
              <div className="empty-title">No {scanMode === 'etf' ? 'ETFs' : 'Trades'}</div>
              <div className="empty-text">Run a scan to discover setups.</div>
            </div>
          )}
        </div>
      )}

      {/* Portfolio Tab */}
      {activeTab === 'portfolio' && (
        <div className="dashboard-grid">
          <div className="main-content">
            <div className="card" style={{ marginBottom: '20px' }}>
              <div className="card-header">
                <div className="card-title">
                  <span className="icon">📊</span> Active {scanMode === 'etf' ? 'ETF ' : ''}Positions
                </div>
              </div>
              {activeTrades.length > 0 ? (
                <div className="portfolio-table-wrapper">
                  <table className="portfolio-table">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {['Stock', 'CMP', 'Chg%', 'Entry', 'SL', 'Target', 'Qty', 'Capital', 'Score'].map(h => (
                          <th key={h} className="portfolio-th">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeTrades.map(t => (
                        <tr key={t.symbol} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
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
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                  No active positions
                </div>
              )}
            </div>
          </div>
          <div className="sidebar">
            <PortfolioSummary portfolio={activePortfolio} />
          </div>
        </div>
      )}

      {/* Mobile sticky bottom scan bar — visible only on small screens via CSS */}
      <div className="mobile-action-bar">
        <button className="btn-scan mobile-scan-btn" onClick={() => runScan(false)} disabled={scanning}>
          {scanning ? <span className="spinner"></span> : '🔍'}
          {scanning ? 'Scanning...' : `Scan ${scanMode === 'etf' ? 'ETFs' : 'Market'}`}
        </button>
        <div className="header-status">
          <span className={`status-dot ${scanning ? 'scanning' : isLive ? '' : 'offline'}`}></span>
          <span>{scanning ? 'Scanning...' : isLive ? 'Live' : 'Sample'}</span>
        </div>
      </div>
    </div>
  );
}
