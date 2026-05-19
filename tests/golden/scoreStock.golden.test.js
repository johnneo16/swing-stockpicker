/**
 * Golden-fixture test for scoreStock.
 *
 * Generates deterministic synthetic OHLCV series (no randomness, no clock,
 * no I/O), feeds them through the full scoring pipeline, and snapshots the
 * stable fields of the output: confidenceScore, setupType, scoreBreakdown,
 * checklist, and key levels.
 *
 * Any change to WEIGHTS, gate thresholds, indicator math, or setup-type
 * routing surfaces here as a snapshot diff with a meaningful explanation.
 *
 * What this catches:
 *   - Accidental WEIGHTS tweak (e.g. v3 18/12 rebalance regression)
 *   - Score-floor 65 → 50 drift
 *   - Setup-type routing changes
 *   - Drift in any of the 10 factor scores from indicator-math changes
 *
 * What this does NOT catch (covered elsewhere):
 *   - Real-data noise behavior — use a real-data fixture for that (M2.5)
 *   - Ranking + gate ordering — see scoringEngine.gates.test.js
 *   - Position-sizing math — see riskEngine.test.js
 *   - Exit logic — see exitEngine.test.js
 */
import { describe, it, expect } from 'vitest';
import { scoreStock } from '../../src/engine/scoringEngine.js';

/**
 * Deterministic OHLCV generator.
 *
 * Produces N bars of a price series that follows a given trend function.
 * Volume is a deterministic function of the bar index (no Math.random).
 *
 * @param {number} count   number of bars
 * @param {(i:number) => number} closeAt  close price as a function of bar index
 * @param {object} opts
 *   - basePrice: anchor price (default 100)
 *   - dailyRange: high-low spread as fraction of close (default 0.015)
 *   - volBase: base volume (default 100000)
 *   - volWave: amplitude of sinusoidal volume variation (default 0.2)
 */
function generateSeries(count, closeAt, opts = {}) {
  const { dailyRange = 0.015, volBase = 100000, volWave = 0.2 } = opts;
  const bars = [];
  const baseDate = new Date('2024-01-01T00:00:00Z').getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const close = closeAt(i);
    const prevClose = i === 0 ? close : closeAt(i - 1);
    const open = prevClose;
    const range = close * dailyRange;
    const high = Math.max(open, close) + range / 2;
    const low  = Math.min(open, close) - range / 2;
    // Sinusoidal volume — fully deterministic given i
    const volume = Math.round(volBase * (1 + volWave * Math.sin(i / 7)));
    bars.push({
      date: new Date(baseDate + i * DAY_MS),
      open, high, low, close, volume,
    });
  }
  return bars;
}

describe('scoreStock — golden fixture', () => {
  it('produces a stable scored trade for a clean uptrend series', () => {
    // 200 bars of a 100 → 150 smooth uptrend (50% gain over 200 days).
    // Linear ramp keeps the math reproducible and the EMA stack bullish.
    const quotes = generateSeries(200, i => 100 + (i / 200) * 50);

    const stockData = {
      symbol:        'GOLDEN',
      name:          'Golden Industries Ltd',
      sector:        'IT',
      currentPrice:  quotes[quotes.length - 1].close,
      previousClose: quotes[quotes.length - 2].close,
      dayChange:     0.5,
      quotes,
      fundamentals: {
        peRatio: 18, roe: 22, debtToEquity: 0.4,
        revenueGrowth: 12, profitMargin: 14,
      },
    };

    const result = scoreStock(stockData, { niftyTrend: 'bullish', marketMood: 'Bullish' }, 50000);
    expect(result).not.toBeNull();

    // Snapshot the fields that gate drift detection. Excluded:
    //   - chartData (large, exposes timestamps)
    //   - indicators (exact float values from upstream `technicalindicators`)
    //   - signals (booleans, captured indirectly through scoreBreakdown)
    //   - generated text (whyThisWorks / whyThisCanFail are reasoning strings)
    expect({
      confidenceScore: result.confidenceScore,
      setupType:       result.setupType,
      riskLevel:       result.riskLevel,
      scoreBreakdown:  result.scoreBreakdown,
      checklist:       result.checklist,
      quantity:        result.quantity,
      capitalRequired: result.capitalRequired,
      // R:R and levels — round-tripped through the engine
      riskRewardRatio: result.riskRewardRatio,
      estimatedDays:   result.estimatedDays,
    }).toMatchSnapshot();
  });

  it('refuses to score a series with <50 bars (analyzeTechnicals null guard)', () => {
    const quotes = generateSeries(30, i => 100 + i * 0.5);
    const stockData = {
      symbol: 'TINY', name: 'Tiny Co', sector: 'IT',
      currentPrice: quotes[29].close, previousClose: quotes[28].close, dayChange: 0,
      quotes, fundamentals: null,
    };
    expect(scoreStock(stockData)).toBeNull();
  });

  it('produces a different score for a downtrending series than for an uptrending one', () => {
    const up   = generateSeries(200, i => 100 + (i / 200) * 50);
    const down = generateSeries(200, i => 150 - (i / 200) * 50);

    const base = {
      symbol: 'X', name: 'X Co', sector: 'IT',
      dayChange: 0, fundamentals: { peRatio: 18, roe: 22, debtToEquity: 0.4 },
    };
    const upResult = scoreStock(
      { ...base, quotes: up,   currentPrice: up[199].close,   previousClose: up[198].close },
      { niftyTrend: 'bullish', marketMood: 'Bullish' }, 50000,
    );
    const downResult = scoreStock(
      { ...base, quotes: down, currentPrice: down[199].close, previousClose: down[198].close },
      { niftyTrend: 'bullish', marketMood: 'Bullish' }, 50000,
    );

    // The uptrend MUST score strictly higher than the downtrend.
    // If a refactor inverts this, scoring is fundamentally broken.
    if (upResult && downResult) {
      expect(upResult.confidenceScore).toBeGreaterThan(downResult.confidenceScore);
    } else {
      // If downResult is null (position sizing rejected it due to no stop, etc),
      // the directional check is still satisfied — uptrend was scoreable, downtrend wasn't.
      expect(upResult).not.toBeNull();
    }
  });
});
