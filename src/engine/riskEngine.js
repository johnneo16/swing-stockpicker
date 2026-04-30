/**
 * Risk Management Engine
 * Professional position sizing and capital allocation for ₹50,000 portfolio.
 */

const TOTAL_CAPITAL = 50000;
const MAX_RISK_PERCENT = 0.02;           // 2% max risk per trade
const DEFAULT_RISK_PERCENT = 0.015;      // 1.5% default risk per trade
const MAX_CONCURRENT_TRADES = 5;
const CASH_RESERVE_PERCENT = 0.15;       // 15% cash reserve (down from 20% to allow more trades)
const MAX_SECTOR_EXPOSURE = 3;           // Max 3 stocks per sector
const MIN_RISK_REWARD = 1.5;             // Minimum 1:1.5 risk-reward
const MAX_CAPITAL_PER_TRADE = 0.20;      // Cap single trade at 20% of portfolio

/**
 * Volatility-adjusted risk multiplier.
 * Inputs: ATR (14), entry price, optional confidence score.
 *
 * Logic:
 *  - ATR/price ratio measures how violently the stock moves day-to-day.
 *  - Wide-ATR stocks need wider stops; if we use the same risk-rupees,
 *    we end up with tiny share counts. Worse, the wider stop means
 *    bigger gap-down exposure when it does fail.
 *  - Conversely, low-ATR stocks (think large-cap defensives) can carry
 *    slightly more risk because their downside is more bounded.
 *  - Confidence score (0–100) adds a smaller secondary nudge.
 *
 * Returns multiplier in [0.6, 1.3] applied to base risk %.
 */
export function volAdjustedRiskMultiplier(entryPrice, atr, confidenceScore = null) {
  if (!atr || !entryPrice || entryPrice <= 0) return 1.0;
  const atrPct = atr / entryPrice;

  let mult;
  if (atrPct >= 0.05)        mult = 0.60;  // very volatile (≥5% daily true range)
  else if (atrPct >= 0.035)  mult = 0.75;  // high vol
  else if (atrPct >= 0.025)  mult = 0.90;  // moderate-high
  else if (atrPct >= 0.015)  mult = 1.00;  // normal
  else if (atrPct >= 0.010)  mult = 1.10;  // low vol
  else                        mult = 1.20;  // very low vol (<1% daily)

  // Confidence nudge: ±10% over the vol mult
  if (confidenceScore != null) {
    if (confidenceScore >= 75)      mult *= 1.10;
    else if (confidenceScore >= 65) mult *= 1.05;
    else if (confidenceScore < 50)  mult *= 0.92;
  }

  // Hard clamp
  return Math.max(0.60, Math.min(1.30, mult));
}

/**
 * Calculate position size for a single trade.
 *
 * @param {number} entryPrice
 * @param {number} stopLoss
 * @param {number} [riskPercent] — base risk %, default 1.5%
 * @param {number} [totalCapital]
 * @param {object} [opts]
 *   - atr: 14-period ATR. If provided, applies volatility-adjusted sizing.
 *   - confidenceScore: 0–100. Optional secondary nudge.
 *   - volAdjusted: explicit on/off (default true if ATR provided).
 */
