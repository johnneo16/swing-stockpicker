import axios from 'axios';
import * as cheerio from 'cheerio';

async function run() {
  const symbol = 'HDFCBANK';
  const exchange = 'NSE';
  const url = `https://www.google.com/finance/quote/${symbol}:${exchange}`;
  try {
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(res.data);
    console.log("URL:", url);
    console.log("Title:", $('title').text());
    console.log("Price element (YMlKec fxKbKc):", $('.YMlKec.fxKbKc').first().text());
    
    // Check other prices
    $('.YMlKec').each((i, el) => {
      console.log(`Other YMlKec [${i}]:`, $(el).text());
    });

  } catch (err) {
    console.error(err.message);
  }
}

run();
