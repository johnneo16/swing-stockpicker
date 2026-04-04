import { SmartAPI } from 'smartapi-javascript';
import { TOTP } from 'totp-generator';

/**
 * Angel One SmartAPI Data Provider
 * Provides real-time and historical data for NSE stocks and ETFs.
 */

let smartApi = null;
let sessionData = null;
let lastLoginTime = 0;
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

// Symbol token cache to avoid repeated searchScrip calls
const symbolCache = new Map();

/**
 * Initialize and authenticate with Angel One
 */
async function ensureSession() {
  const now = Date.now();

  if (smartApi && sessionData && (now - lastLoginTime) < SESSION_TTL) {
    return smartApi;
  }

  const apiKey = process.env.ANGELONE_API_KEY;
  const clientId = process.env.ANGELONE_CLIENT_ID;
  const password = process.env.ANGELONE_PASSWORD;
  const totpSecret = process.env.ANGELONE_TOTP_SECRET;

  if (!apiKey || !clientId || !password || !totpSecret) {
    throw new Error('Angel One credentials not configured.');
  }

  smartApi = new SmartAPI({ api_key: apiKey });

  // Generate TOTP (newer versions of totp-generator return a Promise)
  const totpResult = await TOTP.generate(totpSecret);
  const otp = typeof totpResult === 'object' ? totpResult.otp : totpResult;

  try {
    sessionData = await smartApi.generateSession(clientId, password, otp);

    if (!sessionData || !sessionData.data?.jwtToken) {
      throw new Error('Login failed — check credentials');
    }

    lastLoginTime = now;
    console.log(`🔐 Angel One: Logged in as ${clientId}`);
    return smartApi;
  } catch (error) {
    smartApi = null;
    sessionData = null;
    throw new Error(`Angel One login failed: ${error.message}`);
  }
}

/**
 * Search for a stock/ETF token by symbol name
 * Returns the -EQ (equity) variant by default
 */
async function searchSymbol(api, symbol) {
  // Check cache first
  if (symbolCache.has(symbol)) {
    return symbolCache.get(symbol);
  }

  try {
    const result = await api.searchScrip({ exchange: 'NSE', searchscrip: symbol });

    if (result?.data) {
      // The API logs results but returns undefined for .data
      // We need to parse the console output approach differently
      // Actually the searchScrip in this version logs but doesn't return structured data
      // Let's handle both cases
    }

    // searchScrip in this SDK version logs results but may not return them properly
    // Use a known symbol token map as primary, searchScrip as fallback
    return null;
  } catch (err) {
    console.error(`Angel One: Search failed for ${symbol}:`, err.message);
    return null;
  }
}

