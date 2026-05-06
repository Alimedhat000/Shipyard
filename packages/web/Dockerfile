FROM node:22-alpine AS builder

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

RUN npm install -g pnpm@10.33.2 && \
    pnpm install --frozen-lockfile --prod --filter @shipyard/web...

COPY . .

RUN pnpm --filter @shipyard/web build

FROM nginx:alpine

COPY --from=builder /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf