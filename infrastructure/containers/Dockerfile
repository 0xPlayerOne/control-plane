FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS dependencies

WORKDIR /workspace

COPY package.json bun.lock bunfig.toml turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile --ignore-scripts

FROM dependencies AS build

RUN bun run build

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime

ARG APP_NAME
ENV APP_NAME=${APP_NAME} \
    APP_ENV=production \
    NODE_ENV=production

WORKDIR /workspace

COPY --from=build --chown=bun:bun /workspace /workspace
COPY --chown=bun:bun infrastructure/containers/entrypoint.sh /usr/local/bin/control-plane-entrypoint

RUN chmod 0555 /usr/local/bin/control-plane-entrypoint

USER bun

ENTRYPOINT ["/usr/local/bin/control-plane-entrypoint"]

FROM runtime AS migration

ENTRYPOINT ["bun", "--cwd=packages/database", "run", "db:migrate"]
