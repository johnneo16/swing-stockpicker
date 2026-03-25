/**
 * Curated list of popular NSE ETFs for swing trading analysis.
 * Each ETF includes the Yahoo Finance symbol and sector/category.
 */
const ETF_UNIVERSE = [
  // Broad Market ETFs
  { symbol: 'NIFTYBEES', name: 'Nippon Nifty 50 ETF', sector: 'Broad Market', category: 'Index' },
  { symbol: 'JUNIORBEES', name: 'Nippon Nifty Next 50 ETF', sector: 'Broad Market', category: 'Index' },
  { symbol: 'SETFNIF50', name: 'SBI Nifty 50 ETF', sector: 'Broad Market', category: 'Index' },
  { symbol: 'UTINIFTETF', name: 'UTI Nifty 50 ETF', sector: 'Broad Market', category: 'Index' },

  // Bank ETFs
  { symbol: 'BANKBEES', name: 'Nippon Bank Nifty ETF', sector: 'Banking', category: 'Sectoral' },
  { symbol: 'SETFNIFBK', name: 'SBI Nifty Bank ETF', sector: 'Banking', category: 'Sectoral' },

  // IT ETFs
  { symbol: 'ITBEES', name: 'Nippon Nifty IT ETF', sector: 'IT', category: 'Sectoral' },

  // Gold ETFs
  { symbol: 'GOLDBEES', name: 'Nippon Gold ETF', sector: 'Commodities', category: 'Gold' },
  { symbol: 'GOLDCASE', name: 'ICICI Gold ETF', sector: 'Commodities', category: 'Gold' },
  { symbol: 'HDFCGOLD', name: 'HDFC Gold ETF', sector: 'Commodities', category: 'Gold' },

  // Infrastructure / PSU
  { symbol: 'INFRABEES', name: 'Nippon Nifty Infra ETF', sector: 'Infra', category: 'Sectoral' },
  { symbol: 'PSUBNKBEES', name: 'Nippon PSU Bank ETF', sector: 'Banking', category: 'Sectoral' },
  { symbol: 'CPSE', name: 'Nippon CPSE ETF', sector: 'PSU', category: 'Thematic' },

  // Consumption / Pharma
  { symbol: 'CONSUMBEES', name: 'Nippon Consumption ETF', sector: 'Consumption', category: 'Thematic' },
  { symbol: 'PHARMABEES', name: 'Nippon Pharma ETF', sector: 'Pharma', category: 'Sectoral' },

  // Midcap / Smallcap
  { symbol: 'MIDCPBEES', name: 'Nippon Midcap 150 ETF', sector: 'Midcap', category: 'Index' },
  { symbol: 'MOM50', name: 'MOTILAL Momentum 50 ETF', sector: 'Momentum', category: 'Factor' },

  // International
  { symbol: 'N100', name: 'MOTILAL Nasdaq 100 ETF', sector: 'US Tech', category: 'International' },
  { symbol: 'MAFANG', name: 'Mirae NYSE FANG+ ETF', sector: 'US Tech', category: 'International' },
  { symbol: 'HNGSNGBEES', name: 'Nippon Hang Seng ETF', sector: 'China/HK', category: 'International' },

  // Silver
  { symbol: 'SILVERBEES', name: 'Nippon Silver ETF', sector: 'Commodities', category: 'Silver' },

  // Debt/Liquid
  { symbol: 'LIQUIDBEES', name: 'Nippon Liquid ETF', sector: 'Debt', category: 'Liquid' },
  { symbol: 'NETFGILT5Y', name: 'Nippon Gilt 5Y ETF', sector: 'Debt', category: 'Gilt' },

  // Dividend / Value
  { symbol: 'DIVOPPBEES', name: 'Nippon Dividend Opportunities ETF', sector: 'Dividend', category: 'Factor' },
  { symbol: 'MOM100', name: 'MOTILAL Momentum 100 ETF', sector: 'Momentum', category: 'Factor' },
];

export default ETF_UNIVERSE;
