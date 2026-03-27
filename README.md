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

### Dashboard — Trade Setups with Full Analysis
![Dashboard](docs/screenshots/dashboard.png)

### Portfolio Tracking & Sector Exposure
![Portfolio](docs/screenshots/portfolio.png)

---

## ✨ What is SwingPro?

SwingPro is a **full-stack web platform** that acts as your personal AI trading analyst. Built to scan **50+ NSE Stocks and Top ETFs** using real-time data from **Angel One SmartAPI**, it runs multi-factor technical analysis, applies **hedge-fund-grade risk management**, and presents actionable swing trade setups (3–15 day horizon) through a beautiful dark-mode dashboard.

> **Think of it as a disciplined trading assistant that manages a ₹50,000 portfolio with professional risk rules — capital preservation first, profits second.**

---

## 🎯 Key Features

### 📡 Institutional-Grade Data (Angel One)
- **Live Tick Data:** Bypasses 15-minute delays by fetching live LTPs and full market depth directly from the NSE exchange.
- **Split-Adjusted History:** Perfectly maps 90-day OHLCV candles, adjusting for corporate actions (splits/bonuses) to prevent false technical indicators.
- **Auto-Refresh Scheduler:** Background server worker automatically fetches new data every 30 minutes during active NSE market hours (9:15 AM - 3:30 PM).

### 📊 Multi-Factor Analysis Engine
- **Technical**: RSI (14), MACD (12,26,9), EMA 20/50/200, ATR, Volume Analysis
- **Price Action**: Support/resistance detection, breakout & consolidation patterns, Bollinger Bands squeezing.
- **Asset Classes**: Seamlessly switch between **Stocks** and **ETFs** analysis.

### 💰 Professional Risk Management
| Rule | Value |
|------|-------|
| Max risk per trade | 1.5% of capital (₹750) |
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
| Price Action | 15% | Breakouts, support bounces, consolidation within Bollinger Bands |
| Risk-Reward | 15% | Quality of R:R ratio |
| Psychology | 15% | FOMO filter, overextension check, confirmation |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    SwingPro Architecture                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Angel One SmartAPI (NSE/BSE)                                │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────┐  │
│  │ Data Fetcher │───▶│ Technical Engine  │───▶│ AI Scoring │  │
│  │ (LTP + OHLCV)│    │ RSI/MACD/BB/EMA  │    │ 0-100      │  │
│  └─────────────┘    └──────────────────┘    └─────┬──────┘  │
│                                                    │         │
│                                              ┌─────▼──────┐  │
│                                              │ Risk Engine │  │
│                                              │ Position    │  │
│                                              │ Sizing      │  │
│                                              └─────┬──────┘  │
│                                                    │         │
│  ┌────────────────────────────────────────────────┐│         │
│  │              Node/Express Backend              ││         │
│  │  Automated 30-Min Market Scheduler             │◀─────────│
│  └───────────────────┬────────────────────────────┘          │
│                      │                                       │
│  ┌───────────────────▼────────────────────────────┐          │
│  │           React Frontend (Vite)                │          │
│  │  Stocks/ETFs Toggle │ Portfolio │ Market       │          │
│  └────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start (Local Run)

### 1. Generate Angel One Credentials
1. Create a free trading app at **[SmartAPI Angel One](https://smartapi.angelbroking.com/)** to get your `API Key`. Set Redirect URL to `http://127.0.0.1`.
2. Go to **[Enable TOTP](https://smartapi.angelbroking.com/enable-totp)**, enter your Client ID and MPIN, and save the 16-character authenticator secret.

### 2. Setup Project
```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/swing-stockpicker.git
cd swing-stockpicker

# 2. Install dependencies
npm install

# 3. Create environment variables
cp .env.example .env
```
Fill out the `.env` file with your Angel One credentials:
```env
ANGELONE_API_KEY=your_api_key
ANGELONE_CLIENT_ID=your_client_id
ANGELONE_PASSWORD=your_4_digit_mpin
ANGELONE_TOTP_SECRET=your_16_char_secret
PORT=3001
```

### 3. Run Application
You need **two terminals**:
```bash
# Terminal 1 — Start the backend API server
npm run server

# Terminal 2 — Start the frontend dev server
npm run dev
```
Open **http://localhost:5173** in your browser and click **"Scan Market"**.

---

## 🌐 Cloud Deployment (Render.com)

This application is configured for 1-click free deployment as a unified Monolith on **Render**.

1. Create an account on [Render.com](https://render.com).
2. Click **New +** → **Web Service** and connect your GitHub repository.
3. Configure the service:
   - **Branch**: `main`
   - **Build Command**: `npm run render-build` 
   - **Start Command**: `npm start`
4. Expand **Environment Variables** and add your 4 Angel One variables (`ANGELONE_API_KEY`, etc.).
5. Click **Create Web Service**. 

Render will automatically build the Vite static assets and start the Node.js server, exposing both the frontend UI and the backend API on a single secure public HTTPS URL.

---

## ⚠️ Disclaimer

> This software is for **educational and research purposes only**. It does not constitute financial advice. Trading in the stock market involves substantial risk of loss. Always do your own research and consult a qualified financial advisor before making any investment decisions. 

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
