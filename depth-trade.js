const WebSocket = require("ws");

const SYMBOL = "solusdt";

const depthWs = new WebSocket(`wss://fstream.binance.com/ws/${SYMBOL}@depth`);
const tradeWs = new WebSocket(`wss://fstream.binance.com/ws/${SYMBOL}@trade`);

let lastBids = {};
let lastAsks = {};

let recentTrades = []; // keep 2s window

tradeWs.on("message", (raw) => {
  const msg = JSON.parse(raw);
  const price = msg.p;
  const qty = parseFloat(msg.q);
  const ts = Date.now();

  recentTrades.push({ price, qty, ts });

  // Keep last 2 seconds only
  const cutoff = ts - 2000;
  recentTrades = recentTrades.filter((t) => t.ts > cutoff);
});

depthWs.on("message", (raw) => {
  const msg = JSON.parse(raw);
  const bids = msg.b || [];
  const asks = msg.a || [];

  detect_loss(bids, lastBids, "BID");
  detect_loss(asks, lastAsks, "ASK");

  lastBids = toMap(bids);
  lastAsks = toMap(asks);
});

function detect_loss(currentLevels, lastMap, side) {
  const matchedTargets = new Map();
  const current = toMap(currentLevels);
  for (const price in lastMap) {
    const prev = parseFloat(lastMap[price] || "0");
    const now = parseFloat(current[price] || "0");

    if (now < prev) {
      const delta = (prev - now).toFixed(3);

      // Check if a recent trade matched this price
      const matched = recentTrades.find((t) => t.price === price);
      if (!matched) continue;

      const tag = "✅ MATCHED";

      const target =
        side === "ASK"
          ? (parseFloat(price) * 1.001).toFixed(2) // đặt bán cao hơn chút
          : (parseFloat(price) * 0.99).toFixed(2);

      //   console.log(`[${side}] ${price} ↓ ${delta} ${tag}, target: ${target}`);

      matchedTargets.set(target, { side, originalPrice: price });
    }
  }

  // Giai đoạn 2: kiểm tra nếu có lệnh trade nào khớp giá với target đã lưu
  for (const trade of recentTrades) {
    const match = matchedTargets.get(trade.price);
    if (match) {
      const isReversed =
        (side === "ASK" && match.side === "BID") ||
        (side === "BID" && match.side === "ASK");
  
      if (isReversed) {
        console.log(
          `🎯 FULL MATCH! Trade at ${trade.price} completes cycle from ${match.side} → ${side} (origin: ${match.originalPrice})`
        );
  
        // Optionally: remove matched target so nó không bị log lại
        matchedTargets.delete(trade.price);
      }
    }
  }
}

function toMap(levels) {
  const out = {};
  for (const [price, qty] of levels) {
    out[price] = qty;
  }
  return out;
}