export function calculatePositionSize(entryPrice, stopLoss, riskPercent = DEFAULT_RISK_PERCENT, totalCapital = null, opts = {}) {
  const capital = totalCapital || TOTAL_CAPITAL;
  const baseRiskPercent = riskPercent || DEFAULT_RISK_PERCENT;

  // Volatility-adjusted risk percent
  const volAdjusted = opts.volAdjusted !== false && opts.atr;
  const volMult = volAdjusted ? volAdjustedRiskMultiplier(entryPrice, opts.atr, opts.confidenceScore) : 1.0;
  const adjustedRiskPercent = Math.min(MAX_RISK_PERCENT, baseRiskPercent * volMult);

  const riskAmount = capital * adjustedRiskPercent;
  const riskPerShare = Math.abs(entryPrice - stopLoss);

  if (riskPerShare <= 0) return null;

  // Risk-based quantity
  const riskQuantity = Math.floor(riskAmount / riskPerShare);

  // Cap: never exceed MAX_CAPITAL_PER_TRADE of total portfolio in one position
  const maxCapital = capital * MAX_CAPITAL_PER_TRADE;
  const maxQuantity = Math.floor(maxCapital / entryPrice);

  // Use the smaller of the two
  const quantity = Math.min(riskQuantity, maxQuantity);
  if (quantity <= 0) return null;

  const capitalRequired = quantity * entryPrice;

  return {
    riskAmount: Math.round(riskAmount),
    riskPerShare: Math.round(riskPerShare * 100) / 100,
    quantity,
    capitalRequired: Math.round(capitalRequired),
    percentOfCapital: Math.round((capitalRequired / capital) * 10000) / 100,
    riskPercentApplied: Math.round(adjustedRiskPercent * 10000) / 100, // e.g. 1.65
    volMultiplier: Math.round(volMult * 100) / 100,
  };
}

/**
 * Validate a trade against risk management rules
 */
export function validateTrade(trade, existingTrades = [], totalCapital = null, options = {}) {
  const capital = totalCapital || TOTAL_CAPITAL;
  const maxSectorExposure = options.maxSectorExposure ?? MAX_SECTOR_EXPOSURE;
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

  // 3. Sector concentration (relaxed for ETF mode)
  if (maxSectorExposure < MAX_CONCURRENT_TRADES) {
    const sectorCount = existingTrades.filter(t => t.sector === trade.sector).length;
    if (sectorCount >= maxSectorExposure) {
      issues.push(`Sector ${trade.sector} already has ${sectorCount} positions (max ${maxSectorExposure})`);
    }
  }

  // 4. Capital availability (hard block only when truly no capital left)
  const deployedCapital = existingTrades.reduce((sum, t) => sum + (t.capitalRequired || 0), 0);
  const availableCapital = capital - deployedCapital;
  const minCashReserve = capital * CASH_RESERVE_PERCENT;
  const maxDeployable = availableCapital - minCashReserve;

  if (trade.capitalRequired > availableCapital) {
    issues.push(`Insufficient capital: need ₹${trade.capitalRequired}, only ₹${Math.round(availableCapital)} available`);
  } else if (trade.capitalRequired > maxDeployable) {
    warnings.push(`This trade would breach ${CASH_RESERVE_PERCENT * 100}% cash reserve rule`);
  }

  // 5. Single trade capital limit (flagged as warning only — calculatePositionSize already caps at 20%)
  if (trade.capitalRequired > capital * MAX_CAPITAL_PER_TRADE) {
    warnings.push(`Trade uses ${Math.round((trade.capitalRequired / capital) * 100)}% of capital — capped position`);
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
export function calculatePortfolioSummary(activeTrades = [], totalCapital = null) {
  const capital = totalCapital || TOTAL_CAPITAL;
  const capitalDeployed = activeTrades.reduce((sum, t) => sum + (t.capitalRequired || 0), 0);
  const totalRiskExposure = activeTrades.reduce((sum, t) => sum + (t.riskAmount || 0), 0);

  return {
    totalCapital: capital,
    capitalDeployed: Math.round(capitalDeployed),
    remainingCash: Math.round(capital - capitalDeployed),
    cashReserveTarget: Math.round(capital * CASH_RESERVE_PERCENT),
    totalRiskExposure: Math.round(totalRiskExposure),
    riskExposurePercent: Math.round((totalRiskExposure / capital) * 10000) / 100,
    activeTradeCount: activeTrades.length,
    maxTrades: MAX_CONCURRENT_TRADES,
    deploymentPercent: Math.round((capitalDeployed / capital) * 10000) / 100,
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
  MAX_CAPITAL_PER_TRADE,
};
