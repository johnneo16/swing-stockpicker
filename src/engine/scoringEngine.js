import { analyzeTechnicals, generateTechnicalReasoning } from './technicalAnalysis.js';
import { calculatePositionSize, validateTrade, calculatePortfolioSummary, CONFIG } from './riskEngine.js';
import { scoreFundamentals, generateFundamentalSummary } from './fundamentalAnalysis.js';

/**
 * AI Scoring Engine (Phase 2 — 8-Factor System)
 * Combines technical, fundamental, and market signals into a 0-100 confidence score.
 */

// Revised scoring weights (total = 100)
const WEIGHTS = {
  trend: 15,
  momentum: 18,
  volume: 12,
  priceAction: 13,
  riskReward: 12,
  psychology: 10,
  fundamentals: 10,
  marketContext: 10,
};

/**
 * Score a single stock and generate trade setup
 */
export function scoreStock(stockData, marketContext = null, totalCapital = null) {
  const analysis = analyzeTechnicals(stockData.quotes);
  if (!analysis) return null;

  const { signals, indicators, levels } = analysis;

  // === TREND SCORE (0-15) ===
  let trendScore = 0;
  if (signals.aboveEma200) trendScore += 3;
  if (signals.aboveEma50) trendScore += 3;
  if (signals.aboveEma20) trendScore += 2;
  if (signals.ema20AboveEma50) trendScore += 2;
  if (signals.trendAligned) trendScore += 2;
  if (signals.ema20Rising) trendScore += 1.5;
  if (signals.weeklyUptrend) trendScore += 1.5;
  trendScore = Math.min(trendScore, WEIGHTS.trend);

  // === MOMENTUM SCORE (0-18) ===
  let momentumScore = 0;
  if (signals.rsiNeutralBullish) momentumScore += 5;
  if (signals.rsiOversold) momentumScore += 7;
  if (signals.rsiOverbought) momentumScore -= 5;
  if (signals.macdBullishCross) momentumScore += 8;
  else if (signals.macdBullish) momentumScore += 4;
  if (signals.macdHistogramRising) momentumScore += 3;
  momentumScore = Math.max(0, Math.min(momentumScore, WEIGHTS.momentum));

  // === VOLUME SCORE (0-12) ===
  let volumeScore = 0;
  if (signals.volumeSpike) volumeScore += 10;
  else if (signals.volumeAboveAvg) volumeScore += 7;
  else if (signals.volumeDrying) volumeScore += 2;
  else volumeScore += 4;
  volumeScore = Math.min(volumeScore, WEIGHTS.volume);

  // === PRICE ACTION SCORE (0-13) ===
  let priceActionScore = 0;
  if (signals.breakingOut) priceActionScore += 11;
  else if (signals.consolidating && signals.nearSupport) priceActionScore += 9;
  else if (signals.nearSupport) priceActionScore += 6;
  if (signals.bbSqueezing) priceActionScore += 4; // Squeeze = pending big move
  if (signals.nearLowerBB && signals.rsiOversold) priceActionScore += 3; // Mean reversion
  if (signals.nearResistance && !signals.breakingOut) priceActionScore -= 3;
  if (signals.nearUpperBB && signals.rsiOverbought) priceActionScore -= 3;
  priceActionScore = Math.max(0, Math.min(priceActionScore, WEIGHTS.priceAction));

  // === RISK-REWARD SCORE (0-12) ===
  let rrScore = 0;
  if (levels.riskRewardRatio >= 3.0) rrScore = 12;
  else if (levels.riskRewardRatio >= 2.5) rrScore = 10;
  else if (levels.riskRewardRatio >= 2.0) rrScore = 7;
  else if (levels.riskRewardRatio >= 1.5) rrScore = 3;
  else rrScore = 0;

  // === PSYCHOLOGY FILTER (0-10) ===
  let psychScore = 5;
  if (stockData.dayChange > 5) psychScore -= 4;
  else if (stockData.dayChange > 3) psychScore -= 2;
  if (indicators.rsi > 75) psychScore -= 3;
  // Confirmation bonus — multiple signals aligning
  if (signals.macdBullish && signals.trendAligned && signals.volumeAboveAvg) psychScore += 3;
  if (signals.nearSupport && signals.rsiNeutralBullish) psychScore += 3;
  // ADX confirmation — only trade when there's a real trend
  if (signals.strongTrend && signals.trendAligned) psychScore += 2;
  if (signals.weakTrend) psychScore -= 1;
  psychScore = Math.max(0, Math.min(psychScore, WEIGHTS.psychology));

  // === FUNDAMENTALS SCORE (0-10) ===
  const fundResult = scoreFundamentals(stockData.fundamentals);
  const fundamentalScore = Math.min(fundResult.score, WEIGHTS.fundamentals);

  // === MARKET CONTEXT SCORE (0-10) ===
  let contextScore = 5; // neutral baseline
  if (marketContext) {
    if (marketContext.niftyTrend === 'bullish') contextScore += 3;
    else if (marketContext.niftyTrend === 'bearish') contextScore -= 3;
    if (marketContext.marketMood === 'Bullish') contextScore += 2;
    else if (marketContext.marketMood === 'Bearish') contextScore -= 2;
  }
  contextScore = Math.max(0, Math.min(contextScore, WEIGHTS.marketContext));

  // === TOTAL SCORE ===
  const totalScore = trendScore + momentumScore + volumeScore + priceActionScore
    + rrScore + psychScore + fundamentalScore + contextScore;

  // === POSITION SIZING ===
  const position = calculatePositionSize(stockData.currentPrice, levels.stopLoss, undefined, totalCapital);
  if (!position || position.quantity <= 0) return null;

  // === DETERMINE RISK LEVEL ===
  let riskLevel = 'Medium';
  if (totalScore >= 70) riskLevel = 'Low';
  else if (totalScore < 45) riskLevel = 'High';

  // === SETUP TYPE (analysis basis) ===
  let setupType = 'Trend Analysis';
  if (signals.breakingOut && signals.strongTrend) setupType = 'Breakout + ADX Trend';
  else if (signals.breakingOut) setupType = 'Breakout';
  else if (signals.nearSupport && signals.rsiOversold) setupType = 'Pullback / RSI Reversal';
  else if (signals.bbSqueezing) setupType = 'Bollinger Squeeze';
  else if (signals.nearLowerBB && signals.rsiOversold) setupType = 'Mean Reversion';
  else if (signals.macdBullishCross) setupType = 'MACD Crossover';
  else if (signals.consolidating && signals.nearSupport) setupType = 'Consolidation + Support';
  else if (signals.trendAligned && signals.macdBullish) setupType = 'Trend Continuation';
  else if (signals.volumeSpike) setupType = 'Volume Surge';

  // === EXECUTION STRATEGY ===
  let executionStrategy = 'Wait for confirmation';
  if (signals.breakingOut && signals.strongTrend) executionStrategy = 'Breakout entry — buy on close above resistance with volume + strong ADX';
  else if (signals.breakingOut) executionStrategy = 'Breakout entry — buy on close above resistance with volume';
  else if (signals.nearSupport && signals.rsiOversold) executionStrategy = 'Pullback entry — buy near support with RSI reversal';
  else if (signals.bbSqueezing) executionStrategy = 'Squeeze play — wait for Bollinger Band expansion, enter on direction';
  else if (signals.nearLowerBB && signals.rsiOversold) executionStrategy = 'Mean reversion — buy at lower BB with RSI oversold confirmation';
  else if (signals.consolidating) executionStrategy = 'Wait for breakout — set alert at resistance level';
  else if (signals.trendAligned && signals.macdBullish) executionStrategy = 'Trend continuation — enter on minor pullback to EMA 20';

  // === WHY NOT TO TAKE THIS TRADE ===
  const whyNot = generateWhyNot(signals, indicators, stockData);

  // === FUNDAMENTAL ANALYSIS STRING ===
  const fundamentalStrength = generateFundamentalSummary(stockData.fundamentals, fundResult);

  return {
    // Stock info
    symbol: stockData.symbol,
    name: stockData.name,
    sector: stockData.sector,
    currentMarketPrice: Math.round(stockData.currentPrice * 100) / 100,
    dayChange: Math.round((stockData.dayChange || 0) * 100) / 100,
    previousClose: stockData.previousClose ? Math.round(stockData.previousClose * 100) / 100 : null,

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
    fundamentalStrength,
    sentimentInsight: stockData.dayChange > 0
      ? `Positive momentum today (+${stockData.dayChange.toFixed(2)}%) — market sentiment supportive`
      : `Negative move today (${stockData.dayChange.toFixed(2)}%) — watch for reversal confirmation`,
    institutionalActivity: indicators.volumeRatio > 1.5
      ? `Volume ${indicators.volumeRatio}x above average — possible institutional accumulation`
      : 'Normal volume — no significant institutional signals',

    // Chart Data (last 90 trading sessions)
    // Convert Date objects to unix timestamps for lightweight-charts
    chartData: stockData.quotes.slice(-90).map(q => ({
      time: Math.floor(q.date.getTime() / 1000), // Unix timestamp in seconds
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      value: q.volume // For volume histogram
    })),

    // Fundamentals raw data (for UI display)
    fundamentals: stockData.fundamentals ? {
      peRatio: stockData.fundamentals.peRatio,
      roe: stockData.fundamentals.roe,
      debtToEquity: stockData.fundamentals.debtToEquity,
      revenueGrowth: stockData.fundamentals.revenueGrowth,
      profitMargin: stockData.fundamentals.profitMargin,
      marketCap: stockData.fundamentals.marketCap,
      fiftyTwoWeekHigh: stockData.fundamentals.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: stockData.fundamentals.fiftyTwoWeekLow,
      dividendYield: stockData.fundamentals.dividendYield,
      fundamentalScore: fundResult.score,
      fundamentalRating: fundResult.rating,
    } : null,

    // Trader insight
    setupType,
    confidenceScore: Math.round(totalScore),
    riskLevel,
    whyThisWorks: generateWhyWorks(signals, indicators, fundResult),
    whyThisCanFail: whyNot,
    executionStrategy,

    // Raw data for reference
    indicators,
    signals,
    scoreBreakdown: {
      trend: Math.round(trendScore * 10) / 10,
      momentum: Math.round(momentumScore * 10) / 10,
      volume: Math.round(volumeScore * 10) / 10,
      priceAction: Math.round(priceActionScore * 10) / 10,
      riskReward: Math.round(rrScore * 10) / 10,
      psychology: Math.round(psychScore * 10) / 10,
      fundamentals: Math.round(fundamentalScore * 10) / 10,
      marketContext: Math.round(contextScore * 10) / 10,
    },
  };
}

