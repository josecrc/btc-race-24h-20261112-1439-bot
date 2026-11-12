/**
 * Mean-reversion bot for CBBTC/USDC on 1-minute bars.
 * Buys -80 bps dips below the 60-bar SMA and exits at +80 bps TP or -80 bps SL.
 */
import { BPS, runBars, type Bar, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const WIN = 60;
const DIP_BPS = 80;
const TP_BPS = 80n;
const SL_BPS = 80n;
const MAX_SLIPPAGE_BPS = 100;

const closes: number[] = [];

function pushClose(bar: Bar): number | null {
  const c = Number(bar.c);
  closes.push(c);
  if (closes.length > WIN) closes.shift();
  if (closes.length < WIN) return null;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) sum += closes[i];
  return sum / WIN;
}

await runBars({
  onBatch(state, batch) {
    let sma: number | null = null;
    let cbbtcBar: Bar | null = null;
    for (const bar of batch.bars) {
      if (bar.symbol !== 'CBBTC') continue;
      sma = pushClose(bar);
      cbbtcBar = bar;
    }

    if (state.warmingUp || cbbtcBar === null || cbbtcBar.v === '0') return [];

    const { caps, fees } = state.hello;
    const held = state.positions.get('CBBTC');
    const orders: (SellInput | BuyInput)[] = [];

    if (held !== undefined) {
      const value = state.value('CBBTC', held.qty);
      const takeProfit = value * 10000n >= held.cost * (10000n + TP_BPS);
      const stopLoss = value * 10000n <= held.cost * (10000n - SL_BPS);
      if (takeProfit || stopLoss) {
        orders.push({ side: 'sell', symbol: 'CBBTC', qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    } else if (sma !== null) {
      const c = Number(cbbtcBar.c);
      if (c <= sma * (1 - DIP_BPS / 10000)) {
        const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
        const slice = state.cash < byWeight ? state.cash : byWeight;
        if (slice > 0n && slice >= BigInt(fees.min_notional_quote_units)) {
          orders.push({ side: 'buy', symbol: 'CBBTC', notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
    }

    return orders.slice(0, caps.max_orders_per_bar);
  },
});
