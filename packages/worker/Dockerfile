FROM node:22-alpine AS builder

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/

RUN npm install -g pnpm@11.1.1 && \
    pnpm install --frozen-lockfile --filter @shipyard/worker...

COPY . .

RUN pnpm --filter @shipyard/shared build && \
    pnpm --filter @shipyard/worker build

FROM node:22-alpine

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/

RUN npm install -g pnpm@11.1.1 && \
    pnpm install --frozen-lockfile --prod --filter @shipyard/worker...

RUN apk add --no-cache docker-cli curl tar gzip
RUN mkdir -p /usr/local/lib/docker/cli-plugins && \
	curl -fsSL https://github.com/docker/buildx/releases/download/v0.20.0/buildx-v0.20.0.linux-amd64 \
	-o /usr/local/lib/docker/cli-plugins/docker-buildx && \
	chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
RUN curl -fsSL https://github.com/railwayapp/nixpacks/releases/download/v1.41.0/nixpacks-v1.41.0-x86_64-unknown-linux-musl.tar.gz \
	| tar -xz -C /usr/local/bin nixpacks

COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/packages/worker/dist packages/worker/dist/

ENV CI=true
CMD ["pnpm", "--filter=@shipyard/worker", "run", "start"]
