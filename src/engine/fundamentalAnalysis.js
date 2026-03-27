import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Fundamental Analysis Engine
 * Fetches and scores real fundamental data from Screener.in via web scraping.
 * This bypasses Yahoo Finance rate limits (HTTP 429) for NSE stocks.
 */

// Helper to safely parse localized numbers like "18,25,022" 
function parseScreenerNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Fetch fundamental data for an NSE stock from Screener.in
 */
export async function fetchFundamentals(symbol) {
  try {
    // Some symbols might need mapping if Screener uses a different name, 
    // but for top 500 NIFTY stocks they largely perfectly match the NSE symbol.
    const cleanSymbol = symbol.replace('.NS', '').replace('.BO', '');
    
    const { data } = await axios.get(`https://www.screener.in/company/${cleanSymbol}/consolidated/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 8000
    }).catch(async (err) => {
      // If consolidated fails (404), fallback to standalone page
      if (err.response && err.response.status === 404) {
        return axios.get(`https://www.screener.in/company/${cleanSymbol}/`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000
        });
      }
      throw err;
    });

    const $ = cheerio.load(data);
    const ratios = {};

    // Parse the top ratios ul
    $('#top-ratios li').each((i, el) => {
      const name = $(el).find('.name').text().trim().toLowerCase();
      const value = $(el).find('.number').text().trim();
      ratios[name] = parseScreenerNumber(value);
    });

    // Parse values
    const peRatio = ratios['stock p/e'] || null;
    const roe = ratios['roe'] || null;
    const roce = ratios['roce'] || null;
    const dividendYield = ratios['dividend yield'] || null;
    const bookValue = ratios['book value'] || null;
    
    // Market Cap comes in Crores on Screener. (e.g., 18,25,022 means 18 lakh crores)
    // Yahoo format was raw value. Let's send raw value so TradeCard formatter works.
    const marketCapCr = ratios['market cap'] || 0;
    const marketCapRaw = marketCapCr * 10000000; // Cr -> raw

    // 52W Range "1,612 / 1,115"
    let fiftyTwoWeekHigh = null;
    let fiftyTwoWeekLow = null;
    $('#top-ratios li').each((i, el) => {
      const name = $(el).find('.name').text().trim().toLowerCase();
      if (name.includes('high / low')) {
         const valStr = $(el).find('.value').text().trim().replace(/,/g, '');
         const parts = valStr.split('/');
         if (parts.length === 2) {
            fiftyTwoWeekHigh = parseFloat(parts[0].trim());
            fiftyTwoWeekLow = parseFloat(parts[1].trim());
         }
      }
    });

    return {
      peRatio,
      roe,
      roce, // screener specific bonus metric
      dividendYield,
      bookValue,
      marketCap: marketCapRaw,
      fiftyTwoWeekHigh,
      fiftyTwoWeekLow,
      
      // These elements aren't reliably on the top bar without logging in, 
      // but we return them as null so the UI degrades gracefully.
      debtToEquity: ratios['debt to equity'] || null,
      revenueGrowth: null,
      profitMargin: null,
      targetMeanPrice: null,
      recommendationKey: null,
      numberOfAnalysts: null,
    };
  } catch (error) {
    console.error(`Failed to fetch fundamentals for ${symbol} via Screener.in:`, error.message);
    return null;
  }
}

/**
 * Score fundamentals on a 0-10 scale
 */
export function scoreFundamentals(fundamentals) {
  if (!fundamentals || (!fundamentals.peRatio && !fundamentals.roe)) {
    return { score: 5, rating: 'N/A', details: 'Core fundamental data unavailable.' };
  }

  let score = 0;
  let maxScore = 0;
  const insights = [];

  // === VALUATION (max 3 points) ===
  if (fundamentals.peRatio !== null) {
    maxScore += 3;
    if (fundamentals.peRatio > 0 && fundamentals.peRatio <= 20) {
      score += 3;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — attractively valued`);
    } else if (fundamentals.peRatio > 20 && fundamentals.peRatio <= 35) {
      score += 2;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — fairly valued`);
    } else if (fundamentals.peRatio > 35 && fundamentals.peRatio <= 60) {
      score += 1;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — premium valuation`);
    } else if (fundamentals.peRatio > 60) {
      score += 0;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — expensive`);
    } else {
      score += 0;
      insights.push('Negative PE — company not profitable');
    }
  }

  // === PROFITABILITY (max 3 points) ===
  // Increased weight since we rely heavily on tracking ROE and now ROCE
  if (fundamentals.roe !== null) {
    maxScore += 3;
    if (fundamentals.roe >= 20) { score += 3; insights.push(`ROE ${fundamentals.roe.toFixed(1)}% — excellent`); }
    else if (fundamentals.roe >= 15) { score += 2; insights.push(`ROE ${fundamentals.roe.toFixed(1)}% — strong`); }
    else if (fundamentals.roe >= 10) { score += 1; insights.push(`ROE ${fundamentals.roe.toFixed(1)}% — moderate`); }
    else { score += 0; insights.push(`ROE ${fundamentals.roe.toFixed(1)}% — weak`); }
  }

  // === CAPITAL EFFICIENCY (max 2 points) ===
  if (fundamentals.roce !== null) {
    maxScore += 2;
    if (fundamentals.roce >= 20) { score += 2; insights.push(`ROCE ${fundamentals.roce.toFixed(1)}% — highly efficient`); }
    else if (fundamentals.roce >= 12) { score += 1; insights.push(`ROCE ${fundamentals.roce.toFixed(1)}% — efficient`); }
    else { score += 0; }
  }

  // === 52-WEEK POSITION (max 2 point) ===
  if (fundamentals.fiftyTwoWeekHigh && fundamentals.fiftyTwoWeekLow) {
    maxScore += 2;
    const range = fundamentals.fiftyTwoWeekHigh - fundamentals.fiftyTwoWeekLow;
    if (range > 0) {
      insights.push(`52W range: ₹${fundamentals.fiftyTwoWeekLow.toFixed(0)}–₹${fundamentals.fiftyTwoWeekHigh.toFixed(0)}`);
      score += 1; // neutral baseline
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
  if (!fundamentals || (!fundamentals.peRatio && !fundamentals.roe)) {
    return 'Relying strictly on Volume and Price Action algorithms as primary execution drivers, as fundamental PE/ROE metrics are unavailable.';
  }

  const parts = [];

  if (fundamentals.peRatio) parts.push(`PE: ${fundamentals.peRatio.toFixed(1)}`);
  if (fundamentals.roe) parts.push(`ROE: ${fundamentals.roe}%`);
  if (fundamentals.roce) parts.push(`ROCE: ${fundamentals.roce}%`);
  if (fundamentals.dividendYield) parts.push(`Div Yld: ${fundamentals.dividendYield}%`);

  const metricsLine = parts.join(' | ');
  const ratingLine = `Fundamental rating: ${scoreResult.rating} (${scoreResult.score}/10)`;

  return `${metricsLine}. ${ratingLine}. ${scoreResult.details}`;
}
