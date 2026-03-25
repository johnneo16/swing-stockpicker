import React, { useState, useEffect, useCallback, useRef } from 'react';
import TradeCard from './components/TradeCard.jsx';
import PortfolioSummary from './components/PortfolioSummary.jsx';
import MarketOverview from './components/MarketOverview.jsx';
import AlertPanel, { generateAlerts } from './components/AlertPanel.jsx';

// ---- Sample / Demo Data (used when backend is not running) ----
const SAMPLE_TRADES = [
  {
    symbol: 'TATAMOTORS',
    name: 'Tata Motors',
    sector: 'Auto',
    entryPrice: 745.50,
    stopLoss: 718.30,
    targetPrice: 813.50,
    riskRewardRatio: 2.5,
    riskAmount: 750,
    quantity: 27,
    capitalRequired: 20128,
    percentOfCapital: 40.26,
    technicalReasoning: 'Price above EMA 20 & 50 — uptrend confirmed. RSI 54.2 — healthy momentum zone. MACD above signal — positive momentum. Volume above average (1.34x) — good participation.',
    fundamentalStrength: 'Strong revenue growth in EV segment. PE ratio attractive compared to sector average.',
    sentimentInsight: 'Positive momentum today (+1.82%) — market sentiment supportive',
    institutionalActivity: 'Volume 1.34x above average — possible institutional accumulation',
    confidenceScore: 72,
    riskLevel: 'Low',
    whyThisWorks: 'Strong uptrend with aligned EMAs. Above-average volume confirmation. RSI in healthy momentum zone.',
    whyThisCanFail: 'Near resistance — potential rejection. General market risk — always use stop loss.',
    executionStrategy: 'Trend continuation — enter on minor pullback to EMA 20',
    scoreBreakdown: { trend: 17, momentum: 14, volume: 10, priceAction: 10, riskReward: 12, psychology: 9 },
    validationWarnings: [],
  },
  {
    symbol: 'HDFCBANK',
    name: 'HDFC Bank',
    sector: 'Banking',
    entryPrice: 1642.75,
    stopLoss: 1598.00,
    targetPrice: 1755.00,
    riskRewardRatio: 2.51,
    riskAmount: 750,
    quantity: 16,
    capitalRequired: 26284,
    percentOfCapital: 52.57,
    technicalReasoning: 'Price above EMA 20 — short-term bullish. RSI 58.7 — healthy momentum zone. MACD bullish crossover — fresh momentum. Volume above average (1.52x) — good participation.',
    fundamentalStrength: 'India\'s largest private bank. Consistent profit growth, strong ROE.',
    sentimentInsight: 'Positive momentum today (+0.94%) — market sentiment supportive',
    institutionalActivity: 'Volume 1.52x above average — possible institutional accumulation',
    confidenceScore: 68,
    riskLevel: 'Low',
    whyThisWorks: 'Fresh MACD crossover signal. Above-average volume confirmation. RSI in healthy momentum zone.',
    whyThisCanFail: 'Trend not fully aligned — conflicting signals. General market risk — always use stop loss.',
    executionStrategy: 'Breakout entry — buy on close above resistance with volume',
    scoreBreakdown: { trend: 14, momentum: 16, volume: 12, priceAction: 8, riskReward: 12, psychology: 6 },
    validationWarnings: [],
  },
  {
    symbol: 'RELIANCE',
    name: 'Reliance Industries',
    sector: 'Energy',
    entryPrice: 1285.40,
    stopLoss: 1252.00,
    targetPrice: 1369.00,
    riskRewardRatio: 2.5,
    riskAmount: 750,
    quantity: 22,
    capitalRequired: 28278,
    percentOfCapital: 56.56,
    technicalReasoning: 'Price above EMA 20 & 50 — uptrend confirmed. RSI 48.1 — healthy momentum zone. Consolidating — potential breakout setup.',
    fundamentalStrength: 'Diversified conglomerate with strong retail and telecom segments.',
    sentimentInsight: 'Negative move today (-0.35%) — watch for reversal confirmation',
    institutionalActivity: 'Normal volume — no significant institutional signals',
    confidenceScore: 58,
    riskLevel: 'Medium',
    whyThisWorks: 'Strong uptrend with aligned EMAs. Good risk-reward near support.',
    whyThisCanFail: 'Volume below average — weak participation. Already extended today — FOMO risk. General market risk — always use stop loss.',
    executionStrategy: 'Wait for breakout — set alert at resistance level',
    scoreBreakdown: { trend: 15, momentum: 10, volume: 5, priceAction: 10, riskReward: 10, psychology: 8 },
    validationWarnings: ['Trade uses 56.56% of capital — consider reducing size'],
  },
  {
    symbol: 'INFY',
    name: 'Infosys',
    sector: 'IT',
    entryPrice: 1528.60,
    stopLoss: 1490.00,
    targetPrice: 1625.15,
    riskRewardRatio: 2.5,
    riskAmount: 750,
    quantity: 19,
    capitalRequired: 29043,
    percentOfCapital: 58.09,
    technicalReasoning: 'RSI 42.5 — oversold bounce potential. MACD above signal — positive momentum. Volume above average (1.18x) — good participation. Consolidating — potential breakout setup.',
    fundamentalStrength: 'Strong order book, consistent dividend payer. Second largest IT company.',
    sentimentInsight: 'Positive momentum today (+1.25%) — market sentiment supportive',
    institutionalActivity: 'Volume 1.18x above average — possible institutional accumulation',
    confidenceScore: 55,
    riskLevel: 'Medium',
    whyThisWorks: 'Fresh MACD crossover signal. Good risk-reward near support. RSI in healthy momentum zone.',
    whyThisCanFail: 'Trend not fully aligned — conflicting signals. Near resistance — potential rejection. General market risk — always use stop loss.',
    executionStrategy: 'Pullback entry — buy near support with RSI reversal',
    scoreBreakdown: { trend: 10, momentum: 12, volume: 8, priceAction: 7, riskReward: 10, psychology: 8 },
    validationWarnings: [],
  },
  {
    symbol: 'SUNPHARMA',
    name: 'Sun Pharma',
    sector: 'Pharma',
    entryPrice: 1712.30,
    stopLoss: 1670.00,
    targetPrice: 1818.05,
    riskRewardRatio: 2.5,
    riskAmount: 750,
    quantity: 17,
    capitalRequired: 29109,
    percentOfCapital: 58.22,
    technicalReasoning: 'Price above EMA 20 — short-term bullish. RSI 51.3 — healthy momentum zone. MACD above signal — positive momentum. Breaking out of consolidation with volume.',
    fundamentalStrength: 'Market leader in Indian pharma. Strong pipeline and US generics business.',
    sentimentInsight: 'Positive momentum today (+2.10%) — market sentiment supportive',
    institutionalActivity: 'Volume 1.68x above average — possible institutional accumulation',
    confidenceScore: 64,
    riskLevel: 'Medium',
    whyThisWorks: 'Breakout with volume support. Above-average volume confirmation. RSI in healthy momentum zone.',
    whyThisCanFail: 'Near resistance — potential rejection. High ATR — volatile stock, wider stops needed. General market risk — always use stop loss.',
    executionStrategy: 'Breakout entry — buy on close above resistance with volume',
    scoreBreakdown: { trend: 12, momentum: 13, volume: 12, priceAction: 11, riskReward: 8, psychology: 8 },
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
    nifty50: { name: 'NIFTY 50', price: 23344.75, change: 128.45, changePercent: 0.55, dayHigh: 23389, dayLow: 23215 },
    bankNifty: { name: 'BANK NIFTY', price: 49872.30, change: -45.80, changePercent: -0.09, dayHigh: 49950, dayLow: 49680 },
  },
  marketMood: 'Bullish',
};

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
  const previousTradesRef = useRef([]);

  // Generate initial alerts from sample data
  useEffect(() => {
    const initialAlerts = generateAlerts(SAMPLE_TRADES);
    setAlerts(initialAlerts);
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
  const runScan = useCallback(async () => {
    setScanning(true);
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
        setAlerts(prev => [...newAlerts, ...prev].slice(0, 20));
        setScanTime(data.scannedAt || new Date().toISOString());
        setIsLive(true);
      } else {
        setError('No actionable trades found. Market may be closed or no setups meet criteria.');
      }
    } catch (err) {
      console.error('Scan error:', err);
      setError('Backend not reachable. Showing sample data. Start the server with: node server.js');
    } finally {
      setScanning(false);
    }
  }, []);

  // Try to connect to backend on mount
  useEffect(() => {
    fetchMarketOverview();
  }, [fetchMarketOverview]);

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
          <div className="header-status">
            <span className={`status-dot ${scanning ? 'scanning' : isLive ? '' : 'offline'}`}></span>
            {scanning ? 'Scanning...' : isLive ? 'Live Data' : 'Sample Mode'}
          </div>
          <button
            className="btn-scan"
            id="scan-button"
            onClick={runScan}
            disabled={scanning}
          >
            {scanning ? <span className="spinner"></span> : '🔍'}
            {scanning ? 'Scanning Market...' : 'Scan Market'}
          </button>
        </div>
      </header>

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
                  <table style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '0.85rem',
                  }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {['Stock', 'Entry', 'SL', 'Target', 'Qty', 'Capital', 'Confidence'].map(h => (
                          <th key={h} style={{
                            padding: '10px 12px',
                            textAlign: 'left',
                            color: 'var(--text-muted)',
                            fontWeight: 500,
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                          }}>
                            {h}
                          </th>
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
                          <td style={{ padding: '12px', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>₹{t.entryPrice}</td>
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
