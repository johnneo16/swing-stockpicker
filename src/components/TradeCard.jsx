import React from 'react';

export default function TradeCard({ trade }) {
  const confidenceClass = trade.confidenceScore >= 65 ? 'high' : trade.confidenceScore >= 45 ? 'medium' : 'low';

  return (
    <div className="trade-card" id={`trade-${trade.symbol}`}>
      {/* Header */}
      <div className="trade-card-header">
        <div className="trade-stock-info">
          <div className="trade-stock-avatar">
            {trade.symbol.slice(0, 3)}
          </div>
          <div>
            <div className="trade-stock-name">{trade.name}</div>
            <div className="trade-stock-meta">
              <span className="trade-sector-badge">{trade.sector}</span>
              <span className={`risk-badge ${trade.riskLevel.toLowerCase()}`}>
                {trade.riskLevel} Risk
              </span>
            </div>
          </div>
        </div>
        <div className="trade-confidence">
          <div className={`confidence-score ${confidenceClass}`}>
            {trade.confidenceScore}
          </div>
          <div className="confidence-label">Confidence</div>
        </div>
      </div>

      {/* Body */}
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

        {/* Technical Analysis */}
        <div className="analysis-section">
          <div className="analysis-title">📊 Technical Reasoning</div>
          <div className="analysis-text">{trade.technicalReasoning}</div>
        </div>

        {/* Sentiment */}
        <div className="analysis-section">
          <div className="analysis-title">📰 Sentiment & Institutional</div>
          <div className="analysis-text">{trade.sentimentInsight}</div>
          <div className="analysis-text" style={{ marginTop: '6px' }}>{trade.institutionalActivity}</div>
        </div>

        <div className="section-divider"></div>

        {/* Why Works / Why Fails */}
        <div className="trader-insight">
          <div className="insight-box why-works">
            <div className="insight-title">✅ Why this works</div>
            <div className="insight-text">{trade.whyThisWorks}</div>
          </div>
          <div className="insight-box why-fails">
            <div className="insight-title">⚠️ Why this can fail</div>
            <div className="insight-text">{trade.whyThisCanFail}</div>
          </div>
        </div>

        {/* Execution Strategy */}
        <div className="execution-bar">
          <span className="execution-icon">🎯</span>
          <div>
            <div className="execution-label">Execution Strategy</div>
            <div className="execution-text">{trade.executionStrategy}</div>
          </div>
        </div>

        {/* Score Breakdown */}
        {trade.scoreBreakdown && (
          <div className="score-breakdown" title="Score breakdown: Trend | Momentum | Volume | Price Action | R:R | Psychology">
            <div className="score-bar-segment trend" style={{ width: `${(trade.scoreBreakdown.trend / 100) * 100}%` }}></div>
            <div className="score-bar-segment momentum" style={{ width: `${(trade.scoreBreakdown.momentum / 100) * 100}%` }}></div>
            <div className="score-bar-segment volume" style={{ width: `${(trade.scoreBreakdown.volume / 100) * 100}%` }}></div>
            <div className="score-bar-segment price-action" style={{ width: `${(trade.scoreBreakdown.priceAction / 100) * 100}%` }}></div>
            <div className="score-bar-segment risk-reward" style={{ width: `${(trade.scoreBreakdown.riskReward / 100) * 100}%` }}></div>
            <div className="score-bar-segment psychology" style={{ width: `${(trade.scoreBreakdown.psychology / 100) * 100}%` }}></div>
          </div>
        )}

        {/* Validation Warnings */}
        {trade.validationWarnings && trade.validationWarnings.length > 0 && (
          <div className="validation-warnings">
            {trade.validationWarnings.map((w, i) => (
              <div key={i} className="validation-warning">⚠️ {w}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
