import { BPS, runBars, type Bar, type BarsState } from './vendor/makefun-bars.ts';

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
  onBar(batch, state: BarsState) {
    const buys: Array<{ symbol: string; quote_units: bigint; max_slippage_bps: number }> = [];
    const sells: Array<{ symbol: string; qty: bigint; max_slippage_bps: number }> = [];

    for (const bar of batch.bars) {
      if (bar.symbol !== 'CBBTC') continue;
      const sma = pushClose(bar);
      if (batch.warmup) continue;
      if (bar.v === '0') continue;

      const held = state.held(bar.symbol);
      if (held !== undefined) {
        const value = state.value(bar.symbol, held.qty);
        const takeProfit = value * 10000n >= held.cost * (10000n + TP_BPS);
        const stopLoss = value * 10000n <= held.cost * (10000n - SL_BPS);
        if (takeProfit || stopLoss) {
          sells.push({ symbol: bar.symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else if (sma !== null) {
        const c = Number(bar.c);
        if (c <= sma * (1 - DIP_BPS / 10000)) {
          const cap = (state.equity() * BigInt(state.hello.caps.max_weight_bps)) / BPS;
          const spend = state.cash < cap ? state.cash : cap;
          if (spend >= state.minNotional) {
            buys.push({ symbol: bar.symbol, quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
          }
        }
      }
    }

    return [...sells, ...buys].slice(0, state.hello.caps.max_orders_per_bar);
  },
});
