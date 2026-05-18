import { analyzeTechnicals, generateTechnicalReasoning } from './technicalAnalysis.js';
import { calculatePositionSize, validateTrade, calculatePortfolioSummary, CONFIG } from './riskEngine.js';
import { scoreFundamentals, generateFundamentalSummary } from './fundamentalAnalysis.js';

/**
 * AI Scoring Engine (Phase 2 — 8-Factor System)
 * Combines technical, fundamental, and market signals into a 0-100 confidence score.
 */

// Scoring weights (total = 100) — re-balanced after deep Varsity audit.
// Per Varsity ch.11 + Dow ch.17-18: PRICE ACTION at S/R zones and along
// TRENDLINES does the major lifting. Indicators are confirmation only.
//
// Old → New comparison:
//                 v3 Tier-1   v3 Tier-3 (now)
//   priceAction      11           18    ← +7 (rejection wicks, traps, retest bounces)
//   structure         5           12    ← +7 (trendlines + Varsity S/R + Dow + Fib)
//   trend            13           10    ← -3 (still important, but indicator-derived)
//   momentum         15           10    ← -5 (confirmation only)
//   volume           10            8    ← -2 (confirmation only)
//   psychology        9            5    ← -4 (folded into priceAction)
//   patterns          5            6    ← +1 (Marubozu absorbed too)
//   marketContext    10            9    ← -1 (small rebalance)
//   fundamentals     10           10    same
//   riskReward       12           12    same
//   TOTAL           100          100
const WEIGHTS = {
  trend: 10,        // EMA stack / direction — indicator-derived, confirms direction only
  momentum: 10,     // RSI/MACD — confirmation only per Varsity Finale
  volume: 8,        // volume vs 10-day avg
  priceAction: 18,  // ★ PRIMARY ★ S/R + trendline interaction + rejection / traps
  riskReward: 12,
  psychology: 5,    // RSI overext / day-change FOMO guard
  fundamentals: 10, // ROE / P/E / D/E / ROCE
  marketContext: 9, // Nifty trend + market mood
  patterns: 6,      // candlestick patterns
  structure: 12,    // ★ PRIMARY ★ HH/HL + OBV + trendline validity + Dow + Fib + Varsity-S/R
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

  // === PRICE ACTION SCORE (0-18) — THE BIG LIFTER ===
  // Per Varsity ch.4 + ch.11: HOW price behaves at a level matters more
  // than the level itself. These signals capture the actual battle —
  // rejection wicks, traps, retests — that no indicator can see.
  let priceActionScore = 0;
  // Tier-A signals (massive — the cleanest setups in price action)
  if (signals.bearTrap)         priceActionScore += 8;  // false breakdown reversed = high-conviction long
  if (signals.bullishRejection) priceActionScore += 7;  // rejection wick at support
  if (signals.retestBounce)     priceActionScore += 7;  // broken-and-retested level = textbook entry
  if (signals.onTrendlineSupport && signals.trendlineSupportValid) priceActionScore += 6; // bouncing off validated trendline
  // Tier-B signals (legacy / weaker)
  if (signals.breakingOut)      priceActionScore += 5;
  else if (signals.nearVarsitySupport || signals.nearSupport) priceActionScore += 3;
  if (signals.bbSqueezing)      priceActionScore += 2;  // squeeze pending big move
  if (signals.nearLowerBB && signals.rsiOversold) priceActionScore += 2;
  // Penalties — bearish price action
  if (signals.bearishRejection) priceActionScore -= 4;
  if (signals.bullTrap)         priceActionScore -= 6;  // false breakout reversed = stay out
  if (signals.brokeTrendlineSupport) priceActionScore -= 5; // critical trendline break
  if (signals.nearResistance && !signals.breakingOut) priceActionScore -= 2;
  if (signals.nearUpperBB && signals.rsiOverbought) priceActionScore -= 2;
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

  // === CANDLESTICK PATTERN SCORE (0-5) ===
  // Varsity ch.4-10: reversal patterns are valid only after a contrary trend.
  // We halve the pattern score when the prior-trend gate is not satisfied,
  // and zero it for the strongest reversal patterns (Morning Star,
  // Bullish Engulfing, Hammer) which carry their meaning ENTIRELY from
  // the prior-downtrend context.
  let patternScore = 0;
  if (signals.threeWhiteSoldiers) patternScore = 5;     // continuation pattern — no prior-trend req
  else if (signals.morningStar) patternScore = 5;
  else if (signals.bullishMarubozu) patternScore = 5;   // Varsity ch.5 — pure momentum, no prior-trend req
  else if (signals.bullishEngulfing) patternScore = 4;
  else if (signals.hammer) patternScore = 3;
  else if (signals.dragonflyDoji) patternScore = 3;
  else if (signals.bullishHarami) patternScore = 2;

  // Apply prior-trend penalty for reversal patterns
  const isReversalPattern = signals.morningStar || signals.bullishEngulfing ||
                            signals.hammer || signals.bullishHarami || signals.dragonflyDoji;
  if (isReversalPattern && !signals.priorTrendOk) {
    patternScore = Math.floor(patternScore / 2);  // halve — Varsity says these need prior downtrend
  }
  patternScore = Math.min(patternScore, WEIGHTS.patterns);

  // === MARKET STRUCTURE SCORE (0-12) — THE OTHER BIG LIFTER ===
  // Aggregates: HH/HL + OBV (legacy) + Trendlines + Varsity S/R + Dow + Fib + MTF
  let structureScore = 0;
  // Trend structure (HH/HL)
  if (signals.higherHighs && signals.higherLows) structureScore += 3;
  else if (signals.higherLows) structureScore += 2;
  else if (signals.higherHighs) structureScore += 1;
  if (signals.inDowntrend) structureScore -= 2;
  // OBV — volume-confirmed trend
  if (signals.bullishDivergence) structureScore += 2;
  else if (signals.obvRising) structureScore += 1;
  // Trendlines (the workhorse): validated + currently touching = textbook setup
  if (signals.trendlineSupportValid) structureScore += 2;       // ≥3 touches = respected
  if (signals.onTrendlineSupport && signals.trendlineSupportValid) structureScore += 2; // bouncing now
  // MTF confluence (Varsity Finale + Dow ch.17-18)
  if (signals.mtfBullish && signals.mtfAligned) structureScore += 1;
  if (signals.mtfBearish && !signals.nearLowerBB) structureScore -= 2;
  // Fibonacci confluence (Varsity ch.16): 61.8 golden ratio is strongest
  if (signals.nearFib618) structureScore += 2;
  else if (signals.nearFib50 || signals.nearFib382) structureScore += 1;
  // Varsity-spec S/R (ch.11): touch count drives weight
  if (signals.atGoldenSR) structureScore += 2;       // 5+ touches = "golden" zone
  else if (signals.nearVarsitySupport) structureScore += 1;
  // Dow patterns (ch.18): completed reversal/continuation patterns
  if (signals.doubleBottom) structureScore += 2;
  if (signals.bullishFlag)  structureScore += 2;
  if (signals.rangeBreakout) structureScore += 2;
  if (signals.doubleTop)    structureScore -= 3;
  structureScore = Math.max(0, Math.min(structureScore, WEIGHTS.structure));

  // === TOTAL SCORE ===
  const totalScore = trendScore + momentumScore + volumeScore + priceActionScore
    + rrScore + psychScore + fundamentalScore + contextScore
    + patternScore + structureScore;

  // === POSITION SIZING ===
  // Volatility-adjusted sizing — pass ATR + confidence so high-vol names
  // get smaller positions and high-conviction trades get a small bump.
  const position = calculatePositionSize(
    stockData.currentPrice, levels.stopLoss, undefined, totalCapital,
    { atr: indicators.atr, confidenceScore: totalScore },
  );
  if (!position || position.quantity <= 0) return null;

  // === DETERMINE RISK LEVEL ===
  let riskLevel = 'Medium';
  if (totalScore >= 70) riskLevel = 'Low';
  else if (totalScore < 45) riskLevel = 'High';

  // === SETUP TYPE — price action FIRST, then patterns, then indicators ===
  // Per Varsity ch.11 + Dow: trendline/S/R/rejection setups outweigh anything
  // an indicator can produce. Classification order reflects this hierarchy.
  let setupType = 'Trend Analysis';
  // Tier-A — price action at validated structure (the major lifters)
  if (signals.bearTrap)                                  setupType = 'Bear Trap Reversal';
  else if (signals.retestBounce)                         setupType = 'Trendline Retest Bounce';
  else if (signals.bullishRejection && signals.atGoldenSR) setupType = 'Rejection at Golden S/R';
  else if (signals.bullishRejection && signals.nearVarsitySupport) setupType = 'Support Rejection Wick';
  else if (signals.onTrendlineSupport && signals.trendlineSupportValid && signals.bullishRejection) setupType = 'Trendline Bounce';
  else if (signals.onTrendlineSupport && signals.trendlineSupportValid) setupType = 'At Validated Trendline';
  // Tier-B — Dow patterns (price action over a window)
  else if (signals.doubleBottom)                         setupType = 'Dow Double Bottom';
  else if (signals.bullishFlag)                          setupType = 'Dow Bullish Flag';
  else if (signals.rangeBreakout)                        setupType = 'Dow Range Breakout';
  // Tier-C — candlestick patterns
  else if (signals.bullishMarubozu && signals.volumeAboveAvg) setupType = 'Bullish Marubozu';
  else if (signals.breakingOut && signals.strongTrend)   setupType = 'Breakout + ADX Trend';
  else if (signals.breakingOut) setupType = 'Breakout';
  else if (signals.threeWhiteSoldiers) setupType = 'Three White Soldiers';
  else if (signals.morningStar && signals.nearSupport) setupType = 'Morning Star Reversal';
  else if (signals.bullishEngulfing && signals.nearSupport) setupType = 'Engulfing at Support';
  else if (signals.hammer && signals.nearSupport) setupType = 'Hammer at Support';
  else if (signals.bullishDivergence) setupType = 'OBV Bullish Divergence';
  else if (signals.nearSupport && signals.rsiOversold) setupType = 'Pullback / RSI Reversal';
  else if (signals.bbSqueezing) setupType = 'Bollinger Squeeze';
  else if (signals.nearLowerBB && signals.rsiOversold) setupType = 'Mean Reversion';
  else if (signals.macdBullishCross) setupType = 'MACD Crossover';
  else if (signals.inUptrend && signals.macdBullish) setupType = 'HH/HL Trend Continuation';
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
    estimatedDays: levels.estimatedDays,
    // Varsity-spec S/R surface — for UI display and downstream analysis
    varsitySupport:           levels.varsitySupport,
    varsityResistance:        levels.varsityResistance,
    varsitySupportTouches:    levels.varsitySupportTouches,
    varsityResistanceTouches: levels.varsityResistanceTouches,
    fibLevels:                indicators.fib?.levels,
    fibNearest:               indicators.fib?.nearestLevel,
    // Trendlines — the engine's primary structural reads
    trendlineSupport:         indicators.trendlines?.uptrend ? {
      projected: indicators.trendlines.uptrend.projectedAtNow,
      touches:   indicators.trendlines.uptrend.touches,
      valid:     indicators.trendlines.uptrend.valid,
      slopePctPerBar: indicators.trendlines.uptrend.slopePctPerBar,
    } : null,
    trendlineResistance: indicators.trendlines?.downtrend ? {
      projected: indicators.trendlines.downtrend.projectedAtNow,
      touches:   indicators.trendlines.downtrend.touches,
      valid:     indicators.trendlines.downtrend.valid,
      slopePctPerBar: indicators.trendlines.downtrend.slopePctPerBar,
    } : null,
    priceActionFlags: {
      bullishRejection:  signals.bullishRejection,
      bearishRejection:  signals.bearishRejection,
      bullTrap:          signals.bullTrap,
      bearTrap:          signals.bearTrap,
      retestBounce:      signals.retestBounce,
      onTrendlineSupport: signals.onTrendlineSupport,
    },

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
    // Varsity TA Finale (ch.19) pre-trade checklist — 5 explicit gates.
    // Surfaced on the TradeCard so the user sees exactly which Varsity
    // pillars each pick clears (and which it doesn't).
    checklist: buildChecklist(signals, indicators, levels),
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
      patterns: Math.round(patternScore * 10) / 10,
      structure: Math.round(structureScore * 10) / 10,
    },
  };
}

