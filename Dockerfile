FROM --platform=$BUILDPLATFORM node:24-alpine AS deps

WORKDIR /build
COPY package.json package-lock.json /build/
RUN npm ci --omit=dev

FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json vite.config.ts tsconfig.json /app/
COPY scripts /app/scripts
COPY src /app/src
RUN npm ci && npm run build

FROM node:24-alpine AS prod

WORKDIR /app
COPY --from=deps /build/node_modules /app/node_modules
COPY --from=build /app/dist/ /app/
EXPOSE 8787
CMD ["node", "index.js"]
