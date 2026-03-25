import { NseIndia } from "stock-nse-india";
const nseIndia = new NseIndia();

async function run() {
  try {
    const symbol = "TATAMOTORS";
    console.log("Fetching...", symbol);
    const details = await nseIndia.getEquityDetails(symbol);
    console.log(JSON.stringify(details, null, 2));
  } catch (error) {
    console.error("Error:", error.message);
  }
}
run();
