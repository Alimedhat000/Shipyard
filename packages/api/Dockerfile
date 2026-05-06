FROM node:22-alpine AS builder

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

RUN npm install -g pnpm@10.33.2 && \
    pnpm install --frozen-lockfile --filter @shipyard/api...

COPY . .

RUN pnpm --filter @shipyard/shared build && \
    pnpm --filter @shipyard/api build

FROM node:22-alpine

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

RUN npm install -g pnpm@10.33.2 && \
    pnpm install --frozen-lockfile --prod --filter @shipyard/api...

COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/packages/api/dist packages/api/dist/
COPY --from=builder /app/drizzle drizzle/

EXPOSE 3000

CMD ["pnpm", "--filter=@shipyard/api", "run", "start"]
