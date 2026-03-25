import yf from 'yahoo-finance2';

async function test(symbol) {
  try {
    const quote = await yf.quote(symbol);
    console.log(`\n=== ${symbol} ===`);
    console.log(`Price: ${quote.regularMarketPrice}`);
    console.log(`Time: ${new Date(quote.regularMarketTime).toISOString()}`);
    console.log(`Exchange: ${quote.exchange}`);
    console.log(`Market State: ${quote.marketState}`);
  } catch (err) {
    console.log(`\nError fetching ${symbol}: ${err.message}`);
  }
}

async function run() {
  await test('AAPL');
  await test('TATAMOTORS.NS');
  await test('RELIANCE.NS');
}

run();
