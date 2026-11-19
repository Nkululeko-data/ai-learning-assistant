FROM node:22.13-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./backend/
RUN cd backend && npm ci && npm rebuild better-sqlite3 --build-from-source

COPY backend ./backend
COPY docs ./docs
RUN cd backend && npm run build

FROM node:22.13-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache ca-certificates libstdc++ \
  && addgroup -S app \
  && adduser -S -G app app

COPY --from=build --chown=app:app /app/backend/package*.json ./backend/
COPY --from=build --chown=app:app /app/backend/node_modules ./backend/node_modules
COPY --from=build --chown=app:app /app/backend/dist ./backend/dist
COPY --from=build --chown=app:app /app/backend/config ./backend/config
COPY --from=build --chown=app:app /app/backend/.env.example ./backend/.env.example
COPY --from=build --chown=app:app /app/docs ./docs

RUN mkdir -p /app/backend/data \
  && chown -R app:app /app/backend/data

USER app
WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/src/server.js"]
