FROM node:22-slim
WORKDIR /app

# Copy workspace config + relevant package.json files
COPY package.json package-lock.json ./
COPY packages/plugin-news/package.json packages/plugin-news/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY packages/shared/package.json packages/shared/
COPY packages/rss-crawler/package.json packages/rss-crawler/

RUN npm install --workspace=@pi-tree/rss-crawler --include-workspace-root --ignore-scripts

# Copy source for relevant packages
COPY packages/plugin-news/ packages/plugin-news/
COPY packages/plugin-sdk/ packages/plugin-sdk/
COPY packages/shared/ packages/shared/
COPY packages/rss-crawler/ packages/rss-crawler/

ENV PORT=3948
ENV DATA_DIR=/data

EXPOSE 3948
CMD ["npx", "tsx", "packages/rss-crawler/index.ts"]
