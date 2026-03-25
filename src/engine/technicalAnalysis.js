import { RSI, MACD, EMA, SMA, BollingerBands, ATR } from 'technicalindicators';

/**
 * Run full technical analysis on OHLCV data.
 * Returns indicators + signals for the scoring engine.
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

  // === INDICATORS ===

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

  // ATR (14) — for stop loss calculation
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const atr = atrValues.length > 0 ? atrValues[atrValues.length - 1] : (currentPrice * 0.02);

  // Volume analysis
  const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = currentVolume / avgVolume20;

  // === SUPPORT & RESISTANCE ===
  const recent = quotes.slice(-20);
  const recentLows = recent.map(q => q.low);
  const recentHighs = recent.map(q => q.high);
  const support = Math.min(...recentLows);
  const resistance = Math.max(...recentHighs);

  // Swing lows for better stop loss
  const swingLows = findSwingLows(quotes.slice(-30));
  const nearestSwingLow = swingLows.length > 0
    ? swingLows.reduce((closest, sl) => Math.abs(sl - currentPrice) < Math.abs(closest - currentPrice) ? sl : closest)
    : support;

  // === SIGNALS ===
  const signals = {
    // Trend
    aboveEma20: currentPrice > currentEma20,
    aboveEma50: currentPrice > currentEma50,
    aboveEma200: currentPrice > currentEma200,
    ema20AboveEma50: currentEma20 > currentEma50,
    trendAligned: currentPrice > currentEma20 && currentEma20 > currentEma50,

    // Momentum
    rsiOversold: rsi < 35,
    rsiOverbought: rsi > 70,
    rsiNeutralBullish: rsi > 40 && rsi < 65,
    macdBullishCross: macd.MACD > macd.signal && prevMacd.MACD <= prevMacd.signal,
    macdBullish: macd.histogram > 0,
    macdHistogramRising: macd.histogram > (prevMacd.histogram || 0),

    // Volume
    volumeAboveAvg: volumeRatio > 1.2,
    volumeSpike: volumeRatio > 2.0,

    // Price action
    nearSupport: (currentPrice - support) / currentPrice < 0.03,
    nearResistance: (resistance - currentPrice) / currentPrice < 0.02,
    consolidating: (resistance - support) / currentPrice < 0.05,
    breakingOut: currentPrice > resistance * 0.98 && volumeRatio > 1.3,
  };

  // === TRADE SETUP GENERATION ===
  const stopLoss = calculateStopLoss(currentPrice, atr, nearestSwingLow, support);
  const riskPerShare = currentPrice - stopLoss;
  const target = currentPrice + (riskPerShare * 2.5); // Default 1:2.5 R:R
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
      volumeRatio: Math.round(volumeRatio * 100) / 100,
      avgVolume20: Math.round(avgVolume20),
    },
    levels: {
      support: Math.round(support * 100) / 100,
      resistance: Math.round(resistance * 100) / 100,
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
  const swingStop = swingLow - (price * 0.005); // 0.5% buffer below swing low
  const supportStop = support - (price * 0.005);

  // Choose the tightest stop that still gives room (highest value)
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

  if (signals.trendAligned) reasons.push('Price above EMA 20 & 50 — uptrend confirmed');
  else if (signals.aboveEma20) reasons.push('Price above EMA 20 — short-term bullish');
  else reasons.push('Price below key EMAs — weak trend');

  if (signals.rsiOversold) reasons.push(`RSI ${indicators.rsi} — oversold bounce potential`);
  else if (signals.rsiNeutralBullish) reasons.push(`RSI ${indicators.rsi} — healthy momentum zone`);
  else if (signals.rsiOverbought) reasons.push(`RSI ${indicators.rsi} — overbought, wait for pullback`);

  if (signals.macdBullishCross) reasons.push('MACD bullish crossover — fresh momentum');
  else if (signals.macdBullish) reasons.push('MACD above signal — positive momentum');

  if (signals.volumeSpike) reasons.push(`Volume spike (${indicators.volumeRatio}x avg) — strong participation`);
  else if (signals.volumeAboveAvg) reasons.push(`Volume above average (${indicators.volumeRatio}x) — good participation`);

  if (signals.breakingOut) reasons.push('Breaking out of consolidation with volume');
  else if (signals.consolidating) reasons.push('Consolidating — potential breakout setup');

  return reasons.join('. ') + '.';
}
