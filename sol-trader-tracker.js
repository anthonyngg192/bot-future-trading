const WebSocket = require("ws");

const depthSocket = new WebSocket(
  "wss://fstream.binance.com/ws/solusdt@depth20@100ms"
);
const tradeSocket = new WebSocket(
  "wss://fstream.binance.com/ws/solusdt@aggTrade"
);

let currentBids = new Map();
let currentAsks = new Map();

function updateOrderBook(bids, asks) {
  currentBids.clear();
  currentAsks.clear();

  bids.forEach(([price, qty]) => {
    if (parseFloat(qty) > 0) {
      currentBids.set(price, qty);
    }
  });

  asks.forEach(([price, qty]) => {
    if (parseFloat(qty) > 0) {
      currentAsks.set(price, qty);
    }
  });
}

depthSocket.on("message", (data) => {
  const json = JSON.parse(data);
  updateOrderBook(json.b, json.a);
});

tradeSocket.on("message", (data) => {
  const trade = JSON.parse(data);
  const price = trade.p;
  const qty = trade.q;
  const isSell = trade.m;

  const side = isSell ? "SELL" : "BUY";
  const existed = isSell ? currentBids.has(price) : currentAsks.has(price);

  // Nếu giá này không còn trong depth → khả năng khớp lệnh
  if (!existed) {
    console.log(`[TRADE] ${side} ${qty} SOL @ ${price} (LIKELY MATCHED)`);
  } 
});
