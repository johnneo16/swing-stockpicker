import yahooFinance from 'yahoo-finance2';

/**
 * Fundamental Analysis Engine
 * Fetches and scores real fundamental data from Yahoo Finance quoteSummary.
 */

/**
 * Fetch fundamental data for an NSE stock
 */
export async function fetchFundamentals(symbol) {
  const yahooSymbol = `${symbol}.NS`;

  try {
    const result = await yahooFinance.quoteSummary(yahooSymbol, {
      modules: ['defaultKeyStatistics', 'financialData', 'summaryDetail', 'earningsTrend'],
    });

    const stats = result.defaultKeyStatistics || {};
    const financial = result.financialData || {};
    const summary = result.summaryDetail || {};

    return {
      // Valuation
      peRatio: summary.trailingPE || stats.trailingPE || null,
      forwardPE: stats.forwardPE || summary.forwardPE || null,
      pbRatio: stats.priceToBook || null,
      pegRatio: stats.pegRatio || null,

      // Profitability
      roe: financial.returnOnEquity ? Math.round(financial.returnOnEquity * 10000) / 100 : null,
      roa: financial.returnOnAssets ? Math.round(financial.returnOnAssets * 10000) / 100 : null,
      profitMargin: financial.profitMargins ? Math.round(financial.profitMargins * 10000) / 100 : null,
      operatingMargin: financial.operatingMargins ? Math.round(financial.operatingMargins * 10000) / 100 : null,

      // Growth
      revenueGrowth: financial.revenueGrowth ? Math.round(financial.revenueGrowth * 10000) / 100 : null,
      earningsGrowth: financial.earningsGrowth ? Math.round(financial.earningsGrowth * 10000) / 100 : null,

      // Safety
      debtToEquity: financial.debtToEquity ? Math.round(financial.debtToEquity * 100) / 100 : null,
      currentRatio: financial.currentRatio ? Math.round(financial.currentRatio * 100) / 100 : null,

      // Price context
      marketCap: summary.marketCap || null,
      fiftyTwoWeekHigh: summary.fiftyTwoWeekHigh || null,
      fiftyTwoWeekLow: summary.fiftyTwoWeekLow || null,
      dividendYield: summary.dividendYield ? Math.round(summary.dividendYield * 10000) / 100 : null,

      // Analyst targets
      targetMeanPrice: financial.targetMeanPrice || null,
      recommendationKey: financial.recommendationKey || null,
      numberOfAnalysts: financial.numberOfAnalystOpinions || null,
    };
  } catch (error) {
    console.error(`Failed to fetch fundamentals for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Score fundamentals on a 0-10 scale
 */
export function scoreFundamentals(fundamentals) {
  if (!fundamentals) return { score: 5, rating: 'N/A', details: 'Fundamental data unavailable' };

  let score = 0;
  let maxScore = 0;
  const insights = [];

  // === VALUATION (max 3 points) ===
  if (fundamentals.peRatio !== null) {
    maxScore += 3;
    if (fundamentals.peRatio > 0 && fundamentals.peRatio <= 15) {
      score += 3;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — attractively valued`);
    } else if (fundamentals.peRatio > 15 && fundamentals.peRatio <= 30) {
      score += 2;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — fairly valued`);
    } else if (fundamentals.peRatio > 30 && fundamentals.peRatio <= 50) {
      score += 1;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — premium valuation`);
    } else if (fundamentals.peRatio > 50) {
      score += 0;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — expensive`);
    } else {
      score += 0;
      insights.push('Negative PE — company not profitable');
    }
  }

  // === PROFITABILITY (max 2.5 points) ===
  if (fundamentals.roe !== null) {
    maxScore += 2.5;
    if (fundamentals.roe >= 20) { score += 2.5; insights.push(`ROE ${fundamentals.roe}% — excellent`); }
    else if (fundamentals.roe >= 15) { score += 2; insights.push(`ROE ${fundamentals.roe}% — strong`); }
    else if (fundamentals.roe >= 10) { score += 1; insights.push(`ROE ${fundamentals.roe}% — moderate`); }
    else { score += 0; insights.push(`ROE ${fundamentals.roe}% — weak`); }
  }

  // === GROWTH (max 2 points) ===
  if (fundamentals.revenueGrowth !== null) {
    maxScore += 2;
    if (fundamentals.revenueGrowth >= 20) { score += 2; insights.push(`Revenue growth ${fundamentals.revenueGrowth}% — high growth`); }
    else if (fundamentals.revenueGrowth >= 10) { score += 1.5; insights.push(`Revenue growth ${fundamentals.revenueGrowth}% — solid`); }
    else if (fundamentals.revenueGrowth >= 0) { score += 0.5; insights.push(`Revenue growth ${fundamentals.revenueGrowth}% — slow`); }
    else { score += 0; insights.push(`Revenue declining ${fundamentals.revenueGrowth}%`); }
  }

  // === SAFETY (max 1.5 points) ===
  if (fundamentals.debtToEquity !== null) {
    maxScore += 1.5;
    if (fundamentals.debtToEquity < 0.5) { score += 1.5; insights.push(`D/E ${fundamentals.debtToEquity} — low leverage`); }
    else if (fundamentals.debtToEquity < 1.0) { score += 1; insights.push(`D/E ${fundamentals.debtToEquity} — moderate leverage`); }
    else if (fundamentals.debtToEquity < 2.0) { score += 0.5; insights.push(`D/E ${fundamentals.debtToEquity} — high leverage`); }
    else { score += 0; insights.push(`D/E ${fundamentals.debtToEquity} — heavily leveraged ⚠️`); }
  }

  // === 52-WEEK POSITION (max 1 point) ===
  if (fundamentals.fiftyTwoWeekHigh && fundamentals.fiftyTwoWeekLow) {
    maxScore += 1;
    // No current price here, but we can note the range
    const range = fundamentals.fiftyTwoWeekHigh - fundamentals.fiftyTwoWeekLow;
    if (range > 0) {
      insights.push(`52W range: ₹${fundamentals.fiftyTwoWeekLow.toFixed(0)}–₹${fundamentals.fiftyTwoWeekHigh.toFixed(0)}`);
      score += 0.5; // neutral baseline
    }
  }

  // Normalize to 0–10
  const normalizedScore = maxScore > 0 ? Math.round((score / maxScore) * 10 * 10) / 10 : 5;

  let rating = 'Average';
  if (normalizedScore >= 8) rating = 'Excellent';
  else if (normalizedScore >= 6) rating = 'Good';
  else if (normalizedScore >= 4) rating = 'Average';
  else rating = 'Weak';

  return {
    score: normalizedScore,
    rating,
    details: insights.join('. ') + '.',
  };
}

/**
 * Format market cap for display
 */
export function formatMarketCap(cap) {
  if (!cap) return 'N/A';
  if (cap >= 1e12) return `₹${(cap / 1e12).toFixed(1)}T`;
  if (cap >= 1e10) return `₹${(cap / 1e10).toFixed(0)}B`;
  if (cap >= 1e7) return `₹${(cap / 1e7).toFixed(0)}Cr`;
  return `₹${cap.toLocaleString('en-IN')}`;
}

/**
 * Generate fundamental strength summary for a trade card
 */
export function generateFundamentalSummary(fundamentals, scoreResult) {
  if (!fundamentals) return 'Fundamental data unavailable for this stock.';

  const parts = [];

  if (fundamentals.peRatio) parts.push(`PE: ${fundamentals.peRatio.toFixed(1)}`);
  if (fundamentals.roe) parts.push(`ROE: ${fundamentals.roe}%`);
  if (fundamentals.debtToEquity !== null) parts.push(`D/E: ${fundamentals.debtToEquity}`);
  if (fundamentals.revenueGrowth !== null) parts.push(`Rev Growth: ${fundamentals.revenueGrowth}%`);
  if (fundamentals.profitMargin !== null) parts.push(`Margin: ${fundamentals.profitMargin}%`);

  const metricsLine = parts.join(' | ');
  const ratingLine = `Fundamental rating: ${scoreResult.rating} (${scoreResult.score}/10)`;

  return `${metricsLine}. ${ratingLine}. ${scoreResult.details}`;
}
