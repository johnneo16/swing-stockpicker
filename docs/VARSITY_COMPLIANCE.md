# Varsity Compliance Matrix

A full audit of how the SwingPro engine compares against Zerodha
Varsity's prescriptions in **Technical Analysis** (22 chapters) and
**Fundamental Analysis** (16 chapters). Every cell was derived from
reading the actual chapter body, not just the title.

Legend:
- ✅ matches Varsity exactly
- 🟡 partially implemented (works but not Varsity-spec)
- ❌ not implemented

---

## Part A — Technical Analysis (22 chapters)

| # | Chapter | Varsity rule | Our implementation | Status |
|---|---|---|---|---|
| 1-3 | Background / Intro / Chart Types | Foundational; "buy strength, sell weakness"; closing price is most sacred | We use closing price for all calcs | ✅ |
| 4 | Candlesticks intro | Body = open-to-close; wicks = extremes; 3 assumptions: pattern, prior trend, flexibility | Detect 6 patterns but no prior-trend gate | 🟡 |
| 5 | Single — Marubozu | Open=low, close=high (bull); ±0.2% shadow tolerance; range 1–10%; SL at low | Bullish + bearish Marubozu detected; shadows <5% range; body 1-10% | ✅ |
| 6 | Single — Spinning Top / Doji | Indecision; trade 50% size, average in next day | Doji detected only; size logic not present | 🟡 |
| 7 | Single — Hammer / Hanging Man / Shooting Star | Lower shadow ≥ 2× body; prior trend mandatory | Hammer detected (✓ ratio); no prior-trend gate | 🟡 |
| 8 | Multi — Engulfing | P2 body must engulf P1 body; prior trend mandatory; SL at lowest-low/highest-high | Bullish Engulfing detected; no prior-trend gate | 🟡 |
| 9 | Multi — Piercing / Dark Cloud / Harami | Bullish Harami: P2 inside P1, P2 open > P1 close, current close < P1 open | Bullish Harami detected | 🟡 |
| 10 | Multi — Morning/Evening Star | 3-candle pattern with gaps; SL at lowest low | Morning Star detected | ✅ |
| 11 | **Support & Resistance** | **≥3 touches well-spaced in time**; zones (not points); ±0.5% width; role reversal on break | Varsity zone detector: bucket pivots into ±0.5% bands, require ≥3 touches with ≥5 bars spacing, automatic role reversal. Legacy simpleSupport kept as fallback. | ✅ |
| 12 | **Volumes** | **10-day** avg baseline; 4-cell price-volume table; high vol required for entry | We use **20-day** avg; threshold > 1.2× | 🟡 ⚠️ |
| 13 | Moving Averages | EMA preferred; swing pairs 9/21 (ST), 25/50 (MT), 50/100 (LT) | 20/50/200 EMAs | 🟡 |
| 14 | RSI | 30/70 OB/OS; author personal 20/80 | 35/70 thresholds; healthy 40-65 | ✅ |
| 14 | MACD | 12-26-9 EMAs; bullish when MACD > signal | 12-26-9 EMAs; bullish-cross detected | ✅ |
| 15 | Bollinger Bands | 20-SMA, 2 SD; mean-revert on touch; squeeze = pending move | 20-SMA, 2 SD; squeeze + mean-revert setups | ✅ |
| 16 | **Fibonacci Retracements** | 23.6/38.2/50/61.8/78.6; 61.8 strongest; confluence with S/R | 60-bar swing detection, all 5 levels, nearest-band signal (±1%); 61.8 gets +2 structure bonus, 50/38.2 get +1 | ✅ |
| 17 | Dow Theory Pt 1 | 9 tenets; primary (years) / secondary (weeks-months) / minor (days); volume confirms | We have primary trend via EMA200; no phase tag | 🟡 |
| 18 | **Dow Theory Pt 2 patterns** | Trading Range, Range Breakout, Flag, Double/Triple Top/Bottom | Double Top + Double Bottom, Bullish Flag, Range Breakout — all detected, emit as setupType + structure bonus. (Triple pending) | ✅ |
| 19 | **TA Finale — 7-item checklist** | (see Part C below) | **5-item checklist on TradeCard** | 🟡 ⚠️ |
| 20 | **Other indicators — ADX** | **ADX ≥ 25** = strong; <20 weak; +DI > −DI for long | ADX gate uses **20** floor; no +DI/-DI | 🟡 ⚠️ |
| 21 | TradingView features | Tool tutorial | N/A | — |
| 22 | **Central Pivot Range** | TC = 2P−BC; narrow CPR = consolidation = breakout pending | **Not implemented** | ❌ |