/**
 * Run the full scanning pipeline: fetch → analyze → score → rank → filter
 *
 * @param {Array} scoredStocks
 * @param {number} [totalCapital]
 * @param {object} [options]
 *   - maxResults:    int, default 5 — how many picks to return
 *   - excludeSymbols: Set<string>, default empty — symbols to skip entirely
 *                    (used by orchestrator to exclude already-open positions
 *                     so the scanner backfills with the next-best candidates
 *                     instead of leaving slots empty)
 *   - maxSectorExposure: int (passed through to validateTrade)
 */
export function rankAndFilterTrades(scoredStocks, totalCapital = null, options = {}) {
  const maxResults     = options.maxResults     ?? 5;
  const excludeSymbols = options.excludeSymbols ?? new Set();

  const valid = scoredStocks.filter(s => s !== null && !excludeSymbols.has(s.symbol));

  // Sort by confidence score descending
  valid.sort((a, b) => b.confidenceScore - a.confidenceScore);

  // Pass 1: strict — R:R >= 1.5, score >= 50, portfolio checks.
  // Threshold 50 was chosen from a 3-year × 198-stock backtest sweep
  // (2022-01-01 → 2024-12-31) where it produced the best risk-adjusted
  // return (Sharpe 1.35, expectancy +2.46%/trade, profit factor 1.83,
  // max drawdown 7.11%). Lower thresholds (e.g. 28) include too many
  // marginal setups; higher thresholds (70+) reduce diversification.
  const selectedTrades = [];
  for (const trade of valid) {
    if (trade.riskRewardRatio < 1.5) continue;
    if (trade.confidenceScore < 50) continue;
    // ADX trend-strength gate (Varsity TA ch.20): refuse trending setups
    // in chop (ADX < 20). Mean-reversion setups don't need ADX strength;
    // they actually prefer chop.
    const adxBlock = adxGate(trade);
    if (adxBlock) { trade.blockedReason = adxBlock; continue; }
    // Multi-timeframe (MTF) confluence — refuse trending longs against
    // a confirmed weekly downtrend (Varsity TA Finale ch.19 + Dow ch.17-18)
    const mtfBlock = mtfGate(trade);
    if (mtfBlock) { trade.blockedReason = mtfBlock; continue; }
    const validation = validateTrade(trade, selectedTrades, totalCapital, options);
    if (validation.valid) {
      trade.validationWarnings = validation.warnings;
      trade.lowConfidence = false;
      selectedTrades.push(trade);
    }
    if (selectedTrades.length >= maxResults) break;
  }

  // Pass 2: fill remaining slots from best available, no score floor
  if (selectedTrades.length < maxResults) {
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
      if (selectedTrades.length >= maxResults) break;
    }
  }

  const portfolio = calculatePortfolioSummary(selectedTrades, totalCapital);
  return { trades: selectedTrades, portfolio };
}

