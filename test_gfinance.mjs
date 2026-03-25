import https from 'https';

const url = "https://www.google.com/finance/quote/TATAMOTORS:NSE";
https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    import('fs').then(fs => fs.writeFileSync('gfinance.html', data));
    console.log("Saved to gfinance.html");
  });
});
