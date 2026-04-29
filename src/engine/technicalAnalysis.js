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

  const avgVolume20  = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio   = avgVolume20 > 0 ? currentVolume / avgVolume20 : 1;

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
  const support        = Math.max(support1, support2);
  const resistance     = resistance1;

  const weeklySlope = ema20.length > 5
    ? (ema20[ema20.length - 1] - ema20[ema20.length - 5]) / ema20[ema20.length - 5] * 100
    : 0;

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

    // ── Candlestick patterns (new)
    hammer:            patterns.hammer,
    bullishEngulfing:  patterns.bullishEngulfing,
    morningStar:       patterns.morningStar,
    dragonflyDoji:     patterns.dragonflyDoji,
    threeWhiteSoldiers: patterns.threeWhiteSoldiers,
    bullishHarami:     patterns.bullishHarami,
    anyBullishPattern: patterns.anyBullish,

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
    },
    levels: {
      support:          Math.round(Math.min(support, simpleSupport)     * 100) / 100,
      resistance:       Math.round(Math.max(resistance, simpleResistance) * 100) / 100,
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
                 p.dragonflyDoji || p.threeWhiteSoldiers || p.bullishHarami;

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
