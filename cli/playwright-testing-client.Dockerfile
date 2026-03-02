FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    git \
    tar \
    pbzip2 \
    nano \
    tini \
    && rm -rf /var/lib/apt/lists/*

# this is done globally to avoid reinstalling in mounted node_modules
RUN npx -y playwright@1.57.0 install --with-deps chromium

WORKDIR /playwright

COPY tests/playwright/package.json ./

# Remove local eslint plugin as it points to a path not available in Docker context
# Use npm install instead of ci to regenerate lockfile without the missing local dependency
RUN sed -i '/eslint-plugin-local/d' package.json && \
    npm install && \
    npm cache clean --force

COPY tests/playwright/ .

WORKDIR /playwright-testing-client

COPY tests/playwright-testing-client/package*.json ./

RUN npm ci && npm cache clean --force

COPY tests/playwright-testing-client/ .

COPY devops/docker-entrypoint-init/local_certs/ /etc/ssl/local_certs/

EXPOSE 3802

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3802/ping', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "./bin/www"]
