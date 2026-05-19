import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Fundamental Analysis Engine
 * Fetches and scores real fundamental data from Screener.in via web scraping.
 * This bypasses Yahoo Finance rate limits (HTTP 429) for NSE stocks.
 *
 * Architecture: fetchFundamentals() = fetchFundamentalsHTML + parseFundamentals.
 * The parse step is decoupled so it can be unit-tested against hand-crafted
 * HTML fixtures without live network calls.
 */

const SCREENER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/121.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Helper to safely parse localized numbers like "18,25,022", "₹ 1,612", "12.3%"
function parseScreenerNumber(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[,₹%\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Fetch the raw Screener.in HTML for a symbol. Tries consolidated first
 * (preferred — shows the parent + subsidiaries combined), falls back to
 * standalone on 404.
 */
async function fetchFundamentalsHTML(symbol) {
  const cleanSymbol = symbol.replace('.NS', '').replace('.BO', '');
  const { data } = await axios.get(
    `https://www.screener.in/company/${cleanSymbol}/consolidated/`,
    { headers: SCREENER_HEADERS, timeout: 2500 },
  ).catch(async (err) => {
    if (err.response && err.response.status === 404) {
      return axios.get(`https://www.screener.in/company/${cleanSymbol}/`, {
        headers: SCREENER_HEADERS, timeout: 2500,
      });
    }
    throw err;
  });
  return data;
}

/**
 * Pure parsing function — takes raw Screener.in HTML and returns the
 * fundamentals object. Exported so unit tests can exercise it against
 * fixtures without making network calls.
 *
 * Tier-1 metrics (already in production):
 *   peRatio, roe, roce, debtToEquity, dividendYield, bookValue, marketCap,
 *   fiftyTwoWeekHigh, fiftyTwoWeekLow
 *
 * Tier-3 metrics (M5.1 — Varsity FA module):
 *   cfo5yAvg          — average Cash Flow from Operations over last 5 years (₹ Cr)
 *   operatingMargin   — latest year's Operating Profit / Revenue × 100
 *   salesCagr5y       — 5-year compounded sales growth % (Varsity ch.7)
 *
 * Returns null for any metric not found on the page (some smaller companies
 * don't expose the full financials). Downstream scoring degrades gracefully.
 */
export function parseFundamentals(html) {
  const $ = cheerio.load(html);
  const ratios = {};

  // ── Top ratios bar ───────────────────────────────────────────────────
  $('#top-ratios li').each((i, el) => {
    const name  = $(el).find('.name').text().trim().toLowerCase();
    const value = $(el).find('.number').text().trim();
    ratios[name] = parseScreenerNumber(value);
  });

  const peRatio       = ratios['stock p/e']    ?? null;
  const roe           = ratios['roe']          ?? null;
  const roce          = ratios['roce']         ?? null;
  const dividendYield = ratios['dividend yield'] ?? null;
  const bookValue     = ratios['book value']   ?? null;
  const debtToEquity  = ratios['debt to equity'] ?? null;

  // Market Cap on Screener is in Crores — convert to raw rupees for UI parity
  const marketCapCr  = ratios['market cap'] || 0;
  const marketCapRaw = marketCapCr * 1e7;

  // 52-week range — "1,612 / 1,115"
  let fiftyTwoWeekHigh = null;
  let fiftyTwoWeekLow  = null;
  $('#top-ratios li').each((i, el) => {
    const name = $(el).find('.name').text().trim().toLowerCase();
    if (name.includes('high / low')) {
      const valStr = $(el).find('.value').text().trim().replace(/,/g, '');
      const parts = valStr.split('/');
      if (parts.length === 2) {
        fiftyTwoWeekHigh = parseFloat(parts[0].trim());
        fiftyTwoWeekLow  = parseFloat(parts[1].trim());
      }
    }
  });

  // ── Tier-3 (M5.1): CFO, Operating Margin, Sales CAGR ─────────────────
  const cfo5yAvg        = extractCashFlowFromOps($);
  const operatingMargin = extractLatestOperatingMargin($);
  const salesCagr5y     = extractGrowthCagr($, 'sales');

  return {
    peRatio, roe, roce, dividendYield, bookValue, debtToEquity,
    marketCap:        marketCapRaw,
    fiftyTwoWeekHigh, fiftyTwoWeekLow,

    // Tier-3 — populated when the page has the relevant tables
    cfo5yAvg,
    operatingMargin,
    salesCagr5y,

    // Yahoo-era placeholders retained so the UI degrades gracefully
    revenueGrowth:     null,
    profitMargin:      null,
    targetMeanPrice:   null,
    recommendationKey: null,
    numberOfAnalysts:  null,
  };
}

/**
 * Pull "Cash from Operating Activity" row from the #cash-flow section
 * and average the last 5 yearly columns. Screener renders it as a
 * <table> with a <th class="text"> label and <td> cells per year.
 */
function extractCashFlowFromOps($) {
  const section = $('#cash-flow');
  if (section.length === 0) return null;
  let row = null;
  section.find('table tbody tr').each((i, el) => {
    const label = $(el).find('td.text, th.text').first().text().trim().toLowerCase();
    if (label.includes('cash from operating')) row = $(el);
  });
  if (!row) return null;

  const values = row.find('td').slice(1)        // skip the label cell
    .map((i, el) => parseScreenerNumber($(el).text()))
    .get()
    .filter(v => v != null);
  if (values.length === 0) return null;
  // Use last 5 years (or fewer if not available)
  const recent = values.slice(-5);
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

/**
 * Latest year's Operating Profit / Sales × 100 from #profit-loss.
 * Returns the most-recent annual column's OPM%.
 */
function extractLatestOperatingMargin($) {
  const section = $('#profit-loss');
  if (section.length === 0) return null;

  const findRow = (matcher) => {
    let row = null;
    section.find('table tbody tr').each((i, el) => {
      const label = $(el).find('td.text, th.text').first().text().trim().toLowerCase();
      if (matcher(label)) row = $(el);
    });
    return row;
  };

  // Screener has both "OPM %" and "Operating Profit"; prefer the OPM% row
  const opmRow = findRow(l => l === 'opm %' || l.startsWith('opm'));
  if (opmRow) {
    const cells = opmRow.find('td').slice(1)
      .map((i, el) => parseScreenerNumber($(el).text()))
      .get()
      .filter(v => v != null);
    if (cells.length > 0) return cells[cells.length - 1];
  }

  // Fallback: compute from Operating Profit / Sales
  const opRow    = findRow(l => l.startsWith('operating profit'));
  const salesRow = findRow(l => l === 'sales' || l.startsWith('sales'));
  if (opRow && salesRow) {
    const ops    = opRow.find('td').slice(1).map((i, el) => parseScreenerNumber($(el).text())).get();
    const sales  = salesRow.find('td').slice(1).map((i, el) => parseScreenerNumber($(el).text())).get();
    const i = Math.min(ops.length, sales.length) - 1;
    if (i >= 0 && sales[i] > 0) {
      return Math.round((ops[i] / sales[i]) * 100 * 10) / 10;
    }
  }
  return null;
}

/**
 * Compounded growth percentage over the named horizon, from one of Screener's
 * `Compounded * Growth` tables. Picks the 5-year row by default.
 *
 * Screener renders these as small two-column tables under headings like
 * `Compounded Sales Growth`, `Compounded Profit Growth`, etc. Row labels:
 * `10 Years:`, `5 Years:`, `3 Years:`, `TTM:`.
 */
function extractGrowthCagr($, metric = 'sales', horizon = '5 years') {
  const heading = metric === 'sales'  ? 'Compounded Sales Growth'
               : metric === 'profit' ? 'Compounded Profit Growth'
               : metric === 'stock'  ? 'Stock Price CAGR'
               : null;
  if (!heading) return null;

  let result = null;
  // The section heading is an <h2> followed by a sibling <table>.
  $('h2').each((i, el) => {
    if ($(el).text().trim().toLowerCase() === heading.toLowerCase()) {
      const table = $(el).nextAll('table').first();
      table.find('tr').each((j, tr) => {
        const label = $(tr).find('td').first().text().trim().toLowerCase().replace(/:/g, '').trim();
        if (label === horizon.toLowerCase()) {
          result = parseScreenerNumber($(tr).find('td').eq(1).text());
        }
      });
    }
  });
  return result;
}

/**
 * Fetch fundamental data for an NSE stock from Screener.in.
 * Thin orchestration layer — delegates to fetchFundamentalsHTML +
 * parseFundamentals so the parser is independently testable.
 */
export async function fetchFundamentals(symbol) {
  try {
    const html = await fetchFundamentalsHTML(symbol);
    return parseFundamentals(html);
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

  // === VALUATION (max 3 points) — Varsity ch.11 thresholds ===
  // Karthik: "I wouldn't say I like to buy stocks beyond 25 or at most 30x earnings"
  if (fundamentals.peRatio !== null) {
    maxScore += 3;
    if (fundamentals.peRatio > 0 && fundamentals.peRatio <= 16) {
      score += 3;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — attractive (Varsity <16x)`);
    } else if (fundamentals.peRatio > 16 && fundamentals.peRatio <= 22) {
      score += 2;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — fair (Varsity 16-22x neutral)`);
    } else if (fundamentals.peRatio > 22 && fundamentals.peRatio <= 30) {
      score += 1;
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — cautious (Varsity 22-30x)`);
    } else if (fundamentals.peRatio > 30) {
      score = Math.max(0, score - 1);  // active penalty
      insights.push(`PE ${fundamentals.peRatio.toFixed(1)} — AVOID (Varsity >30x)`);
    } else {
      score += 0;
      insights.push('Negative PE — company not profitable');
    }
  }

  // === PROFITABILITY (max 3 points) — Varsity ch.9 thresholds ===
  // Varsity: ROE >= 18% is good; top Indian companies 14-16%; due diligence wants >=25%
  if (fundamentals.roe !== null) {
    maxScore += 3;
    if (fundamentals.roe >= 25)      { score += 3; insights.push(`ROE ${fundamentals.roe.toFixed(1)}% — excellent (Varsity DD ≥25%)`); }
    else if (fundamentals.roe >= 18) { score += 2; insights.push(`ROE ${fundamentals.roe.toFixed(1)}% — good (Varsity ≥18%)`); }
    else if (fundamentals.roe >= 14) { score += 1; insights.push(`ROE ${fundamentals.roe.toFixed(1)}% — average (top Indian avg)`); }
    else                              { score += 0; insights.push(`ROE ${fundamentals.roe.toFixed(1)}% — weak (Varsity <14%)`); }
  }

  // === CAPITAL EFFICIENCY (max 2 points) — Varsity has no fixed threshold ===
  if (fundamentals.roce !== null) {
    maxScore += 2;
    if (fundamentals.roce >= 20) { score += 2; insights.push(`ROCE ${fundamentals.roce.toFixed(1)}% — highly efficient`); }
    else if (fundamentals.roce >= 12) { score += 1; insights.push(`ROCE ${fundamentals.roce.toFixed(1)}% — efficient`); }
    else { score += 0; }
  }

  // === LEVERAGE (max 1 point) — Varsity ch.10: D/E > 1 = caution ===
  if (fundamentals.debtToEquity !== null && fundamentals.debtToEquity !== undefined) {
    maxScore += 1;
    if (fundamentals.debtToEquity <= 0.5) { score += 1; insights.push(`D/E ${fundamentals.debtToEquity.toFixed(2)} — low leverage`); }
    else if (fundamentals.debtToEquity <= 1.0) { score += 0.5; insights.push(`D/E ${fundamentals.debtToEquity.toFixed(2)} — moderate leverage`); }
    else { score += 0; insights.push(`D/E ${fundamentals.debtToEquity.toFixed(2)} — high leverage (Varsity caution >1)`); }
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

  // === TIER-3 (M5.2): CASH GENERATION (max 1 point) — Varsity FA ch.7 ===
  // CFO is the cleanest test of "real" earnings vs accounting profit.
  // 5-year average ≥ 0 = cash-generating business; < 0 = burning cash.
  if (fundamentals.cfo5yAvg != null) {
    maxScore += 1;
    if (fundamentals.cfo5yAvg > 0) {
      score += 1;
      insights.push(`5y avg CFO ₹${fundamentals.cfo5yAvg}Cr — positive cash generation`);
    } else {
      // Active penalty: negative CFO is a strong warning signal
      score = Math.max(0, score - 0.5);
      insights.push(`5y avg CFO ₹${fundamentals.cfo5yAvg}Cr — cash-burning (Varsity caution)`);
    }
  }

  // === TIER-3 (M5.2): OPERATING MARGIN (max 1.5 points) — Varsity FA ch.6 ===
  // Premium OPM is a moat indicator. Varsity's bands roughly align with:
  //   ≥25% = excellent (defensible pricing power)
  //   15-25% = good (typical for quality businesses)
  //   10-15% = average (commodity exposure)
  //   <10% = weak (price-taker, low margin)
  if (fundamentals.operatingMargin != null) {
    maxScore += 1.5;
    if (fundamentals.operatingMargin >= 25)      { score += 1.5; insights.push(`OPM ${fundamentals.operatingMargin}% — premium margins (pricing power)`); }
    else if (fundamentals.operatingMargin >= 15) { score += 1;   insights.push(`OPM ${fundamentals.operatingMargin}% — quality margins`); }
    else if (fundamentals.operatingMargin >= 10) { score += 0.5; insights.push(`OPM ${fundamentals.operatingMargin}% — average margins`); }
    else                                          { score += 0;   insights.push(`OPM ${fundamentals.operatingMargin}% — thin margins`); }
  }

  // === TIER-3 (M5.2): SALES CAGR (max 1 point) — Varsity FA ch.7 ===
  // 5-year compounded sales growth is the headline growth metric Karthik
  // emphasises in the FA module. Negative CAGR is an active sell signal.
  if (fundamentals.salesCagr5y != null) {
    maxScore += 1;
    if (fundamentals.salesCagr5y >= 20)      { score += 1;    insights.push(`5y Sales CAGR ${fundamentals.salesCagr5y}% — strong growth`); }
    else if (fundamentals.salesCagr5y >= 10) { score += 0.5;  insights.push(`5y Sales CAGR ${fundamentals.salesCagr5y}% — steady growth`); }
    else if (fundamentals.salesCagr5y >= 0)  { score += 0;    insights.push(`5y Sales CAGR ${fundamentals.salesCagr5y}% — flat`); }
    else                                      { score -= 0.5; insights.push(`5y Sales CAGR ${fundamentals.salesCagr5y}% — declining (Varsity avoid)`); }
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
  // Tier-3 — surface when present, even though they don't yet feed scoring
  if (fundamentals.operatingMargin != null) parts.push(`OPM: ${fundamentals.operatingMargin}%`);
  if (fundamentals.salesCagr5y    != null) parts.push(`5y Sales CAGR: ${fundamentals.salesCagr5y}%`);
  if (fundamentals.cfo5yAvg       != null) parts.push(`5y avg CFO: ₹${fundamentals.cfo5yAvg}Cr`);

  const metricsLine = parts.join(' | ');
  const ratingLine = `Fundamental rating: ${scoreResult.rating} (${scoreResult.score}/10)`;

  return `${metricsLine}. ${ratingLine}. ${scoreResult.details}`;
}
