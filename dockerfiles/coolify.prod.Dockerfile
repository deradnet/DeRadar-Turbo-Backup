# === STAGE 1: Build ===
FROM node:23.11.0 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# === STAGE 2: Production ===
FROM node:23.11.0-slim

WORKDIR /app
RUN mkdir -p /data && touch /data/db.sqlite && chmod -R 777 /data

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=1937

EXPOSE 1937

ENTRYPOINT ["node", "dist/main.js"]
