import { analyzeTechnicals, generateTechnicalReasoning } from './technicalAnalysis.js';
import { calculatePositionSize, validateTrade, calculatePortfolioSummary, CONFIG } from './riskEngine.js';
import { scoreFundamentals, generateFundamentalSummary } from './fundamentalAnalysis.js';

/**
 * AI Scoring Engine (Phase 2 — 8-Factor System)
 * Combines technical, fundamental, and market signals into a 0-100 confidence score.
 */

// Scoring weights (total = 100) — REVERTED to the v2 baseline after the
// v3 re-weighting empirically degraded performance:
//   2022-2024 in-sample backtest: win 48.67% → 42.4%, exp +1.74% → +1.05%,
//   maxDD 8.4% → 12.99%.
//
// The new analysis modules (trendlines, rejection wicks, traps, Fibonacci,
// Varsity S/R zones, Dow patterns, Marubozu) are RETAINED as additive
// signals — they enrich scoring but no longer dominate. The two setup
// types that empirically WORKED (Bear Trap Reversal +1.60%, Support
// Rejection Wick +2.58%) remain as Tier-A classifications.
const WEIGHTS = {
  trend: 13,
  momentum: 15,
  volume: 10,
  priceAction: 11,
  riskReward: 12,
  psychology: 9,
  fundamentals: 10,
  marketContext: 10,
  patterns: 5,    // candlestick patterns
  structure: 5,   // HH/HL + OBV + trendline + Dow + Fib + Varsity-S/R (additive, clamped here)
};

/**
 * Score a single stock and generate trade setup
 */
