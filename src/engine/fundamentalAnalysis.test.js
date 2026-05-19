/**
 * Tests for the Screener.in fundamentals parser.
 *
 * Strategy: hand-craft minimal HTML fragments that mirror Screener's real
 * structure (verified against live pages 2026-05). The parser must be
 * resilient to:
 *   - missing sections (smaller companies don't expose full financials)
 *   - empty cells (most-recent year may have null cells when results pending)
 *   - localized number formats (₹, %, commas)
 */
import { describe, it, expect } from 'vitest';
import { parseFundamentals, scoreFundamentals } from './fundamentalAnalysis.js';

// Helper: wrap a partial HTML fragment in a minimal HTML doc so cheerio
// parses it cleanly.
function wrap(body) {
  return `<!doctype html><html><body>${body}</body></html>`;
}

const TOP_RATIOS = `
  <ul id="top-ratios">
    <li><span class="name">Market Cap</span><span class="number">125,400</span></li>
    <li><span class="name">Stock P/E</span><span class="number">18.5</span></li>
    <li><span class="name">ROE</span><span class="number">22.4</span></li>
    <li><span class="name">ROCE</span><span class="number">28.1</span></li>
    <li><span class="name">Debt to equity</span><span class="number">0.34</span></li>
    <li><span class="name">Dividend Yield</span><span class="number">1.2</span></li>
    <li><span class="name">Book Value</span><span class="number">450</span></li>
    <li><span class="name">High / Low</span><span class="value">1,612 / 1,115</span></li>
  </ul>
`;

const CASH_FLOW = `
  <section id="cash-flow">
    <table><tbody>
      <tr><td class="text">Cash from Operating Activity</td>
          <td>1,200</td><td>1,400</td><td>1,600</td><td>1,800</td><td>2,000</td></tr>
      <tr><td class="text">Cash from Investing</td>
          <td>-200</td><td>-300</td><td>-400</td><td>-500</td><td>-600</td></tr>
    </tbody></table>
  </section>
`;

const PROFIT_LOSS = `
  <section id="profit-loss">
    <table><tbody>
      <tr><td class="text">Sales</td>
          <td>5,000</td><td>5,500</td><td>6,000</td><td>6,500</td><td>7,000</td></tr>
      <tr><td class="text">Operating Profit</td>
          <td>900</td><td>1,000</td><td>1,100</td><td>1,200</td><td>1,400</td></tr>
      <tr><td class="text">OPM %</td>
          <td>18</td><td>18.2</td><td>18.3</td><td>18.5</td><td>20</td></tr>
    </tbody></table>
  </section>
`;

const GROWTH_TABLES = `
  <h2>Compounded Sales Growth</h2>
  <table><tbody>
    <tr><td>10 Years:</td><td>14%</td></tr>
    <tr><td>5 Years:</td><td>17%</td></tr>
    <tr><td>3 Years:</td><td>22%</td></tr>
    <tr><td>TTM:</td><td>25%</td></tr>
  </tbody></table>
`;

describe('parseFundamentals — Tier-1 ratios (existing behavior)', () => {
  it('extracts top-bar ratios correctly', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS));
    expect(f.peRatio).toBe(18.5);
    expect(f.roe).toBe(22.4);
    expect(f.roce).toBe(28.1);
    expect(f.debtToEquity).toBe(0.34);
    expect(f.dividendYield).toBe(1.2);
    expect(f.bookValue).toBe(450);
  });

  it('parses 52-week range from the "High / Low" cell', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS));
    expect(f.fiftyTwoWeekHigh).toBe(1612);
    expect(f.fiftyTwoWeekLow).toBe(1115);
  });

  it('converts market cap from Crores to raw rupees', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS));
    expect(f.marketCap).toBe(125400 * 1e7);    // 1,25,400 Cr → 1.254 trillion ₹
  });

  it('returns null for any ratio missing from the page', () => {
    const sparse = `<ul id="top-ratios">
      <li><span class="name">Stock P/E</span><span class="number">22</span></li>
    </ul>`;
    const f = parseFundamentals(wrap(sparse));
    expect(f.peRatio).toBe(22);
    expect(f.roe).toBeNull();
    expect(f.roce).toBeNull();
    expect(f.debtToEquity).toBeNull();
  });
});

describe('parseFundamentals — Tier-3 (M5.1) — cfo5yAvg', () => {
  it('averages the last 5 Cash-from-Operating cells', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS + CASH_FLOW));
    // (1200 + 1400 + 1600 + 1800 + 2000) / 5 = 1600
    expect(f.cfo5yAvg).toBe(1600);
  });

  it('handles fewer than 5 cells gracefully', () => {
    const shortCF = `<section id="cash-flow"><table><tbody>
      <tr><td class="text">Cash from Operating Activity</td>
          <td>800</td><td>1,000</td><td>1,200</td></tr>
    </tbody></table></section>`;
    const f = parseFundamentals(wrap(TOP_RATIOS + shortCF));
    expect(f.cfo5yAvg).toBe(1000);                  // (800+1000+1200)/3
  });

  it('returns null when the cash-flow section is missing', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS));
    expect(f.cfo5yAvg).toBeNull();
  });

  it('skips empty cells (e.g. pending-results year)', () => {
    const cfWithEmpty = `<section id="cash-flow"><table><tbody>
      <tr><td class="text">Cash from Operating Activity</td>
          <td>1,000</td><td>1,200</td><td>1,400</td><td>1,600</td><td></td></tr>
    </tbody></table></section>`;
    const f = parseFundamentals(wrap(TOP_RATIOS + cfWithEmpty));
    // (1000+1200+1400+1600)/4 = 1300
    expect(f.cfo5yAvg).toBe(1300);
  });
});

