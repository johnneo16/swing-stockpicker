import React, { useState, useEffect, useCallback, useRef } from 'react';
import TradeCard from './components/TradeCard.jsx';
import PortfolioSummary from './components/PortfolioSummary.jsx';
import MarketOverview from './components/MarketOverview.jsx';
import AlertPanel, { generateAlerts } from './components/AlertPanel.jsx';

// ---- Sample / Demo Data (shown until backend is connected) ----
// NOTE: These are ILLUSTRATIVE prices, not live market data.
// Click "Scan Market" to fetch real-time prices from Yahoo Finance.
const SAMPLE_TRADES = [
  {
    symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto',
    currentMarketPrice: 745.50, dayChange: 1.82,
    entryPrice: 745.50, stopLoss: 718.30, targetPrice: 813.50, riskRewardRatio: 2.5,
    riskAmount: 750, quantity: 27, capitalRequired: 20128, percentOfCapital: 40.26,
    technicalReasoning: 'Price above EMA 20 & 50 — uptrend confirmed. RSI 54.2 — healthy momentum zone. MACD above signal — positive momentum. ADX 28 — strong trend in place.',
    fundamentalStrength: 'PE: 8.2 | ROE: 28.5% | D/E: 1.1 | Rev Growth: 12.3%. Fundamental rating: Good (7.2/10).',
    sentimentInsight: 'Positive momentum today (+1.82%) — market sentiment supportive',
    institutionalActivity: 'Volume 1.34x above average — possible institutional accumulation',
    confidenceScore: 72, riskLevel: 'Low',
    whyThisWorks: 'Strong uptrend with aligned EMAs. ADX confirms strong trending move. Above-average volume confirmation.',
    whyThisCanFail: 'Near resistance — potential rejection. General market risk — always use stop loss.',
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
    technicalReasoning: 'Price above EMA 20 — short-term bullish. RSI 58.7. MACD bullish crossover — fresh momentum. Bollinger Band squeeze — potential breakout imminent.',
    fundamentalStrength: 'PE: 19.5 | ROE: 16.8% | D/E: 0.1 | Rev Growth: 18.2%. Fundamental rating: Excellent (8.5/10).',
    sentimentInsight: 'Positive momentum today (+0.94%) — market sentiment supportive',
    institutionalActivity: 'Volume 1.52x above average — possible institutional accumulation',
    confidenceScore: 68, riskLevel: 'Low',
    whyThisWorks: 'Fresh MACD crossover signal. Above-average volume confirmation. Strong fundamentals (Excellent).',
    whyThisCanFail: 'Trend not fully aligned — conflicting signals. General market risk.',
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
    technicalReasoning: 'Price above EMA 20 & 50 — uptrend confirmed. RSI 48.1. Consolidating — potential breakout setup. ADX 22 — trend strengthening.',
    fundamentalStrength: 'PE: 28.3 | ROE: 9.2% | D/E: 0.4 | Rev Growth: 8.1%. Fundamental rating: Average (5.8/10).',
    sentimentInsight: 'Negative move today (-0.35%) — watch for reversal confirmation',
    institutionalActivity: 'Normal volume — no significant institutional signals',
    confidenceScore: 55, riskLevel: 'Medium',
    whyThisWorks: 'Strong uptrend with aligned EMAs. Good risk-reward near support.',
    whyThisCanFail: 'Volume below average — weak participation. General market risk.',
    executionStrategy: 'Wait for breakout — set alert at resistance level',
    scoreBreakdown: { trend: 12, momentum: 8, volume: 4, priceAction: 8, riskReward: 7, psychology: 6, fundamentals: 5.8, marketContext: 5 },
    fundamentals: { peRatio: 28.3, roe: 9.2, debtToEquity: 0.4, revenueGrowth: 8.1, profitMargin: 8.5, marketCap: 17.3e12, fiftyTwoWeekHigh: 1420, fiftyTwoWeekLow: 1100, fundamentalScore: 5.8, fundamentalRating: 'Average' },
    validationWarnings: ['Trade uses 56.56% of capital — consider reducing size'],
  },
  {
    symbol: 'INFY', name: 'Infosys', sector: 'IT',
    currentMarketPrice: 1528.60, dayChange: 1.25,
    entryPrice: 1528.60, stopLoss: 1490.00, targetPrice: 1625.15, riskRewardRatio: 2.5,
    riskAmount: 750, quantity: 19, capitalRequired: 29043, percentOfCapital: 58.09,
    technicalReasoning: 'RSI 42.5 — oversold bounce potential. MACD above signal. Near lower Bollinger Band — potential mean reversion.',
    fundamentalStrength: 'PE: 24.1 | ROE: 33.2% | D/E: 0.1 | Rev Growth: 5.2%. Fundamental rating: Good (7.0/10).',
    sentimentInsight: 'Positive momentum today (+1.25%) — market sentiment supportive',
    institutionalActivity: 'Volume 1.18x above average — possible institutional accumulation',
    confidenceScore: 52, riskLevel: 'Medium',
    whyThisWorks: 'Good risk-reward near support. RSI in healthy momentum zone. Strong fundamentals (Good).',
    whyThisCanFail: 'Trend not fully aligned. Near resistance — potential rejection.',
    executionStrategy: 'Mean reversion — buy at lower BB with RSI oversold confirmation',
    scoreBreakdown: { trend: 8, momentum: 10, volume: 7, priceAction: 6, riskReward: 7, psychology: 5, fundamentals: 7, marketContext: 5 },
    fundamentals: { peRatio: 24.1, roe: 33.2, debtToEquity: 0.1, revenueGrowth: 5.2, profitMargin: 20.1, marketCap: 6.3e12, fiftyTwoWeekHigh: 1680, fiftyTwoWeekLow: 1350, fundamentalScore: 7.0, fundamentalRating: 'Good' },
    validationWarnings: [],
  },
  {
    symbol: 'SUNPHARMA', name: 'Sun Pharma', sector: 'Pharma',
    currentMarketPrice: 1712.30, dayChange: 2.10,
    entryPrice: 1712.30, stopLoss: 1670.00, targetPrice: 1818.05, riskRewardRatio: 2.5,
    riskAmount: 750, quantity: 17, capitalRequired: 29109, percentOfCapital: 58.22,
    technicalReasoning: 'Price above EMA 20 — short-term bullish. RSI 51.3. MACD above signal. Breaking out of consolidation with volume.',
    fundamentalStrength: 'PE: 35.2 | ROE: 14.8% | D/E: 0.2 | Rev Growth: 11.5%. Fundamental rating: Good (6.5/10).',
    sentimentInsight: 'Positive momentum today (+2.10%) — market sentiment supportive',
    institutionalActivity: 'Volume 1.68x above average — possible institutional accumulation',
    confidenceScore: 61, riskLevel: 'Medium',
    whyThisWorks: 'Breakout with volume support. Above-average volume confirmation.',
    whyThisCanFail: 'Near resistance — potential rejection. High ATR — volatile stock.',
    executionStrategy: 'Breakout entry — buy on close above resistance with volume',
    scoreBreakdown: { trend: 10, momentum: 11, volume: 10, priceAction: 9, riskReward: 7, psychology: 5, fundamentals: 6.5, marketContext: 5 },
    fundamentals: { peRatio: 35.2, roe: 14.8, debtToEquity: 0.2, revenueGrowth: 11.5, profitMargin: 18.3, marketCap: 4.1e12, fiftyTwoWeekHigh: 1850, fiftyTwoWeekLow: 1240, fundamentalScore: 6.5, fundamentalRating: 'Good' },
    validationWarnings: [],
  },
];

