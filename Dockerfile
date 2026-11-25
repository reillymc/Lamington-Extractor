# Build stage
FROM node:24-alpine AS build

RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package*.json .
COPY tools/Scripts/generate_spec.ts ./tools/Scripts/generate_spec.ts
COPY openapi.yaml .

RUN npm ci

COPY . .

# Production stage
FROM node:24-alpine AS production

WORKDIR /home/node/app

COPY package*.json .
COPY tools/Scripts/generate_spec.ts ./tools/Scripts/generate_spec.ts

RUN npm ci --omit=dev

COPY --from=build /home/node/app/LICENCE ./LICENCE
COPY --from=build /home/node/app/openapi.yaml ./openapi.yaml
COPY --from=build /home/node/app/src ./src

RUN chown -R node:node /home/node/app

USER node

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/index.ts"]

HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=10s \
  CMD wget -qO- http://localhost:${PORT:-3001}/health || exit 1
