FROM oven/bun:1.3.0-alpine

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --production

COPY . .

EXPOSE 3000

CMD ["bun", "run", "server"]
