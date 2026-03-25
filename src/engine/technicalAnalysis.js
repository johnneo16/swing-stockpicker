import { RSI, MACD, EMA, SMA, BollingerBands, ATR, ADX } from 'technicalindicators';

/**
 * Run full technical analysis on OHLCV data.
 * Returns indicators + signals for the scoring engine.
 * 
 * Precision improvements (Phase 2):
 * - Bollinger Bands for overbought/oversold context
 * - ADX for trend strength filtering
 * - Pivot point-based support/resistance
 * - Multi-period trend confirmation
 */
export function analyzeTechnicals(quotes) {
  if (!quotes || quotes.length < 50) {
    return null;
  }

  const closes = quotes.map(q => q.close);
  const highs = quotes.map(q => q.high);
  const lows = quotes.map(q => q.low);
  const volumes = quotes.map(q => q.volume);
  const currentPrice = closes[closes.length - 1];

  // === CORE INDICATORS ===

  // RSI (14)
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

  // MACD (12, 26, 9)
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const macd = macdValues.length > 0 ? macdValues[macdValues.length - 1] : { MACD: 0, signal: 0, histogram: 0 };
  const prevMacd = macdValues.length > 1 ? macdValues[macdValues.length - 2] : macd;

  // EMAs
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const ema200 = closes.length >= 200 ? EMA.calculate({ values: closes, period: 200 }) : [];

  const currentEma20 = ema20.length > 0 ? ema20[ema20.length - 1] : currentPrice;
  const currentEma50 = ema50.length > 0 ? ema50[ema50.length - 1] : currentPrice;
  const currentEma200 = ema200.length > 0 ? ema200[ema200.length - 1] : currentPrice;

  // Previous EMAs for slope detection
  const prevEma20 = ema20.length > 1 ? ema20[ema20.length - 2] : currentEma20;
  const prevEma50 = ema50.length > 1 ? ema50[ema50.length - 2] : currentEma50;

  // ATR (14) — for stop loss calculation
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : (currentPrice * 0.02);

  // Volume analysis
  const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = currentVolume / avgVolume20;

  // === PHASE 2: PRECISION INDICATORS ===

  // Bollinger Bands (20, 2)
  const bbValues = BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 });
  const bb = bbValues.length > 0 ? bbValues[bbValues.length - 1] : null;
  const bbWidth = bb ? (bb.upper - bb.lower) / bb.middle : 0;

  // ADX (14) — Trend strength
  let adxValue = 25; // default
  try {
    const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
    if (adxValues.length > 0) {
      adxValue = adxValues[adxValues.length - 1].adx;
    }
  } catch (e) {
    // ADX might fail with insufficient data
  }

  // === SUPPORT & RESISTANCE (Pivot Point method) ===
  const recent = quotes.slice(-20);
  const pivotHigh = Math.max(...recent.map(q => q.high));
  const pivotLow = Math.min(...recent.map(q => q.low));
  const pivotClose = recent[recent.length - 1].close;
  const pivotPoint = (pivotHigh + pivotLow + pivotClose) / 3;
  const support1 = (2 * pivotPoint) - pivotHigh;
  const resistance1 = (2 * pivotPoint) - pivotLow;
  const support2 = pivotPoint - (pivotHigh - pivotLow);

  // Also keep simple S/R for reference
  const simpleSupport = Math.min(...recent.map(q => q.low));
  const simpleResistance = Math.max(...recent.map(q => q.high));

  // Best support for stop loss
  const support = Math.max(support1, support2); // Use the higher (tighter) support
  const resistance = resistance1;

  // Swing lows for better stop loss
  const swingLows = findSwingLows(quotes.slice(-30));
  const nearestSwingLow = swingLows.length > 0
    ? swingLows.reduce((closest, sl) => Math.abs(sl - currentPrice) < Math.abs(closest - currentPrice) ? sl : closest)
    : support;

  // === MULTI-PERIOD TREND ===
  // Weekly trend approximation (5-day EMA slope)
  const weeklySlope = ema20.length > 5
    ? (ema20[ema20.length - 1] - ema20[ema20.length - 5]) / ema20[ema20.length - 5] * 100
    : 0;

  // === SIGNALS ===
  const signals = {
    // Trend
    aboveEma20: currentPrice > currentEma20,
    aboveEma50: currentPrice > currentEma50,
    aboveEma200: currentPrice > currentEma200,
    ema20AboveEma50: currentEma20 > currentEma50,
    trendAligned: currentPrice > currentEma20 && currentEma20 > currentEma50,
    ema20Rising: currentEma20 > prevEma20,
    ema50Rising: currentEma50 > prevEma50,
    weeklyUptrend: weeklySlope > 0.5,

    // Trend strength (ADX)
    strongTrend: adxValue > 25,
    weakTrend: adxValue < 20,
    trendStrengthening: adxValue > 20,

    // Momentum
    rsiOversold: rsi < 35,
    rsiOverbought: rsi > 70,
    rsiNeutralBullish: rsi > 40 && rsi < 65,
    macdBullishCross: macd.MACD > macd.signal && prevMacd.MACD <= prevMacd.signal,
    macdBullish: macd.histogram > 0,
    macdHistogramRising: macd.histogram > (prevMacd.histogram || 0),

    // Bollinger Bands
    nearLowerBB: bb ? currentPrice < bb.lower * 1.01 : false,
    nearUpperBB: bb ? currentPrice > bb.upper * 0.99 : false,
    bbSqueezing: bbWidth < 0.04, // Tight squeeze = potential breakout
    insideBB: bb ? (currentPrice > bb.lower && currentPrice < bb.upper) : true,

    // Volume
    volumeAboveAvg: volumeRatio > 1.2,
    volumeSpike: volumeRatio > 2.0,
    volumeDrying: volumeRatio < 0.6,

    // Price action
    nearSupport: (currentPrice - simpleSupport) / currentPrice < 0.03,
    nearResistance: (simpleResistance - currentPrice) / currentPrice < 0.02,
    consolidating: (simpleResistance - simpleSupport) / currentPrice < 0.05,
    breakingOut: currentPrice > simpleResistance * 0.98 && volumeRatio > 1.3,
  };

  // === TRADE SETUP GENERATION ===
  const stopLoss = calculateStopLoss(currentPrice, atr, nearestSwingLow, support);
  const riskPerShare = currentPrice - stopLoss;

  // Dynamic target based on setup quality
  let targetMultiplier = 2.5;
  if (signals.breakingOut && signals.strongTrend) targetMultiplier = 3.0;
  if (signals.rsiOversold && signals.nearLowerBB) targetMultiplier = 2.0;
  if (signals.bbSqueezing) targetMultiplier = 3.0; // Squeezes lead to big moves

  const target = currentPrice + (riskPerShare * targetMultiplier);
  const riskRewardRatio = riskPerShare > 0 ? (target - currentPrice) / riskPerShare : 0;

  return {
    indicators: {
      rsi: Math.round(rsi * 100) / 100,
      macd: {
        value: Math.round((macd.MACD || 0) * 100) / 100,
        signal: Math.round((macd.signal || 0) * 100) / 100,
        histogram: Math.round((macd.histogram || 0) * 100) / 100,
      },
      ema20: Math.round(currentEma20 * 100) / 100,
      ema50: Math.round(currentEma50 * 100) / 100,
      ema200: Math.round(currentEma200 * 100) / 100,
      atr: Math.round(atr * 100) / 100,
      adx: Math.round(adxValue * 100) / 100,
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      avgVolume20: Math.round(avgVolume20),
      bollingerBands: bb ? {
        upper: Math.round(bb.upper * 100) / 100,
        middle: Math.round(bb.middle * 100) / 100,
        lower: Math.round(bb.lower * 100) / 100,
        width: Math.round(bbWidth * 10000) / 100,
      } : null,
      weeklySlope: Math.round(weeklySlope * 100) / 100,
    },
    levels: {
      support: Math.round(Math.min(support, simpleSupport) * 100) / 100,
      resistance: Math.round(Math.max(resistance, simpleResistance) * 100) / 100,
      pivotPoint: Math.round(pivotPoint * 100) / 100,
      stopLoss: Math.round(stopLoss * 100) / 100,
      target: Math.round(target * 100) / 100,
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
    },
    signals,
  };
}

