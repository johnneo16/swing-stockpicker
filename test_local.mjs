import fetch from 'node-fetch';

async function test() {
  try {
    const res = await fetch('http://localhost:3001/api/scan');
    const data = await res.json();
    const hdfc = data.trades.find(t => t.symbol === 'HDFCBANK');
    if (hdfc) {
      console.log('HDFC Bank from /api/scan:', hdfc.currentPrice, 'Date:', hdfc.date);
    } else {
      console.log('HDFCBANK not found in trades. Let me check cached data if any.');
    }
  } catch(e) { console.error("Error:", e.message); }
}

test();