/**
 * ADX trend-strength gate — Varsity TA module ch.20.
 *
 * Returns a blocking reason (string) if the trade should be refused, or
 * null if the trade passes. Setup-type aware:
 *   - Trending setups (Trend Continuation, Breakout, HH/HL, MACD Crossover)
 *     require ADX ≥ 20. Chop kills these.
 *   - Mean-reversion setups (Mean Reversion, Pullback, Hammer/Engulfing at
 *     Support, Morning Star) are happy with ADX < 25 (they need a range,
 *     not a trend).
 *   - Squeeze/structure setups are neutral.
 *
 * The threshold of 20 is Varsity's textbook ADX trend-onset level.
 */
function adxGate(trade) {
  const adx = trade.indicators?.adx;
  if (adx == null) return null;        // no ADX available — let it pass
  const setup = trade.setupType || '';

  const trendingSetups = [
    'Trend Continuation', 'HH/HL Trend Continuation',
    'Breakout', 'Breakout + ADX Trend',
    'MACD Crossover', 'Three White Soldiers',
    'Dow Bullish Flag', 'Dow Range Breakout', 'Bullish Marubozu',
    'At Validated Trendline', 'Trendline Bounce',
  ];
  const meanRevSetups = [
    'Mean Reversion', 'Pullback / RSI Reversal',
    'Hammer at Support', 'Engulfing at Support', 'Morning Star Reversal',
    'OBV Bullish Divergence',
  ];

  // Varsity ch.20 prescribes ADX ≥ 25 for trend-entry; <20 = weak trend; 20-25 grey
  if (trendingSetups.includes(setup) && adx < 25) {
    return `ADX ${adx} < 25: ${setup} requires a real trend (Varsity ch.20 threshold)`;
  }
  if (meanRevSetups.includes(setup) && adx > 30) {
    return `ADX ${adx} > 30: ${setup} needs a range, not a runaway trend`;
  }
  return null;
}

