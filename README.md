# 🚀 SwingPro — AI-Powered NSE Swing Trading Platform

<div align="center">

**Professional-grade AI swing trading system for the Indian stock market**

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Angel One](https://img.shields.io/badge/Angel_One-SmartAPI-FF9900?style=for-the-badge&logoColor=white)](https://smartapi.angelbroking.com/)

</div>

---

## 📸 Screenshots

### Dashboard — Dual-Mode (Stocks & ETFs)
![Dashboard](docs/screenshots/dashboard.png)

### Portfolio Tracking & Sector Exposure
![Portfolio](docs/screenshots/portfolio.png)

---

## ✨ What is SwingPro?

SwingPro is a **full-stack web platform** that acts as your personal AI trading analyst. Built to scan **100+ liquid NSE Stocks and Top Index ETFs** using real-time data from **Angel One SmartAPI** and high-integrity fundamentals from **Screener.in**, it runs multi-factor technical analysis, applies **hedge-fund-grade risk management**, and presents actionable swing trade setups (3–15 day horizon) through a professional Neon-Dark terminal dashboard.

> **Think of it as a disciplined trading assistant that manages your portfolio with institutional risk rules — prioritize capital preservation while capturing high-probability momentum.**

---

## 🎯 Key Features

### 📡 High-Integrity Data Pipeline
- **SmartAPI (Angel One):** Fetching live tick data and 90-day OHLCV candles to bypass 15-minute exchange delays.
- **Screener.in Scraping:** Custom robust scraper using `Axios` and `Cheerio` to ingest real-time PE, ROE, ROCE, and Dividend Yield metrics, bypassing common Yahoo Finance rate limits.
- **Auto-Refresh Scheduler:** Background worker fetches new data every 30 minutes during NSE hours (9:15 AM - 3:30 PM).

### 📊 Multi-Factor Analysis Engine (Alpha Engine)
- **Technical Indicators**: RSI (14), MACD (12,26,9), EMA 20/50/200, ATR-based volatility, and Volume-Price analysis.
- **Trend Alignment**: Confirms entries only when price is sustained above key moving averages with accelerating momentum.
- **Asset Classes**: Separate dedicated pipelines for **Equity Stocks** and **Exchange Traded Funds (ETFs)**.

### 💰 Professional Risk Management
| Rule | Value | Description |
|------|-------|-------------|
| Max risk per trade | 2.0% | Calculated as percentage of total capital |
| Position sizing | Capped at 20% | Never allocate more than 20% capital to a single trade |
| Max concurrent trades| 5 | Ensures optimal diversification vs focus |
| Cash reserve | 15% | Always maintains liquidity for strategic adjustments |
| Sector limit | 3 (Stocks) / 5 (ETFs) | Prevents over-concentration in specific industries |
| Min risk-reward | 1:1.5+ | Prefers setups with asymmetric profit potential |

### 🧠 AI Confidence Scoring (0–100)
A weighted scoring system that evaluates trade quality:
- **Trend Alignment (20%)**: MA position & slope.
- **Momentum (20%)**: RSI/MACD strength.
- **Volume Profile (15%)**: Relative volume vs 20-day average.
- **Price Action (15%)**: Breakouts & Support/Resistance confirmation.
- **Risk-Reward (15%)**: Mathematical quality of the trade entry/exit.
- **Fundamental Strength (15%)**: ROE/PE/ROCE scores from Screener.in.

---

## 🏗️ System Architecture

SwingPro follows a decoupled Monolithic architecture optimized for low-latency financial analysis.

### 🧬 Tech Stack
- **Frontend**: React 18, Vite 5, Lucide React (Icons), Vanilla CSS (Custom Glassmorphism + Dark Grid).
- **Backend**: Node.js 18+, Express.js, `totp-generator` (2FA automation).
- **Data Ingestion**: `axios`, `cheerio` (Web Scraping), `smartapi-javascript`.
- **Infrastructure**: Render.com (Unified Deployment), `dotenv` (Security).

---

## 🔮 Roadmap
1. **[DONE] Screener.in Integration**: Move away from unreliable public fundamental APIs.
2. **[DONE] Dynamic Capital**: Support for adjusting portfolio size directly from the dashboard.
3. **[DONE] High-Conviction Filter**: Toggle to see only picks with scores ≥ 60.
4. **Real-time WebSockets**: Tick-by-tick updates instead of polling.
5. **Backtesting Engine**: Verify strategies against 5-year historical OHLCV data.

---

## 🚀 Quick Start (Local Run)

### 1. Generate Angel One Credentials
1. Create a trading app at [SmartAPI Angel One](https://smartapi.angelbroking.com/).
2. Enable [TOTP](https://smartapi.angelbroking.com/enable-totp) and save your 16-character secret.

### 2. Setup Project
```bash
git clone https://github.com/johnneo16/swing-stockpicker.git
npm install
cp .env.example .env
```
Fill `.env` with your Keys, Client ID, PIN, and TOTP Secret.

### 3. Run Application
```bash
# Terminal 1 — Backend
npm run server

# Terminal 2 — Frontend
npm run dev
```

---

## ⚠️ Disclaimer
This software is for **educational purposes only**. Trading stocks involves significant risk. Always consult a certified financial advisor before making investment decisions.

---

## 📄 License
MIT License.
