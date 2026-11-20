# Build stage
FROM node:24-bullseye AS build

RUN mkdir -p /home/node/app && chown -R node:node /home/node/app

WORKDIR /home/node/app

COPY package*.json .

RUN npm ci

COPY . .

RUN npm run generate:spec

# Production stage
FROM node:24-alpine AS production

WORKDIR /home/node/app

COPY package*.json .
COPY --from=build /home/node/app/LICENCE ./LICENCE

COPY --from=build /home/node/app/src ./src

RUN chown -R node:node /home/node/app

USER node

RUN npm ci --omit=dev

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "src/index.ts"]

HEALTHCHECK --interval=10s --timeout=3s --retries=5 --start-period=10s \
  CMD wget -qO- http://localhost:3001/health || exit 1
