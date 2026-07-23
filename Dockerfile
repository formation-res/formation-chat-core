FROM node:24.11.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server-sdk/package.json packages/server-sdk/package.json
COPY connectors/haystack/package.json connectors/haystack/package.json
COPY connectors/mock/package.json connectors/mock/package.json
RUN npm ci
COPY apps/server apps/server
COPY packages/protocol packages/protocol
COPY packages/server-sdk packages/server-sdk
COPY connectors/haystack connectors/haystack
COPY connectors/mock connectors/mock
RUN npm run build --workspace @formation-chat-core/protocol
RUN npm run build --workspace @formation-chat-core/server-sdk
RUN npm run build --workspace @formation-chat-core/haystack-connector
RUN npm run build --workspace @formation-chat-core/mock-connector
RUN npm run build --workspace @formation-chat-core/server

FROM node:24.11.1-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/server-sdk/package.json packages/server-sdk/package.json
COPY connectors/haystack/package.json connectors/haystack/package.json
COPY connectors/mock/package.json connectors/mock/package.json
RUN npm ci --omit=dev
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/packages/protocol/dist packages/protocol/dist
COPY --from=build /app/packages/server-sdk/dist packages/server-sdk/dist
COPY --from=build /app/connectors/haystack/dist connectors/haystack/dist
COPY --from=build /app/connectors/haystack/schemas connectors/haystack/schemas
COPY --from=build /app/connectors/mock/dist connectors/mock/dist
USER node
CMD ["npm", "run", "start", "--workspace", "@formation-chat-core/server"]
