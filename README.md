# 🚀 SwingPro — AI-Powered NSE Swing Trading Platform

<div align="center">

**Professional-grade AI swing trading system for the Indian stock market**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Yahoo Finance](https://img.shields.io/badge/Yahoo_Finance-API-720e9e?style=for-the-badge&logo=yahoo&logoColor=white)](https://finance.yahoo.com/)

</div>

---

## 📸 Screenshots

### Dashboard — Trade Setups with Full Analysis
![Dashboard](docs/screenshots/dashboard.png)

### Portfolio Tracking & Sector Exposure
![Portfolio](docs/screenshots/portfolio.png)

---

## ✨ What is SwingPro?

SwingPro is a **full-stack web platform** that acts as your personal AI trading analyst. It scans **50+ NSE stocks** via Yahoo Finance, runs multi-factor technical analysis, applies **hedge-fund-grade risk management**, and presents actionable swing trade setups (3–15 day horizon) through a beautiful dark-mode dashboard.

> **Think of it as a disciplined trading assistant that manages a ₹50,000 portfolio with professional risk rules — capital preservation first, profits second.**

---

## 🎯 Key Features

### 📊 Multi-Factor Analysis Engine
- **Technical**: RSI (14), MACD (12,26,9), EMA 20/50/200, ATR, Volume Analysis
- **Price Action**: Support/resistance detection, breakout & consolidation patterns, swing lows
- **Smart Money**: Volume spike detection for institutional footprint tracking

### 💰 Professional Risk Management
| Rule | Value |
|------|-------|
| Max risk per trade | 1–2% of capital (₹500–₹1,000) |
| Position sizing | `Quantity = Risk Amount / (Entry − Stop Loss)` |
| Max concurrent trades | 5 |
| Cash reserve | 25% always in cash |
| Sector limit | Max 2 stocks per sector |
| Min risk-reward | 1:2 (prefers 1:2.5+) |

### 🧠 AI Confidence Scoring (0–100)
Six-factor weighted scoring system:

| Factor | Weight | What it measures |
|--------|--------|-----------------|
| Trend | 20% | EMA alignment, price above key MAs |
| Momentum | 20% | RSI zone, MACD crossovers, histogram slope |
| Volume | 15% | Volume ratio vs 20-day average |
| Price Action | 15% | Breakouts, support bounces, consolidation |
| Risk-Reward | 15% | Quality of R:R ratio |
| Psychology | 15% | FOMO filter, overextension check, confirmation |

### 🧘 Trader Psychology Engine
Every trade includes:
- ✅ **Why this trade works** — bullish case
- ⚠️ **Why this trade can FAIL** — risk awareness (no blind trades)
- 🎯 **Execution strategy** — breakout entry / pullback / wait
- 📊 **Confidence score & risk level** — data-driven conviction

### 🔔 Alert System
- New high-confidence setups detected
- Risk warnings (sector overload, capital limits)
- Per-trade validation warnings

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    SwingPro Architecture                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Yahoo Finance API (.NS suffix)                              │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────┐  │
│  │ Data Fetcher │───▶│ Technical Engine  │───▶│ AI Scoring │  │
│  │ (Batch + RL) │    │ RSI/MACD/EMA/ATR │    │ 0-100      │  │
│  └─────────────┘    └──────────────────┘    └─────┬──────┘  │
│                                                    │         │
│                                              ┌─────▼──────┐  │
│                                              │ Risk Engine │  │
│                                              │ Position    │  │
│                                              │ Sizing      │  │
│                                              └─────┬──────┘  │
│                                                    │         │
│  ┌────────────────────────────────────────────────┐│         │
│  │              Express API (:3001)               ││         │
│  │  GET /api/scan                                 │◀─────────│
│  │  GET /api/market-overview                      │          │
│  │  GET /api/portfolio                            │          │
│  └───────────────────┬────────────────────────────┘          │
│                      │                                       │
│  ┌───────────────────▼────────────────────────────┐          │
│  │           React Dashboard (:5173)              │          │
│  │  Trade Cards │ Portfolio │ Market │ Alerts      │          │
│  └────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+ ([download](https://nodejs.org/))
- **npm** (comes with Node.js)

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/swing-stockpicker.git
cd swing-stockpicker

# 2. Install dependencies
npm install
```

### Running

You need **two terminals**:

```bash
# Terminal 1 — Start the backend API server
node server.js
# → 🚀 API running on http://localhost:3001

# Terminal 2 — Start the frontend dev server
npm run dev
# → Vite ready at http://localhost:5173
```

Open **http://localhost:5173** in your browser. The dashboard loads instantly with **sample data**. Click **"Scan Market"** to fetch **live NSE data** from Yahoo Finance.

---

## 📁 Project Structure

```
swing-stockpicker/
├── server.js                          # Express API server (3 endpoints)
├── package.json                       # Dependencies & scripts
├── vite.config.js                     # Vite + React + API proxy
├── index.html                         # Entry HTML
└── src/
    ├── main.jsx                       # React entry point
    ├── App.jsx                        # Main dashboard (3 tabs, sample data fallback)
    ├── index.css                      # Dark glassmorphism design system
    ├── components/
    │   ├── TradeCard.jsx              # Full trade setup card
    │   ├── PortfolioSummary.jsx       # Capital tracking + sector exposure
    │   ├── MarketOverview.jsx         # Nifty 50 / Bank Nifty + mood
    │   └── AlertPanel.jsx             # Trade signal alerts
    └── engine/
        ├── dataFetcher.js             # Yahoo Finance API integration
        ├── technicalAnalysis.js       # RSI, MACD, EMA, ATR, S/R levels
        ├── riskEngine.js              # Position sizing & capital allocation
        ├── scoringEngine.js           # Multi-factor AI scoring (0-100)
        └── stockUniverse.js           # 50 curated NSE stocks with sectors
```

---

## 📊 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scan` | GET | Full market scan → ranked trade setups |
| `/api/scan?refresh=true` | GET | Force refresh (bypass 5-min cache) |
| `/api/market-overview` | GET | Nifty 50, Bank Nifty, market mood |
| `/api/portfolio` | GET | Portfolio summary from latest scan |

### Sample Response — `/api/scan`

```json
{
  "trades": [
    {
      "symbol": "TATAMOTORS",
      "name": "Tata Motors",
      "sector": "Auto",
      "entryPrice": 745.50,
      "stopLoss": 718.30,
      "targetPrice": 813.50,
      "riskRewardRatio": 2.5,
      "riskAmount": 750,
      "quantity": 27,
      "capitalRequired": 20128,
      "confidenceScore": 72,
      "riskLevel": "Low",
      "technicalReasoning": "Price above EMA 20 & 50. RSI 54.2. MACD bullish...",
      "whyThisWorks": "Strong uptrend with aligned EMAs...",
      "whyThisCanFail": "Near resistance — potential rejection...",
      "executionStrategy": "Trend continuation — enter on pullback to EMA 20"
    }
  ],
  "portfolio": {
    "totalCapital": 50000,
    "capitalDeployed": 37500,
    "remainingCash": 12500,
    "riskExposurePercent": 7.5,
    "activeTradeCount": 5
  }
}
```

---

## 🧮 Position Sizing — How It Works

Every trade uses this exact formula (no arbitrary quantities):

```
Risk Per Trade = Total Capital × Risk % (1.5%)
               = ₹50,000 × 0.015
               = ₹750

Risk Per Share = Entry Price − Stop Loss
               = ₹745.50 − ₹718.30
               = ₹27.20

Position Size  = Risk Per Trade / Risk Per Share
               = ₹750 / ₹27.20
               = 27 shares

Capital Needed = 27 × ₹745.50
               = ₹20,128
```

> If the worst case happens and stop loss is hit, you lose exactly **₹750** (1.5% of capital). Never more.

---

## 🔧 Configuration

All risk parameters can be tuned in `src/engine/riskEngine.js`:

```javascript
const TOTAL_CAPITAL = 50000;           // Your trading capital
const MAX_RISK_PERCENT = 0.02;         // Max 2% risk per trade
const DEFAULT_RISK_PERCENT = 0.015;    // Default 1.5% risk per trade
const MAX_CONCURRENT_TRADES = 5;       // Max open positions
const CASH_RESERVE_PERCENT = 0.25;     // Keep 25% as cash
const MAX_SECTOR_EXPOSURE = 2;         // Max 2 stocks per sector
const MIN_RISK_REWARD = 2.0;           // Minimum 1:2 R:R ratio
```

---

## 📈 Stock Universe

The scanner covers **50 liquid NSE stocks** across 15+ sectors:

| Sector | Stocks |
|--------|--------|
| Banking | HDFCBANK, ICICIBANK, SBIN, KOTAKBANK, AXISBANK |
| IT | TCS, INFY, WIPRO, HCLTECH, TECHM, LTIM |
| Auto | TATAMOTORS, MARUTI, M&M, BAJAJ-AUTO, EICHERMOT |
| Pharma | SUNPHARMA, DRREDDY, CIPLA, DIVISLAB |
| Energy | RELIANCE, ONGC |
| Metals | TATASTEEL, JSWSTEEL, HINDALCO |
| FMCG | HINDUNILVR, ITC, NESTLEIND, BRITANNIA |
| And more... | Telecom, Power, Infra, Consumer, Retail |

---

## 🛣️ Roadmap

- [x] **Phase 1 (MVP)** — Daily swing picks, risk-based position sizing, sample data preview
- [ ] **Phase 2** — Live portfolio tracking, trade history, P&L dashboard
- [ ] **Phase 3** — Telegram/WhatsApp alerts, strategy backtesting
- [ ] **Phase 4** — Fully automated AI assistant, personalized watchlists

---

## ⚠️ Disclaimer

> This software is for **educational and research purposes only**. It does not constitute financial advice. Trading in the stock market involves substantial risk of loss. Always do your own research and consult a qualified financial advisor before making any investment decisions. Past performance is not indicative of future results.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with 🧠 discipline and ☕ caffeine**

*"Capital protection > profit maximization"*

</div>
