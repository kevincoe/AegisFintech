import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CandlestickChart,
  Clock,
  Lock,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  formatCents,
  parseDecimalToCents,
  type CurrencyCode,
  type OrderSide,
  type OrderType,
} from '@aegis/shared';
import { apiRequest, generateIdempotencyKey } from '../../api/client.js';
import { ConfirmationModal } from '../../components/ConfirmationModal.js';
import type {
  CheckingAccount,
  CrmOverviewResponse,
  DemoUser,
  MarketAsset,
  PortfolioHolding,
  PortfolioOrder,
} from '../../types.js';
import { CandlestickChartCard } from './CandlestickChartCard.js';
import { OrderBookDepth } from './OrderBookDepth.js';

interface Props {
  currentUser: DemoUser;
  assets: MarketAsset[];
  checkingAccounts: CheckingAccount[];
  holdings: PortfolioHolding[];
  orders: PortfolioOrder[];
  crmData?: CrmOverviewResponse;
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  liveHistoryBySymbol: Record<string, number[]>;
  onRefreshData: () => void;
  onNavigateCrm?: () => void;
  onToast: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function TradingView({
  currentUser,
  assets,
  checkingAccounts,
  holdings,
  orders,
  crmData,
  selectedSymbol,
  onSelectSymbol,
  liveHistoryBySymbol,
  onRefreshData,
  onNavigateCrm,
  onToast,
}: Props) {
  const [orderSide, setOrderSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [orderQty, setOrderQty] = useState('50');
  const [limitPriceStr, setLimitPriceStr] = useState('37.00');
  const [hasClientAttestation, setHasClientAttestation] = useState(false);

  // Confirmation modal state
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [latchedOrderKey, setLatchedOrderKey] = useState('');
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  const selectedAsset =
    assets.find((a) => a.symbol === selectedSymbol) ?? assets[0];

  const settlementAccount = useMemo(
    () => checkingAccounts.find((a) => a.currency === selectedAsset?.currency),
    [checkingAccounts, selectedAsset?.currency]
  );

  const selectedHolding = useMemo(
    () => holdings.find((h) => h.symbol === selectedAsset?.symbol),
    [holdings, selectedAsset?.symbol]
  );

  // Pre-trade estimation & Fat-Finger guardrail computation
  const preTrade = useMemo(() => {
    if (!selectedAsset) return null;
    const qty = Math.max(0, parseInt(orderQty || '0', 10) || 0);
    let unitPriceCents = selectedAsset.currentPriceCents;
    if (orderType === 'LIMIT') {
      try {
        const parsed = parseDecimalToCents(limitPriceStr);
        if (parsed > 0) unitPriceCents = parsed;
      } catch {
        // Fallback to current price
      }
    }
    const grossCents = qty * unitPriceCents;
    const brokerageFeeCents = Math.max(1, Math.round((grossCents * 15) / 10000)); // 15 bps
    const totalCashRequiredCents =
      orderSide === 'BUY' ? grossCents + brokerageFeeCents : Math.max(0, grossCents - brokerageFeeCents);

    const deviationPct =
      orderType === 'LIMIT' && selectedAsset.currentPriceCents > 0
        ? ((unitPriceCents - selectedAsset.currentPriceCents) /
            selectedAsset.currentPriceCents) *
          100
        : 0;
    const isFatFingerPrice = orderType === 'LIMIT' && Math.abs(deviationPct) >= 5.0;
    const availableCashCents = settlementAccount?.availableBalanceCents ?? 0;
    const isHighAllocation =
      orderSide === 'BUY' &&
      availableCashCents > 0 &&
      totalCashRequiredCents > availableCashCents * 0.5;

    // 5-Gate Pre-Trade Concentration & Suitability Preview
    const maxConcentrationBps = crmData?.suitabilityProfile?.maxStockConcentrationBps ?? 2500;
    const riskTier = crmData?.suitabilityProfile?.riskTier ?? 'BALANCED_GROWTH';
    const kycTier = crmData?.kycProfile?.tier ?? 'TIER_2_STANDARD';
    const isKycBlocked =
      kycTier === 'TIER_0_UNVERIFIED' || kycTier === 'TIER_1_SIMPLIFIED';

    // Total liquid net worth in asset currency (approximated using BRL checking/holdings)
    const totalCashInBrl = checkingAccounts.reduce(
      (sum, a) => sum + (a.balanceInBrlCents ?? a.balanceCents),
      0
    );
    const totalHoldingsInBrl = holdings.reduce(
      (sum, h) => sum + (h.currency === 'USD' ? h.marketValueCents * 5.8 : h.marketValueCents),
      0
    );
    const liquidNetWorthInAssetCents =
      selectedAsset.currency === 'USD'
        ? Math.max(1, Math.round((totalCashInBrl + totalHoldingsInBrl) / 5.8))
        : Math.max(1, Math.round(totalCashInBrl + totalHoldingsInBrl));

    const existingHoldingCents =
      (selectedHolding?.quantity ?? 0) * selectedAsset.currentPriceCents;
    const pendingOrdersCents = orders
      .filter(
        (o) =>
          o.symbol === selectedAsset.symbol &&
          o.side === 'BUY' &&
          (o.status === 'OPEN' || o.status === 'PENDING_COMPLIANCE_APPROVAL')
      )
      .reduce(
        (sum, o) => sum + o.quantity * (o.limitPriceCents ?? selectedAsset.currentPriceCents),
        0
      );

    const projectedCommitCents =
      orderSide === 'BUY'
        ? existingHoldingCents + pendingOrdersCents + grossCents
        : existingHoldingCents;
    const projectedConcentrationBps = Math.round(
      (projectedCommitCents * 10000) / liquidNetWorthInAssetCents
    );
    const exceedsConcentrationCap =
      orderSide === 'BUY' && projectedConcentrationBps > maxConcentrationBps;
    const requiresVolatilityAttestation =
      orderSide === 'BUY' &&
      riskTier === 'CONSERVATIVE' &&
      (selectedAsset.volatilityBps ?? 120) >= 135;

    return {
      qty,
      unitPriceCents,
      grossCents,
      brokerageFeeCents,
      totalCashRequiredCents,
      deviationPct,
      isFatFingerPrice,
      isHighAllocation,
      maxConcentrationBps,
      projectedConcentrationBps,
      exceedsConcentrationCap,
      requiresVolatilityAttestation,
      riskTier,
      kycTier,
      isKycBlocked,
    };
  }, [
    selectedAsset,
    orderQty,
    orderType,
    limitPriceStr,
    orderSide,
    settlementAccount,
    crmData,
    checkingAccounts,
    holdings,
    selectedHolding,
    orders,
  ]);

  const handleApplyAllocationPreset = (fraction: number) => {
    if (!selectedAsset || !preTrade) return;
    if (orderSide === 'BUY') {
      const availCents = settlementAccount?.availableBalanceCents ?? 0;
      const budgetCents = Math.floor(availCents * fraction * 0.998); // account for 15bps fee
      const maxShares = Math.max(1, Math.floor(budgetCents / preTrade.unitPriceCents));
      setOrderQty(String(maxShares));
    } else {
      const availShares = selectedHolding?.availableQuantity ?? 0;
      const targetShares = Math.max(1, Math.floor(availShares * fraction));
      setOrderQty(String(targetShares));
    }
  };

  const handleOpenOrderReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAsset || !preTrade || preTrade.qty <= 0) {
      onToast('error', 'Enter a valid share quantity (minimum 1 share).');
      return;
    }
    if (
      orderSide === 'BUY' &&
      settlementAccount &&
      preTrade.totalCashRequiredCents > settlementAccount.availableBalanceCents
    ) {
      onToast(
        'error',
        `Insufficient available ${selectedAsset.currency} cash (${formatCents(settlementAccount.availableBalanceCents, selectedAsset.currency)}).`
      );
      return;
    }
    if (orderSide === 'SELL') {
      const availShares = selectedHolding?.availableQuantity ?? 0;
      if (preTrade.qty > availShares) {
        onToast(
          'error',
          `Insufficient available ${selectedAsset.symbol} custody shares (Available: ${availShares}).`
        );
        return;
      }
    }

    setLatchedOrderKey(generateIdempotencyKey('trade'));
    setOrderModalOpen(true);
  };