/**
 * Multi-timeframe (MTF) confluence gate.
 * Varsity TA Finale (ch.19) + Dow Theory (ch.17-18):
 * "Primary trend = weekly. Trade only when the daily trigger aligns
 *  with the weekly trend."
 *
 * Refuses trending LONG setups when the weekly trend is confirmed DOWN.
 * Mean-reversion / squeeze setups are exempt — they intentionally fade.
 */
/**
 * Pre-trade checklist — Varsity TA Finale (ch.19 §19.5).
 * Full 7-item version matching Varsity's prescribed sequence:
 *   1. Pattern    — recognized candlestick pattern present
 *   2. Prior trend — bullish pattern preceded by downtrend (cardinal Varsity rule)
 *   3. Volume    — ≥ 10-day avg (Varsity ch.12)
 *   4. S/R       — entry near support / SL aligned with S&R level (≤4% gap)
 *   5. Dow       — primary/secondary trend confirms (EMA stack as proxy)
 *   6. R:R       — risk-reward ≥ 1.5
 *   7. Indicators — MACD + RSI confirm direction
 */
function buildChecklist(signals, indicators, levels) {
  return {
    pattern:     !!(signals.anyBullishPattern || signals.threeWhiteSoldiers ||
                    signals.morningStar || signals.bullishEngulfing || signals.hammer ||
                    signals.bullishHarami || signals.dragonflyDoji || signals.bullishMarubozu),
    priorTrend:  !!signals.priorTrendOk,    // Varsity ch.4-10: prior downtrend required
    volume:      !!(signals.volumeAboveAvg || signals.volumeSpike),
    // S/R: prefer Varsity zone match; fall back to legacy if not yet established
    srLevel:     !!(signals.nearVarsitySupport || signals.breakingOut ||
                    signals.nearSupport || signals.nearLowerBB),
    dow:         !!(signals.trendAligned || signals.inUptrend || signals.mtfBullish),
    riskReward:  (levels?.riskRewardRatio ?? 0) >= 1.5,
    indicators:  !!(signals.macdBullish && signals.rsiNeutralBullish), // both must confirm
  };
}

