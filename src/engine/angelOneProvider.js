import { SmartAPI } from 'smartapi-javascript';
import { TOTP } from 'totp-generator';

/**
 * Angel One SmartAPI Data Provider
 * Provides real-time and historical data for NSE stocks and ETFs.
 * 
 * Setup:
 * 1. Create account at https://www.angelone.in
 * 2. Go to https://smartapi.angelone.in
 * 3. Create an app → get API Key
 * 4. Enable TOTP at https://smartapi.angelone.in/enable-totp
 * 5. Copy your TOTP secret key
 * 6. Set credentials in .env file
 */

let smartApi = null;
let sessionData = null;
let lastLoginTime = 0;
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

// Angel One symbol token mapping (NSE)
const EXCHANGE = 'NSE';

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
    throw new Error('Angel One credentials not configured. Set ANGELONE_API_KEY, ANGELONE_CLIENT_ID, ANGELONE_PASSWORD, ANGELONE_TOTP_SECRET in .env');
  }

  smartApi = new SmartAPI({ api_key: apiKey });

  // Generate TOTP
  const { otp } = TOTP.generate(totpSecret);

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
 */
async function searchSymbol(api, symbol) {
  try {
    const result = await api.searchScrip({ exchange: EXCHANGE, searchscrip: symbol });
    if (result?.data?.length > 0) {
      // Find exact match
      const exact = result.data.find(s => s.tradingsymbol === symbol) || result.data[0];
      return {
        symboltoken: exact.symboltoken,
        tradingsymbol: exact.tradingsymbol,
        name: exact.shortname || exact.tradingsymbol,
      };
    }
    return null;
  } catch (err) {
    console.error(`Angel One: Search failed for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Fetch real-time LTP and market data for a symbol
 */
export async function fetchAngelOneLTP(symbol) {
  try {
    const api = await ensureSession();
    const scrip = await searchSymbol(api, symbol);
    if (!scrip) return null;

    const ltpData = await api.getLTP({
      exchange: EXCHANGE,
      tradingsymbol: scrip.tradingsymbol,
      symboltoken: scrip.symboltoken,
    });

    if (!ltpData?.data) return null;

    return {
      symbol,
      currentPrice: ltpData.data.ltp,
      change: ltpData.data.change || 0,
      changePercent: ltpData.data.changepercent || 0,
      open: ltpData.data.open,
      high: ltpData.data.high,
      low: ltpData.data.low,
      close: ltpData.data.close,
      volume: ltpData.data.volume,
      symbolToken: scrip.symboltoken,
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
    const scrip = await searchSymbol(api, symbol);
    if (!scrip) return null;

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const formatDate = (d) => {
      return d.toISOString().split('T')[0] + ' 09:15';
    };

    const result = await api.getCandleData({
      exchange: EXCHANGE,
      symboltoken: scrip.symboltoken,
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
  // Map common index names to Angel One symbols
  const indexMap = {
    '^NSEI': 'Nifty 50',
    '^NSEBANK': 'Nifty Bank',
    '^BSESN': 'SENSEX',
  };

  try {
    const api = await ensureSession();
    const searchName = indexMap[indexSymbol] || indexSymbol;
    const result = await api.searchScrip({ exchange: 'NSE', searchscrip: searchName });

    if (!result?.data?.length) return null;

    const scrip = result.data[0];
    const ltpData = await api.getLTP({
      exchange: 'NSE',
      tradingsymbol: scrip.tradingsymbol,
      symboltoken: scrip.symboltoken,
    });

    if (!ltpData?.data) return null;

    return {
      name: searchName,
      price: ltpData.data.ltp,
      change: ltpData.data.change || 0,
      changePercent: ltpData.data.changepercent || 0,
      dayHigh: ltpData.data.high,
      dayLow: ltpData.data.low,
      volume: ltpData.data.volume,
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
