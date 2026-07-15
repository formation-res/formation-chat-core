FROM node:24.11.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm ci
COPY apps/server apps/server
COPY packages/protocol packages/protocol
RUN npm run build --workspace @formation-chat-core/protocol
RUN npm run build --workspace @formation-chat-core/server

FROM node:24.11.1-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm ci --omit=dev
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/packages/protocol/dist packages/protocol/dist
USER node
CMD ["npm", "run", "start", "--workspace", "@formation-chat-core/server"]