function mtfGate(trade) {
  const mtf = trade.indicators?.mtf;
  if (!mtf || mtf.weeklyTrend === 'unknown') return null;
  const setup = trade.setupType || '';

  const trendingLongs = [
    'Trend Continuation', 'HH/HL Trend Continuation',
    'Breakout', 'Breakout + ADX Trend', 'Three White Soldiers',
    'MACD Crossover',
    'Dow Bullish Flag', 'Dow Range Breakout', 'Bullish Marubozu',
  ];

  if (trendingLongs.includes(setup) && mtf.weeklyTrend === 'down') {
    return `Weekly trend is DOWN (slope ${mtf.weeklySlopePct}%): ${setup} long refused — daily ≠ weekly`;
  }
  return null;
}

function generateWhyWorks(signals, indicators, fundResult) {
  const reasons = [];
  if (signals.trendAligned) reasons.push('Strong uptrend with aligned EMAs (20 > 50)');
  if (signals.inUptrend) reasons.push('Market structure confirms Higher Highs + Higher Lows');
  else if (signals.higherLows) reasons.push('Higher Lows forming — buyers absorbing dips');
  if (signals.strongTrend) reasons.push(`ADX ${indicators.adx} confirms strong trending move`);
  if (signals.macdBullishCross) reasons.push('Fresh MACD crossover signal');
  if (signals.bullishDivergence) reasons.push('OBV bullish divergence — accumulation hidden in price weakness');
  else if (signals.obvRising) reasons.push('OBV trending up — volume confirms price action');
  if (signals.threeWhiteSoldiers) reasons.push('Three White Soldiers — sustained institutional buying');
  else if (signals.morningStar) reasons.push('Morning Star reversal pattern');
  else if (signals.bullishEngulfing) reasons.push('Bullish Engulfing — buyers overwhelmed sellers');
  else if (signals.hammer) reasons.push('Hammer candle — clear rejection of lower prices');
  if (signals.volumeSpike) reasons.push('Volume spike — institutional participation');
  else if (signals.volumeAboveAvg) reasons.push('Above-average volume confirmation');
  if (signals.nearSupport && !signals.breakingOut) reasons.push('Entry near support — defined risk');
  if (signals.breakingOut) reasons.push('Breakout above resistance with volume');
  if (signals.rsiNeutralBullish) reasons.push('RSI in healthy momentum zone (40-65)');
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
  if (signals.inDowntrend) risks.push('Market structure: Lower Highs + Lower Lows — counter-trend trade');
  else if (signals.lowerHighs) risks.push('Most recent swing high is lower — momentum fading');
  if (!signals.obvRising) risks.push('OBV not confirming — volume not supporting move');
  if (signals.nearResistance && !signals.breakingOut) risks.push('Near resistance — potential rejection');
  if (signals.weakTrend) risks.push(`ADX ${indicators.adx} — no clear trend, range-bound risk`);
  if (signals.nearUpperBB) risks.push('Near upper Bollinger Band — overextended');
  if (indicators.atr > stockData.currentPrice * 0.04) risks.push('High ATR — volatile stock, wider stops needed');
  if (stockData.fundamentals?.debtToEquity > 2) risks.push(`High debt (D/E: ${stockData.fundamentals.debtToEquity}) — financial risk`);
  risks.push('General market risk — always honor stop loss');
  return risks.join('. ') + '.';
}
