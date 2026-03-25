import axios from 'axios';
import * as cheerio from 'cheerio';

async function getLivePrice(symbol, exchange) {
  try {
    const url = `https://www.google.com/finance/quote/${symbol}:${exchange}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    const $ = cheerio.load(response.data);
    const title = $('title').text();
    const priceText = $('.YMlKec.fxKbKc').first().text();
    
    console.log(`\nURL: ${url}`);
    console.log(`Title: ${title}`);
    console.log(`Raw Price: "${priceText}"`);
    
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error.message);
  }
}

async function run() {
  await getLivePrice('TATAMOTORS', 'NSE');
  await getLivePrice('RELIANCE', 'NSE');
}

run();
