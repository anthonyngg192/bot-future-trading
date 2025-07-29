# Base image dùng Node.js
FROM node:20-alpine

WORKDIR /usr/src/app

COPY . .

RUN npm install

CMD ["node", "solusdt-live.js"]