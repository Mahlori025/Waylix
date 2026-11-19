# Build from the repo root:  docker build -f packages/server/Dockerfile -t waylix-api .
FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/server packages/server
# Engine and server have no runtime dependencies beyond each other; only the compiler is needed.
RUN npm install --no-save --no-package-lock typescript@~5.9.3 @types/node@^22 \
 && npx tsc -p packages/engine/tsconfig.json \
 && mkdir -p node_modules/@waylix && cp -r packages/engine node_modules/@waylix/engine \
 && npx tsc -p packages/server/tsconfig.json

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 WAYLIX_DB=/data/waylix.db
COPY --from=build /app/packages/engine/package.json node_modules/@waylix/engine/package.json
COPY --from=build /app/packages/engine/dist node_modules/@waylix/engine/dist
COPY --from=build /app/packages/server/package.json package.json
COPY --from=build /app/packages/server/dist dist
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
