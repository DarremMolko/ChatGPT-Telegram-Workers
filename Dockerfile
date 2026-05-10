FROM --platform=$BUILDPLATFORM node:24-alpine AS deps

WORKDIR /build
COPY package.json /build/
RUN npm install --omit=dev

FROM node:24-alpine AS build

WORKDIR /app
COPY package.json vite.config.ts tsconfig.json /app/
COPY scripts /app/scripts
COPY src /app/src
RUN npm install && npm run build

FROM node:24-alpine AS prod

WORKDIR /app
COPY --from=deps /build/node_modules /app/node_modules
COPY --from=build /app/dist/ /app/
EXPOSE 8787
CMD ["node", "index.js"]
