import React, { Suspense } from 'react';
import {
  BarChart2, TrendingUp, Newspaper, CheckCircle2,
  AlertTriangle, Target, AlertCircle, Star, ArrowUpRight,
  ArrowRight, ArrowDownRight, XCircle, ExternalLink
} from 'lucide-react';

const MiniChart = React.lazy(() => import('./MiniChart'));

const TradeCard = ({ trade }) => {
  const confidenceClass = trade.confidenceScore >= 65 ? 'high' : trade.confidenceScore >= 45 ? 'medium' : 'low';
  const fund = trade.fundamentals;
  // Determine if we have any valid fundamental data at all.
  const hasFundamentals = fund && (fund.peRatio || fund.roe || fund.marketCap);

  return (
    <div className={`trade-card${trade.lowConfidence ? ' trade-card-low-conf' : ''}`} id={`trade-${trade.symbol}`}>
      {trade.lowConfidence && (
        <div className="low-conf-banner">
          ⚠ Watch Only — Score below threshold, verify before acting
        </div>
      )}
      {/* ---- Header ---- */}
      <div className="trade-card-header">
        <div className="trade-stock-info">
          <div className="trade-stock-avatar">
            {trade.symbol.slice(0, 3)}
          </div>
          <div>
            <div className="trade-stock-name">{trade.name}</div>
            <div className="trade-stock-meta">
              <span className="trade-sector-badge">{trade.sector}</span>
              <span className={`risk-badge ${trade.riskLevel?.toLowerCase()}`}>
                {trade.riskLevel} Risk
              </span>
              {trade.setupType && (
                <span className="setup-type-badge">{trade.setupType}</span>
              )}
              {hasFundamentals && fund.fundamentalRating && (
                <span className={`fund-badge ${fund.fundamentalRating.toLowerCase()}`}>
                  FA: {fund.fundamentalRating}
                </span>
              )}
              {!hasFundamentals && (
                <span className="fund-badge na">FA: N/A</span>
              )}
              {fund?.recommendationKey && (
                <span className={`rec-badge rec-${fund.recommendationKey}`}>
                  {formatRecommendation(fund.recommendationKey)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="trade-confidence">
          <div className={`confidence-score ${confidenceClass}`}>
            {trade.confidenceScore}
          </div>
          <div className="confidence-label">Confidence</div>
          <a
            href={`https://www.tradingview.com/chart/?symbol=NSE%3A${trade.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="tv-link-btn"
            title="Verify chart on TradingView"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink size={11} /> TradingView
          </a>
          {trade.currentMarketPrice && (
            <div style={{ marginTop: '6px', textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                ₹{trade.currentMarketPrice.toLocaleString('en-IN')}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                fontWeight: 500,
                color: trade.dayChange >= 0 ? 'var(--profit)' : 'var(--loss)',
              }}>
                {trade.dayChange >= 0 ? '+' : ''}{trade.dayChange}%
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- Body ---- */}
      <div className="trade-card-body">
        {/* Price Levels */}
        <div className="trade-levels">
          <div className="level-item">
            <div className="level-label">Entry</div>
            <div className="level-value entry">₹{trade.entryPrice.toLocaleString('en-IN')}</div>
          </div>
          <div className="level-item">
            <div className="level-label">Stop Loss</div>
            <div className="level-value stop-loss">₹{trade.stopLoss.toLocaleString('en-IN')}</div>
          </div>
          <div className="level-item">
            <div className="level-label">Target</div>
            <div className="level-value target">₹{trade.targetPrice.toLocaleString('en-IN')}</div>
          </div>
          <div className="level-item">
            <div className="level-label">R:R Ratio</div>
            <div className="level-value rr">1:{trade.riskRewardRatio}</div>
          </div>
        </div>

        {/* Position Sizing */}
        <div className="position-section">
          <div className="position-item">
            <div className="position-label">Risk ₹</div>
            <div className="position-value">₹{trade.riskAmount.toLocaleString('en-IN')}</div>
          </div>
          <div className="position-item">
            <div className="position-label">Quantity</div>
            <div className="position-value">{trade.quantity} shares</div>
          </div>
          <div className="position-item">
            <div className="position-label">Capital</div>
            <div className="position-value">₹{trade.capitalRequired.toLocaleString('en-IN')}</div>
          </div>
        </div>

        {/* Mini Chart */}
        {trade.chartData && trade.chartData.length > 0 && (
          <div className="chart-wrapper" style={{ margin: '20px 0', border: '1px solid var(--border-subtle)', borderRadius: '12px', overflow: 'hidden', backgroundColor: 'var(--bg-glass)' }}>
            <Suspense fallback={<div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading Chart…</div>}>
              <MiniChart data={trade.chartData} />
            </Suspense>
          </div>
        )}

        {/* Fundamental Metrics Row */}
        {hasFundamentals ? (
          <div className="fundamentals-row">
            {fund.peRatio !== null && (
              <div className="fund-metric">
                <span className="fund-metric-label">PE</span>
                <span className="fund-metric-value">{fund.peRatio.toFixed(1)}</span>
              </div>
            )}
            {fund.roe !== null && (
              <div className="fund-metric">
                <span className="fund-metric-label">ROE</span>
                <span className="fund-metric-value">{fund.roe}%</span>
              </div>
            )}
            {fund.roce !== null && fund.roce !== undefined && (
              <div className="fund-metric">
                <span className="fund-metric-label">ROCE</span>
                <span className="fund-metric-value">{fund.roce}%</span>
              </div>
            )}
            {fund.debtToEquity !== null && fund.debtToEquity !== undefined && (
              <div className="fund-metric">
                <span className="fund-metric-label">D/E</span>
                <span className={`fund-metric-value ${fund.debtToEquity > 1.5 ? 'danger' : fund.debtToEquity < 0.5 ? 'safe' : ''}`}>
                  {fund.debtToEquity}
                </span>
              </div>
            )}
            {fund.revenueGrowth !== null && fund.revenueGrowth !== undefined && (
              <div className="fund-metric">
                <span className="fund-metric-label">Rev Gr.</span>
                <span className={`fund-metric-value ${fund.revenueGrowth > 0 ? 'safe' : 'danger'}`}>
                  {fund.revenueGrowth}%
                </span>
              </div>
            )}
            {fund.profitMargin !== null && fund.profitMargin !== undefined && (
              <div className="fund-metric">
                <span className="fund-metric-label">Margin</span>
                <span className="fund-metric-value">{fund.profitMargin}%</span>
              </div>
            )}
            {fund.marketCap > 0 && (
              <div className="fund-metric">
                <span className="fund-metric-label">Mkt Cap</span>
                <span className="fund-metric-value">{formatMktCap(fund.marketCap)}</span>
              </div>
            )}
            {fund.dividendYield > 0 && (
              <div className="fund-metric">
                <span className="fund-metric-label">Div Yld</span>
                <span className="fund-metric-value safe">{fund.dividendYield}%</span>
              </div>
            )}
            {fund.fiftyTwoWeekHigh !== null && fund.fiftyTwoWeekLow !== null && (
              <div className="fund-metric wide">
                <span className="fund-metric-label">52W Range</span>
                <span className="fund-metric-value">
                  ₹{fund.fiftyTwoWeekLow.toFixed(0)} – ₹{fund.fiftyTwoWeekHigh.toFixed(0)}
                </span>
              </div>
            )}
            {/* Analyst consensus */}
            {fund.targetMeanPrice && (
              <div className="fund-metric">
                <span className="fund-metric-label">Analyst Target</span>
                <span className="fund-metric-value safe">₹{fund.targetMeanPrice.toFixed(0)}</span>
              </div>
            )}
            {fund.numberOfAnalysts && (
              <div className="fund-metric">
                <span className="fund-metric-label">Analysts</span>
                <span className="fund-metric-value">{fund.numberOfAnalysts}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="no-fundamentals-notice">
            <BarChart2 size={16} className="inline-icon" /> Technical-only setup — fundamental data unavailable for this stock via Screener. Trade based on price action and technicals.
          </div>
        )}

        {/* Technical Analysis */}
        <div className="analysis-section">
          <div className="analysis-title"><BarChart2 size={16} className="title-icon" /> Technical Reasoning</div>
          <div className="analysis-text">{trade.technicalReasoning}</div>
        </div>

        {/* Fundamental Analysis text */}
        <div className="analysis-section">
          <div className="analysis-title"><TrendingUp size={16} className="title-icon" /> Fundamental Strength</div>
          <div className="analysis-text">{trade.fundamentalStrength}</div>
        </div>

        {/* Sentiment */}
        <div className="analysis-section">
          <div className="analysis-title"><Newspaper size={16} className="title-icon" /> Sentiment & Institutional</div>
          <div className="analysis-text">{trade.sentimentInsight}</div>
          <div className="analysis-text" style={{ marginTop: '6px' }}>{trade.institutionalActivity}</div>
        </div>

        <div className="section-divider" />

        {/* Why Works / Why Fails */}
        <div className="trader-insight">
          <div className="insight-box why-works">
            <div className="insight-title"><CheckCircle2 size={16} className="title-icon" /> Why this works</div>
            <div className="insight-text">{trade.whyThisWorks}</div>
          </div>
          <div className="insight-box why-fails">
            <div className="insight-title"><AlertTriangle size={16} className="title-icon" /> Why this can fail</div>
            <div className="insight-text">{trade.whyThisCanFail}</div>
          </div>
        </div>

        {/* Execution Strategy */}
        <div className="execution-bar">
          <span className="execution-icon"><Target size={20} /></span>
          <div>
            <div className="execution-label">Execution Strategy</div>
            <div className="execution-text">{trade.executionStrategy}</div>
          </div>
        </div>

        {/* Score Breakdown */}
        {trade.scoreBreakdown && (
          <div className="score-breakdown" title="Trend | Momentum | Volume | Price Action | R:R | Psychology | Fundamentals | Market">
            <div className="score-bar-segment trend" style={{ width: `${(trade.scoreBreakdown.trend / 15) * 100}%` }} />
            <div className="score-bar-segment momentum" style={{ width: `${(trade.scoreBreakdown.momentum / 18) * 100}%` }} />
            <div className="score-bar-segment volume" style={{ width: `${(trade.scoreBreakdown.volume / 12) * 100}%` }} />
            <div className="score-bar-segment price-action" style={{ width: `${(trade.scoreBreakdown.priceAction / 13) * 100}%` }} />
            <div className="score-bar-segment risk-reward" style={{ width: `${(trade.scoreBreakdown.riskReward / 12) * 100}%` }} />
            <div className="score-bar-segment psychology" style={{ width: `${(trade.scoreBreakdown.psychology / 10) * 100}%` }} />
            <div className="score-bar-segment fundamentals" style={{ width: `${((trade.scoreBreakdown.fundamentals || 0) / 10) * 100}%` }} />
            <div className="score-bar-segment market-ctx" style={{ width: `${((trade.scoreBreakdown.marketContext || 0) / 10) * 100}%` }} />
          </div>
        )}

        {/* Validation Warnings */}
        {trade.validationWarnings && trade.validationWarnings.length > 0 && (
          <div className="validation-warnings">
            {trade.validationWarnings.map((w, i) => (
              <div key={i} className="validation-warning"><AlertCircle size={14} className="inline-icon" /> {w}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function formatMktCap(cap) {
  if (!cap) return 'N/A';
  if (cap >= 1e12) return `₹${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e10) return `₹${(cap / 1e10).toFixed(0)}B`;
  if (cap >= 1e7) return `₹${(cap / 1e7).toFixed(0)}Cr`;
  return `₹${cap.toLocaleString('en-IN')}`;
}

function formatRecommendation(key) {
  const map = {
    strongBuy: <><Star size={12} className="inline-icon"/> Strong Buy</>,
    buy: <><ArrowUpRight size={12} className="inline-icon"/> Buy</>,
    hold: <><ArrowRight size={12} className="inline-icon"/> Hold</>,
    underperform: <><ArrowDownRight size={12} className="inline-icon"/> Underperform</>,
    sell: <><XCircle size={12} className="inline-icon"/> Sell</>,
  };
  return map[key] || key;
}

export default React.memo(TradeCard);
