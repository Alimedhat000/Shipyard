FROM node:22-alpine AS builder

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/

RUN npm install -g pnpm@10.33.2 && \
    pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @shipyard/shared build && \
    pnpm --filter @shipyard/worker build

FROM node:22-alpine

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/

RUN npm install -g pnpm@10.33.2 && \
    pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/packages/worker/dist packages/worker/dist/

CMD ["pnpm", "--filter=@shipyard/worker", "run", "start"]
