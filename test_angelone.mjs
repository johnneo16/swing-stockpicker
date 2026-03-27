import 'dotenv/config';
import { SmartAPI } from 'smartapi-javascript';
import { TOTP } from 'totp-generator';

async function testMarketData() {
  const apiKey = process.env.ANGELONE_API_KEY;
  const clientId = process.env.ANGELONE_CLIENT_ID;
  const password = process.env.ANGELONE_PASSWORD;
  const totpSecret = process.env.ANGELONE_TOTP_SECRET;

  const totpResult = await TOTP.generate(totpSecret);
  const otp = typeof totpResult === 'object' ? totpResult.otp : totpResult;

  const smart_api = new SmartAPI({ api_key: apiKey });
  const session = await smart_api.generateSession(clientId, password, otp);
  console.log('Login:', session.status ? '✅' : '❌');

  // Test marketData (LTP mode)
  console.log('\n--- marketData (LTP) ---');
  const ltp = await smart_api.marketData({
    mode: 'LTP',
    exchangeTokens: { NSE: ['2885'] }  // 2885 = RELIANCE
  });
  console.log(JSON.stringify(ltp, null, 2));

  // Test marketData (FULL mode)
  console.log('\n--- marketData (FULL) ---');
  const full = await smart_api.marketData({
    mode: 'FULL',
    exchangeTokens: { NSE: ['2885'] }
  });
  console.log(JSON.stringify(full, null, 2));

  // Test searchScrip
  console.log('\n--- searchScrip RELIANCE ---');
  const search = await smart_api.searchScrip({ exchange: 'NSE', searchscrip: 'RELIANCE' });
  console.log(JSON.stringify(search?.data?.slice(0, 3), null, 2));

  // Test getCandleData
  console.log('\n--- getCandleData ---');
  const candles = await smart_api.getCandleData({
    exchange: 'NSE',
    symboltoken: '2885',
    interval: 'ONE_DAY',
    fromdate: '2026-03-20 09:15',
    todate: '2026-03-27 15:30',
  });
  console.log(JSON.stringify(candles, null, 2));
}

testMarketData().catch(console.error);
