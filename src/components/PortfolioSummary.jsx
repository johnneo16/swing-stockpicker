import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Briefcase, TrendingUp, Banknote, Target, Zap, BarChart2, Pencil, Check } from 'lucide-react';

export default function PortfolioSummary({ portfolio, capital, onCapitalChange }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef(null);

  const deploymentPct = portfolio ? (portfolio.deploymentPercent || 0) : 0;
  const displayCapital = capital || portfolio?.totalCapital || 50000;

  if (!portfolio) return null;

  const startEditing = useCallback(() => {
    setEditValue(String(displayCapital));
    setIsEditing(true);
  }, [displayCapital]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const saveCapital = useCallback(() => {
    const parsed = parseInt(editValue.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(parsed) && parsed >= 1000 && onCapitalChange) {
      onCapitalChange(parsed);
    }
    setIsEditing(false);
  }, [editValue, onCapitalChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      saveCapital();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  }, [saveCapital]);

  return (
    <div className="card portfolio-card" id="portfolio-summary">
      <div className="card-header">
        <div className="card-title"><span className="icon"><Briefcase size={16} className="inline-icon text-accent"/></span> Portfolio Dashboard</div>
      </div>

      <div className="portfolio-total">
        <div className="portfolio-total-label">Total Capital</div>
        {isEditing ? (
          <div className="capital-edit-row">
            <span className="capital-currency">₹</span>
            <input
              ref={inputRef}
              type="text"
              className="capital-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={saveCapital}
              inputMode="numeric"
              autoComplete="off"
            />
            <button className="capital-save-btn" onMouseDown={(e) => { e.preventDefault(); saveCapital(); }} title="Save">
              <Check size={14} />
            </button>
          </div>
        ) : (
          <div className="capital-display-row" onClick={startEditing} title="Click to edit capital">
            <div className="portfolio-total-value">₹{displayCapital.toLocaleString('en-IN')}</div>
            <button className="capital-edit-btn" onClick={(e) => { e.stopPropagation(); startEditing(); }} title="Edit capital">
              <Pencil size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="portfolio-stats">
        <div className="portfolio-stat">
          <span className="portfolio-stat-label"><TrendingUp size={14} className="inline-icon"/> Deployed</span>
          <span className="portfolio-stat-value" style={{ color: 'var(--accent-cyan)' }}>
            ₹{portfolio.capitalDeployed?.toLocaleString('en-IN')}
          </span>
        </div>

        <div className="portfolio-stat">
          <span className="portfolio-stat-label"><Banknote size={14} className="inline-icon"/> Cash Reserve</span>
          <span className="portfolio-stat-value" style={{ color: 'var(--profit)' }}>
            ₹{portfolio.remainingCash?.toLocaleString('en-IN')}
          </span>
        </div>

        <div className="portfolio-stat">
          <span className="portfolio-stat-label"><Target size={14} className="inline-icon"/> Reserve Target</span>
          <span className="portfolio-stat-value">
            ₹{portfolio.cashReserveTarget?.toLocaleString('en-IN')}
          </span>
        </div>

        <div className="portfolio-stat">
          <span className="portfolio-stat-label"><Zap size={14} className="inline-icon"/> Risk Exposure</span>
          <span className="portfolio-stat-value" style={{ color: 'var(--warning)' }}>
            ₹{portfolio.totalRiskExposure?.toLocaleString('en-IN')} ({portfolio.riskExposurePercent}%)
          </span>
        </div>

        <div className="portfolio-stat">
          <span className="portfolio-stat-label"><BarChart2 size={14} className="inline-icon"/> Active Trades</span>
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