export function scoreStock(stockData, marketContext = null, totalCapital = null) {
  const analysis = analyzeTechnicals(stockData.quotes);
  if (!analysis) return null;

  const { signals, indicators, levels } = analysis;

  // === TREND SCORE (0-13) ===
  // M5.3: fast EMA stack (price > ema9 > ema21) gets a small bonus to
  // reward short-term timing. A fresh ema9-over-ema21 cross is a strong
  // entry signal in Varsity's 9/21 prescription. Both are clamped under
  // the trend ceiling so they can't displace the primary 20/50/200 stack.
  let trendScore = 0;
  if (signals.aboveEma200) trendScore += 3;
  if (signals.aboveEma50) trendScore += 3;
  if (signals.aboveEma20) trendScore += 2;
  if (signals.ema20AboveEma50) trendScore += 2;
  if (signals.trendAligned) trendScore += 2;
  if (signals.ema20Rising) trendScore += 1.5;
  if (signals.weeklyUptrend) trendScore += 1.5;
  if (signals.fastTrendStack) trendScore += 1;      // M5.3: short-term in-trend
  if (signals.ema9CrossUp)    trendScore += 1.5;    // M5.3: fresh fast-cross entry
  if (signals.ema9CrossDown)  trendScore -= 1;      // M5.3: fresh fast-cross warning
  trendScore = Math.max(0, Math.min(trendScore, WEIGHTS.trend));

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

  // === PRICE ACTION SCORE (0-11) — backtest-calibrated ===
  // Cap reverted to 11 (was 18, which empirically degraded results).
  // Bonuses retained ONLY for empirically positive signals:
  //   Bear Trap (+1.60% exp on n=26) and Bullish Rejection (+2.58% on n=17).
  // The trendline-touch and retest-bounce flags are NOT rewarded here —
  // they didn't show edge in the 2022-2024 backtest.
  let priceActionScore = 0;
  // Empirical winners
  if (signals.bearTrap)         priceActionScore += 7;  // proven
  if (signals.bullishRejection && (signals.nearVarsitySupport || signals.atGoldenSR))
                                priceActionScore += 7;  // proven
  // Legacy signals (unchanged from v2)
  if (signals.breakingOut)      priceActionScore += 6;
  else if (signals.consolidating && signals.nearSupport) priceActionScore += 5;
  else if (signals.nearSupport) priceActionScore += 3;
  if (signals.bbSqueezing)      priceActionScore += 3;
  if (signals.nearLowerBB && signals.rsiOversold) priceActionScore += 2;
  // Penalties — bearish price action (these are detection-only; the
  // structureScore handles bearish-pattern penalties)
  if (signals.bearishRejection) priceActionScore -= 3;
  if (signals.bullTrap)         priceActionScore -= 5;
  if (signals.brokeTrendlineSupport) priceActionScore -= 3;
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
  // Dow patterns (ch.18) — backtest-tuned weights:
  // - Double Bottom (-1.35% exp on n=15) and Range Breakout (-2.66% on n=14):
  //   zero bonus, the signal is detected but doesn't earn structure points.
  //   Synthetic tests passed; real data is noisier. Keeping detection for
  //   downstream UI / future re-validation.
  // - Bullish Flag is kept at +1 — neutral edge (-0.80% on n=9) but
  //   pairs well with a validated trendline (its setupType is gated to
  //   only fire WITH trendline support).
  if (signals.bullishFlag && signals.trendlineSupportValid)  structureScore += 1;
  if (signals.doubleTop)    structureScore -= 3;             // bearish — keep penalty
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

  // === SETUP TYPE — empirical-winner-driven classification ===
  // Backtest 2022-2024 ranking of new v3 setups (by per-trade expectancy):
  //   ✓ Support Rejection Wick    n=17  win=53%  exp=+2.58%   ← KEEP as Tier-A
  //   ✓ Bear Trap Reversal        n=26  win=46%  exp=+1.60%   ← KEEP as Tier-A
  //   ~ At Validated Trendline    n=42  win=45%  exp=+0.77%   ← tightened gating below
  //   ~ Bullish Flag              n= 9  win=44%  exp=-0.80%   ← demoted, no priority routing
  //   ✗ Trendline Retest Bounce   n= 8  win=38%  exp=-0.42%   ← DROPPED from priority
  //   ✗ Dow Double Bottom         n=15  win=33%  exp=-1.35%   ← DROPPED
  //   ✗ Dow Range Breakout        n=14  win=29%  exp=-2.66%   ← DROPPED
  let setupType = 'Trend Analysis';
  // Tier-A — empirically validated winners
  if (signals.bearTrap)                                                   setupType = 'Bear Trap Reversal';
  else if (signals.bullishRejection && (signals.nearVarsitySupport || signals.atGoldenSR)) setupType = 'Support Rejection Wick';
  // Tier-B — At Validated Trendline only when also confirmed by price-action signal
  else if (signals.onTrendlineSupport && signals.trendlineSupportValid &&
           (signals.bullishRejection || signals.bearTrap || signals.atGoldenSR))
                                                                          setupType = 'Trendline + Price Action';
  // Tier-C — Marubozu / Bullish Flag (preserve, neutral edge)
  else if (signals.bullishMarubozu && signals.volumeAboveAvg)             setupType = 'Bullish Marubozu';
  else if (signals.bullishFlag && signals.trendlineSupportValid)          setupType = 'Bullish Flag';
  // Tier-D — legacy indicator-driven (kept; Run #10 baseline performance OK)
  else if (signals.breakingOut && signals.strongTrend)                    setupType = 'Breakout + ADX Trend';
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

  // Pass 1: strict — R:R >= 1.5, score >= 65, portfolio checks.
  // Threshold raised from 50 to 65 based on Run #15 (2022-2024) per-bucket
  // expectancy data:
  //   70+    n= 34  win=56%  exp=+3.94%    ← elite — beats v2 baseline (+1.74%)
  //   60-69  n= 99  win=44%  exp=+0.14%    ← break-even, gets eaten by commission
  //   50-59  n= 30  win=40%  exp=-0.09%    ← actively losing
  // After 0.2% round-trip commission, the 60-69 bucket goes negative.
  // Threshold 65 keeps the elite bucket + the top half of the middle one
  // (Pass-2 fills any remaining slots with no floor for diversification).
  const selectedTrades = [];
  for (const trade of valid) {
    if (trade.riskRewardRatio < 1.5) continue;
    if (trade.confidenceScore < 65) continue;
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
