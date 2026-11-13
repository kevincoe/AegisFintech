import { useMemo } from 'react';
import { Layers, Lock } from 'lucide-react';
import { formatCents } from '@aegis/shared';
import type { MarketAsset, PortfolioOrder } from '../../types.js';

interface Props {
  asset: MarketAsset;
  openOrders: PortfolioOrder[];
  onSelectPriceCents: (priceCents: number) => void;
}

interface BookLevel {
  priceCents: number;
  size: number;
  cumulative: number;
  userLockedShares: number;
}

export function OrderBookDepth({
  asset,
  openOrders,
  onSelectPriceCents,
}: Props) {
  const { asks, bids, maxCumulative, spreadCents, spreadBps } = useMemo(() => {
    const mid = asset.currentPriceCents;
    const tickStep = Math.max(5, Math.round(mid * 0.0025));

    const symbolOpenOrders = openOrders.filter(
      (o) => o.symbol === asset.symbol && o.status === 'OPEN'
    );

    // Build 5 Ask levels (ascending from mid + tickStep, then reversed for top-down display)
    let askCum = 0;
    const rawAsks: BookLevel[] = [];
    for (let i = 1; i <= 5; i++) {
      const levelPrice = mid + i * tickStep;
      const baseSize = 120 + ((i * 73 + asset.symbol.charCodeAt(0) * 11) % 280);
      const userLocked = symbolOpenOrders
        .filter(
          (o) =>
            o.side === 'SELL' &&
            o.limitPriceCents !== null &&
            Math.abs(o.limitPriceCents - levelPrice) <= tickStep / 2
        )
        .reduce((acc, o) => acc + o.quantity, 0);
      const size = baseSize + userLocked;
      askCum += size;
      rawAsks.push({
        priceCents: levelPrice,
        size,
        cumulative: askCum,
        userLockedShares: userLocked,
      });
    }

    // Build 5 Bid levels (descending from mid - tickStep)
    let bidCum = 0;
    const rawBids: BookLevel[] = [];
    for (let i = 1; i <= 5; i++) {
      const levelPrice = Math.max(10, mid - i * tickStep);
      const baseSize = 140 + ((i * 89 + asset.symbol.charCodeAt(1) * 13) % 310);
      const userLocked = symbolOpenOrders
        .filter(
          (o) =>
            o.side === 'BUY' &&
            o.limitPriceCents !== null &&
            Math.abs(o.limitPriceCents - levelPrice) <= tickStep / 2
        )
        .reduce((acc, o) => acc + o.quantity, 0);
      const size = baseSize + userLocked;
      bidCum += size;
      rawBids.push({
        priceCents: levelPrice,
        size,
        cumulative: bidCum,
        userLockedShares: userLocked,
      });
    }

    const bestAsk = rawAsks[0]?.priceCents ?? mid + tickStep;
    const bestBid = rawBids[0]?.priceCents ?? mid - tickStep;
    const diff = Math.max(1, bestAsk - bestBid);
    const bps = Math.round((diff / mid) * 10000);

    return {
      asks: [...rawAsks].reverse(),
      bids: rawBids,
      maxCumulative: Math.max(askCum, bidCum, 1),
      spreadCents: diff,
      spreadBps: bps,
    };
  }, [asset.symbol, asset.currentPriceCents, openOrders]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-sky-400" aria-hidden="true" />
          <h3 className="text-sm font-bold text-white">
            Level 2 Order Book Depth ({asset.symbol})
          </h3>
        </div>
        <span className="text-[11px] text-slate-300">Click any row to set Limit Price</span>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono tabular-nums text-xs space-y-1.5">
        {/* Column Headers */}
        <div className="grid grid-cols-3 text-[10px] font-sans font-semibold uppercase tracking-wider text-slate-300 pb-1 border-b border-slate-800">
          <span>Price ({asset.currency})</span>
          <span className="text-right">Size (Shares)</span>
          <span className="text-right">Cumulative</span>
        </div>

        {/* ASKS (SELL WALL) */}
        <div className="space-y-1">
          {asks.map((lvl) => {
            const widthPct = Math.round((lvl.cumulative / maxCumulative) * 100);
            return (
              <button
                key={`ask-${lvl.priceCents}`}
                type="button"
                onClick={() => onSelectPriceCents(lvl.priceCents)}
                className="relative w-full grid grid-cols-3 items-center px-2 py-1 rounded overflow-hidden hover:bg-slate-900 transition cursor-pointer text-left"
              >
                <div
                  style={{ width: `${widthPct}%` }}
                  className="pointer-events-none absolute inset-y-0 right-0 bg-rose-500/15"
                />
                <span className="relative z-10 font-bold text-rose-400 flex items-center gap-1">
                  {formatCents(lvl.priceCents, asset.currency)}
                  {lvl.userLockedShares > 0 && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">
                      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                      {lvl.userLockedShares}
                    </span>
                  )}
                </span>
                <span className="relative z-10 text-right text-slate-200">
                  {lvl.size.toLocaleString()}
                </span>
                <span className="relative z-10 text-right text-slate-400">
                  {lvl.cumulative.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>

        {/* SPREAD DIVIDER */}
        <div className="my-1.5 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-[11px]">
          <span className="text-slate-300">
            Last:{' '}
            <strong className="text-white">
              {formatCents(asset.currentPriceCents, asset.currency)}
            </strong>
          </span>
          <span className="text-sky-300">
            Spread: {formatCents(spreadCents, asset.currency)} ({(spreadBps / 100).toFixed(2)}%)
          </span>
        </div>

        {/* BIDS (BUY WALL) */}
        <div className="space-y-1">
          {bids.map((lvl) => {
            const widthPct = Math.round((lvl.cumulative / maxCumulative) * 100);
            return (
              <button
                key={`bid-${lvl.priceCents}`}
                type="button"
                onClick={() => onSelectPriceCents(lvl.priceCents)}
                className="relative w-full grid grid-cols-3 items-center px-2 py-1 rounded overflow-hidden hover:bg-slate-900 transition cursor-pointer text-left"
              >
                <div
                  style={{ width: `${widthPct}%` }}
                  className="pointer-events-none absolute inset-y-0 right-0 bg-emerald-500/15"
                />
                <span className="relative z-10 font-bold text-emerald-400 flex items-center gap-1">
                  {formatCents(lvl.priceCents, asset.currency)}
                  {lvl.userLockedShares > 0 && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">
                      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                      {lvl.userLockedShares}
                    </span>
                  )}
                </span>
                <span className="relative z-10 text-right text-slate-200">
                  {lvl.size.toLocaleString()}
                </span>
                <span className="relative z-10 text-right text-slate-400">
                  {lvl.cumulative.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
