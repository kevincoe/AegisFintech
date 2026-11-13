import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { formatCents } from '@aegis/shared';
import type { MarketAsset } from '../../types.js';

interface CandlePoint {
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  asset: MarketAsset;
  liveHistoryCents: number[];
}

type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D';

export function CandlestickChartCard({ asset, liveHistoryCents }: Props) {
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');

  const candles = useMemo<CandlePoint[]>(() => {
    const count = 18;
    const baseOpen = asset.openPriceCents;
    const current = asset.currentPriceCents;
    const tfMultiplier =
      timeframe === '1m'
        ? 0.4
        : timeframe === '5m'
          ? 0.75
          : timeframe === '15m'
            ? 1.1
            : timeframe === '1h'
              ? 1.6
              : 2.2;

    // Seeded deterministic generator based on symbol + timeframe
    let seed = asset.symbol
      .split('')
      .reduce((acc, ch, i) => acc + ch.charCodeAt(0) * (i + 17), 0);
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const result: CandlePoint[] = [];
    let prevClose = baseOpen;

    for (let i = 0; i < count - 1; i++) {
      const progress = (i + 1) / count;
      const targetTrend = Math.round(baseOpen + (current - baseOpen) * progress);
      const jitter = Math.round(
        (nextRand() - 0.48) * baseOpen * 0.012 * tfMultiplier
      );
      const open = prevClose;
      const close = Math.max(100, Math.round((targetTrend + open) / 2 + jitter));
      const wickUp = Math.max(
        4,
        Math.round(nextRand() * baseOpen * 0.008 * tfMultiplier)
      );
      const wickDown = Math.max(
        4,
        Math.round(nextRand() * baseOpen * 0.008 * tfMultiplier)
      );
      const high = Math.max(open, close) + wickUp;
      const low = Math.max(50, Math.min(open, close) - wickDown);
      const volume = Math.round(12_000 + nextRand() * 48_000 * tfMultiplier);

      result.push({
        label: `T-${count - 1 - i}`,
        open,
        high,
        low,
        close,
        volume,
      });
      prevClose = close;
    }

    // Final live candle incorporates real-time SSE session ticks
    const recentTicks =
      liveHistoryCents.length > 0 ? liveHistoryCents.slice(-6) : [prevClose, current];
    const liveOpen = prevClose;
    const liveClose = current;
    const liveHigh = Math.max(liveOpen, liveClose, ...recentTicks) + 5;
    const liveLow = Math.max(50, Math.min(liveOpen, liveClose, ...recentTicks) - 5);

    result.push({
      label: 'NOW',
      open: liveOpen,
      high: liveHigh,
      low: liveLow,
      close: liveClose,
      volume: Math.round(35_000 * tfMultiplier + recentTicks.length * 1_850),
    });

    return result;
  }, [asset.symbol, asset.openPriceCents, asset.currentPriceCents, timeframe, liveHistoryCents]);

  const { minPrice, maxPrice, maxVolume } = useMemo(() => {
    const lows = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    const vols = candles.map((c) => c.volume);
    const rawMin = Math.min(...lows);
    const rawMax = Math.max(...highs);
    const pad = Math.max(10, Math.round((rawMax - rawMin) * 0.12));
    return {
      minPrice: Math.max(0, rawMin - pad),
      maxPrice: rawMax + pad,
      maxVolume: Math.max(1, ...vols),
    };
  }, [candles]);

  const svgWidth = 640;
  const svgHeight = 230;
  const priceTop = 14;
  const priceBottom = 168;
  const volTop = 178;
  const volBottom = 218;

  const priceToY = (priceCents: number) => {
    const span = Math.max(1, maxPrice - minPrice);
    const ratio = (maxPrice - priceCents) / span;
    return priceTop + ratio * (priceBottom - priceTop);
  };

  const currentY = priceToY(asset.currentPriceCents);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
      {/* Header & Timeframe Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">
                {asset.symbol} — {asset.name}
              </h3>
              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-200">
                {asset.exchange} • {asset.currency}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-300 mt-0.5">
              <span>Open: {formatCents(asset.openPriceCents, asset.currency)}</span>
              <span className="text-emerald-400">
                High: {formatCents(asset.highPriceCents, asset.currency)}
              </span>
              <span className="text-rose-400">
                Low: {formatCents(asset.lowPriceCents, asset.currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Timeframe Tabs */}
        <div
          className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1"
          role="group"
          aria-label="Chart timeframe"
        >
          {(['1m', '5m', '15m', '1h', '1D'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`rounded px-2 py-1 font-mono text-[11px] font-semibold transition cursor-pointer ${
                timeframe === tf
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Native Zero-Dependency SVG OHLCV Candlestick & Volume Canvas */}
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-56 overflow-visible"
          role="img"
          aria-label={`OHLCV Candlestick chart for ${asset.symbol} at ${formatCents(asset.currentPriceCents, asset.currency)}`}
        >
          {/* Horizontal Price Gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((step) => {
            const priceVal = Math.round(maxPrice - step * (maxPrice - minPrice));
            const y = priceTop + step * (priceBottom - priceTop);
            return (
              <g key={step}>
                <line
                  x1={0}
                  y1={y}
                  x2={svgWidth - 65}
                  y2={y}
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <text
                  x={svgWidth - 60}
                  y={y + 3}
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontFamily="monospace"
                >
                  {formatCents(priceVal, asset.currency)}
                </text>
              </g>
            );
          })}

          {/* Separator between Price and Volume */}
          <line
            x1={0}
            y1={volTop - 5}
            x2={svgWidth - 65}
            y2={volTop - 5}
            stroke="#334155"
            strokeWidth={1}
          />

          {/* Candlesticks & Volume Histogram */}
          {candles.map((c, idx) => {
            const slotWidth = (svgWidth - 72) / candles.length;
            const centerX = idx * slotWidth + slotWidth / 2 + 4;
            const bodyWidth = Math.max(8, slotWidth * 0.58);
            const isBull = c.close >= c.open;
            const color = isBull ? '#10b981' : '#f43f5e';

            const highY = priceToY(c.high);
            const lowY = priceToY(c.low);
            const openY = priceToY(c.open);
            const closeY = priceToY(c.close);
            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(2.5, Math.abs(closeY - openY));

            const volHeight = (c.volume / maxVolume) * (volBottom - volTop);
            const volY = volBottom - volHeight;

            return (
              <g key={c.label}>
                {/* High-Low Wick */}
                <line
                  x1={centerX}
                  y1={highY}
                  x2={centerX}
                  y2={lowY}
                  stroke={color}
                  strokeWidth={1.5}
                />
                {/* Open-Close Body */}
                <rect
                  x={centerX - bodyWidth / 2}
                  y={bodyTop}
                  width={bodyWidth}
                  height={bodyHeight}
                  rx={1.5}
                  fill={color}
                  fillOpacity={idx === candles.length - 1 ? 1 : 0.85}
                />
                {/* Volume Bar */}
                <rect
                  x={centerX - bodyWidth / 2}
                  y={volY}
                  width={bodyWidth}
                  height={Math.max(2, volHeight)}
                  rx={1}
                  fill={color}
                  fillOpacity={0.35}
                />
              </g>
            );
          })}

          {/* Live Price Tracker Line */}
          <line
            x1={0}
            y1={currentY}
            x2={svgWidth - 65}
            y2={currentY}
            stroke="#38bdf8"
            strokeDasharray="4 2"
            strokeWidth={1.2}
          />
        </svg>
      </div>
    </div>
  );
}
