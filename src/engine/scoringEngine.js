import { analyzeTechnicals, generateTechnicalReasoning } from './technicalAnalysis.js';
import { calculatePositionSize, validateTrade, calculatePortfolioSummary } from './riskEngine.js';

/**
 * AI Scoring Engine
 * Combines multiple signals into a confidence score (0-100)
 * and generates complete trade setups.
 */

// Scoring weights
const WEIGHTS = {
  trend: 20,
  momentum: 20,
  volume: 15,
  priceAction: 15,
  riskReward: 15,
  psychology: 15,
};

/**
 * Score a single stock and generate trade setup
 */
export function scoreStock(stockData) {
  const analysis = analyzeTechnicals(stockData.quotes);
  if (!analysis) return null;

  const { signals, indicators, levels } = analysis;

  // === TREND SCORE (0-20) ===
  let trendScore = 0;
  if (signals.aboveEma200) trendScore += 5;
  if (signals.aboveEma50) trendScore += 5;
  if (signals.aboveEma20) trendScore += 4;
  if (signals.ema20AboveEma50) trendScore += 3;
  if (signals.trendAligned) trendScore += 3;
  trendScore = Math.min(trendScore, WEIGHTS.trend);

  // === MOMENTUM SCORE (0-20) ===
  let momentumScore = 0;
  if (signals.rsiNeutralBullish) momentumScore += 6;
  if (signals.rsiOversold) momentumScore += 8; // Bounce potential
  if (signals.rsiOverbought) momentumScore -= 5; // Penalty
  if (signals.macdBullishCross) momentumScore += 8;
  else if (signals.macdBullish) momentumScore += 4;
  if (signals.macdHistogramRising) momentumScore += 4;
  momentumScore = Math.max(0, Math.min(momentumScore, WEIGHTS.momentum));

  // === VOLUME SCORE (0-15) ===
  let volumeScore = 0;
  if (signals.volumeSpike) volumeScore += 12;
  else if (signals.volumeAboveAvg) volumeScore += 8;
  else volumeScore += 3; // Baseline for normal volume
  volumeScore = Math.min(volumeScore, WEIGHTS.volume);

  // === PRICE ACTION SCORE (0-15) ===
  let priceActionScore = 0;
  if (signals.breakingOut) priceActionScore += 13;
  else if (signals.consolidating && signals.nearSupport) priceActionScore += 10;
  else if (signals.nearSupport) priceActionScore += 7;
  if (signals.nearResistance && !signals.breakingOut) priceActionScore -= 3;
  priceActionScore = Math.max(0, Math.min(priceActionScore, WEIGHTS.priceAction));

  // === RISK-REWARD SCORE (0-15) ===
  let rrScore = 0;
  if (levels.riskRewardRatio >= 3.0) rrScore = 15;
  else if (levels.riskRewardRatio >= 2.5) rrScore = 12;
  else if (levels.riskRewardRatio >= 2.0) rrScore = 8;
  else if (levels.riskRewardRatio >= 1.5) rrScore = 4;
  else rrScore = 0;

  // === PSYCHOLOGY FILTER (0-15, can go negative) ===
  let psychScore = 8; // Start neutral
  // FOMO filter: if stock already up significantly, reduce score
  if (stockData.dayChange > 5) psychScore -= 6; // Chasing
  if (stockData.dayChange > 3) psychScore -= 3;
  // Overextended filter
  if (indicators.rsi > 75) psychScore -= 5;
  // Confirmation bonus
  if (signals.macdBullish && signals.trendAligned && signals.volumeAboveAvg) psychScore += 5;
  // Patience bonus for pullback setups
  if (signals.nearSupport && signals.rsiNeutralBullish) psychScore += 4;
  psychScore = Math.max(0, Math.min(psychScore, WEIGHTS.psychology));

  // === TOTAL SCORE ===
  const totalScore = trendScore + momentumScore + volumeScore + priceActionScore + rrScore + psychScore;

  // === POSITION SIZING ===
  const position = calculatePositionSize(stockData.currentPrice, levels.stopLoss);
  if (!position || position.quantity <= 0) return null;

  // === DETERMINE RISK LEVEL ===
  let riskLevel = 'Medium';
  if (totalScore >= 70) riskLevel = 'Low';
  else if (totalScore < 45) riskLevel = 'High';

  // === EXECUTION STRATEGY ===
  let executionStrategy = 'Wait for confirmation';
  if (signals.breakingOut) executionStrategy = 'Breakout entry — buy on close above resistance with volume';
  else if (signals.nearSupport && signals.rsiOversold) executionStrategy = 'Pullback entry — buy near support with RSI reversal';
  else if (signals.consolidating) executionStrategy = 'Wait for breakout — set alert at resistance level';
  else if (signals.trendAligned && signals.macdBullish) executionStrategy = 'Trend continuation — enter on minor pullback to EMA 20';

  // === WHY NOT TO TAKE THIS TRADE ===
  const whyNot = generateWhyNot(signals, indicators, stockData);

  return {
    // Stock info
    symbol: stockData.symbol,
    name: stockData.name,
    sector: stockData.sector,

    // Trade setup
    entryPrice: Math.round(stockData.currentPrice * 100) / 100,
    stopLoss: levels.stopLoss,
    targetPrice: levels.target,
    riskRewardRatio: levels.riskRewardRatio,

    // Position sizing
    riskAmount: position.riskAmount,
    quantity: position.quantity,
    capitalRequired: position.capitalRequired,
    percentOfCapital: position.percentOfCapital,

    // Analysis
    technicalReasoning: generateTechnicalReasoning(analysis),
    fundamentalStrength: 'Based on market cap and sector strength — detailed FA requires additional data feeds',
    sentimentInsight: stockData.dayChange > 0
      ? `Positive momentum today (+${stockData.dayChange.toFixed(2)}%) — market sentiment supportive`
      : `Negative move today (${stockData.dayChange.toFixed(2)}%) — watch for reversal confirmation`,
    institutionalActivity: indicators.volumeRatio > 1.5
      ? `Volume ${indicators.volumeRatio}x above average — possible institutional accumulation`
      : 'Normal volume — no significant institutional signals',

    // Trader insight
    confidenceScore: Math.round(totalScore),
    riskLevel,
    whyThisWorks: generateWhyWorks(signals, indicators),
    whyThisCanFail: whyNot,
    executionStrategy,

    // Raw data for reference
    indicators,
    signals,
    scoreBreakdown: {
      trend: trendScore,
      momentum: momentumScore,
      volume: volumeScore,
      priceAction: priceActionScore,
      riskReward: rrScore,
      psychology: psychScore,
    },
  };
}

