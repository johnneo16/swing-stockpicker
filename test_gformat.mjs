import axios from 'axios';
import * as cheerio from 'cheerio';

async function test(s) {
  const url = 'https://www.google.com/finance/quote/'+s;
  try {
    const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }});
    const $ = cheerio.load(res.data);
    console.log(s, $('title').text(), $('.YMlKec.fxKbKc').first().text());
  } catch (e) {
    console.log(s, 'Failed', e.message);
  }
}

async function run() {
  await test('TATAMOTORS:NSE');
  await test('NSE:TATAMOTORS');
  await test('TATAMOTORS:BOM');
  await test('BOM:TATAMOTORS');
}
run();
