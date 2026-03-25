/**
 * Risk Management Engine
 * Professional position sizing and capital allocation for ₹50,000 portfolio.
 */

const TOTAL_CAPITAL = 50000;
const MAX_RISK_PERCENT = 0.02;       // 2% max risk per trade
const DEFAULT_RISK_PERCENT = 0.015;  // 1.5% default risk per trade
const MAX_CONCURRENT_TRADES = 5;
const CASH_RESERVE_PERCENT = 0.25;   // 25% cash reserve
const MAX_SECTOR_EXPOSURE = 2;       // Max 2 stocks per sector
const MIN_RISK_REWARD = 2.0;         // Minimum 1:2 risk-reward

/**
 * Calculate position size for a single trade
 */
export function calculatePositionSize(entryPrice, stopLoss, riskPercent = DEFAULT_RISK_PERCENT) {
  const riskAmount = TOTAL_CAPITAL * riskPercent;
  const riskPerShare = Math.abs(entryPrice - stopLoss);

  if (riskPerShare <= 0) return null;

  const quantity = Math.floor(riskAmount / riskPerShare);
  const capitalRequired = quantity * entryPrice;

  return {
    riskAmount: Math.round(riskAmount),
    riskPerShare: Math.round(riskPerShare * 100) / 100,
    quantity,
    capitalRequired: Math.round(capitalRequired),
    percentOfCapital: Math.round((capitalRequired / TOTAL_CAPITAL) * 10000) / 100,
  };
}

/**
 * Validate a trade against risk management rules
 */
export function validateTrade(trade, existingTrades = []) {
  const issues = [];
  const warnings = [];

  // 1. Risk-reward filter
  if (trade.riskRewardRatio < MIN_RISK_REWARD) {
    issues.push(`Risk-reward ratio ${trade.riskRewardRatio} is below minimum ${MIN_RISK_REWARD}`);
  }

  // 2. Max concurrent trades
  if (existingTrades.length >= MAX_CONCURRENT_TRADES) {
    issues.push(`Maximum ${MAX_CONCURRENT_TRADES} concurrent trades reached`);
  }

  // 3. Sector concentration
  const sectorCount = existingTrades.filter(t => t.sector === trade.sector).length;
  if (sectorCount >= MAX_SECTOR_EXPOSURE) {
    issues.push(`Sector ${trade.sector} already has ${sectorCount} positions (max ${MAX_SECTOR_EXPOSURE})`);
  }

  // 4. Capital availability
  const deployedCapital = existingTrades.reduce((sum, t) => sum + (t.capitalRequired || 0), 0);
  const availableCapital = TOTAL_CAPITAL - deployedCapital;
  const minCashReserve = TOTAL_CAPITAL * CASH_RESERVE_PERCENT;
  const maxDeployable = availableCapital - minCashReserve;

  if (trade.capitalRequired > maxDeployable) {
    if (trade.capitalRequired > availableCapital) {
      issues.push(`Insufficient capital: need ₹${trade.capitalRequired}, only ₹${Math.round(availableCapital)} available`);
    } else {
      warnings.push(`This trade would breach ${CASH_RESERVE_PERCENT * 100}% cash reserve rule`);
    }
  }

  // 5. Single trade capital limit (max 30% of capital in one trade)
  if (trade.capitalRequired > TOTAL_CAPITAL * 0.30) {
    warnings.push(`Trade uses ${Math.round((trade.capitalRequired / TOTAL_CAPITAL) * 100)}% of capital — consider reducing size`);
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
  };
}

/**
 * Build portfolio summary from active trades
 */
export function calculatePortfolioSummary(activeTrades = []) {
  const capitalDeployed = activeTrades.reduce((sum, t) => sum + (t.capitalRequired || 0), 0);
  const totalRiskExposure = activeTrades.reduce((sum, t) => sum + (t.riskAmount || 0), 0);

  return {
    totalCapital: TOTAL_CAPITAL,
    capitalDeployed: Math.round(capitalDeployed),
    remainingCash: Math.round(TOTAL_CAPITAL - capitalDeployed),
    cashReserveTarget: Math.round(TOTAL_CAPITAL * CASH_RESERVE_PERCENT),
    totalRiskExposure: Math.round(totalRiskExposure),
    riskExposurePercent: Math.round((totalRiskExposure / TOTAL_CAPITAL) * 10000) / 100,
    activeTradeCount: activeTrades.length,
    maxTrades: MAX_CONCURRENT_TRADES,
    deploymentPercent: Math.round((capitalDeployed / TOTAL_CAPITAL) * 10000) / 100,
    sectorDistribution: getSectorDistribution(activeTrades),
  };
}

function getSectorDistribution(trades) {
  const sectors = {};
  trades.forEach(t => {
    sectors[t.sector] = (sectors[t.sector] || 0) + 1;
  });
  return sectors;
}

export const CONFIG = {
  TOTAL_CAPITAL,
  MAX_RISK_PERCENT,
  DEFAULT_RISK_PERCENT,
  MAX_CONCURRENT_TRADES,
  CASH_RESERVE_PERCENT,
  MAX_SECTOR_EXPOSURE,
  MIN_RISK_REWARD,
};
