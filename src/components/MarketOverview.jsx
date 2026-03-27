import React from 'react';
import { Globe, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MarketOverview({ marketData }) {
  if (!marketData) {
    return (
      <div className="card" id="market-overview">
        <div className="card-header">
          <div className="card-title"><span className="icon"><Globe size={16} className="inline-icon text-accent"/></span> Market Overview</div>
        </div>
        <div style={{ padding: '16px 0' }}>
          <div className="loading-skeleton" style={{ height: '70px', marginBottom: '10px' }}></div>
          <div className="loading-skeleton" style={{ height: '70px' }}></div>
        </div>
      </div>
    );
  }

  const { indices, marketMood } = marketData;
  const moodClass = marketMood === 'Bullish' ? 'bullish' : marketMood === 'Bearish' ? 'bearish' : 'neutral';
  
  const getMoodIcon = () => {
    if (marketMood === 'Bullish') return <TrendingUp size={16} style={{ color: 'var(--profit)' }} />;
    if (marketMood === 'Bearish') return <TrendingDown size={16} style={{ color: 'var(--loss)' }} />;
    return <Minus size={16} style={{ color: 'var(--warning)' }} />;
  };

  return (
    <div className="card" id="market-overview">
      <div className="card-header">
        <div className="card-title"><span className="icon"><Globe size={16} className="inline-icon text-accent"/></span> Market Overview</div>
      </div>

      <div className="market-indices">
        {indices.nifty50 && (
          <IndexRow
            name="NIFTY 50"
            price={indices.nifty50.price}
            change={indices.nifty50.change}
            changePercent={indices.nifty50.changePercent}
          />
        )}
        {indices.bankNifty && (
          <IndexRow
            name="BANK NIFTY"
            price={indices.bankNifty.price}
            change={indices.bankNifty.change}
            changePercent={indices.bankNifty.changePercent}
          />
        )}
      </div>

      <div className="market-mood">
        <span className="mood-label">Market Mood</span>
        <span style={{ display: 'flex', alignItems: 'center' }}>{getMoodIcon()}</span>
        <span className={`mood-value ${moodClass}`}>{marketMood}</span>
      </div>
    </div>
  );
}

function IndexRow({ name, price, change, changePercent }) {
  const isPositive = change >= 0;
  return (
    <div className="index-row">
      <span className="index-name">{name}</span>
      <span className="index-price">{price?.toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
      <span className={`index-change ${isPositive ? 'positive' : 'negative'}`}>
        {isPositive ? '+' : ''}{changePercent?.toFixed(2)}%
      </span>
    </div>
  );
}