/**
 * Run the full scanning pipeline: fetch → analyze → score → rank → filter
 */
export function rankAndFilterTrades(scoredStocks, totalCapital = null, options = {}) {
  const valid = scoredStocks.filter(s => s !== null);

  // Sort by confidence score descending
  valid.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Pass 1: strict — R:R >= 1.5, score >= 28, portfolio checks
  const selectedTrades = [];
  for (const trade of valid) {
    if (trade.riskRewardRatio < 1.5) continue;
    if (trade.confidenceScore < 28) continue;
    const validation = validateTrade(trade, selectedTrades, totalCapital, options);
    if (validation.valid) {
      trade.validationWarnings = validation.warnings;
      trade.lowConfidence = false;
      selectedTrades.push(trade);
    }
    if (selectedTrades.length >= 5) break;
  }

  // Pass 2: fill remaining slots from best available, no score floor
  if (selectedTrades.length < 5) {
    const selectedSymbols = new Set(selectedTrades.map(t => t.symbol));
    for (const trade of valid) {
      if (selectedSymbols.has(trade.symbol)) continue;
      if (trade.riskRewardRatio < 1.0) continue;
      const validation = validateTrade(trade, selectedTrades, totalCapital, options);
      if (validation.valid) {
        trade.validationWarnings = validation.warnings;
        trade.lowConfidence = true;
        selectedTrades.push(trade);
      }
      if (selectedTrades.length >= 5) break;
    }
  }

  const portfolio = calculatePortfolioSummary(selectedTrades, totalCapital);
  return { trades: selectedTrades, portfolio };
}