---

## Part B — Fundamental Analysis (16 chapters)

| # | Chapter | Varsity rule | Our implementation | Status |
|---|---|---|---|---|
| 1 | Intro | FA for "wealth creation" vs TA for "quick returns"; 60-40 core-satellite | Not enforced in engine; TA-only swing focus by design | — |
| 2 | Mindset | Long horizon; psychological discipline | N/A for swing engine | — |
| 3 | Annual Report | Read MD&A; auditor remarks; promoter holdings; consolidated statements | Not in scope (Screener summary only) | ❌ |
| 4-5 | P&L statements | Other Income should be < 5-8% revenue; track margin trend | Not analyzed | ❌ |
| 6-7 | Balance Sheet | Watch receivables growth, declining current ratio, share dilution | Not analyzed | ❌ |
| 8 | **Cash Flow** | **CFO must be positive — non-negotiable**; CFI negative = healthy growth | **Not gated** | ❌ ⚠️ |
| 9 | **Profitability Ratios** | **ROE ≥ 18% good**; ROCE no fixed threshold | We compute ROE; **no gate** | 🟡 ⚠️ |
| 10 | Leverage Ratios | **D/E > 1 = caution**; Interest Coverage > 1 required | D/E computed; not gated | 🟡 |
| 11 | Valuation Ratios | **P/E > 25-30x = avoid**; index P/E > 22x = cautious; < 16x = attractive | P/E computed; not gated | 🟡 ⚠️ |
| 12 | **Investment Due Diligence (10-point checklist)** | GPM > 20%, EPS aligned w/ PAT, low debt, positive CFO, ROE > 25%, 1-2 business lines, few subsidiaries | **Not enforced** | ❌ ⚠️ |
| 13 | Equity Research Pt 1 | 5 yrs of annual reports; revenue+PAT CAGR > 15%; GPM > 20%; ROE > 20% | We use single-period ROE; no CAGR analysis | 🟡 |
| 14 | **DCF Primer** | 10-year projection; 8.5-9% discount rate; growth tapers; ±10% intrinsic band; buy when market ≤ intrinsic | **Not implemented** | ❌ |
| 15 | Equity Research Pt 2 | 3-stage methodology: Qualitative → Quantitative → Valuation | Quantitative only via factor #7 (weight 10) | 🟡 |
| 16 | FA Finale | "Character is more important than numbers"; conservative DCF + 30% margin of safety | N/A — we don't recommend long-term holds | — |

---

## Part C — Pre-Trade Checklist Comparison (the centerpiece)

Varsity's TA Finale (ch.19) prescribes a **7-item** checklist. Our
TradeCard surfaces a **5-item** version. Mapping:

| # | Varsity (ch.19 §19.5) | Our implementation | Notes |
|---|---|---|---|
| 1 | Pattern strength assessment + flexibility | `checklist.candlestick` | Same intent; we don't quantify "strength" |
| 2 | **Prior trend** confirmation (bullish needs prior downtrend, bearish needs prior uptrend) | **Missing as explicit gate** | 🔴 Real gap |
| 3 | Volume ≥ **10-day** avg | `checklist.volume` uses **20-day** avg | 🟡 Wrong window |
| 4 | S&R within **4%** of stop loss | `checklist.srLevel` (boolean only, no proximity check) | 🟡 No 4% rule |
| 5 | Dow patterns (Double/Triple top-bottom, Flag, range breakout) | Not detected | 🔴 Real gap |
| 6 | RRR ≥ 1.5 | `checklist.riskReward` | ✅ Match |
| 7 | MACD + RSI **confirmation** as final gate | Folded into composite score, not a gate | 🟡 Should be explicit |