// Well-known NSE symbol tokens (fetched from Angel One OpenAPIScripMaster.json)
// Key = symbol used in stockUniverse / etfUniverse, Value = Angel One token
const SYMBOL_TOKENS = {
  // ── Nifty 50 / Large Cap Stocks ──────────────────────────────────────────
  'RELIANCE': '2885', 'TCS': '11536', 'HDFCBANK': '1333', 'INFY': '1594',
  'ICICIBANK': '4963', 'SBIN': '3045', 'BHARTIARTL': '10604', 'ITC': '1660',
  'HCLTECH': '7229', 'KOTAKBANK': '1922', 'LT': '11483', 'AXISBANK': '5900',
  'BAJFINANCE': '317', 'MARUTI': '10999', 'TATAMOTORS': '3456',
  'SUNPHARMA': '3351', 'TITAN': '3506', 'WIPRO': '3787', 'ONGC': '2475',
  'NTPC': '11630', 'TATASTEEL': '3499', 'BAJAJFINSV': '16675',
  'POWERGRID': '14977', 'ADANIENT': '25', 'ADANIPORTS': '15083',
  'ULTRACEMCO': '11532', 'ASIANPAINT': '236', 'DIVISLAB': '10940',
  'HINDALCO': '1363', 'JSWSTEEL': '11723', 'NESTLEIND': '17963',
  'COALINDIA': '20374', 'TECHM': '13538', 'BRITANNIA': '547',
  'HINDUNILVR': '1394', 'HEROMOTOCO': '1348', 'BAJAJ-AUTO': '16669',
  'PIDILITIND': '2664', 'SBILIFE': '21808', 'INDUSINDBK': '5258',
  'TATAPOWER': '3426', 'DRREDDY': '881', 'CIPLA': '694', 'EICHERMOT': '910',
  'APOLLOHOSP': '157', 'GRASIM': '1232', 'TRENT': '1964',
  'HDFCLIFE': '467', 'LTIM': '17818', 'DMART': '19943',

  // ── Additional Stocks (from expanded universe) ───────────────────────────
  'M&M': '2031',        // Mahindra & Mahindra
  'SRF': '3273',
  'AARTIIND': '7',
  'HINDPETRO': '1406',  // HPCL
  'BPCL': '526',
  'GAIL': '4717',
  'BEL': '383',
  'HAL': '2303',
  'DLF': '14732',
  'GODREJCP': '10099',
  'DABUR': '772',
  'COLPAL': '15141',
  'TATACONSUM': '3432',
  'TATACOMM': '3721',
  'JUBLFOOD': '18096',
  'PAGEIND': '14413',
  'BERGEPAINT': '404',
  'HAVELLS': '9819',
  'VOLTAS': '3718',
  'CUMMINSIND': '1901',
  'ABB': '13',
  'SIEMENS': '3150',
  'BHEL': '438',
  'POLYCAB': '9590',
  'KEI': '13310',
  'CHOLAFIN': '685',
  'CANBK': '10794',
  'IDFCFIRSTB': '11184',
  'FEDERALBNK': '1023',
  'AUFIL': '21238',     // AU Small Finance Bank (listed as AUBANK in Angel One)

  // ── ETFs ─────────────────────────────────────────────────────────────────
  'NIFTYBEES': '2489', 'BANKBEES': '5765', 'GOLDBEES': '16600',
  'ITBEES': '15818', 'JUNIORBEES': '10576', 'SETFNIF50': '18126',
  'PSUBNKBEES': '19105', 'LIQUIDBEES': '10730', 'SILVERBEES': '25354',
  'SETFNIFBK': '7361',   // SBI Nifty Bank ETF
  'MOM50': '19289',      // Motilal Momentum 50
  'MOM100': '21423',     // Motilal Momentum 100
  'N100': '22739',       // Motilal Nasdaq 100 (listed as MON100 in Angel One)
  'MAFANG': '3507',      // Mirae FANG+
  'HNGSNGBEES': '18284', // Nippon Hang Seng
  'DIVOPPBEES': '2636',  // Nippon Dividend Opp
  'CONSUMBEES': '2435',  // Nippon Consumption
  'PHARMABEES': '4973',  // Nippon Pharma
  'INFRABEES': '20072',  // Nippon Infra
  'HDFCGOLD': '19543',   // HDFC Gold ETF
  'GOLDCASE': '22901',   // ICICI Gold ETF
  'CPSE': '2328',        // Nippon CPSE ETF (listed as CPSEETF in Angel One)
  'NETFGILT5Y': '3172',  // Nippon Gilt 5Y (listed as GILT5YBEES in Angel One)
};

/**
 * Get symbol token for a given NSE symbol
 */