const SAMPLE_PORTFOLIO = {
  totalCapital: 50000,
  capitalDeployed: 37500,
  remainingCash: 12500,
  cashReserveTarget: 12500,
  totalRiskExposure: 3750,
  riskExposurePercent: 7.5,
  activeTradeCount: 5,
  maxTrades: 5,
  deploymentPercent: 75,
  sectorDistribution: { Auto: 1, Banking: 1, Energy: 1, IT: 1, Pharma: 1 },
};

const SAMPLE_MARKET = {
  indices: {
    nifty50: { name: 'NIFTY 50', price: 23344.75, change: 128.45, changePercent: 0.55 },
    bankNifty: { name: 'BANK NIFTY', price: 49872.30, change: -45.80, changePercent: -0.09 },
  },
  marketMood: 'Bullish',
  isMarketOpen: false,
};

// Auto-refresh interval (60 seconds)
const AUTO_REFRESH_INTERVAL = 60 * 1000;

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [trades, setTrades] = useState(SAMPLE_TRADES);
  const [portfolio, setPortfolio] = useState(SAMPLE_PORTFOLIO);
  const [marketData, setMarketData] = useState(SAMPLE_MARKET);
  const [alerts, setAlerts] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [scanTime, setScanTime] = useState(null);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [nextRefreshIn, setNextRefreshIn] = useState(null);
  const previousTradesRef = useRef([]);
  const autoRefreshTimer = useRef(null);
  const countdownTimer = useRef(null);

  // Generate initial alerts from sample data
  useEffect(() => {
    setAlerts(generateAlerts(SAMPLE_TRADES));
  }, []);

  // Fetch market overview
  const fetchMarketOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/market-overview');
      if (res.ok) {
        const data = await res.json();
        setMarketData(data);
        setIsLive(true);
      }
    } catch {
      // Silently fall back to sample data
    }
  }, []);

  // Run scan
  const runScan = useCallback(async (silent = false) => {
    if (!silent) setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/scan?refresh=true');
      if (!res.ok) throw new Error('Scan failed');
      const data = await res.json();

      if (data.trades && data.trades.length > 0) {
        const newAlerts = generateAlerts(data.trades, previousTradesRef.current);
        previousTradesRef.current = data.trades;
        setTrades(data.trades);
        setPortfolio(data.portfolio);
        setAlerts(prev => [...newAlerts, ...prev].slice(0, 30));
        setScanTime(data.scannedAt || new Date().toISOString());
        setIsLive(true);
        // Reset countdown
        setNextRefreshIn(AUTO_REFRESH_INTERVAL / 1000);
      } else if (!silent) {
        setError('No actionable trades found. Market may be closed or no setups meet criteria.');
      }

      // Also refresh market overview
      fetchMarketOverview();
    } catch (err) {
      console.error('Scan error:', err);
      if (!silent) {
        setError('Backend not reachable. Showing sample data. Start the server with: node server.js');
      }
    } finally {
      if (!silent) setScanning(false);
    }
  }, [fetchMarketOverview]);

  // Auto-refresh logic
  useEffect(() => {
    if (autoRefresh) {
      // Poll every 60s (backend has its own 5-min cache)
      autoRefreshTimer.current = setInterval(() => {
        runScan(true);
      }, AUTO_REFRESH_INTERVAL);

      // Countdown timer
      setNextRefreshIn(AUTO_REFRESH_INTERVAL / 1000);
      countdownTimer.current = setInterval(() => {
        setNextRefreshIn(prev => {
          if (prev <= 1) return AUTO_REFRESH_INTERVAL / 1000;
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (autoRefreshTimer.current) clearInterval(autoRefreshTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      setNextRefreshIn(null);
    };
  }, [autoRefresh, runScan]);

  // Try to connect to backend on mount
  useEffect(() => {
    fetchMarketOverview();
  }, [fetchMarketOverview]);

  const toggleAutoRefresh = () => setAutoRefresh(prev => !prev);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">S</div>
          <div>
            <h1 className="header-title">SwingPro</h1>
            <p className="header-subtitle">AI-Powered NSE Swing Trading Platform</p>
          </div>
        </div>
        <div className="header-actions">
          {/* Auto-refresh toggle */}
          <button
            className={`auto-refresh-toggle ${autoRefresh ? 'active' : ''}`}
            onClick={toggleAutoRefresh}
            title={autoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh (polls every 60s)'}
          >
            {autoRefresh ? '🔄' : '⏸️'}
            {autoRefresh ? 'Auto' : 'Manual'}
            {autoRefresh && nextRefreshIn && (
              <span className="countdown-text">{nextRefreshIn}s</span>
            )}
          </button>

          <div className="header-status">
            <span className={`status-dot ${scanning ? 'scanning' : isLive ? '' : 'offline'}`}></span>
            {scanning ? 'Scanning...' : isLive ? 'Live Data' : 'Sample Mode'}
          </div>
          <button
            className="btn-scan"
            id="scan-button"
            onClick={() => runScan(false)}
            disabled={scanning}
          >
            {scanning ? <span className="spinner"></span> : '🔍'}
            {scanning ? 'Scanning Market...' : 'Scan Market'}
          </button>
        </div>
      </header>

      {/* Sample mode disclaimer */}
      {!isLive && (
        <div style={{
          padding: '10px 16px',
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.15)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '16px',
          fontSize: '0.82rem',
          color: 'var(--accent-indigo)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          ℹ️ Showing sample data for preview. Click <strong>Scan Market</strong> to fetch live prices from Yahoo Finance.
        </div>
      )}

      {/* Tabs */}
      <div className="tabs" id="main-tabs">
        {['dashboard', 'trades', 'portfolio'].map(tab => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'dashboard' ? '📊 Dashboard' : tab === 'trades' ? '📋 All Trades' : '💼 Portfolio'}
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{
          padding: '12px 18px',
          background: 'var(--warning-bg)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '20px',
          fontSize: '0.85rem',
          color: 'var(--warning)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div className="dashboard-grid">
          <div className="main-content">
            {scanning ? (
              <>
                <div className="loading-skeleton skeleton-card"></div>
                <div className="loading-skeleton skeleton-card"></div>
                <div className="loading-skeleton skeleton-card"></div>
              </>
            ) : trades.length > 0 ? (
              <>
                {trades.slice(0, 3).map(trade => (
                  <TradeCard key={trade.symbol} trade={trade} />
                ))}
                {trades.length > 3 && (
                  <div style={{ textAlign: 'center', padding: '12px' }}>
                    <button
                      className="tab active"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setActiveTab('trades')}
                    >
                      View all {trades.length} trades →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📈</div>
                <div className="empty-title">No Trades Yet</div>
                <div className="empty-text">
                  Click "Scan Market" to analyze NSE stocks and find high-confidence swing trade setups.
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
            <PortfolioSummary portfolio={portfolio} />
            <MarketOverview marketData={marketData} />
            <AlertPanel alerts={alerts} />
          </div>
        </div>
      )}

      {/* All Trades Tab */}
      {activeTab === 'trades' && (
        <div>
          {trades.map(trade => (
            <TradeCard key={trade.symbol} trade={trade} />
          ))}
          {trades.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <div className="empty-title">No Trades</div>
              <div className="empty-text">Run a market scan to discover trade setups.</div>
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
                <div className="card-title"><span className="icon">📊</span> Active Positions</div>
              </div>
              {trades.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {['Stock', 'CMP', 'Change', 'Entry', 'SL', 'Target', 'Qty', 'Capital', 'Score'].map(h => (
                          <th key={h} style={{
                            padding: '10px 12px', textAlign: 'left', color: 'var(--text-muted)',
                            fontWeight: 500, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map(t => (
                        <tr key={t.symbol} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '12px', fontWeight: 600 }}>
                            {t.symbol}
                            <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{t.sector}</span>
                          </td>
                          <td style={{ padding: '12px', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                            ₹{(t.currentMarketPrice || t.entryPrice).toLocaleString('en-IN')}
                          </td>
                          <td style={{ padding: '12px', fontFamily: 'var(--font-mono)', color: (t.dayChange || 0) >= 0 ? 'var(--profit)' : 'var(--loss)' }}>
                            {(t.dayChange || 0) >= 0 ? '+' : ''}{t.dayChange || 0}%
                          </td>
                          <td style={{ padding: '12px', fontFamily: 'var(--font-mono)' }}>₹{t.entryPrice}</td>
                          <td style={{ padding: '12px', fontFamily: 'var(--font-mono)', color: 'var(--loss)' }}>₹{t.stopLoss}</td>
                          <td style={{ padding: '12px', fontFamily: 'var(--font-mono)', color: 'var(--profit)' }}>₹{t.targetPrice}</td>
                          <td style={{ padding: '12px', fontFamily: 'var(--font-mono)' }}>{t.quantity}</td>
                          <td style={{ padding: '12px', fontFamily: 'var(--font-mono)' }}>₹{t.capitalRequired?.toLocaleString('en-IN')}</td>
                          <td style={{ padding: '12px' }}>
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
            <PortfolioSummary portfolio={portfolio} />
          </div>
        </div>
      )}
    </div>
  );
}