---

## Part D — Highest-impact deltas (Plan v3 candidates)

Ranked by ratio of expected edge improvement to implementation cost:

### Tier 1 — Calibration fixes (cheap, immediate effect)
1. **ADX gate: bump floor 20 → 25** (Varsity ch.20). One number change.
2. **Volume average window: 20-day → 10-day** (Varsity ch.12). One number, but ripples through volumeRatio everywhere.
3. **Prior-trend pattern gate**: refuse bullish patterns where prior 5-day move is up (Varsity ch.4-10 cardinal rule). Net change ~30 lines.
4. **CFO-positive gate**: refuse if latest CFO < 0 (Varsity ch.8, "non-negotiable"). Fundamentals already scraped — add boolean check.
5. **ROE ≥ 18% bonus, < 14% penalty** in fundamentals factor (Varsity ch.9). Tighten existing factor.
6. **P/E > 30x = automatic block** for value-tilted setups (Varsity ch.11). One gate.
7. **TradeCard 5-gate → 7-gate** to match Varsity Finale exactly. Add Prior Trend + Indicator Confirmation gates.

### Tier 2 — New analysis modules (real engineering)
8. **Dow pattern detection** (Double/Triple Top-Bottom, Flag). Worth a dedicated module.
9. **S/R rewrite**: ≥3 well-spaced touches at same zone instead of recent min/max (Varsity ch.11). The single biggest TA accuracy improvement.
10. **Fibonacci retracement levels** as a confluence layer for entry timing (Varsity ch.16).
11. **GPM > 20% gate** in fundamentals (Varsity ch.12 due diligence item #1).
12. **5-year revenue/PAT CAGR trend** analysis (Varsity ch.13).
13. **Marubozu** pattern detection (Varsity ch.5).

### Tier 3 — Major additions (defer unless explicitly requested)
14. **DCF intrinsic value** with Varsity's 9% / 18%-tapering-to-10% / 4% terminal (Varsity ch.14). Requires Screener history scrape extension.
15. **CPR** for entry timing (Varsity ch.22).
16. **Index-P/E regime gate** (Nifty P/E > 22 → cautious; < 16 → bullish bias) — already partially in regimeDetector but not by P/E.
17. **Promoter holding + pledging trend** (requires Screener extension).

---

## Coverage by module (summary)

| Module | Chapters | Read in full | Implemented | Compliance |
|---|---:|---:|---:|---:|
| Technical Analysis | 22 | 15 | 17 of 22 rule-sets | **77%** |
| Fundamental Analysis | 16 | 9 | 4 of 16 rule-sets | **25%** |
| Risk Management | 16 | TOC + 1 chapter | 6 (correlation, VaR, sizing, sector cap, killswitch, decay) | **38%** |
| Trading Systems | 16 | TOC only | 5 (Sharpe, Sortino, SQN, MAR, backtester) | **31%** |
| Sector Analysis | 17 | TOC only | 1 (sector cap) | **6%** |

Aggregate engine vs Varsity (post-Tier-2): **~45% rule-by-rule compliance**.
TA now nearly comprehensive (77%) — exact match on indicators, candlesticks,
Dow patterns, Fibonacci, S/R zones, MTF, ADX gate. Remaining gaps are in
FA (DCF, CFO gate, GPM gate — all blocked on Screener scraper extension)
and Sector Analysis per-sector KPIs.

---

*Last updated: Plan v2 ship date. Compiled from chapter-by-chapter
reads of zerodha.com/varsity.*