async function getSymbolToken(api, symbol) {
  if (SYMBOL_TOKENS[symbol]) {
    return { symboltoken: SYMBOL_TOKENS[symbol], tradingsymbol: `${symbol}-EQ` };
  }

  // Fallback: search via API
  try {
    const result = await api.searchScrip({ exchange: 'NSE', searchscrip: symbol });
    // The SDK logs data but may not return it in a usable format
    // For now, if not in our map, skip this symbol
    console.warn(`Angel One: Symbol ${symbol} not in token map, skipping`);
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch real-time market data for a symbol using marketData API
 */
export async function fetchAngelOneLTP(symbol) {
  try {
    const api = await ensureSession();
    const token = SYMBOL_TOKENS[symbol];
    if (!token) return null;

    const result = await api.marketData({
      mode: 'FULL',
      exchangeTokens: { NSE: [token] },
    });

    if (!result?.data?.fetched?.length) return null;
    const d = result.data.fetched[0];

    return {
      symbol,
      currentPrice: d.ltp,
      change: d.netChange || 0,
      changePercent: d.percentChange || 0,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.tradeVolume,
      symbolToken: token,
    };
  } catch (error) {
    console.error(`Angel One LTP failed for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Fetch historical candle data for a symbol
 */
export async function fetchAngelOneHistorical(symbol, days = 90) {
  try {
    const api = await ensureSession();
    const token = SYMBOL_TOKENS[symbol];
    if (!token) {
      console.warn(`Angel One: No token for ${symbol}, skipping`);
      return null;
    }

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const formatDate = (d) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} 09:15`;
    };

    const result = await api.getCandleData({
      exchange: 'NSE',
      symboltoken: token,
      interval: 'ONE_DAY',
      fromdate: formatDate(fromDate),
      todate: formatDate(toDate),
    });

    if (!result?.data?.length) return null;

    const quotes = result.data.map(candle => ({
      date: new Date(candle[0]),
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5],
    }));

    // Also get real-time LTP
    let ltp = null;
    try {
      ltp = await fetchAngelOneLTP(symbol);
    } catch (e) { /* use candle close */ }

    const lastCandle = quotes[quotes.length - 1];
    const currentPrice = ltp?.currentPrice || lastCandle.close;
    const previousClose = quotes.length > 1 ? quotes[quotes.length - 2].close : lastCandle.close;

    return {
      symbol,
      quotes,
      currentPrice,
      currentVolume: ltp?.volume || lastCandle.volume,
      previousClose,
      dayChange: ltp?.changePercent || ((currentPrice - previousClose) / previousClose * 100),
      dayHigh: ltp?.high || lastCandle.high,
      dayLow: ltp?.low || lastCandle.low,
    };
  } catch (error) {
    console.error(`Angel One historical failed for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Fetch market index data from Angel One
 */
export async function fetchAngelOneIndex(indexSymbol) {
  // Index tokens on NSE
  const indexTokens = {
    '^NSEI': '99926000',    // Nifty 50
    '^NSEBANK': '99926009', // Bank Nifty
    '^BSESN': '99919000',  // Sensex (BSE)
  };

  const indexNames = {
    '^NSEI': 'Nifty 50',
    '^NSEBANK': 'Bank Nifty',
    '^BSESN': 'Sensex',
  };

  try {
    const api = await ensureSession();
    const token = indexTokens[indexSymbol];
    if (!token) return null;

    const exchange = indexSymbol === '^BSESN' ? 'BSE' : 'NSE';

    const result = await api.marketData({
      mode: 'FULL',
      exchangeTokens: { [exchange]: [token] },
    });

    if (!result?.data?.fetched?.length) return null;
    const d = result.data.fetched[0];

    return {
      name: indexNames[indexSymbol] || indexSymbol,
      price: d.ltp,
      change: d.netChange || 0,
      changePercent: d.percentChange || 0,
      dayHigh: d.high,
      dayLow: d.low,
      volume: d.tradeVolume || 0,
    };
  } catch (error) {
    console.error(`Angel One index fetch failed for ${indexSymbol}:`, error.message);
    return null;
  }
}

/**
 * Check if Angel One credentials are configured
 */
export function isAngelOneConfigured() {
  return !!(
    process.env.ANGELONE_API_KEY &&
    process.env.ANGELONE_CLIENT_ID &&
    process.env.ANGELONE_PASSWORD &&
    process.env.ANGELONE_TOTP_SECRET
  );
}