  const handleConfirmStockOrder = async () => {
    if (!selectedAsset || !preTrade || isSubmittingOrder) return;
    setIsSubmittingOrder(true);
    try {
      const res = await apiRequest<{
        order: {
          id: string;
          symbol: string;
          side: OrderSide;
          orderType: OrderType;
          quantity: number;
          status: string;
          executedPriceCents: number | null;
          currency: CurrencyCode;
        };
      }>('/api/trading/orders', {
        method: 'POST',
        idempotencyKey: latchedOrderKey,
        body: {
          symbol: selectedAsset.symbol,
          side: orderSide,
          orderType,
          quantity: preTrade.qty,
          limitPriceCents: orderType === 'LIMIT' ? preTrade.unitPriceCents : undefined,
          hasClientAttestation,
          attestationText: hasClientAttestation
            ? `Client digitally signed Gate 3 Volatility Waiver for ${selectedAsset.symbol} on Order Ticket.`
            : undefined,
        },
      });
      setOrderModalOpen(false);
      onRefreshData();
      if (res.order.status === 'FILLED') {
        onToast(
          'success',
          `Order FILLED: ${res.order.side} ${res.order.quantity} ${res.order.symbol} @ ${formatCents(res.order.executedPriceCents ?? 0, res.order.currency)}`
        );
      } else if (res.order.status === 'PENDING_COMPLIANCE_APPROVAL') {
        onToast(
          'info',
          `Gate 4 Concentration Hold: ${res.order.side} ${res.order.quantity} ${res.order.symbol} placed in Supervisory Compliance Queue with escrow reserved!`
        );
      } else {
        onToast(
          'info',
          `Limit Order OPEN in Order Book: ${res.order.side} ${res.order.quantity} ${res.order.symbol} (Escrow locked!)`
        );
      }
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      await apiRequest(`/api/trading/orders/${orderId}/cancel`, {
        method: 'POST',
      });
      onRefreshData();
      onToast('info', 'Limit order cancelled and locked escrow released.');
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  };

  const handleSetMarketPrice = async (symbol: string, newPriceCents: number) => {
    try {
      const res = await apiRequest<{ filledOrdersCount: number }>('/api/market/set-price', {
        method: 'POST',
        body: { symbol, priceCents: Math.max(100, newPriceCents) },
      });
      onRefreshData();
      if (res.filledOrdersCount > 0) {
        onToast(
          'success',
          `Price crossed limit threshold! Automatically filled ${res.filledOrdersCount} open limit order(s) for ${symbol}.`
        );
      }
    } catch (err) {
      onToast('error', (err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      {/* ====================================================================
          ROW 1: HIGH-DENSITY WATCHLIST + ORDER ENTRY TICKET
         ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Listed Equities Watchlist with Sparklines & Price Simulator */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <CandlestickChart className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                Institutional Watchlist (B3 BRL & NASDAQ USD)
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Click any ticker to inspect its OHLCV chart & Order Book, or use the{' '}
                <strong className="text-white">-3% / +3% Price Nudge</strong> buttons to trigger
                open Limit Orders!
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-300 uppercase text-[11px]">
                <tr>
                  <th className="py-2 pr-3">Ticker</th>
                  <th className="py-2 pr-3">Exchange</th>
                  <th className="py-2 pr-3 text-right">Last Price</th>
                  <th className="py-2 pr-3 text-right">24h Delta</th>
                  <th className="py-2 pr-3 text-center">24h Range</th>
                  <th className="py-2 text-right">Didactic Price Simulator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                {assets.map((asset) => {
                  const isSelected = asset.symbol === selectedSymbol;
                  const up = asset.changePercent >= 0;
                  const rangeSpan = Math.max(1, asset.highPriceCents - asset.lowPriceCents);
                  const rangePct = Math.min(
                    100,
                    Math.max(
                      0,
                      Math.round(((asset.currentPriceCents - asset.lowPriceCents) / rangeSpan) * 100)
                    )
                  );
                  return (
                    <tr
                      key={asset.symbol}
                      onClick={() => {
                        onSelectSymbol(asset.symbol);
                        setLimitPriceStr((asset.currentPriceCents / 100).toFixed(2));
                      }}
                      className={`cursor-pointer transition ${
                        isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-800/50'
                      }`}
                    >
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white">{asset.symbol}</span>
                          {asset.isRestricted && (
                            <span
                              title={`Trading Blackout: ${asset.restrictionReason}`}
                              className="inline-flex items-center gap-0.5 rounded bg-rose-500/20 border border-rose-500/40 px-1.5 py-0.5 text-[9px] font-bold text-rose-300"
                            >
                              <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                              RESTRICTED
                            </span>
                          )}
                        </div>
                        <div className="font-sans text-[11px] text-slate-300">{asset.name}</div>
                      </td>
                      <td className="py-3 pr-3">
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200 border border-slate-700">
                          {asset.exchange} ({asset.currency})
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right font-bold text-white text-sm">
                        {formatCents(asset.currentPriceCents, asset.currency)}
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${
                            up
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {up ? (
                            <TrendingUp className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <TrendingDown className="h-3 w-3" aria-hidden="true" />
                          )}
                          {up ? '+' : ''}
                          {asset.changePercent.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="w-24 mx-auto space-y-1">
                          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div
                              style={{ width: `${rangePct}%` }}
                              className={up ? 'h-full bg-emerald-400' : 'h-full bg-rose-400'}
                            />
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-300">
                            <span>{(asset.lowPriceCents / 100).toFixed(0)}</span>
                            <span>{(asset.highPriceCents / 100).toFixed(0)}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              handleSetMarketPrice(
                                asset.symbol,
                                Math.round(asset.currentPriceCents * 0.97)
                              )
                            }
                            className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20 cursor-pointer"
                            title="Drop price 3% to trigger open LIMIT BUY orders"
                          >
                            -3% Drop
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleSetMarketPrice(
                                asset.symbol,
                                Math.round(asset.currentPriceCents * 1.03)
                              )
                            }
                            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20 cursor-pointer"
                            title="Pump price 3% to trigger open LIMIT SELL orders"
                          >
                            +3% Rally
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Institutional Order Entry Ticket (Market vs Limit + Fat-Finger Guardrails) */}
        {selectedAsset && preTrade && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">
                  Order Ticket: {selectedAsset.symbol}
                </h3>
                <p className="text-xs text-slate-300">
                  {selectedAsset.name} • Settled in {selectedAsset.currency}
                </p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="text-sm font-bold text-emerald-400">
                  {formatCents(selectedAsset.currentPriceCents, selectedAsset.currency)}
                </div>
                <div className="text-[10px] text-slate-300">Live Market Price</div>
              </div>
            </div>

            <form onSubmit={handleOpenOrderReview} className="space-y-3.5">
              {/* BUY / SELL Toggle */}
              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-950 p-1 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setOrderSide('BUY')}
                  className={`rounded-md py-1.5 text-xs font-bold transition cursor-pointer ${
                    orderSide === 'BUY'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  BUY {selectedAsset.symbol}
                </button>
                <button
                  type="button"
                  onClick={() => setOrderSide('SELL')}
                  className={`rounded-md py-1.5 text-xs font-bold transition cursor-pointer ${
                    orderSide === 'SELL'
                      ? 'bg-rose-500 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  SELL {selectedAsset.symbol}
                </button>
              </div>

              {/* MARKET / LIMIT Toggle */}
              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-950 p-1 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setOrderType('MARKET')}
                  className={`rounded-md py-1.5 text-xs font-semibold transition cursor-pointer ${
                    orderType === 'MARKET'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Market (Instant Fill)
                </button>
                <button
                  type="button"
                  onClick={() => setOrderType('LIMIT')}
                  className={`rounded-md py-1.5 text-xs font-semibold transition cursor-pointer ${
                    orderType === 'LIMIT'
                      ? 'bg-slate-800 text-amber-300'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Limit (Order Book Escrow)
                </button>
              </div>

              {/* Available Cash / Shares Banner */}
              <div className="flex items-center justify-between rounded-lg bg-slate-950 px-3 py-1.5 text-[11px] font-mono tabular-nums border border-slate-800">
                <span className="text-slate-300 font-sans">
                  {orderSide === 'BUY'
                    ? `Available ${selectedAsset.currency} Buying Power:`
                    : `Available ${selectedAsset.symbol} Custody:`}
                </span>
                <span className="font-bold text-white">
                  {orderSide === 'BUY'
                    ? formatCents(
                        settlementAccount?.availableBalanceCents ?? 0,
                        selectedAsset.currency
                      )
                    : `${selectedHolding?.availableQuantity ?? 0} shares`}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="order-qty"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Quantity (Shares)
                  </label>
                  <input
                    id="order-qty"
                    type="number"
                    min={1}
                    required
                    value={orderQty}
                    onChange={(e) => setOrderQty(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-white"
                  />
                </div>

                {orderType === 'LIMIT' && (
                  <div>
                    <label
                      htmlFor="limit-price"
                      className="block text-xs font-medium text-amber-300 mb-1"
                    >
                      Limit Price ({selectedAsset.currency})
                    </label>
                    <input
                      id="limit-price"
                      type="text"
                      required
                      value={limitPriceStr}
                      onChange={(e) => setLimitPriceStr(e.target.value)}
                      className="w-full rounded-lg border border-amber-500/50 bg-slate-950 px-3 py-2 text-sm font-mono tabular-nums text-white"
                    />
                  </div>
                )}
              </div>

              {/* Quick Buying Power / Position Allocation Presets */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: '25%', val: 0.25 },
                  { label: '50%', val: 0.5 },
                  { label: '75%', val: 0.75 },
                  { label: '100%', val: 1.0 },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleApplyAllocationPreset(preset.val)}
                    className="rounded-md border border-slate-700 bg-slate-950 py-1 font-mono text-[11px] font-semibold text-slate-300 hover:border-emerald-500/50 hover:text-white transition cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Fat-Finger & High Allocation Warning Banner */}
              {(preTrade.isFatFingerPrice || preTrade.isHighAllocation) && (
                <div
                  role="alert"
                  className="rounded-xl border border-amber-500/40 bg-amber-950/25 p-3 text-xs text-amber-200 flex items-start gap-2"
                >
                  <AlertTriangle
                    className="h-4 w-4 text-amber-400 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="space-y-0.5">
                    <div className="font-bold text-amber-300">Pre-Trade Risk Advisory</div>
                    {preTrade.isFatFingerPrice && (
                      <p>
                        Limit price deviates by{' '}
                        <strong className="font-mono">
                          {preTrade.deviationPct >= 0 ? '+' : ''}
                          {preTrade.deviationPct.toFixed(2)}%
                        </strong>{' '}
                        from last traded price.
                      </p>
                    )}
                    {preTrade.isHighAllocation && (
                      <p>This order allocates over 50% of your available liquid cash.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Pre-Trade Cost Estimation */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-1.5 font-mono tabular-nums text-xs">
                <div className="flex justify-between text-slate-300">
                  <span className="font-sans">Gross Notional:</span>
                  <span>{formatCents(preTrade.grossCents, selectedAsset.currency)}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span className="font-sans">Clearing Fee (15 bps):</span>
                  <span className="text-rose-400">
                    -{formatCents(preTrade.brokerageFeeCents, selectedAsset.currency)}
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-1.5 font-bold text-white">
                  <span className="font-sans">
                    {orderSide === 'BUY' ? 'Total Cash Required:' : 'Estimated Net Proceeds:'}
                  </span>
                  <span className={orderSide === 'BUY' ? 'text-emerald-400' : 'text-sky-300'}>
                    {formatCents(preTrade.totalCashRequiredCents, selectedAsset.currency)}
                  </span>
                </div>
              </div>

              {/* 5-Gate Pre-Trade Compliance & Concentration Guardrail Box */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    5-Gate Pre-Trade Compliance
                  </span>
                  <span className="font-mono text-[10px] text-slate-300">
                    Profile: <strong className="text-emerald-300">{preTrade.riskTier}</strong>
                  </span>
                </div>

                {selectedAsset.isRestricted && (
                  <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2 text-[11px] text-rose-200 flex items-center justify-between gap-2">
                    <span>
                      <strong>Gate 2 Blackout:</strong> {selectedAsset.symbol} is restricted (
                      {selectedAsset.restrictionReason}).
                    </span>
                    {onNavigateCrm && (
                      <button
                        type="button"
                        onClick={onNavigateCrm}
                        className="shrink-0 underline text-rose-300 hover:text-white cursor-pointer"
                      >
                        Manage List
                      </button>
                    )}
                  </div>
                )}

                {orderSide === 'BUY' && (
                  <div className="space-y-1 font-mono tabular-nums">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-sans text-slate-300">
                        Gate 4 Projected Concentration:
                      </span>
                      <span
                        className={`font-bold ${
                          preTrade.exceedsConcentrationCap ? 'text-amber-300' : 'text-emerald-400'
                        }`}
                      >
                        {(preTrade.projectedConcentrationBps / 100).toFixed(1)}% / Max{' '}
                        {(preTrade.maxConcentrationBps / 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (preTrade.projectedConcentrationBps /
                                Math.max(1, preTrade.maxConcentrationBps)) *
                                100
                            )
                          )}%`,
                        }}
                        className={`h-full transition-all ${
                          preTrade.exceedsConcentrationCap ? 'bg-amber-400' : 'bg-emerald-400'
                        }`}
                      />
                    </div>
                    {preTrade.exceedsConcentrationCap && (
                      <p className="font-sans text-[10px] text-amber-300 pt-0.5">
                        Exceeds single-stock cap — order will reserve escrow in{' '}
                        <code className="font-mono">PENDING_COMPLIANCE_APPROVAL</code> for
                        Supervisory Sign-Off.
                      </p>
                    )}
                  </div>
                )}

                {preTrade.requiresVolatilityAttestation && (
                  <label className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-950/25 p-2 text-[11px] text-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasClientAttestation}
                      onChange={(e) => setHasClientAttestation(e.target.checked)}
                      className="mt-0.5 rounded border-amber-500 bg-slate-950 text-emerald-500"
                    />
                    <span>
                      <strong>Gate 3 Volatility Waiver:</strong> I attest that {selectedAsset.symbol}{' '}
                      volatility ({((selectedAsset.volatilityBps ?? 140) / 100).toFixed(2)}%) exceeds
                      my Conservative profile and accept unsolicited market risk.
                    </span>
                  </label>
                )}
              </div>

              <button
                type="submit"
                className={`w-full rounded-xl py-2.5 text-sm font-bold transition cursor-pointer ${
                  orderSide === 'BUY'
                    ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                    : 'bg-rose-500 text-white hover:bg-rose-400'
                }`}
              >
                Review & Submit {orderType} {orderSide} Order →
              </button>
            </form>
          </div>
        )}
      </div>

      {/* ====================================================================
          ROW 2: NATIVE SVG CANDLESTICK CHART + LEVEL 2 ORDER BOOK DEPTH
         ==================================================================== */}
      {selectedAsset && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <CandlestickChartCard
              asset={selectedAsset}
              liveHistoryCents={liveHistoryBySymbol[selectedAsset.symbol] ?? []}
            />
          </div>
          <div>
            <OrderBookDepth
              asset={selectedAsset}
              openOrders={orders}
              onSelectPriceCents={(priceCents) => {
                setOrderType('LIMIT');
                setLimitPriceStr((priceCents / 100).toFixed(2));
              }}
            />
          </div>
        </div>
      )}

      {/* ====================================================================
          ROW 3: CUSTODY PORTFOLIO (PREÇO MÉDIO) & ORDER EXECUTION HISTORY
         ==================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h3 className="text-base font-bold text-white mb-4">
            Custody Portfolio & Weighted Average Price (Preço Médio)
          </h3>
          {holdings.length === 0 ? (
            <p className="text-xs text-slate-300">No stock positions in custody yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead className="border-b border-slate-800 text-slate-300 uppercase text-[11px]">
                  <tr>
                    <th className="py-2 pr-2">Asset</th>
                    <th className="py-2 pr-2 text-right">Qty (Locked)</th>
                    <th className="py-2 pr-2 text-right">Avg Cost</th>
                    <th className="py-2 pr-2 text-right">Last Price</th>
                    <th className="py-2 pr-2 text-right">Unrealized P&L</th>
                    <th className="py-2 text-right">Realized P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {holdings.map((h) => (
                    <tr
                      key={h.id}
                      onClick={() => onSelectSymbol(h.symbol)}
                      className="cursor-pointer hover:bg-slate-800/40 transition"
                    >
                      <td className="py-2.5 pr-2 font-bold text-white">{h.symbol}</td>
                      <td className="py-2.5 pr-2 text-right text-slate-200">
                        {h.quantity}
                        {h.lockedQuantity > 0 && (
                          <span className="text-amber-400"> ({h.lockedQuantity}🔒)</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-2 text-right text-slate-300">
                        {formatCents(h.averagePriceCents, h.currency)}
                      </td>
                      <td className="py-2.5 pr-2 text-right text-white">
                        {formatCents(h.currentPriceCents, h.currency)}
                      </td>
                      <td
                        className={`py-2.5 pr-2 text-right font-semibold ${
                          h.unrealizedPnlCents >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {h.unrealizedPnlCents >= 0 ? '+' : ''}
                        {formatCents(h.unrealizedPnlCents, h.currency)} ({h.unrealizedPnlPercent}%)
                      </td>
                      <td
                        className={`py-2.5 text-right font-semibold ${
                          h.realizedPnlCents >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {h.realizedPnlCents >= 0 ? '+' : ''}
                        {formatCents(h.realizedPnlCents, h.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Order Book History (Open & Filled Orders) */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" aria-hidden="true" />
            Order Book & Execution History
          </h3>
          <div className="space-y-2.5 max-h-80 overflow-y-auto">
            {orders.map((ord) => (
              <div
                key={ord.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs font-mono tabular-nums"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 font-bold ${
                        ord.side === 'BUY'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-rose-500/15 text-rose-400'
                      }`}
                    >
                      {ord.side}
                    </span>
                    <span className="font-bold text-white">
                      {ord.quantity} {ord.symbol}
                    </span>
                    <span className="text-slate-300">({ord.orderType})</span>
                  </div>
                  <div className="text-[11px] text-slate-300 mt-1">
                    {ord.status === 'FILLED'
                      ? `Filled @ ${formatCents(ord.executedPriceCents ?? 0, ord.currency)} • Fee: ${formatCents(ord.feeCents, ord.currency)}`
                      : `Limit Target: ${formatCents(ord.limitPriceCents ?? 0, ord.currency)}`}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                      ord.status === 'FILLED'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : ord.status === 'OPEN'
                          ? 'bg-amber-500/20 text-amber-300'
                          : ord.status === 'PENDING_COMPLIANCE_APPROVAL'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                            : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {ord.status}
                  </span>
                  {ord.status === 'PENDING_COMPLIANCE_APPROVAL' && onNavigateCrm && (
                    <button
                      type="button"
                      onClick={onNavigateCrm}
                      className="rounded bg-sky-500/20 border border-sky-500/40 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/30 cursor-pointer"
                    >
                      Review in Compliance Desk →
                    </button>
                  )}
                  {(ord.status === 'OPEN' || ord.status === 'PENDING_COMPLIANCE_APPROVAL') && (
                    <button
                      type="button"
                      onClick={() => handleCancelOrder(ord.id)}
                      className="rounded bg-rose-500/20 border border-rose-500/40 px-2.5 py-0.5 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/30 cursor-pointer"
                    >
                      Cancel & Release Escrow
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ====================================================================
          "THE LAST HONEST MOMENT" CONFIRMATION MODAL FOR STOCK ORDERS
         ==================================================================== */}
      {selectedAsset && preTrade && settlementAccount && (
        <ConfirmationModal
          isOpen={orderModalOpen}
          onClose={() => setOrderModalOpen(false)}
          title={`Review ${orderType} ${orderSide} Order: ${selectedAsset.symbol}`}
          description={
            orderType === 'MARKET'
              ? 'Executes immediately against SYS-MARKET-CLEARING and updates Weighted Average Cost (Preço Médio).'
              : 'Places order in the Order Book and reserves escrow until market price crosses your Limit Price.'
          }
          badgeText={`${selectedAsset.exchange} • ${orderType} ${orderSide}`}
          debitDetails={
            orderSide === 'BUY'
              ? {
                  accountLabel: `${currentUser.name} (${selectedAsset.currency} Checking)`,
                  accountNumber: `#${settlementAccount.accountNumber}`,
                  amountCents: preTrade.totalCashRequiredCents,
                  currency: selectedAsset.currency,
                  balanceAfterCents:
                    settlementAccount.availableBalanceCents - preTrade.totalCashRequiredCents,
                }
              : {
                  accountLabel: `${selectedAsset.symbol} Custody Position`,
                  accountNumber: `${selectedHolding?.availableQuantity ?? 0} Shares Available`,
                  amountCents: preTrade.grossCents,
                  currency: selectedAsset.currency,
                  balanceAfterCents:
                    ((selectedHolding?.availableQuantity ?? 0) - preTrade.qty) *
                    preTrade.unitPriceCents,
                }
          }
          creditDetails={
            orderSide === 'BUY'
              ? {
                  accountLabel: `${selectedAsset.symbol} Custody Position`,
                  accountNumber: `${selectedAsset.exchange} Clearing`,
                  amountCents: preTrade.grossCents,
                  currency: selectedAsset.currency,
                  subtitle: `+${preTrade.qty} shares @ ${formatCents(preTrade.unitPriceCents, selectedAsset.currency)}`,
                }
              : {
                  accountLabel: `${currentUser.name} (${selectedAsset.currency} Checking)`,
                  accountNumber: `#${settlementAccount.accountNumber}`,
                  amountCents: preTrade.totalCashRequiredCents,
                  currency: selectedAsset.currency,
                  balanceAfterCents:
                    settlementAccount.availableBalanceCents + preTrade.totalCashRequiredCents,
                }
          }
          contractItems={[
            {
              label: 'Order Specification',
              value: `${orderSide} ${preTrade.qty} ${selectedAsset.symbol} (${orderType})`,
              highlight: true,
            },
            {
              label: orderType === 'LIMIT' ? 'Limit Execution Price' : 'Reference Market Price',
              value: formatCents(preTrade.unitPriceCents, selectedAsset.currency),
              mono: true,
            },
            {
              label: 'Brokerage & Clearing Fee (15 bps)',
              value: formatCents(preTrade.brokerageFeeCents, selectedAsset.currency),
              mono: true,
            },
          ]}
          idempotencyKey={latchedOrderKey}
          isSubmitting={isSubmittingOrder}
          onConfirm={handleConfirmStockOrder}
          confirmButtonText={`Authorize ${orderType} ${orderSide} (${preTrade.qty} ${selectedAsset.symbol})`}
        />
      )}
    </div>
  );
}
