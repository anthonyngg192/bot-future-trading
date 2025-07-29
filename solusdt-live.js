const WebSocket = require("ws");

const CAPITAL_LIMIT = 1000;
const ORDER_UNIT = 10;

let capitalInUse = 0;
let pendingTrades = [];
let activeTrades = [];
let tradeHistory = [];
let lastPrintedTradeCount = 0;
let profit_per_process = 0;

const tradeSocket = new WebSocket(
  "wss://fstream.binance.com/ws/solusdt@aggTrade"
);
const markSocket = new WebSocket(
  "wss://fstream.binance.com/ws/solusdt@markPrice"
);
const depthSocket = new WebSocket(
  "wss://fstream.binance.com/ws/solusdt@depth20@100ms"
);

let markPrice = null;
let fundingRate = null;
let bestBid = null,
  bestAsk = null;
let bidVol = 0,
  askVol = 0;
let lastTrade = null;

function getTime() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

function getSecondsDiff(start, end) {
  if (!start || !end) return "?";
  const toSec = (t) => {
    const [h, m, s] = t.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };
  return toSec(end) - toSec(start);
}

function showSummary() {
  if (!bestBid || !bestAsk || !markPrice || !lastTrade) return;

  const spread = (parseFloat(bestAsk[0]) - parseFloat(bestBid[0])).toFixed(4);
  const liquidityRatio = (bidVol / askVol).toFixed(2);

  console.clear();
  console.log(
    `Mark Price: ${parseFloat(markPrice).toFixed(
      8
    )} | Funding Rate: ${fundingRate}`
  );
  console.log(`→ Last Trade: ${lastTrade}`);
  console.log(
    `→ Bid Vol: ${bidVol.toFixed(2)} SOL | Ask Vol: ${askVol.toFixed(
      2
    )} SOL | Liquidity Ratio: ${liquidityRatio}`
  );
  console.log(`→ Capital in use: ${capitalInUse}/${CAPITAL_LIMIT} USDT`);
  console.log(
    `→ Orders open: ${pendingTrades.length} pending | ${activeTrades.length} active`
  );
  console.log("---");

  // if (pendingTrades.length > 0) {
  //   console.log(`⏳ Pending BUY Orders:`);
  //   pendingTrades.forEach((t, i) =>
  //     console.log(
  //       ` - #${i + 1} ${t.qty} SOL @ ${t.buyPrice.toFixed(2)} (target: ${
  //         t.sellTarget
  //       }) Type: ${t.type === "Buy" ? "🟢 Long" : "🔴 Short"}`
  //     )
  //   );
  // }

  // if (activeTrades.length > 0) {
  //   console.log(`⏳ Active Orders:`);
  //   activeTrades.forEach((t, i) =>
  //     console.log(
  //       ` - #${i + 1} ${t.qty} SOL @ ${t.buyPrice.toFixed(2)} (target: ${
  //         t.sellTarget
  //       })`
  //     )
  //   );
  // }

  const sign = profit_per_process >= 0 ? "🟢 LỜI" : "🔴 LỖ";
  console.log(`\n→ Total Profit: ${profit_per_process} USDT (${sign})`);

  if (tradeHistory.length > lastPrintedTradeCount) {
    const recent = tradeHistory.slice(-10);
    console.log("\n=== HISTORY ===");
    recent.forEach((t, i) => {
      const idx = tradeHistory.length - recent.length + i + 1;
      const profitSign = parseFloat(t.profit) >= 0 ? "+" : "";
      const duration = getSecondsDiff(t.buyTime, t.sellTime);
      console.log(
        `#${idx} BUY @ ${Number(t.buy).toFixed(2)} → SELL @ ${Number(
          t.sell
        ).toFixed(2)} = PROFIT ${profitSign}${t.profit} USDT`
      );
      console.log(
        `   🕒 BUY: ${t.buyTime} | SELL: ${t.sellTime} | ΔT: ${duration}s`
      );
    });
    lastPrintedTradeCount = tradeHistory.length;
  }
}

function maybeSimulateTrade() {
  const openSlots = CAPITAL_LIMIT - capitalInUse;

  let score = 0;
  if (!bestAsk || !bestBid) {
    return;
  }
  const spread = parseFloat(bestAsk[0]) - parseFloat(bestBid[0]);
  const liquidityRatio = bidVol / askVol;
  const priceDiff = parseFloat(lastTrade.p) - parseFloat(markPrice);

  if (liquidityRatio > 4) score += 1;
  if (liquidityRatio > 5.5) score += 1;

  if (liquidityRatio < 0.4) score -= 1;

  if (spread < 0.002) score += 1;
  if (spread > 0.01) score -= 1;

  if (priceDiff > 0) score += 1;
  else if (priceDiff < 0) score -= 1;

  if (score >= 2 && openSlots > 0) {
    const buyPrice = parseFloat(bestBid[0]) - 0.01;
    const qty = parseFloat((ORDER_UNIT / buyPrice).toFixed(2));
    const sellTarget = parseFloat((buyPrice * 1.001).toFixed(4));

    buySimulator({ buyPrice, qty, sellTarget });
  }

  if (score >= 2 && openSlots > 0) {
    const buyPrice = parseFloat(bestBid[0]) - 0.01;
    const qty = parseFloat((ORDER_UNIT / buyPrice).toFixed(2));
    const sellTarget = parseFloat((buyPrice * 1.001).toFixed(4));
    buySimulator({ buyPrice, qty, sellTarget });
  } else if (score <= -2 && openSlots > 0) {
    const sellPrice = parseFloat(bestAsk[0]) + 0.01;
    const qty = parseFloat((ORDER_UNIT / sellPrice).toFixed(2));
    const buyBackTarget = parseFloat((sellPrice * 0.999).toFixed(4));

    sellSimulator({ buyPrice: sellPrice, qty, sellTarget: buyBackTarget });
  }
}

