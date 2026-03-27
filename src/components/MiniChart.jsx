import React, { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';

const MiniChart = ({ data }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!data || data.length === 0 || !chartContainerRef.current) return;

    try {
      const chartOptions = {
        layout: {
          backgroundColor: 'transparent',
          textColor: '#CBD5E1',
        },
        grid: {
          vertLines: { color: 'rgba(51, 65, 85, 0.4)' },
          horzLines: { color: 'rgba(51, 65, 85, 0.4)' },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { autoScale: true, borderColor: '#475569' },
        timeScale: { borderColor: '#475569', timeVisible: false },
        handleScroll: { vertTouchDrag: false },
      };

      const chart = createChart(chartContainerRef.current, chartOptions);
      chartRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#10B981', downColor: '#EF4444', 
        borderDownColor: '#EF4444', borderUpColor: '#10B981',
        wickDownColor: '#EF4444', wickUpColor: '#10B981',
      });

      // Data strict deduplication and sorting
      const uniqueDataMap = new Map();
      data.forEach(d => {
        if (!d.time || isNaN(d.open) || isNaN(d.close)) return;
        const dateStr = new Date(d.time * 1000).toISOString().split('T')[0];
        uniqueDataMap.set(dateStr, {
          time: dateStr, open: d.open, high: d.high, low: d.low, close: d.close, value: d.value
        });
      });

      const sortedData = Array.from(uniqueDataMap.values()).sort((a, b) => new Date(a.time) - new Date(b.time));
      
      candleSeries.setData(sortedData.map(d => ({
        time: d.time, open: d.open, high: d.high, low: d.low, close: d.close
      })));

      const volumeSeries = chart.addHistogramSeries({
        color: '#38BDF8', priceFormat: { type: 'volume' }, priceScaleId: ''
      });
      chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      
      volumeSeries.setData(sortedData.map(d => ({
        time: d.time, value: d.value || 0, color: d.close > d.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'
      })));

      chart.timeScale().fitContent();

      const handleResize = () => {
        if (chartContainerRef.current) {
          chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight });
        }
      };
      window.addEventListener('resize', handleResize);
      requestAnimationFrame(handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        chart.remove();
      };
    } catch (err) {
      console.error('MiniChart rendering error:', err);
      setErrorMsg(err.toString());
    }
  }, [data]);

  if (errorMsg) {
    return <div style={{ color: 'red', padding: '10px' }}>Chart Error: {errorMsg}</div>;
  }

  return <div ref={chartContainerRef} style={{ width: '100%', height: '100%', minHeight: '220px', position: 'relative' }} />;
};

export default MiniChart;