function generateWhyWorks(signals, indicators, fundResult) {
  const reasons = [];
  if (signals.trendAligned) reasons.push('Strong uptrend with aligned EMAs');
  if (signals.strongTrend) reasons.push('ADX confirms strong trending move');
  if (signals.macdBullishCross) reasons.push('Fresh MACD crossover signal');
  if (signals.volumeAboveAvg) reasons.push('Above-average volume confirmation');
  if (signals.nearSupport) reasons.push('Good risk-reward near support');
  if (signals.breakingOut) reasons.push('Breakout with volume support');
  if (signals.rsiNeutralBullish) reasons.push('RSI in healthy momentum zone');
  if (signals.bbSqueezing) reasons.push('Bollinger Band squeeze — big move pending');
  if (fundResult && fundResult.score >= 7) reasons.push(`Strong fundamentals (${fundResult.rating})`);
  return reasons.length > 0 ? reasons.join('. ') + '.' : 'Setup meets minimum criteria.';
}

function generateWhyNot(signals, indicators, stockData) {
  const risks = [];
  if (signals.rsiOverbought) risks.push('RSI overbought — risk of pullback');
  if (stockData.dayChange > 4) risks.push('Already extended today — FOMO risk');
  if (!signals.volumeAboveAvg) risks.push('Volume below average — weak participation');
  if (!signals.trendAligned) risks.push('Trend not fully aligned — conflicting signals');
  if (signals.nearResistance) risks.push('Near resistance — potential rejection');
  if (signals.weakTrend) risks.push(`ADX ${indicators.adx} — no clear trend, range-bound risk`);
  if (signals.nearUpperBB) risks.push('Near upper Bollinger Band — overextended');
  if (indicators.atr > stockData.currentPrice * 0.04) risks.push('High ATR — volatile stock, wider stops needed');
  if (stockData.fundamentals?.debtToEquity > 2) risks.push(`High debt (D/E: ${stockData.fundamentals.debtToEquity}) — financial risk`);
  risks.push('General market risk — always use stop loss');
  return risks.join('. ') + '.';
}
