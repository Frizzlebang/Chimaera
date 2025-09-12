# -------- client build --------
FROM node:20-alpine AS client-build
WORKDIR /client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# -------- server runtime --------
FROM node:20-alpine AS server
WORKDIR /app
ENV NODE_ENV=production

# deps first for better caching
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# bring in all server code (includes db/schema.sql)
COPY server/ ./

# static assets from client
COPY --from=client-build /client/dist ./public

# expose ports
EXPOSE 2567 8080

# start server (ESM entry)
CMD ["node","src/index.js"]
