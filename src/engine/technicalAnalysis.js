import { RSI, MACD, EMA, BollingerBands, ATR, ADX } from 'technicalindicators';

/**
 * Wall Street-Level Technical Analysis Engine
 *
 * Upgrades over v1:
 *  - Candlestick pattern recognition (6 patterns)
 *  - Market structure analysis: Higher Highs / Higher Lows
 *  - On-Balance Volume (OBV) trend + bullish divergence
 *  - Structure-based stop loss (swing low – ATR buffer, with guard rails)
 *  - Resistance-based price targets (swing highs before ATR fallback)
 *  - Estimated holding days derived from ATR velocity
 */

export function analyzeTechnicals(quotes) {
  if (!quotes || quotes.length < 50) return null;

  const closes  = quotes.map(q => q.close);
  const highs   = quotes.map(q => q.high);
  const lows    = quotes.map(q => q.low);
  const volumes = quotes.map(q => q.volume);
  const currentPrice = closes[closes.length - 1];

  // ── CORE INDICATORS ───────────────────────────────────────────────────────

  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

  const macdValues = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });
  const macd     = macdValues.length > 0 ? macdValues[macdValues.length - 1] : { MACD: 0, signal: 0, histogram: 0 };
  const prevMacd = macdValues.length > 1 ? macdValues[macdValues.length - 2] : macd;

  const ema20  = EMA.calculate({ values: closes, period: 20 });
  const ema50  = EMA.calculate({ values: closes, period: 50 });
  const ema200 = closes.length >= 200 ? EMA.calculate({ values: closes, period: 200 }) : [];

  const currentEma20  = ema20.length  > 0 ? ema20[ema20.length - 1]   : currentPrice;
  const currentEma50  = ema50.length  > 0 ? ema50[ema50.length - 1]   : currentPrice;
  const currentEma200 = ema200.length > 0 ? ema200[ema200.length - 1] : currentPrice;
  const prevEma20     = ema20.length  > 1 ? ema20[ema20.length - 2]   : currentEma20;
  const prevEma50     = ema50.length  > 1 ? ema50[ema50.length - 2]   : currentEma50;

  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : currentPrice * 0.02;

  // Varsity ch.12: volume baseline is 10-day SMA (not 20). Keep avgVolume20
  // exposed for legacy callers but compute volumeRatio off 10-day per Varsity.
  const avgVolume10  = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const avgVolume20  = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio   = avgVolume10 > 0 ? currentVolume / avgVolume10 : 1;

  const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  const bb       = bbValues.length > 0 ? bbValues[bbValues.length - 1] : null;
  const bbWidth  = bb ? (bb.upper - bb.lower) / bb.middle : 0;

  let adxValue = 25;
  try {
    const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
    if (adxValues.length > 0) adxValue = adxValues[adxValues.length - 1].adx;
  } catch (_) {}

  // ── PIVOT-POINT SUPPORT / RESISTANCE ──────────────────────────────────────

  const recent         = quotes.slice(-20);
  const pivotHigh      = Math.max(...recent.map(q => q.high));
  const pivotLow       = Math.min(...recent.map(q => q.low));
  const pivotClose     = recent[recent.length - 1].close;
  const pivotPoint     = (pivotHigh + pivotLow + pivotClose) / 3;
  const support1       = 2 * pivotPoint - pivotHigh;
  const resistance1    = 2 * pivotPoint - pivotLow;
  const support2       = pivotPoint - (pivotHigh - pivotLow);
  const simpleSupport  = Math.min(...recent.map(q => q.low));
  const simpleResistance = Math.max(...recent.map(q => q.high));

  // Varsity ch.11 S/R zones — ≥3 touches at ~same price, well-spaced in time,
  // ±0.5% zone width. Returns array of { center, lowBand, highBand, touches,
  // type: 'support' | 'resistance' } sorted by touch count desc.
  const srZones = computeVarsitySR(quotes, currentPrice);
  const nearestSupportZone    = srZones.find(z => z.type === 'support'    && z.center < currentPrice);
  const nearestResistanceZone = srZones.find(z => z.type === 'resistance' && z.center > currentPrice);
  const support        = Math.max(support1, support2);
  const resistance     = resistance1;

  const weeklySlope = ema20.length > 5
    ? (ema20[ema20.length - 1] - ema20[ema20.length - 5]) / ema20[ema20.length - 5] * 100
    : 0;

  // ── FIBONACCI RETRACEMENTS (Varsity ch.16) ───────────────────────────────
  // Identify the most recent significant swing high & swing low over the
  // lookback window, compute the 23.6 / 38.2 / 50 / 61.8 / 78.6 retracement
  // levels, and flag which one the current price is sitting on (within 1%).
  // The 61.8% Golden Ratio is Varsity's "strongest" support level.
  const fib = computeFibonacci(quotes, currentPrice);

  // ── DOW PATTERNS (Varsity ch.18) ────────────────────────────────────────
  // Detect classical Dow chart patterns over the last 60 trading days:
  //   - Double Bottom (bullish reversal): two swing lows at ~same price,
  //     well-spaced, with a peak between them
  //   - Double Top (bearish reversal): mirror
  //   - Flag continuation (bullish): big rally then short pullback in a
  //     parallel channel — set up for next leg up
  //   - Range Breakout: sustained consolidation followed by high-vol break
  const dow = computeDowPatterns(quotes, currentPrice, volumeRatio);

  // ── MULTI-TIMEFRAME (MTF) CONFLUENCE ─────────────────────────────────────
  // Varsity TA "Finale" (ch.19) + Dow Theory (ch.17-18): daily setups should
  // confirm against the weekly trend. Resample daily → weekly, compute weekly
  // EMA20/50 stack + slope. The setupType-aware MTF gate in scoringEngine uses
  // mtf.aligned / mtf.weeklyTrend.
  const mtf = computeMTF(quotes, currentPrice);

  // ── WALL STREET-LEVEL ANALYSIS ────────────────────────────────────────────

  const patterns    = detectCandlestickPatterns(quotes);
  const structure   = analyzeMarketStructure(quotes);
  const obvAnalysis = calculateOBVTrend(quotes);

  // ── STRUCTURE-BASED STOP LOSS ─────────────────────────────────────────────

  const stopLoss    = calculateStopLossV2(currentPrice, atr, quotes);
  const riskPerShare = Math.max(currentPrice - stopLoss, atr * 0.5);

  // ── RESISTANCE-BASED TARGET ───────────────────────────────────────────────

  const breakingOutSignal = currentPrice > simpleResistance * 0.98 && volumeRatio > 1.3;
  const target = calculateResistanceTarget(currentPrice, stopLoss, atr, structure, {
    breakingOut: breakingOutSignal,
    rsiOversold: rsi < 35,
    nearLowerBB: bb ? currentPrice < bb.lower * 1.01 : false,
    bbSqueezing: bbWidth < 0.04,
    strongTrend: adxValue > 25,
  });

  const riskRewardRatio = riskPerShare > 0 ? (target - currentPrice) / riskPerShare : 0;

  // ── ESTIMATED HOLDING DAYS ────────────────────────────────────────────────
  // Assume stock moves ~50 % of ATR per day on average toward target
  const priceMoveNeeded  = target - currentPrice;
  const dailyExpectedMove = atr * 0.5;
  const estimatedDays    = Math.max(3, Math.min(25, Math.ceil(priceMoveNeeded / dailyExpectedMove)));

  // ── SIGNALS ───────────────────────────────────────────────────────────────

  const signals = {
    // Trend / EMA
    aboveEma20:       currentPrice > currentEma20,
    aboveEma50:       currentPrice > currentEma50,
    aboveEma200:      currentPrice > currentEma200,
    ema20AboveEma50:  currentEma20 > currentEma50,
    trendAligned:     currentPrice > currentEma20 && currentEma20 > currentEma50,
    ema20Rising:      currentEma20 > prevEma20,
    ema50Rising:      currentEma50 > prevEma50,
    weeklyUptrend:    weeklySlope > 0.5,

    // ── Multi-timeframe confluence (Varsity TA Finale ch.19 + Dow ch.17-18)
    mtfBullish:       mtf.weeklyTrend === 'up',
    mtfBearish:       mtf.weeklyTrend === 'down',
    mtfAligned:       mtf.aligned,

    // ── Fibonacci (Varsity ch.16) — at golden ratio support
    nearFib618:       fib?.nearestLevel === '61.8',
    nearFib50:        fib?.nearestLevel === '50',
    nearFib382:       fib?.nearestLevel === '38.2',
    nearAnyFib:       !!fib?.nearestLevel,

    // ── Dow chart patterns (Varsity ch.18)
    doubleBottom:     dow?.doubleBottom || false,
    doubleTop:        dow?.doubleTop    || false,
    bullishFlag:      dow?.bullishFlag  || false,
    rangeBreakout:    dow?.rangeBreakout || false,

    // Trend strength (ADX)
    strongTrend:        adxValue > 25,
    weakTrend:          adxValue < 20,
    trendStrengthening: adxValue > 20,

    // Momentum
    rsiOversold:        rsi < 35,
    rsiOverbought:      rsi > 70,
    rsiNeutralBullish:  rsi > 40 && rsi < 65,
    macdBullishCross:   macd.MACD > macd.signal && prevMacd.MACD <= prevMacd.signal,
    macdBullish:        macd.histogram > 0,
    macdHistogramRising: macd.histogram > (prevMacd.histogram || 0),

    // Bollinger Bands
    nearLowerBB: bb ? currentPrice < bb.lower * 1.01 : false,
    nearUpperBB: bb ? currentPrice > bb.upper * 0.99 : false,
    bbSqueezing: bbWidth < 0.04,
    insideBB:    bb ? currentPrice > bb.lower && currentPrice < bb.upper : true,

    // Volume
    volumeAboveAvg: volumeRatio > 1.2,
    volumeSpike:    volumeRatio > 2.0,
    volumeDrying:   volumeRatio < 0.6,

    // Price action
    nearSupport:    (currentPrice - simpleSupport) / currentPrice < 0.03,
    nearResistance: (simpleResistance - currentPrice) / currentPrice < 0.02,
    consolidating:  (simpleResistance - simpleSupport) / currentPrice < 0.05,
    breakingOut:    breakingOutSignal,

    // ── Varsity-spec S/R (ch.11): ≥3 well-spaced touches, ±0.5% zone width
    nearVarsitySupport:    !!nearestSupportZone &&
                           (currentPrice - nearestSupportZone.center) / currentPrice < 0.04,
    nearVarsityResistance: !!nearestResistanceZone &&
                           (nearestResistanceZone.center - currentPrice) / currentPrice < 0.04,
    atGoldenSR:            !!(nearestSupportZone && nearestSupportZone.touches >= 5),

    // ── Candlestick patterns (new)
    hammer:            patterns.hammer,
    bullishEngulfing:  patterns.bullishEngulfing,
    morningStar:       patterns.morningStar,
    dragonflyDoji:     patterns.dragonflyDoji,
    threeWhiteSoldiers: patterns.threeWhiteSoldiers,
    bullishHarami:     patterns.bullishHarami,
    bullishMarubozu:   patterns.bullishMarubozu,  // Varsity ch.5
    bearishMarubozu:   patterns.bearishMarubozu,
    anyBullishPattern: patterns.anyBullish,
    priorTrendOk:      patterns.priorTrendOk,    // Varsity ch.4-10 prior-trend gate
    priorTrendPct:     patterns.priorTrendPct,

    // ── Market structure (new)
    higherHighs:  structure.higherHighs,
    higherLows:   structure.higherLows,
    inUptrend:    structure.inUptrend,
    inDowntrend:  structure.inDowntrend,

    // ── OBV (new)
    obvRising:         obvAnalysis.obvRising,
    bullishDivergence: obvAnalysis.bullishDivergence,
  };

  return {
    indicators: {
      rsi:          Math.round(rsi * 100) / 100,
      macd: {
        value:     Math.round((macd.MACD     || 0) * 100) / 100,
        signal:    Math.round((macd.signal   || 0) * 100) / 100,
        histogram: Math.round((macd.histogram|| 0) * 100) / 100,
      },
      ema20:        Math.round(currentEma20  * 100) / 100,
      ema50:        Math.round(currentEma50  * 100) / 100,
      ema200:       Math.round(currentEma200 * 100) / 100,
      atr:          Math.round(atr           * 100) / 100,
      adx:          Math.round(adxValue      * 100) / 100,
      volumeRatio:  Math.round(volumeRatio   * 100) / 100,
      avgVolume20:  Math.round(avgVolume20),
      bollingerBands: bb ? {
        upper:  Math.round(bb.upper  * 100) / 100,
        middle: Math.round(bb.middle * 100) / 100,
        lower:  Math.round(bb.lower  * 100) / 100,
        width:  Math.round(bbWidth  * 10000) / 100,
      } : null,
      weeklySlope:  Math.round(weeklySlope * 100) / 100,
      mtf,                                  // multi-timeframe weekly snapshot
      fib,                                  // Fibonacci retracement levels + nearest
    },
    srZones,                                  // Varsity ch.11 — full zone list w/ touch counts
    levels: {
      support:          Math.round(Math.min(support, simpleSupport)     * 100) / 100,
      resistance:       Math.round(Math.max(resistance, simpleResistance) * 100) / 100,
      varsitySupport:    nearestSupportZone    ? Math.round(nearestSupportZone.center    * 100) / 100 : null,
      varsityResistance: nearestResistanceZone ? Math.round(nearestResistanceZone.center * 100) / 100 : null,
      varsitySupportTouches:    nearestSupportZone?.touches    ?? 0,
      varsityResistanceTouches: nearestResistanceZone?.touches ?? 0,
      pivotPoint:       Math.round(pivotPoint  * 100) / 100,
      stopLoss:         Math.round(stopLoss    * 100) / 100,
      target:           Math.round(target      * 100) / 100,
      riskRewardRatio:  Math.round(riskRewardRatio * 100) / 100,
      estimatedDays,
    },
    signals,
    patterns,
    structure,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CANDLESTICK PATTERN DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function detectCandlestickPatterns(quotes) {
  const p = {
    hammer: false, bullishEngulfing: false, morningStar: false,
    dragonflyDoji: false, threeWhiteSoldiers: false, bullishHarami: false,
    bullishMarubozu: false, bearishMarubozu: false,
    anyBullish: false,
  };

  if (quotes.length < 3) return p;

  const c0 = quotes[quotes.length - 1]; // latest candle
  const c1 = quotes[quotes.length - 2]; // previous
  const c2 = quotes[quotes.length - 3]; // 3 bars ago

  const body  = c => Math.abs(c.close - c.open);
  const isBull = c => c.close >= c.open;
  const isBear = c => c.close < c.open;
  const lower  = c => Math.min(c.open, c.close) - c.low;
  const upper  = c => c.high - Math.max(c.open, c.close);
  const rng    = c => c.high - c.low;

  const body0 = body(c0), body1 = body(c1), body2 = body(c2);
  const rng0  = rng(c0),  rng1  = rng(c1),  rng2  = rng(c2);

  // Marubozu — Varsity ch.5. Bull: open≈low, close≈high (no shadows).
  // Tolerances: shadows ≤ 0.2% of body; body range 1-10% of price.
  const c0Rng = c0.high - c0.low;
  const c0BodyPct = c0.close > 0 ? body0 / c0.close * 100 : 0;
  if (c0BodyPct >= 1 && c0BodyPct <= 10 && c0Rng > 0) {
    const upperFrac = upper(c0) / c0Rng;
    const lowerFrac = lower(c0) / c0Rng;
    // Tolerance: shadows < 5% of total range
    if (isBull(c0) && upperFrac < 0.05 && lowerFrac < 0.05) {
      p.bullishMarubozu = true;
    } else if (isBear(c0) && upperFrac < 0.05 && lowerFrac < 0.05) {
      p.bearishMarubozu = true;
    }
  }

  // Hammer — long lower wick ≥ 2× body, tiny upper wick
  if (rng0 > 0 && body0 >= c0.close * 0.001 &&
      lower(c0) >= 2 * body0 && upper(c0) <= 0.5 * body0) {
    p.hammer = true;
  }

  // Dragonfly Doji — almost no body, very long lower shadow
  if (rng0 > 0 && body0 < rng0 * 0.08 && lower(c0) > rng0 * 0.60) {
    p.dragonflyDoji = true;
  }

  // Bullish Engulfing — c1 bearish, c0 bullish and swallows c1 body
  if (isBear(c1) && isBull(c0) &&
      c0.open <= c1.close && c0.close >= c1.open && body0 > body1 * 0.8) {
    p.bullishEngulfing = true;
  }

  // Bullish Harami — c1 large bearish, c0 small bullish inside c1 body
  if (isBear(c1) && body1 > rng1 * 0.5 &&
      isBull(c0) && body0 < body1 * 0.5 &&
      c0.open > c1.close && c0.close < c1.open) {
    p.bullishHarami = true;
  }

  // Morning Star — 3-candle reversal
  if (isBear(c2) && body2 > rng2 * 0.5 &&
      body1 < body2 * 0.4 &&
      isBull(c0) && body0 > rng0 * 0.5 &&
      c0.close > (c2.open + c2.close) / 2) {
    p.morningStar = true;
  }

  // Three White Soldiers — 3 strong bull candles, each closing higher
  if (quotes.length >= 3 &&
      isBull(c2) && isBull(c1) && isBull(c0) &&
      c1.close > c2.close && c0.close > c1.close &&
      c1.open  > c2.open  && c0.open  > c1.open  &&
      body0 > rng0 * 0.4 && body1 > rng1 * 0.4 && body2 > rng2 * 0.4) {
    p.threeWhiteSoldiers = true;
  }

  p.anyBullish = p.hammer || p.bullishEngulfing || p.morningStar ||
                 p.dragonflyDoji || p.threeWhiteSoldiers || p.bullishHarami ||
                 p.bullishMarubozu;

  // Varsity ch.4-10 cardinal rule: bullish reversal patterns are only valid
  // when preceded by a downtrend. Without this check, a hammer in the middle
  // of an uptrend is a continuation signal (or noise), not a buy.
  // Use a 5-day prior trend window measured on closes BEFORE the pattern.
  if (p.anyBullish && quotes.length >= 8) {
    const window = quotes.slice(-8, -1).map(q => q.close); // 7 closes preceding c0
    const start = window[0], end = window[window.length - 1];
    const priorTrendPct = start > 0 ? (end - start) / start * 100 : 0;
    p.priorTrendOk = priorTrendPct < -0.5; // strictly downtrend, > 0.5% drop
    p.priorTrendPct = +priorTrendPct.toFixed(2);
  } else {
    p.priorTrendOk = false;
    p.priorTrendPct = 0;
  }

  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// SWING HIGH / LOW DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function findSwingLows(quotes) {
  const lows = [];
  for (let i = 2; i < quotes.length - 2; i++) {
    if (quotes[i].low < quotes[i-1].low && quotes[i].low < quotes[i-2].low &&
        quotes[i].low < quotes[i+1].low && quotes[i].low < quotes[i+2].low) {
      lows.push(quotes[i].low);
    }
  }
  return lows;
}

function findSwingHighs(quotes) {
  const highs = [];
  for (let i = 2; i < quotes.length - 2; i++) {
    if (quotes[i].high > quotes[i-1].high && quotes[i].high > quotes[i-2].high &&
        quotes[i].high > quotes[i+1].high && quotes[i].high > quotes[i+2].high) {
      highs.push(quotes[i].high);
    }
  }
  return highs;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET STRUCTURE: Higher Highs / Higher Lows
// ─────────────────────────────────────────────────────────────────────────────

function analyzeMarketStructure(quotes) {
  const lookback  = Math.min(quotes.length, 60);
  const slice     = quotes.slice(-lookback);
  const swingH    = findSwingHighs(slice);
  const swingL    = findSwingLows(slice);

  const higherHighs = swingH.length >= 2 && swingH[swingH.length - 1] > swingH[swingH.length - 2];
  const higherLows  = swingL.length >= 2 && swingL[swingL.length - 1] > swingL[swingL.length - 2];
  const lowerHighs  = swingH.length >= 2 && swingH[swingH.length - 1] < swingH[swingH.length - 2];
  const lowerLows   = swingL.length >= 2 && swingL[swingL.length - 1] < swingL[swingL.length - 2];

  const inUptrend   = higherHighs && higherLows;
  const inDowntrend = lowerHighs  && lowerLows;

  // Most recent structural swing low — best stop-loss anchor
  const structuralSwingLow = swingL.length > 0 ? swingL[swingL.length - 1] : null;

  // Nearest swing high above current price — resistance target
  const currentPrice = quotes[quotes.length - 1].close;
  const aboveLevels  = swingH.filter(h => h > currentPrice * 1.005);
  const nearestResistance = aboveLevels.length > 0 ? Math.min(...aboveLevels) : null;

  return { higherHighs, higherLows, lowerHighs, lowerLows, inUptrend, inDowntrend,
           structuralSwingLow, nearestResistance, swingHighs: swingH, swingLows: swingL };
}

// ─────────────────────────────────────────────────────────────────────────────
// ON-BALANCE VOLUME (OBV) TREND + BULLISH DIVERGENCE
// ─────────────────────────────────────────────────────────────────────────────

function calculateOBVTrend(quotes) {
  if (quotes.length < 20) return { obvTrend: 'neutral', bullishDivergence: false, obvRising: false };

  // Build OBV series
  const obvs = [0];
  for (let i = 1; i < quotes.length; i++) {
    const prev = obvs[obvs.length - 1];
    if (quotes[i].close > quotes[i - 1].close)      obvs.push(prev + (quotes[i].volume || 0));
    else if (quotes[i].close < quotes[i - 1].close) obvs.push(prev - (quotes[i].volume || 0));
    else                                             obvs.push(prev);
  }

  // 10-day OBV direction
  const last10Obv = obvs.slice(-10);
  const obvRising = last10Obv[last10Obv.length - 1] > last10Obv[0];

  // Bullish divergence: price made lower low in recent 10 bars vs prior 10, but OBV did not
  const slice1Prices = quotes.slice(-20, -10).map(q => q.close);
  const slice2Prices = quotes.slice(-10).map(q => q.close);
  const slice1Obvs   = obvs.slice(-20, -10);
  const slice2Obvs   = obvs.slice(-10);

  const low1 = Math.min(...slice1Prices);
  const low2 = Math.min(...slice2Prices);
  const obvAtLow1 = slice1Obvs[slice1Prices.indexOf(low1)] || 0;
  const obvAtLow2 = slice2Obvs[slice2Prices.indexOf(low2)] || 0;

  const bullishDivergence = low2 < low1 && obvAtLow2 > obvAtLow1;

  return { obvTrend: obvRising ? 'rising' : 'falling', bullishDivergence, obvRising };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE-BASED STOP LOSS (replaces old ATR*1.5 shortcut)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// VARSITY-SPEC SUPPORT / RESISTANCE ZONES — Varsity ch.11
//
// Replaces the naive min/max simpleSupport/simpleResistance with proper
// touch-counting zones per Varsity's literal prescription:
//
//   "Identify at least 3 price action zones... well spaced in time...
//    The price level is usually depicted in a range and not at a single
//    price point. It is actually a zone or an area..."
//
// Algorithm:
//   1. Collect every swing pivot (high or low) from the last 90 bars
//   2. Bucket pivots into ±0.5% bands
//   3. Count distinct touches per band; require ≥3 touches AND min spacing
//      of 5 bars between consecutive touches in the same zone
//   4. Classify each zone as 'support' if center < currentPrice, else
//      'resistance'. After break, role-reversal happens automatically.
//
// Returns: [{ center, lowBand, highBand, touches, lastTouchIdx, type }]
//          sorted by touch count (descending) — strongest zones first.
// ─────────────────────────────────────────────────────────────────────────────
function computeVarsitySR(quotes, currentPrice) {
  if (!quotes || quotes.length < 30) return [];
  const window = quotes.slice(-90);
  const ZONE_WIDTH_PCT = 0.5;   // ±0.5% per Varsity ch.11
  const MIN_TOUCHES    = 3;     // Varsity hard minimum
  const MIN_SPACING    = 5;     // bars between touches in the same zone

  // Find pivots — local highs and lows with 2-bar lookback
  const pivots = [];
  for (let i = 2; i < window.length - 2; i++) {
    const h = window[i].high, l = window[i].low;
    if (h > window[i-1].high && h > window[i-2].high && h > window[i+1].high && h > window[i+2].high) {
      pivots.push({ idx: i, price: h });
    }
    if (l < window[i-1].low && l < window[i-2].low && l < window[i+1].low && l < window[i+2].low) {
      pivots.push({ idx: i, price: l });
    }
  }
  if (pivots.length < MIN_TOUCHES) return [];

  // Bucket pivots into bands. Build a cluster around each pivot price
  // and merge nearby ones.
  const bands = [];   // { center, touches: [pivots], lowBand, highBand }
  for (const p of pivots) {
    // Find an existing band within zone width
    let merged = false;
    for (const b of bands) {
      const distPct = Math.abs(p.price - b.center) / b.center * 100;
      if (distPct <= ZONE_WIDTH_PCT) {
        // Require min spacing from latest touch in this band
        const lastTouchIdx = b.touches[b.touches.length - 1].idx;
        if (p.idx - lastTouchIdx >= MIN_SPACING) {
          b.touches.push(p);
          // Recenter as touch-average
          b.center = b.touches.reduce((s, t) => s + t.price, 0) / b.touches.length;
        }
        merged = true;
        break;
      }
    }
    if (!merged) {
      bands.push({ center: p.price, touches: [p] });
    }
  }

  // Keep only bands with ≥3 well-spaced touches
  const validBands = bands.filter(b => b.touches.length >= MIN_TOUCHES);

  return validBands
    .map(b => ({
      center:       Math.round(b.center * 100) / 100,
      lowBand:      Math.round(b.center * (1 - ZONE_WIDTH_PCT / 100) * 100) / 100,
      highBand:     Math.round(b.center * (1 + ZONE_WIDTH_PCT / 100) * 100) / 100,
      touches:      b.touches.length,
      lastTouchIdx: b.touches[b.touches.length - 1].idx,
      type:         b.center < currentPrice ? 'support' : 'resistance',
    }))
    .sort((a, b) => b.touches - a.touches);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOW CHART PATTERNS — Varsity ch.18
// Classical reversal + continuation patterns from Dow Theory:
//   - Double Bottom: two lows at ~same price (±2%), well-spaced (≥10 bars),
//     with a peak ≥3% above between them. Confirmed when price > the peak.
//   - Double Top: mirror image.
//   - Bullish Flag: a strong rally (≥7% in <10 bars) followed by a brief
//     pullback in a tight range (≤3% drawdown, ≤8 bars). High-probability
//     continuation pattern.
//   - Range Breakout: ≥15 bars in a ≤5% range, then breaks out on volume.
// ─────────────────────────────────────────────────────────────────────────────
function computeDowPatterns(quotes, currentPrice, volumeRatio) {
  if (!quotes || quotes.length < 30) return null;
  const window = quotes.slice(-60);
  const highs = window.map(q => q.high);
  const lows  = window.map(q => q.low);
  const closes = window.map(q => q.close);

  // Find local pivot points (swing highs/lows) with a 3-bar lookback/forward
  const pivotHighs = [];
  const pivotLows  = [];
  for (let i = 3; i < window.length - 3; i++) {
    const isHigh = highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i-3] &&
                   highs[i] > highs[i+1] && highs[i] > highs[i+2] && highs[i] > highs[i+3];
    const isLow  = lows[i]  < lows[i-1]  && lows[i]  < lows[i-2]  && lows[i]  < lows[i-3] &&
                   lows[i]  < lows[i+1]  && lows[i]  < lows[i+2]  && lows[i]  < lows[i+3];
    if (isHigh) pivotHighs.push({ idx: i, price: highs[i] });
    if (isLow)  pivotLows.push({  idx: i, price: lows[i]  });
  }

  let doubleBottom = false, doubleTop = false;
  // Double Bottom: 2 most-recent lows within ±2%, spaced ≥10 bars, peak ≥3% between
  if (pivotLows.length >= 2) {
    const L = pivotLows.slice(-2);
    const priceDiffPct = Math.abs(L[0].price - L[1].price) / L[0].price * 100;
    const spacing = L[1].idx - L[0].idx;
    if (priceDiffPct <= 2 && spacing >= 10) {
      // Find peak between
      const between = highs.slice(L[0].idx + 1, L[1].idx);
      const peak = between.length ? Math.max(...between) : 0;
      const peakLiftPct = (peak - L[0].price) / L[0].price * 100;
      if (peakLiftPct >= 3 && currentPrice > peak) doubleBottom = true;
    }
  }
  // Double Top: mirror
  if (pivotHighs.length >= 2) {
    const H = pivotHighs.slice(-2);
    const priceDiffPct = Math.abs(H[0].price - H[1].price) / H[0].price * 100;
    const spacing = H[1].idx - H[0].idx;
    if (priceDiffPct <= 2 && spacing >= 10) {
      const between = lows.slice(H[0].idx + 1, H[1].idx);
      const valley = between.length ? Math.min(...between) : Infinity;
      const dipPct = (H[0].price - valley) / H[0].price * 100;
      if (dipPct >= 3 && currentPrice < valley) doubleTop = true;
    }
  }

  // Bullish Flag: detect a recent strong rally followed by tight pullback
  let bullishFlag = false;
  if (window.length >= 20) {
    // Look 5-15 bars ago for the rally start
    const rallyEndIdx = window.length - 6;
    const rallyStartIdx = window.length - 16;
    if (rallyStartIdx >= 0 && rallyEndIdx > rallyStartIdx) {
      const rallyGain = (closes[rallyEndIdx] - closes[rallyStartIdx]) / closes[rallyStartIdx] * 100;
      if (rallyGain >= 7) {
        // Last 5 bars should be a tight pullback (≤3% drop from rally peak)
        const recent = closes.slice(-5);
        const recentDrop = (Math.max(...recent) - currentPrice) / Math.max(...recent) * 100;
        if (recentDrop >= 0 && recentDrop <= 3) bullishFlag = true;
      }
    }
  }

  // Range Breakout: last 15+ bars in a ≤5% range that just broke up on vol
  let rangeBreakout = false;
  if (window.length >= 20) {
    const consol = closes.slice(-20, -1);
    const cmin = Math.min(...consol), cmax = Math.max(...consol);
    const rangePct = cmin > 0 ? (cmax - cmin) / cmin * 100 : 0;
    if (rangePct <= 5 && currentPrice > cmax && volumeRatio >= 1.5) {
      rangeBreakout = true;
    }
  }

  return { doubleBottom, doubleTop, bullishFlag, rangeBreakout, pivotHighs: pivotHighs.length, pivotLows: pivotLows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIBONACCI RETRACEMENTS — Varsity ch.16
// Identify the most recent significant swing high and swing low, then
// compute the 5 standard Fibonacci levels. Flag the nearest level the
// current price is sitting on (within 1% tolerance), so downstream
// scoring can give a confluence bonus for entries at the golden ratio.
//
// Direction convention:
//   - If swingHigh comes AFTER swingLow → uptrend → retracements drop FROM
//     swingHigh toward swingLow as percentages of the up-move
//   - If swingLow comes AFTER swingHigh → downtrend → bounces rise FROM
//     swingLow toward swingHigh as percentages of the down-move
// ─────────────────────────────────────────────────────────────────────────────
function computeFibonacci(quotes, currentPrice) {
  if (!quotes || quotes.length < 30) return null;
  // Look at the most recent 60 trading days for the dominant swing
  const window = quotes.slice(-60);
  let hiIdx = 0, loIdx = 0;
  for (let i = 0; i < window.length; i++) {
    if (window[i].high > window[hiIdx].high) hiIdx = i;
    if (window[i].low  < window[loIdx].low ) loIdx = i;
  }
  const swingHigh = window[hiIdx].high;
  const swingLow  = window[loIdx].low;
  const range     = swingHigh - swingLow;
  if (range <= 0) return null;

  const uptrend = hiIdx > loIdx;
  const ratios = { '23.6': 0.236, '38.2': 0.382, '50': 0.50, '61.8': 0.618, '78.6': 0.786 };
  const levels = {};
  for (const [name, r] of Object.entries(ratios)) {
    // Retracement from swingHigh during uptrend = swingHigh - r × range
    // Retracement from swingLow during downtrend = swingLow + r × range
    levels[name] = uptrend ? swingHigh - r * range : swingLow + r * range;
  }

  // Find nearest level within 1% tolerance
  let nearestLevel = null, nearestDistPct = Infinity;
  for (const [name, lvl] of Object.entries(levels)) {
    const distPct = Math.abs(currentPrice - lvl) / currentPrice * 100;
    if (distPct < nearestDistPct) { nearestDistPct = distPct; nearestLevel = name; }
  }
  // Only flag if within 1%
  if (nearestDistPct > 1.0) nearestLevel = null;

  return {
    swingHigh:  Math.round(swingHigh * 100) / 100,
    swingLow:   Math.round(swingLow  * 100) / 100,
    direction:  uptrend ? 'up' : 'down',
    levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    nearestLevel,
    nearestDistPct: Math.round(nearestDistPct * 100) / 100,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TIMEFRAME (MTF) CONFLUENCE — daily ↔ weekly trend alignment
// Source: Varsity TA module Finale (ch.19) + Dow Theory (ch.17-18).
// "Primary trend on the weekly chart sets the bias; trade only when the
//  daily trigger aligns with the weekly trend."
// ─────────────────────────────────────────────────────────────────────────────
function computeMTF(quotes, currentPrice) {
  // Resample daily candles → weekly bars by ISO week. Each weekly bar:
  // open = Mon open, high = max high, low = min low, close = Fri close.
  const weeklyCloses = resampleWeekly(quotes);
  if (weeklyCloses.length < 22) {
    return { weeklyTrend: 'unknown', aligned: false, weeklyEma20: null, weeklyEma50: null, weeks: weeklyCloses.length };
  }

  const wEma20 = EMA.calculate({ values: weeklyCloses, period: 20 });
  const hasW50 = weeklyCloses.length >= 50;
  const wEma50 = hasW50 ? EMA.calculate({ values: weeklyCloses, period: 50 }) : null;

  const w20 = wEma20[wEma20.length - 1];
  const w50 = hasW50 ? wEma50[wEma50.length - 1] : null;
  const wPrice = weeklyCloses[weeklyCloses.length - 1];

  // Slope: last 4 weekly EMA20 bars (~ 1 month of weekly action)
  const slope = wEma20.length >= 4
    ? (w20 - wEma20[wEma20.length - 4]) / wEma20[wEma20.length - 4] * 100
    : 0;

  // Trend classification: with ≥50 weeks of data require full EMA stack;
  // otherwise fall back to price-vs-EMA20 + slope only.
  let weeklyTrend = 'sideways';
  if (hasW50) {
    if (wPrice > w20 && w20 > w50 && slope > 0.5) weeklyTrend = 'up';
    else if (wPrice < w20 && w20 < w50 && slope < -0.5) weeklyTrend = 'down';
  } else {
    if (wPrice > w20 && slope > 0.5) weeklyTrend = 'up';
    else if (wPrice < w20 && slope < -0.5) weeklyTrend = 'down';
  }

  // Aligned = daily price agrees with weekly trend
  const aligned = (weeklyTrend === 'up' && currentPrice > w20)
               || (weeklyTrend === 'down' && currentPrice < w20);

  return {
    weeklyTrend, aligned,
    weeklyEma20: Math.round(w20 * 100) / 100,
    weeklyEma50: hasW50 ? Math.round(w50 * 100) / 100 : null,
    weeklySlopePct: Math.round(slope * 100) / 100,
    weeks: weeklyCloses.length,
  };
}

function resampleWeekly(quotes) {
  // Group consecutive 5 trading days into one weekly bar.
  // Using trading-day grouping (not ISO week) — robust to holidays.
  const weekly = [];
  for (let i = 0; i < quotes.length; i += 5) {
    const chunk = quotes.slice(i, i + 5);
    if (chunk.length === 0) continue;
    weekly.push(chunk[chunk.length - 1].close);
  }
  return weekly;
}

function calculateStopLossV2(currentPrice, atr, quotes) {
  // 1. Find the most recent structural swing low below price
  const swingLowsList = findSwingLows(quotes.slice(-35)).filter(l => l < currentPrice);

  let stopLoss;

  if (swingLowsList.length > 0) {
    // Nearest swing low below current price
    const nearestSwingLow = swingLowsList.reduce((best, sl) =>
      sl > best && sl < currentPrice ? sl : best, 0);

    if (nearestSwingLow > 0) {
      // Place stop a cushion below the swing low (professionals use 0.5–1.0 ATR)
      const buffer = Math.max(atr * 0.75, currentPrice * 0.0075);
      stopLoss = nearestSwingLow - buffer;
    }
  }

  // 2. ATR fallback (2× ATR = institutional standard for swing trades)
  const atrStop = currentPrice - atr * 2.0;

  if (!stopLoss || stopLoss <= 0) {
    stopLoss = atrStop;
  } else {
    // Guard rails: not tighter than 0.75 ATR, not wider than 3.5 ATR
    const minDistStop = currentPrice - atr * 0.75; // tightest allowed
    const maxDistStop = currentPrice - atr * 3.5;  // widest allowed
    stopLoss = Math.min(stopLoss, minDistStop);     // loosen if too tight
    stopLoss = Math.max(stopLoss, maxDistStop);     // tighten if too wide
  }

  // Absolute floor: stop can't be > 50% away (sanity check)
  return Math.max(stopLoss, currentPrice * 0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESISTANCE-BASED TARGET
// ─────────────────────────────────────────────────────────────────────────────

function calculateResistanceTarget(currentPrice, stopLoss, atr, structure, signals) {
  const riskPerShare = currentPrice - stopLoss;

  // Try structural resistance first
  if (structure.nearestResistance) {
    const candidate = structure.nearestResistance * 0.99; // slightly below resistance
    const potentialRR = riskPerShare > 0 ? (candidate - currentPrice) / riskPerShare : 0;
    if (potentialRR >= 1.5 && potentialRR <= 6.0) return candidate;
  }

  // ATR multiplier fallback
  let mult = 2.5;
  if (signals.breakingOut && signals.strongTrend) mult = 3.0;
  else if (signals.rsiOversold && signals.nearLowerBB) mult = 2.0;
  else if (signals.bbSqueezing) mult = 3.0;

  return currentPrice + riskPerShare * mult;
}

// ─────────────────────────────────────────────────────────────────────────────
// HUMAN-READABLE TECHNICAL REASONING
// ─────────────────────────────────────────────────────────────────────────────

export function generateTechnicalReasoning(analysis) {
  const { indicators, signals, patterns } = analysis;
  const reasons = [];

  // Trend
  if (signals.trendAligned)    reasons.push('Price above EMA 20 & 50 — uptrend confirmed');
  else if (signals.aboveEma20) reasons.push('Price above EMA 20 — short-term bullish');
  else                         reasons.push('Price below key EMAs — weak trend');

  // Structure
  if (signals.inUptrend)         reasons.push('Market structure: Higher Highs + Higher Lows');
  else if (signals.higherLows)   reasons.push('Higher Lows forming — buyers absorbing dips');
  else if (signals.inDowntrend)  reasons.push('Market structure: Lower Highs + Lower Lows — caution');

  // ADX trend strength
  if (signals.strongTrend) reasons.push(`ADX ${indicators.adx} — strong trend in place`);
  else if (signals.weakTrend) reasons.push(`ADX ${indicators.adx} — weak/no trend, range-bound`);

  // RSI
  if (signals.rsiOversold)      reasons.push(`RSI ${indicators.rsi} — oversold bounce potential`);
  else if (signals.rsiNeutralBullish) reasons.push(`RSI ${indicators.rsi} — healthy momentum zone`);
  else if (signals.rsiOverbought)     reasons.push(`RSI ${indicators.rsi} — overbought, await pullback`);

  // MACD
  if (signals.macdBullishCross) reasons.push('MACD bullish crossover — fresh momentum signal');
  else if (signals.macdBullish) reasons.push('MACD above signal line — positive momentum');

  // Bollinger Bands
  if (signals.bbSqueezing)  reasons.push('Bollinger Band squeeze — potential breakout imminent');
  if (signals.nearLowerBB)  reasons.push('Near lower Bollinger Band — mean reversion potential');

  // OBV
  if (signals.bullishDivergence) reasons.push('OBV bullish divergence — smart money accumulating');
  else if (signals.obvRising)    reasons.push('OBV trending up — volume confirms price strength');

  // Candlestick patterns
  if (signals.threeWhiteSoldiers) reasons.push('Three White Soldiers — strong institutional buying');
  else if (signals.morningStar)   reasons.push('Morning Star pattern — bullish reversal signal');
  else if (signals.bullishEngulfing) reasons.push('Bullish Engulfing — buyers took control');
  else if (signals.hammer)        reasons.push('Hammer candle — rejection of lower prices');
  else if (signals.dragonflyDoji) reasons.push('Dragonfly Doji — buyers defended the lows');
  else if (signals.bullishHarami) reasons.push('Bullish Harami — momentum shift beginning');

  // Volume
  if (signals.volumeSpike)       reasons.push(`Volume spike (${indicators.volumeRatio}x avg) — strong institutional participation`);
  else if (signals.volumeAboveAvg) reasons.push(`Volume above average (${indicators.volumeRatio}x) — solid participation`);
  else if (signals.volumeDrying)   reasons.push('Volume drying up — watch for breakout direction');

  // Price action
  if (signals.breakingOut)   reasons.push('Breaking out of consolidation with volume');
  else if (signals.consolidating) reasons.push('Consolidating — potential breakout setup forming');

  return reasons.join('. ') + '.';
}