function buySimulator({ buyPrice, qty, sellTarget }) {
  const trade = {
    id: Date.now().toString(),
    buyPrice,
    qty,
    sellTarget,
    buyTime: null,
    sellTime: null,
    filledBuy: false,
    filledSell: false,
    createdAtSec: Math.floor(Date.now() / 1000),
    type: "Buy",
  };

  pendingTrades.push(trade);
  capitalInUse += ORDER_UNIT;

  console.log(
    `[🟢] ${getTime()} → MÔ PHỎNG MUA ${qty} SOL @ ${buyPrice.toFixed(
      2
    )} (target SELL @ ${sellTarget})`
  );
}

function sellSimulator({ buyPrice, qty, sellTarget }) {
  const trade = {
    id: Date.now().toString(),
    buyPrice,
    qty,
    sellTarget,
    buyTime: null,
    sellTime: null,
    filledBuy: false,
    filledSell: false,
    createdAtSec: Math.floor(Date.now() / 1000),
    type: "Sell",
  };

  pendingTrades.push(trade);
  capitalInUse += ORDER_UNIT;

  console.log(
    `[🟢] ${getTime()} → MÔ PHỎNG MUA ${qty} SOL @ ${buyPrice.toFixed(
      2
    )} (target SELL @ ${sellTarget})`
  );
}

// MARK PRICE
markSocket.on("message", (msg) => {
  const json = JSON.parse(msg);
  markPrice = json.p;
  fundingRate = (parseFloat(json.r) * 100).toFixed(4) + "%";
  showSummary();
});

// DEPTH
depthSocket.on("message", (msg) => {
  const json = JSON.parse(msg);
  const bids = json.b.slice(0, 5);
  const asks = json.a.slice(0, 5);

  bestBid = bids[0];
  bestAsk = asks[0];

  bidVol = bids.reduce((sum, [_, qty]) => sum + parseFloat(qty), 0);
  askVol = asks.reduce((sum, [_, qty]) => sum + parseFloat(qty), 0);

  showSummary();
});

// TRADES
tradeSocket.on("message", (msg) => {
  const json = JSON.parse(msg);
  const isSell = json.m;
  const side = isSell ? "SELL" : "BUY";
  lastTrade = `${side} ${json.q} SOL @ ${json.p}`;

  maybeSimulateTrade();

  // 1. Xử lý fill BUY
  pendingTrades = pendingTrades.filter((t) => {
    const currentPrice = parseFloat(json.p);

    // === Mô phỏng BUY khớp giá ===
    if (t.type === "Buy" && !t.filledBuy && currentPrice <= t.buyPrice) {
      t.filledBuy = true;
      t.buyTime = getTime();
      console.log(
        `[✅] ${t.buyTime} → BUY FILLED @ ${currentPrice} → target SELL @ ${t.sellTarget}`
      );
      activeTrades.push(t);
      return false;
    }

    // === Mô phỏng SELL (short) khớp giá ===
    if (t.type === "Sell" && !t.filledBuy && currentPrice >= t.buyPrice) {
      t.filledBuy = true;
      t.buyTime = getTime();
      console.log(
        `[✅] ${t.buyTime} → SHORT SELL FILLED @ ${currentPrice} → target BUY BACK @ ${t.sellTarget}`
      );
      activeTrades.push(t);
      return false;
    }

    return true;
  });

  // 2. Timeout những thằng chờ BUY quá lâu
  const nowSec = Math.floor(Date.now() / 1000);
  pendingTrades = pendingTrades.filter((t) => {
    const age = nowSec - t.createdAtSec;
    if (age > 60) {
      console.log(
        `[⏰] ${getTime()} → CANCEL BUY @ ${t.buyPrice.toFixed(
          2
        )} (timeout > 60s)`
      );
      capitalInUse -= ORDER_UNIT;
      return false;
    }
    return true;
  });

  // 3. Xử lý SELL target
  activeTrades = activeTrades.filter((t) => {
    const currentPrice = parseFloat(json.p);

    // === Chốt lời cho lệnh BUY ===
    if (t.type === "Buy" && !t.filledSell && currentPrice >= t.sellTarget) {
      t.filledSell = true;
      t.sellTime = getTime();

      tradeHistory.push({
        type: "Buy",
        buy: t.buyPrice,
        sell: currentPrice,
        qty: t.qty,
        profit: currentPrice - t.buyPrice,
        buyTime: t.buyTime,
        sellTime: t.sellTime,
      });

      profit_per_process += (currentPrice - t.buyPrice).toFixed(2);
      capitalInUse -= ORDER_UNIT;
      setTimeout(() => showSummary(), 10);
      return false;
    }

    // === Chốt lời cho lệnh SELL (short) ===
    if (t.type === "Sell" && !t.filledSell && currentPrice <= t.sellTarget) {
      t.filledSell = true;
      t.sellTime = getTime();

      tradeHistory.push({
        type: "Sell",
        sell: t.buyPrice, // tức là giá đã "bán khống"
        buyBack: currentPrice, // mua lại
        qty: t.qty,
        profit: t.buyPrice - currentPrice,
        sellTime: t.buyTime,
        buyBackTime: t.sellTime,
      });

      profit_per_process += t.buyPrice - currentPrice;
      capitalInUse -= ORDER_UNIT;
      setTimeout(() => showSummary(), 10);
      return false;
    }

    return true;
  });
  showSummary();
});