function calculateStopLoss(price, atr, swingLow, support) {
  // Use the highest of: 1.5x ATR below price, swing low - buffer, support - buffer
  const atrStop = price - (atr * 1.5);
  const swingStop = swingLow - (price * 0.005);
  const supportStop = support - (price * 0.005);

  // Choose the tightest stop that still gives room
  return Math.max(atrStop, Math.min(swingStop, supportStop));
}

function findSwingLows(quotes) {
  const lows = [];
  for (let i = 2; i < quotes.length - 2; i++) {
    if (
      quotes[i].low < quotes[i - 1].low &&
      quotes[i].low < quotes[i - 2].low &&
      quotes[i].low < quotes[i + 1].low &&
      quotes[i].low < quotes[i + 2].low
    ) {
      lows.push(quotes[i].low);
    }
  }
  return lows;
}

/**
 * Generate a human-readable technical reasoning string
 */
export function generateTechnicalReasoning(analysis) {
  const { indicators, signals } = analysis;
  const reasons = [];

  // Trend
  if (signals.trendAligned) reasons.push('Price above EMA 20 & 50 — uptrend confirmed');
  else if (signals.aboveEma20) reasons.push('Price above EMA 20 — short-term bullish');
  else reasons.push('Price below key EMAs — weak trend');

  // ADX trend strength
  if (signals.strongTrend) reasons.push(`ADX ${indicators.adx} — strong trend in place`);
  else if (signals.weakTrend) reasons.push(`ADX ${indicators.adx} — weak/no trend, range-bound`);

  // RSI
  if (signals.rsiOversold) reasons.push(`RSI ${indicators.rsi} — oversold bounce potential`);
  else if (signals.rsiNeutralBullish) reasons.push(`RSI ${indicators.rsi} — healthy momentum zone`);
  else if (signals.rsiOverbought) reasons.push(`RSI ${indicators.rsi} — overbought, wait for pullback`);

  // MACD
  if (signals.macdBullishCross) reasons.push('MACD bullish crossover — fresh momentum');
  else if (signals.macdBullish) reasons.push('MACD above signal — positive momentum');

  // Bollinger Bands
  if (signals.bbSqueezing) reasons.push('Bollinger Band squeeze — potential breakout imminent');
  if (signals.nearLowerBB) reasons.push('Near lower Bollinger Band — potential mean reversion');

  // Volume
  if (signals.volumeSpike) reasons.push(`Volume spike (${indicators.volumeRatio}x avg) — strong participation`);
  else if (signals.volumeAboveAvg) reasons.push(`Volume above average (${indicators.volumeRatio}x) — good participation`);
  else if (signals.volumeDrying) reasons.push('Volume drying up — watch for breakout direction');

  // Price action
  if (signals.breakingOut) reasons.push('Breaking out of consolidation with volume');
  else if (signals.consolidating) reasons.push('Consolidating — potential breakout setup');

  return reasons.join('. ') + '.';
}
