import React from 'react';

export default function PortfolioSummary({ portfolio }) {
  if (!portfolio) return null;

  const deploymentPct = portfolio.deploymentPercent || 0;

  return (
    <div className="card portfolio-card" id="portfolio-summary">
      <div className="card-header">
        <div className="card-title"><span className="icon">💰</span> Portfolio</div>
      </div>

      <div className="portfolio-total">
        <div className="portfolio-total-label">Total Capital</div>
        <div className="portfolio-total-value">₹{portfolio.totalCapital?.toLocaleString('en-IN')}</div>
      </div>

      <div className="portfolio-stats">
        <div className="portfolio-stat">
          <span className="portfolio-stat-label">📈 Deployed</span>
          <span className="portfolio-stat-value" style={{ color: 'var(--accent-cyan)' }}>
            ₹{portfolio.capitalDeployed?.toLocaleString('en-IN')}
          </span>
        </div>

        <div className="portfolio-stat">
          <span className="portfolio-stat-label">💵 Cash Remaining</span>
          <span className="portfolio-stat-value" style={{ color: 'var(--profit)' }}>
            ₹{portfolio.remainingCash?.toLocaleString('en-IN')}
          </span>
        </div>

        <div className="portfolio-stat">
          <span className="portfolio-stat-label">🎯 Cash Reserve Target</span>
          <span className="portfolio-stat-value">
            ₹{portfolio.cashReserveTarget?.toLocaleString('en-IN')}
          </span>
        </div>

        <div className="portfolio-stat">
          <span className="portfolio-stat-label">⚡ Risk Exposure</span>
          <span className="portfolio-stat-value" style={{ color: 'var(--warning)' }}>
            ₹{portfolio.totalRiskExposure?.toLocaleString('en-IN')} ({portfolio.riskExposurePercent}%)
          </span>
        </div>

        <div className="portfolio-stat">
          <span className="portfolio-stat-label">📊 Active Trades</span>
          <span className="portfolio-stat-value">
            {portfolio.activeTradeCount} / {portfolio.maxTrades}
          </span>
        </div>
      </div>

      {/* Deployment Progress Bar */}
      <div className="progress-bar-container">
        <div className="progress-label">
          <span>Capital Deployment</span>
          <span>{deploymentPct}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.min(deploymentPct, 100)}%` }}></div>
        </div>
      </div>

      {/* Sector Distribution */}
      {portfolio.sectorDistribution && Object.keys(portfolio.sectorDistribution).length > 0 && (
        <div style={{ marginTop: '18px', paddingTop: '18px', borderTop: '1px solid var(--border-subtle)' }}>
          <div className="analysis-title" style={{ marginBottom: '10px' }}>Sector Exposure</div>
          {Object.entries(portfolio.sectorDistribution).map(([sector, count]) => (
            <div key={sector} className="portfolio-stat" style={{ marginBottom: '6px' }}>
              <span className="portfolio-stat-label" style={{ fontSize: '0.78rem' }}>{sector}</span>
              <span className="portfolio-stat-value" style={{ fontSize: '0.82rem' }}>
                {count} {'trade' + (count > 1 ? 's' : '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
