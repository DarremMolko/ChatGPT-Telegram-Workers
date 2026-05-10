FROM --platform=$BUILDPLATFORM node:20-alpine AS deps

WORKDIR /build
COPY package.json /build/
RUN npm install --omit=dev --production

FROM node:20-alpine AS build

WORKDIR /app
COPY package.json vite.config.ts tsconfig.json /app/
COPY scripts /app/scripts
COPY src /app/src
RUN npm install && npm run build

FROM node:20-alpine AS prod

WORKDIR /app
COPY --from=deps /build/node_modules /app/node_modules
COPY --from=build /app/dist/ /app/
RUN apk add --no-cache sqlite
EXPOSE 8787
CMD ["node", "index.js"]