/**
 * Run the full scanning pipeline: fetch → analyze → score → rank → filter
 */
export function rankAndFilterTrades(scoredStocks) {
  // Filter out low-confidence trades
  const filtered = scoredStocks
    .filter(s => s !== null)
    .filter(s => s.confidenceScore >= 40)
    .filter(s => s.riskRewardRatio >= 2.0);

  // Sort by confidence score (descending)
  filtered.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Apply portfolio-level risk checks
  const selectedTrades = [];
  for (const trade of filtered) {
    const validation = validateTrade(trade, selectedTrades);
    if (validation.valid) {
      trade.validationWarnings = validation.warnings;
      selectedTrades.push(trade);
    }
    if (selectedTrades.length >= 5) break; // Max 5 trades
  }

  // Build portfolio summary
  const portfolio = calculatePortfolioSummary(selectedTrades);

  return { trades: selectedTrades, portfolio };
}

function generateWhyWorks(signals, indicators) {
  const reasons = [];
  if (signals.trendAligned) reasons.push('Strong uptrend with aligned EMAs');
  if (signals.macdBullishCross) reasons.push('Fresh MACD crossover signal');
  if (signals.volumeAboveAvg) reasons.push('Above-average volume confirmation');
  if (signals.nearSupport) reasons.push('Good risk-reward near support');
  if (signals.breakingOut) reasons.push('Breakout with volume support');
  if (signals.rsiNeutralBullish) reasons.push('RSI in healthy momentum zone');
  return reasons.length > 0 ? reasons.join('. ') + '.' : 'Setup meets minimum criteria.';
}

function generateWhyNot(signals, indicators, stockData) {
  const risks = [];
  if (signals.rsiOverbought) risks.push('RSI overbought — risk of pullback');
  if (stockData.dayChange > 4) risks.push('Already extended today — FOMO risk');
  if (!signals.volumeAboveAvg) risks.push('Volume below average — weak participation');
  if (!signals.trendAligned) risks.push('Trend not fully aligned — conflicting signals');
  if (signals.nearResistance) risks.push('Near resistance — potential rejection');
  if (indicators.atr > stockData.currentPrice * 0.04) risks.push('High ATR — volatile stock, wider stops needed');
  risks.push('General market risk — always use stop loss');
  return risks.join('. ') + '.';
}