describe('parseFundamentals — Tier-3 (M5.1) — operatingMargin', () => {
  it('prefers the OPM % row, returns the latest year', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS + PROFIT_LOSS));
    expect(f.operatingMargin).toBe(20);             // latest column
  });

  it('falls back to Operating Profit / Sales when OPM% row is absent', () => {
    const plNoOpm = `<section id="profit-loss"><table><tbody>
      <tr><td class="text">Sales</td>
          <td>5,000</td><td>5,500</td><td>6,000</td><td>6,500</td><td>7,000</td></tr>
      <tr><td class="text">Operating Profit</td>
          <td>900</td><td>1,000</td><td>1,100</td><td>1,200</td><td>1,400</td></tr>
    </tbody></table></section>`;
    const f = parseFundamentals(wrap(TOP_RATIOS + plNoOpm));
    // 1400 / 7000 = 20% latest
    expect(f.operatingMargin).toBe(20);
  });

  it('returns null when neither row is parseable', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS));
    expect(f.operatingMargin).toBeNull();
  });
});

describe('parseFundamentals — Tier-3 (M5.1) — salesCagr5y', () => {
  it('extracts the 5-year row from Compounded Sales Growth', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS + GROWTH_TABLES));
    expect(f.salesCagr5y).toBe(17);
  });

  it('returns null when the heading is missing', () => {
    const f = parseFundamentals(wrap(TOP_RATIOS));
    expect(f.salesCagr5y).toBeNull();
  });

  it('handles heading-case variations defensively', () => {
    const upperHeading = `<h2>COMPOUNDED SALES GROWTH</h2>
      <table><tbody><tr><td>5 Years:</td><td>15%</td></tr></tbody></table>`;
    const f = parseFundamentals(wrap(TOP_RATIOS + upperHeading));
    expect(f.salesCagr5y).toBe(15);
  });
});

describe('scoreFundamentals — M5.2 Tier-3 scoring', () => {
  const baseLegacy = {
    peRatio: 18.5, roe: 22.4, roce: 28.1, debtToEquity: 0.34,
    dividendYield: 1.2, fiftyTwoWeekHigh: 1612, fiftyTwoWeekLow: 1115,
  };

  it('returns the same score whether Tier-3 fields are present-null or omitted', () => {
    // Both cases should produce identical scores — null Tier-3 means
    // "data unavailable", which contributes 0 to numerator AND maxScore.
    const withNulls = { ...baseLegacy, cfo5yAvg: null, operatingMargin: null, salesCagr5y: null };
    expect(scoreFundamentals(baseLegacy).score).toBe(scoreFundamentals(withNulls).score);
  });

  it('rewards positive 5y avg CFO (+1 point of 3.5 added maxScore)', () => {
    const withGoodCFO = { ...baseLegacy, cfo5yAvg: 1500 };
    const result = scoreFundamentals(withGoodCFO);
    expect(result.details).toMatch(/positive cash generation/);
    // Score change is normalized: the legacy 10-point ceiling now divides
    // across more maxScore, so the absolute number can shift either way.
    // What matters is the row contributed.
  });

  it('penalizes negative 5y avg CFO', () => {
    const burning = { ...baseLegacy, cfo5yAvg: -200 };
    const result = scoreFundamentals(burning);
    expect(result.details).toMatch(/cash-burning/);
  });

  it('rewards premium operating margins (≥25%)', () => {
    const premium = { ...baseLegacy, operatingMargin: 30 };
    expect(scoreFundamentals(premium).details).toMatch(/premium margins/);
  });

  it('flags thin operating margins (<10%)', () => {
    const thin = { ...baseLegacy, operatingMargin: 6 };
    expect(scoreFundamentals(thin).details).toMatch(/thin margins/);
  });

  it('rewards strong 5y Sales CAGR (≥20%)', () => {
    const strong = { ...baseLegacy, salesCagr5y: 24 };
    expect(scoreFundamentals(strong).details).toMatch(/strong growth/);
  });

  it('penalizes declining sales (negative CAGR)', () => {
    const declining = { ...baseLegacy, salesCagr5y: -3 };
    expect(scoreFundamentals(declining).details).toMatch(/declining/);
  });

  it('ranks a Tier-3-complete excellent company above the same legacy ratios with no Tier-3', () => {
    // A name with strong fundamentals AND Tier-3 quality (positive CFO,
    // premium OPM, strong CAGR) must score at least as high as the same
    // name without Tier-3 data — the new dimensions should add signal,
    // not muddle it.
    const noTier3 = baseLegacy;
    const fullTier3 = {
      ...baseLegacy, cfo5yAvg: 2000, operatingMargin: 28, salesCagr5y: 22,
    };
    expect(scoreFundamentals(fullTier3).score).toBeGreaterThanOrEqual(scoreFundamentals(noTier3).score);
  });

  it('ranks an excellent company strictly higher than a cash-burning one with the same TA ratios', () => {
    const excellent = {
      ...baseLegacy, cfo5yAvg: 2000, operatingMargin: 28, salesCagr5y: 22,
    };
    const concerning = {
      ...baseLegacy, cfo5yAvg: -500, operatingMargin: 5, salesCagr5y: -3,
    };
    expect(scoreFundamentals(excellent).score).toBeGreaterThan(scoreFundamentals(concerning).score);
  });
});
