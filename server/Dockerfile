# -------- client build --------
FROM node:20-alpine AS client-build
WORKDIR /client
# copy entire client tree to avoid path resolution issues
COPY client/ ./
# sanity check (will fail early with clear message if src missing)
RUN [ -f "./src/main.js" ] || (echo "ERROR: client/src/main.js missing in build context" && ls -la && exit 1)
RUN npm install --no-audit --no-fund && npm run build

# -------- server runtime --------
FROM node:20-alpine AS server
WORKDIR /app
COPY server/package.json ./package.json
RUN npm install --no-audit --no-fund
COPY server/src ./src
COPY --from=client-build /client/dist ./public
EXPOSE 2567
CMD ["npm","start"]
