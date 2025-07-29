const WebSocket = require("ws");

const ORDER_UNIT = 10;
let capitalInUse = 0;

let pendingTrades = []; // { buyPrice, sellPrice, qty, createdAt }
let activeTrades = [];
let tradeHistory = [];

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function getTime() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}

function simulateNewBuy(price) {
  if (capitalInUse + ORDER_UNIT > 100) return;

  pendingTrades.push({
    buyPrice: price,
    sellPrice: parseFloat((price * 1.001).toFixed(4)), // +0.1%
    qty: 1,
    createdAt: nowSec(),
  });
  capitalInUse += ORDER_UNIT;
  console.log(`[🎯] ${getTime()} → NEW BUY @ ${price}`);
}

const tradeSocket = new WebSocket("wss://fstream.binance.com/ws/solusdt@trade");

const depthSocket = new WebSocket(
  "wss://fstream.binance.com/ws/solusdt@depth@100ms"
);

tradeSocket.on("message", (data) => {
  const json = JSON.parse(data);
  const price = parseFloat(json.p);
  const isBuyerMaker = json.m;

  pendingTrades = pendingTrades.filter((t) => {
    const isMatch = !isBuyerMaker && price === t.buyPrice;
    if (isMatch) {
      console.log(`[✅] ${getTime()} → FILLED BUY @ ${price}`);
      activeTrades.push({ ...t, buyTime: getTime() });
      return false;
    }
    return true;
  });

  activeTrades = activeTrades.filter((t) => {
    const isSellMatch = isBuyerMaker && price >= t.sellPrice;
    if (isSellMatch) {
      console.log(`[💰] ${getTime()} → SOLD @ ${price} | Profit: 0.1`);
      tradeHistory.push({
        ...t,
        sellTime: getTime(),
        sellPrice: price,
        profit: 0.1,
      });
      capitalInUse -= ORDER_UNIT;
      return false;
    }
    return true;
  });
});

depthSocket.on("message", (data) => {
  const json = JSON.parse(data);
  if (!json.a?.length || !json.b?.length) return;
  const bestAsk = parseFloat(json.a[0][0]);
  const bestBid = parseFloat(json.b[0][0]);

  const spread = (bestAsk - bestBid).toFixed(4);

  if (spread <= 0.01) {
    simulateNewBuy(bestAsk); // BUY ở giá ask (taker)
  }
});

setInterval(() => {
  const now = nowSec();
  pendingTrades = pendingTrades.filter((t) => {
    const age = now - t.createdAt;
    if (age > 60) {
      console.log(`[⏰] ${getTime()} → CANCEL BUY @ ${t.buyPrice}`);
      capitalInUse -= ORDER_UNIT;
      return false;
    }
    return true;
  });
}, 5000);
