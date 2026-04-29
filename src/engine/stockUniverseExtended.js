/**
 * Extended NSE F&O universe — Nifty 200 + key F&O additions = ~200 names.
 *
 * Each entry: { symbol, sector, name, marketCap?: 'large'|'mid'|'small' }
 *
 * The liquidity filter (avgTurnover20d > ₹50 Cr) is applied at scan time
 * inside `dataFetcher.batchFetchStocks` — see `enrichWithLiquidity`.
 */

const STOCK_UNIVERSE_EXTENDED = [
  // ── Banking ──────────────────────────────────────────────────
  { symbol: 'HDFCBANK', sector: 'Banking', name: 'HDFC Bank', marketCap: 'large' },
  { symbol: 'ICICIBANK', sector: 'Banking', name: 'ICICI Bank', marketCap: 'large' },
  { symbol: 'SBIN', sector: 'Banking', name: 'State Bank of India', marketCap: 'large' },
  { symbol: 'KOTAKBANK', sector: 'Banking', name: 'Kotak Mahindra Bank', marketCap: 'large' },
  { symbol: 'AXISBANK', sector: 'Banking', name: 'Axis Bank', marketCap: 'large' },
  { symbol: 'INDUSINDBK', sector: 'Banking', name: 'IndusInd Bank', marketCap: 'large' },
  { symbol: 'BANKBARODA', sector: 'Banking', name: 'Bank of Baroda', marketCap: 'large' },
  { symbol: 'PNB', sector: 'Banking', name: 'Punjab National Bank', marketCap: 'large' },
  { symbol: 'CANBK', sector: 'Banking', name: 'Canara Bank', marketCap: 'large' },
  { symbol: 'IDFCFIRSTB', sector: 'Banking', name: 'IDFC First Bank', marketCap: 'mid' },
  { symbol: 'FEDERALBNK', sector: 'Banking', name: 'Federal Bank', marketCap: 'mid' },
  { symbol: 'AUFIL', sector: 'Banking', name: 'AU Small Finance Bank', marketCap: 'mid' },
  { symbol: 'BANDHANBNK', sector: 'Banking', name: 'Bandhan Bank', marketCap: 'mid' },
  { symbol: 'RBLBANK', sector: 'Banking', name: 'RBL Bank', marketCap: 'mid' },
  { symbol: 'IDBI', sector: 'Banking', name: 'IDBI Bank', marketCap: 'mid' },

  // ── Financial Services ───────────────────────────────────────
  { symbol: 'BAJFINANCE', sector: 'Financial Services', name: 'Bajaj Finance', marketCap: 'large' },
  { symbol: 'BAJAJFINSV', sector: 'Financial Services', name: 'Bajaj Finserv', marketCap: 'large' },
  { symbol: 'CHOLAFIN', sector: 'Financial Services', name: 'Cholamandalam Finance', marketCap: 'large' },
  { symbol: 'SHRIRAMFIN', sector: 'Financial Services', name: 'Shriram Finance', marketCap: 'large' },
  { symbol: 'SBICARD', sector: 'Financial Services', name: 'SBI Cards', marketCap: 'large' },
  { symbol: 'MUTHOOTFIN', sector: 'Financial Services', name: 'Muthoot Finance', marketCap: 'large' },
  { symbol: 'PFC', sector: 'Financial Services', name: 'Power Finance Corp', marketCap: 'large' },
  { symbol: 'RECLTD', sector: 'Financial Services', name: 'REC Limited', marketCap: 'large' },
  { symbol: 'IRFC', sector: 'Financial Services', name: 'Indian Railway Finance', marketCap: 'large' },
  { symbol: 'LTF', sector: 'Financial Services', name: 'L&T Finance', marketCap: 'mid' },
  { symbol: 'M&MFIN', sector: 'Financial Services', name: 'M&M Financial', marketCap: 'mid' },

  // ── Insurance & AMC ──────────────────────────────────────────
  { symbol: 'HDFCLIFE', sector: 'Insurance', name: 'HDFC Life Insurance', marketCap: 'large' },
  { symbol: 'SBILIFE', sector: 'Insurance', name: 'SBI Life Insurance', marketCap: 'large' },
  { symbol: 'ICICIPRULI', sector: 'Insurance', name: 'ICICI Prudential', marketCap: 'large' },
  { symbol: 'ICICIGI', sector: 'Insurance', name: 'ICICI Lombard', marketCap: 'large' },
  { symbol: 'LICI', sector: 'Insurance', name: 'LIC of India', marketCap: 'large' },
  { symbol: 'HDFCAMC', sector: 'AMC', name: 'HDFC AMC', marketCap: 'large' },
  { symbol: 'NIPPONLIFE', sector: 'AMC', name: 'Nippon Life AMC', marketCap: 'mid' },

  // ── IT ────────────────────────────────────────────────────────
  { symbol: 'TCS', sector: 'IT', name: 'Tata Consultancy Services', marketCap: 'large' },
  { symbol: 'INFY', sector: 'IT', name: 'Infosys', marketCap: 'large' },
  { symbol: 'WIPRO', sector: 'IT', name: 'Wipro', marketCap: 'large' },
  { symbol: 'HCLTECH', sector: 'IT', name: 'HCL Technologies', marketCap: 'large' },
  { symbol: 'TECHM', sector: 'IT', name: 'Tech Mahindra', marketCap: 'large' },
  { symbol: 'LTIM', sector: 'IT', name: 'LTIMindtree', marketCap: 'large' },
  { symbol: 'PERSISTENT', sector: 'IT', name: 'Persistent Systems', marketCap: 'large' },
  { symbol: 'COFORGE', sector: 'IT', name: 'Coforge', marketCap: 'large' },
  { symbol: 'MPHASIS', sector: 'IT', name: 'Mphasis', marketCap: 'mid' },
  { symbol: 'OFSS', sector: 'IT', name: 'Oracle Financial Services', marketCap: 'mid' },
  { symbol: 'KPITTECH', sector: 'IT', name: 'KPIT Technologies', marketCap: 'mid' },

  // ── Auto ─────────────────────────────────────────────────────
  { symbol: 'TATAMOTORS', sector: 'Auto', name: 'Tata Motors', marketCap: 'large' },
  { symbol: 'MARUTI', sector: 'Auto', name: 'Maruti Suzuki', marketCap: 'large' },
  { symbol: 'M&M', sector: 'Auto', name: 'Mahindra & Mahindra', marketCap: 'large' },
  { symbol: 'BAJAJ-AUTO', sector: 'Auto', name: 'Bajaj Auto', marketCap: 'large' },
  { symbol: 'EICHERMOT', sector: 'Auto', name: 'Eicher Motors', marketCap: 'large' },
  { symbol: 'HEROMOTOCO', sector: 'Auto', name: 'Hero MotoCorp', marketCap: 'large' },
  { symbol: 'TVSMOTOR', sector: 'Auto', name: 'TVS Motor', marketCap: 'large' },
  { symbol: 'ASHOKLEY', sector: 'Auto', name: 'Ashok Leyland', marketCap: 'mid' },
  { symbol: 'BHARATFORG', sector: 'Auto', name: 'Bharat Forge', marketCap: 'mid' },
  { symbol: 'MOTHERSON', sector: 'Auto', name: 'Samvardhana Motherson', marketCap: 'mid' },
  { symbol: 'BOSCHLTD', sector: 'Auto', name: 'Bosch', marketCap: 'large' },
  { symbol: 'MRF', sector: 'Auto', name: 'MRF', marketCap: 'mid' },
  { symbol: 'BALKRISIND', sector: 'Auto', name: 'Balkrishna Industries', marketCap: 'mid' },
  { symbol: 'TIINDIA', sector: 'Auto', name: 'Tube Investments', marketCap: 'mid' },
  { symbol: 'EXIDEIND', sector: 'Auto', name: 'Exide Industries', marketCap: 'mid' },

  // ── Pharma & Healthcare ──────────────────────────────────────
  { symbol: 'SUNPHARMA', sector: 'Pharma', name: 'Sun Pharma', marketCap: 'large' },
  { symbol: 'DRREDDY', sector: 'Pharma', name: "Dr. Reddy's Labs", marketCap: 'large' },
  { symbol: 'CIPLA', sector: 'Pharma', name: 'Cipla', marketCap: 'large' },
  { symbol: 'DIVISLAB', sector: 'Pharma', name: 'Divis Laboratories', marketCap: 'large' },
  { symbol: 'LUPIN', sector: 'Pharma', name: 'Lupin', marketCap: 'large' },
  { symbol: 'AUROPHARMA', sector: 'Pharma', name: 'Aurobindo Pharma', marketCap: 'large' },
  { symbol: 'TORNTPHARM', sector: 'Pharma', name: 'Torrent Pharma', marketCap: 'large' },
  { symbol: 'ZYDUSLIFE', sector: 'Pharma', name: 'Zydus Lifesciences', marketCap: 'large' },
  { symbol: 'ALKEM', sector: 'Pharma', name: 'Alkem Laboratories', marketCap: 'mid' },
  { symbol: 'BIOCON', sector: 'Pharma', name: 'Biocon', marketCap: 'mid' },
  { symbol: 'GLAND', sector: 'Pharma', name: 'Gland Pharma', marketCap: 'mid' },
  { symbol: 'ABBOTINDIA', sector: 'Pharma', name: 'Abbott India', marketCap: 'mid' },
  { symbol: 'IPCALAB', sector: 'Pharma', name: 'IPCA Labs', marketCap: 'mid' },
  { symbol: 'GLENMARK', sector: 'Pharma', name: 'Glenmark Pharma', marketCap: 'mid' },
  { symbol: 'APOLLOHOSP', sector: 'Healthcare', name: 'Apollo Hospitals', marketCap: 'large' },
  { symbol: 'MAXHEALTH', sector: 'Healthcare', name: 'Max Healthcare', marketCap: 'large' },
  { symbol: 'FORTIS', sector: 'Healthcare', name: 'Fortis Healthcare', marketCap: 'mid' },
  { symbol: 'LAURUSLABS', sector: 'Pharma', name: 'Laurus Labs', marketCap: 'mid' },

  // ── FMCG / Consumer Staples ──────────────────────────────────
  { symbol: 'HINDUNILVR', sector: 'FMCG', name: 'Hindustan Unilever', marketCap: 'large' },
  { symbol: 'ITC', sector: 'FMCG', name: 'ITC', marketCap: 'large' },
  { symbol: 'NESTLEIND', sector: 'FMCG', name: 'Nestle India', marketCap: 'large' },
  { symbol: 'BRITANNIA', sector: 'FMCG', name: 'Britannia Industries', marketCap: 'large' },
  { symbol: 'DABUR', sector: 'FMCG', name: 'Dabur', marketCap: 'large' },
  { symbol: 'GODREJCP', sector: 'FMCG', name: 'Godrej Consumer Products', marketCap: 'large' },
  { symbol: 'COLPAL', sector: 'FMCG', name: 'Colgate-Palmolive', marketCap: 'large' },
  { symbol: 'MARICO', sector: 'FMCG', name: 'Marico', marketCap: 'large' },
  { symbol: 'TATACONSUM', sector: 'FMCG', name: 'Tata Consumer Products', marketCap: 'large' },
  { symbol: 'PIDILITIND', sector: 'Specialty Chem', name: 'Pidilite Industries', marketCap: 'large' },
  { symbol: 'UBL', sector: 'FMCG', name: 'United Breweries', marketCap: 'mid' },
  { symbol: 'VBL', sector: 'FMCG', name: 'Varun Beverages', marketCap: 'large' },
  { symbol: 'PATANJALI', sector: 'FMCG', name: 'Patanjali Foods', marketCap: 'mid' },
  { symbol: 'EMAMILTD', sector: 'FMCG', name: 'Emami', marketCap: 'mid' },

  // ── Energy / Oil & Gas ───────────────────────────────────────
  { symbol: 'RELIANCE', sector: 'Oil & Gas', name: 'Reliance Industries', marketCap: 'large' },
  { symbol: 'ONGC', sector: 'Oil & Gas', name: 'Oil & Natural Gas Corp', marketCap: 'large' },
  { symbol: 'IOC', sector: 'Oil & Gas', name: 'Indian Oil Corp', marketCap: 'large' },
  { symbol: 'BPCL', sector: 'Oil & Gas', name: 'Bharat Petroleum', marketCap: 'large' },
  { symbol: 'HINDPETRO', sector: 'Oil & Gas', name: 'Hindustan Petroleum', marketCap: 'large' },
  { symbol: 'GAIL', sector: 'Oil & Gas', name: 'GAIL India', marketCap: 'large' },
  { symbol: 'PETRONET', sector: 'Oil & Gas', name: 'Petronet LNG', marketCap: 'mid' },
  { symbol: 'IGL', sector: 'Oil & Gas', name: 'Indraprastha Gas', marketCap: 'mid' },
  { symbol: 'MGL', sector: 'Oil & Gas', name: 'Mahanagar Gas', marketCap: 'mid' },
  { symbol: 'OIL', sector: 'Oil & Gas', name: 'Oil India', marketCap: 'mid' },

  // ── Power / Utilities ────────────────────────────────────────
  { symbol: 'NTPC', sector: 'Power', name: 'NTPC', marketCap: 'large' },
  { symbol: 'POWERGRID', sector: 'Power', name: 'Power Grid Corp', marketCap: 'large' },
  { symbol: 'TATAPOWER', sector: 'Power', name: 'Tata Power', marketCap: 'large' },
  { symbol: 'ADANIPOWER', sector: 'Power', name: 'Adani Power', marketCap: 'large' },
  { symbol: 'JSWENERGY', sector: 'Power', name: 'JSW Energy', marketCap: 'large' },
  { symbol: 'NHPC', sector: 'Power', name: 'NHPC', marketCap: 'mid' },
  { symbol: 'SJVN', sector: 'Power', name: 'SJVN', marketCap: 'mid' },
  { symbol: 'ADANIGREEN', sector: 'Power', name: 'Adani Green Energy', marketCap: 'large' },
  { symbol: 'TORNTPOWER', sector: 'Power', name: 'Torrent Power', marketCap: 'mid' },
  { symbol: 'CESC', sector: 'Power', name: 'CESC', marketCap: 'mid' },

  // ── Metals & Mining ──────────────────────────────────────────
  { symbol: 'TATASTEEL', sector: 'Metals', name: 'Tata Steel', marketCap: 'large' },
  { symbol: 'JSWSTEEL', sector: 'Metals', name: 'JSW Steel', marketCap: 'large' },
  { symbol: 'HINDALCO', sector: 'Metals', name: 'Hindalco Industries', marketCap: 'large' },
  { symbol: 'VEDL', sector: 'Metals', name: 'Vedanta', marketCap: 'large' },
  { symbol: 'COALINDIA', sector: 'Metals', name: 'Coal India', marketCap: 'large' },
  { symbol: 'NMDC', sector: 'Metals', name: 'NMDC', marketCap: 'large' },
  { symbol: 'JINDALSTEL', sector: 'Metals', name: 'Jindal Steel', marketCap: 'large' },
  { symbol: 'SAIL', sector: 'Metals', name: 'Steel Authority of India', marketCap: 'mid' },
  { symbol: 'NATIONALUM', sector: 'Metals', name: 'National Aluminium', marketCap: 'mid' },
  { symbol: 'APLAPOLLO', sector: 'Metals', name: 'APL Apollo Tubes', marketCap: 'mid' },
  { symbol: 'JSL', sector: 'Metals', name: 'Jindal Stainless', marketCap: 'mid' },
  { symbol: 'HINDZINC', sector: 'Metals', name: 'Hindustan Zinc', marketCap: 'large' },

  // ── Cement & Construction ────────────────────────────────────
  { symbol: 'ULTRACEMCO', sector: 'Cement', name: 'UltraTech Cement', marketCap: 'large' },
  { symbol: 'GRASIM', sector: 'Cement', name: 'Grasim Industries', marketCap: 'large' },
  { symbol: 'SHREECEM', sector: 'Cement', name: 'Shree Cement', marketCap: 'large' },
  { symbol: 'AMBUJACEM', sector: 'Cement', name: 'Ambuja Cements', marketCap: 'large' },
  { symbol: 'ACC', sector: 'Cement', name: 'ACC', marketCap: 'mid' },
  { symbol: 'DALBHARAT', sector: 'Cement', name: 'Dalmia Bharat', marketCap: 'mid' },
  { symbol: 'JKCEMENT', sector: 'Cement', name: 'JK Cement', marketCap: 'mid' },
  { symbol: 'LT', sector: 'Construction', name: 'Larsen & Toubro', marketCap: 'large' },
  { symbol: 'GMRINFRA', sector: 'Infrastructure', name: 'GMR Airports', marketCap: 'mid' },
  { symbol: 'IRCON', sector: 'Construction', name: 'IRCON International', marketCap: 'mid' },
  { symbol: 'NCC', sector: 'Construction', name: 'NCC', marketCap: 'mid' },

  // ── Capital Goods / Industrials ──────────────────────────────
  { symbol: 'SIEMENS', sector: 'Capital Goods', name: 'Siemens', marketCap: 'large' },
  { symbol: 'ABB', sector: 'Capital Goods', name: 'ABB India', marketCap: 'large' },
  { symbol: 'BHEL', sector: 'Capital Goods', name: 'BHEL', marketCap: 'mid' },
  { symbol: 'CUMMINSIND', sector: 'Capital Goods', name: 'Cummins India', marketCap: 'large' },
  { symbol: 'HAVELLS', sector: 'Capital Goods', name: 'Havells India', marketCap: 'large' },
  { symbol: 'POLYCAB', sector: 'Capital Goods', name: 'Polycab India', marketCap: 'large' },
  { symbol: 'KEI', sector: 'Capital Goods', name: 'KEI Industries', marketCap: 'mid' },
  { symbol: 'VOLTAS', sector: 'Capital Goods', name: 'Voltas', marketCap: 'large' },
  { symbol: 'CROMPTON', sector: 'Capital Goods', name: 'Crompton Greaves', marketCap: 'mid' },
  { symbol: 'DIXON', sector: 'Capital Goods', name: 'Dixon Technologies', marketCap: 'large' },
  { symbol: 'AIAENG', sector: 'Capital Goods', name: 'AIA Engineering', marketCap: 'mid' },
  { symbol: 'THERMAX', sector: 'Capital Goods', name: 'Thermax', marketCap: 'mid' },
  { symbol: 'HAL', sector: 'Defence', name: 'Hindustan Aeronautics', marketCap: 'large' },
  { symbol: 'BEL', sector: 'Defence', name: 'Bharat Electronics', marketCap: 'large' },
  { symbol: 'BDL', sector: 'Defence', name: 'Bharat Dynamics', marketCap: 'mid' },
  { symbol: 'MAZDOCK', sector: 'Defence', name: 'Mazagon Dock', marketCap: 'mid' },
  { symbol: 'COCHINSHIP', sector: 'Defence', name: 'Cochin Shipyard', marketCap: 'mid' },

  // ── Telecom & Media ──────────────────────────────────────────
  { symbol: 'BHARTIARTL', sector: 'Telecom', name: 'Bharti Airtel', marketCap: 'large' },
  { symbol: 'IDEA', sector: 'Telecom', name: 'Vodafone Idea', marketCap: 'mid' },
  { symbol: 'INDUSTOWER', sector: 'Telecom', name: 'Indus Towers', marketCap: 'large' },
  { symbol: 'TATACOMM', sector: 'Telecom', name: 'Tata Communications', marketCap: 'mid' },
  { symbol: 'ZEEL', sector: 'Media', name: 'Zee Entertainment', marketCap: 'mid' },
  { symbol: 'PVRINOX', sector: 'Media', name: 'PVR INOX', marketCap: 'mid' },
  { symbol: 'SAREGAMA', sector: 'Media', name: 'Saregama India', marketCap: 'mid' },

  // ── Consumer Discretionary / Retail ──────────────────────────
  { symbol: 'ASIANPAINT', sector: 'Paints', name: 'Asian Paints', marketCap: 'large' },
  { symbol: 'BERGEPAINT', sector: 'Paints', name: 'Berger Paints', marketCap: 'large' },
  { symbol: 'KANSAINER', sector: 'Paints', name: 'Kansai Nerolac', marketCap: 'mid' },
  { symbol: 'TITAN', sector: 'Consumer Durables', name: 'Titan Company', marketCap: 'large' },
  { symbol: 'BATAINDIA', sector: 'Consumer Durables', name: 'Bata India', marketCap: 'mid' },
  { symbol: 'TRENT', sector: 'Retail', name: 'Trent (Westside)', marketCap: 'large' },
  { symbol: 'DMART', sector: 'Retail', name: 'Avenue Supermarts', marketCap: 'large' },
  { symbol: 'JUBLFOOD', sector: 'Retail', name: 'Jubilant FoodWorks', marketCap: 'mid' },
  { symbol: 'PAGEIND', sector: 'Apparel', name: 'Page Industries', marketCap: 'large' },
  { symbol: 'NYKAA', sector: 'Retail', name: 'Nykaa', marketCap: 'mid' },
  { symbol: 'ABFRL', sector: 'Apparel', name: 'Aditya Birla Fashion', marketCap: 'mid' },
  { symbol: 'METROBRAND', sector: 'Retail', name: 'Metro Brands', marketCap: 'mid' },

  // ── Real Estate ──────────────────────────────────────────────
  { symbol: 'DLF', sector: 'Real Estate', name: 'DLF', marketCap: 'large' },
  { symbol: 'GODREJPROP', sector: 'Real Estate', name: 'Godrej Properties', marketCap: 'large' },
  { symbol: 'OBEROIRLTY', sector: 'Real Estate', name: 'Oberoi Realty', marketCap: 'large' },
  { symbol: 'PRESTIGE', sector: 'Real Estate', name: 'Prestige Estates', marketCap: 'large' },
  { symbol: 'BRIGADE', sector: 'Real Estate', name: 'Brigade Enterprises', marketCap: 'mid' },
  { symbol: 'PHOENIXLTD', sector: 'Real Estate', name: 'Phoenix Mills', marketCap: 'large' },

  // ── Chemicals & Specialty ────────────────────────────────────
  { symbol: 'SRF', sector: 'Specialty Chem', name: 'SRF', marketCap: 'large' },
  { symbol: 'PIIND', sector: 'Specialty Chem', name: 'PI Industries', marketCap: 'large' },
  { symbol: 'AARTIIND', sector: 'Specialty Chem', name: 'Aarti Industries', marketCap: 'mid' },
  { symbol: 'NAVINFLUOR', sector: 'Specialty Chem', name: 'Navin Fluorine', marketCap: 'mid' },
  { symbol: 'DEEPAKNTR', sector: 'Specialty Chem', name: 'Deepak Nitrite', marketCap: 'mid' },
  { symbol: 'TATACHEM', sector: 'Specialty Chem', name: 'Tata Chemicals', marketCap: 'mid' },
  { symbol: 'UPL', sector: 'Agrochemicals', name: 'UPL', marketCap: 'large' },
  { symbol: 'CHAMBLFERT', sector: 'Fertilizers', name: 'Chambal Fertilisers', marketCap: 'mid' },
  { symbol: 'COROMANDEL', sector: 'Fertilizers', name: 'Coromandel International', marketCap: 'mid' },

  // ── Capital Markets / Exchanges ──────────────────────────────
  { symbol: 'BSE', sector: 'Capital Markets', name: 'BSE Limited', marketCap: 'mid' },
  { symbol: 'CDSL', sector: 'Capital Markets', name: 'CDSL', marketCap: 'mid' },
  { symbol: 'CAMS', sector: 'Capital Markets', name: 'Computer Age Mgmt Services', marketCap: 'mid' },
  { symbol: 'ANGELONE', sector: 'Capital Markets', name: 'Angel One', marketCap: 'mid' },
  { symbol: 'MCX', sector: 'Capital Markets', name: 'Multi Commodity Exchange', marketCap: 'mid' },
  { symbol: 'IIFL', sector: 'Financial Services', name: 'IIFL Finance', marketCap: 'mid' },

  // ── New Age / Internet ───────────────────────────────────────
  { symbol: 'ZOMATO', sector: 'Internet', name: 'Zomato', marketCap: 'large' },
  { symbol: 'PAYTM', sector: 'Internet', name: 'Paytm (One97)', marketCap: 'mid' },
  { symbol: 'POLICYBZR', sector: 'Internet', name: 'PB Fintech', marketCap: 'mid' },

  // ── Logistics & Aviation ─────────────────────────────────────
  { symbol: 'INDIGO', sector: 'Aviation', name: 'IndiGo (InterGlobe)', marketCap: 'large' },
  { symbol: 'CONCOR', sector: 'Logistics', name: 'Container Corporation', marketCap: 'mid' },
  { symbol: 'BLUEDART', sector: 'Logistics', name: 'Blue Dart Express', marketCap: 'mid' },
  { symbol: 'DELHIVERY', sector: 'Logistics', name: 'Delhivery', marketCap: 'mid' },
];

// Liquidity filter — applied at scan time inside dataFetcher
// Stocks with avg 20-day turnover < this are skipped
export const MIN_AVG_TURNOVER_INR = 50_00_00_000; // ₹50 crore

export default STOCK_UNIVERSE_EXTENDED;
