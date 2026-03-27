// Curated universe of ~50 liquid NSE stocks across sectors
// Suffix .NS is appended for Yahoo Finance queries

const STOCK_UNIVERSE = [
  // Banking & Financial
  { symbol: 'HDFCBANK', sector: 'Banking', name: 'HDFC Bank' },
  { symbol: 'ICICIBANK', sector: 'Banking', name: 'ICICI Bank' },
  { symbol: 'SBIN', sector: 'Banking', name: 'State Bank of India' },
  { symbol: 'KOTAKBANK', sector: 'Banking', name: 'Kotak Mahindra Bank' },
  { symbol: 'AXISBANK', sector: 'Banking', name: 'Axis Bank' },
  { symbol: 'BAJFINANCE', sector: 'Financial Services', name: 'Bajaj Finance' },
  { symbol: 'HDFCLIFE', sector: 'Insurance', name: 'HDFC Life Insurance' },

  // IT
  { symbol: 'TCS', sector: 'IT', name: 'Tata Consultancy Services' },
  { symbol: 'INFY', sector: 'IT', name: 'Infosys' },
  { symbol: 'WIPRO', sector: 'IT', name: 'Wipro' },
  { symbol: 'HCLTECH', sector: 'IT', name: 'HCL Technologies' },
  { symbol: 'TECHM', sector: 'IT', name: 'Tech Mahindra' },

  // Auto
  { symbol: 'TATAMOTORS', sector: 'Auto', name: 'Tata Motors' },
  { symbol: 'MARUTI', sector: 'Auto', name: 'Maruti Suzuki' },
  { symbol: 'M&M', sector: 'Auto', name: 'Mahindra & Mahindra' },
  { symbol: 'BAJAJ-AUTO', sector: 'Auto', name: 'Bajaj Auto' },
  { symbol: 'EICHERMOT', sector: 'Auto', name: 'Eicher Motors' },

  // Pharma & Healthcare
  { symbol: 'SUNPHARMA', sector: 'Pharma', name: 'Sun Pharma' },
  { symbol: 'DRREDDY', sector: 'Pharma', name: "Dr. Reddy's Labs" },
  { symbol: 'CIPLA', sector: 'Pharma', name: 'Cipla' },
  { symbol: 'APOLLOHOSP', sector: 'Healthcare', name: 'Apollo Hospitals' },

  // Energy & Metals
  { symbol: 'RELIANCE', sector: 'Energy', name: 'Reliance Industries' },
  { symbol: 'ONGC', sector: 'Energy', name: 'ONGC' },
  { symbol: 'TATASTEEL', sector: 'Metals', name: 'Tata Steel' },
  { symbol: 'JSWSTEEL', sector: 'Metals', name: 'JSW Steel' },
  { symbol: 'HINDALCO', sector: 'Metals', name: 'Hindalco Industries' },
  { symbol: 'COALINDIA', sector: 'Mining', name: 'Coal India' },

  // FMCG
  { symbol: 'HINDUNILVR', sector: 'FMCG', name: 'Hindustan Unilever' },
  { symbol: 'ITC', sector: 'FMCG', name: 'ITC' },
  { symbol: 'NESTLEIND', sector: 'FMCG', name: 'Nestle India' },
  { symbol: 'BRITANNIA', sector: 'FMCG', name: 'Britannia Industries' },

  // Infra & Construction
  { symbol: 'LTIM', sector: 'IT', name: 'LTIMindtree' },
  { symbol: 'LT', sector: 'Infrastructure', name: 'Larsen & Toubro' },
  { symbol: 'ULTRACEMCO', sector: 'Cement', name: 'UltraTech Cement' },
  { symbol: 'ADANIENT', sector: 'Conglomerate', name: 'Adani Enterprises' },
  { symbol: 'ADANIPORTS', sector: 'Infrastructure', name: 'Adani Ports' },

  // Telecom & Media
  { symbol: 'BHARTIARTL', sector: 'Telecom', name: 'Bharti Airtel' },

  // Power & Utilities
  { symbol: 'NTPC', sector: 'Power', name: 'NTPC' },
  { symbol: 'POWERGRID', sector: 'Power', name: 'Power Grid Corp' },
  { symbol: 'TATAPOWER', sector: 'Power', name: 'Tata Power' },

  // Consumer & Retail
  { symbol: 'TITAN', sector: 'Consumer', name: 'Titan Company' },
  { symbol: 'DMART', sector: 'Retail', name: 'Avenue Supermarts' },
  { symbol: 'TRENT', sector: 'Retail', name: 'Trent' },

  // Chemicals & Materials
  { symbol: 'PIDILITIND', sector: 'Chemicals', name: 'Pidilite Industries' },
  { symbol: 'SBILIFE', sector: 'Insurance', name: 'SBI Life Insurance' },
  { symbol: 'SRF', sector: 'Chemicals', name: 'SRF' },
  { symbol: 'AARTIIND', sector: 'Chemicals', name: 'Aarti Industries' },

  // Diversified & Others
  { symbol: 'ASIANPAINT', sector: 'Consumer', name: 'Asian Paints' },
  { symbol: 'DIVISLAB', sector: 'Pharma', name: "Divi's Laboratories" },
  { symbol: 'HEROMOTOCO', sector: 'Auto', name: 'Hero MotoCorp' },
  { symbol: 'INDUSINDBK', sector: 'Banking', name: 'IndusInd Bank' },
  { symbol: 'HINDPETRO', sector: 'Energy', name: 'HPCL' },
  { symbol: 'BPCL', sector: 'Energy', name: 'BPCL' },
  { symbol: 'GAIL', sector: 'Energy', name: 'GAIL' },
  { symbol: 'BEL', sector: 'Defense', name: 'Bharat Electronics' },
  { symbol: 'HAL', sector: 'Defense', name: 'Hindustan Aeronautics' },
  { symbol: 'DLF', sector: 'Real Estate', name: 'DLF' },
  { symbol: 'GODREJCP', sector: 'FMCG', name: 'Godrej Consumer' },
  { symbol: 'DABUR', sector: 'FMCG', name: 'Dabur India' },
  { symbol: 'COLPAL', sector: 'FMCG', name: 'Colgate-Palmolive' },
  { symbol: 'TATACONSUM', sector: 'FMCG', name: 'Tata Consumer' },
  { symbol: 'TATACOMM', sector: 'Telecom', name: 'Tata Communications' },
  { symbol: 'JUBLFOOD', sector: 'Retail', name: 'Jubilant FoodWorks' },
  { symbol: 'PAGEIND', sector: 'Textiles', name: 'Page Industries' },
  { symbol: 'BERGEPAINT', sector: 'Consumer', name: 'Berger Paints' },
  { symbol: 'HAVELLS', sector: 'Consumer Durables', name: 'Havells India' },
  { symbol: 'VOLTAS', sector: 'Consumer Durables', name: 'Voltas' },
  { symbol: 'CUMMINSIND', sector: 'Engineering', name: 'Cummins India' },
  { symbol: 'ABB', sector: 'Engineering', name: 'ABB India' },
  { symbol: 'SIEMENS', sector: 'Engineering', name: 'Siemens' },
  { symbol: 'BHEL', sector: 'Engineering', name: 'BHEL' },
  { symbol: 'POLYCAB', sector: 'Electronics', name: 'Polycab India' },
  { symbol: 'KEI', sector: 'Electronics', name: 'KEI Industries' },
  { symbol: 'CHOLAFIN', sector: 'Financial Services', name: 'Cholamandalam' },
  { symbol: 'CANBK', sector: 'Banking', name: 'Canara Bank' },
  { symbol: 'IDFCFIRSTB', sector: 'Banking', name: 'IDFC First Bank' },
  { symbol: 'FEDERALBNK', sector: 'Banking', name: 'Federal Bank' },
  { symbol: 'AUFIL', sector: 'Banking', name: 'AU Small Finance' },
];

// Remove duplicates
const seen = new Set();
const UNIQUE_STOCKS = STOCK_UNIVERSE.filter(s => {
  if (seen.has(s.symbol)) return false;
  seen.add(s.symbol);
  return true;
});

export default UNIQUE_STOCKS;
