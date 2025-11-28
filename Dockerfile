FROM oven/bun:1.3.0-slim

RUN apt-get update && apt-get install -y cron && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .

RUN echo '#!/bin/sh\n\
cd /app\n\
echo "$(date): Starting transaction batch" >> /var/log/cron.log\n\
bun run index.js "$@" >> /var/log/cron.log 2>&1\n\
echo "$(date): Finished transaction batch" >> /var/log/cron.log\n\
' > /app/run-transaction.sh && chmod +x /app/run-transaction.sh

# Setup cron job (default: daily at 2 AM UTC)
# Override with CRON_SCHEDULE environment variable
RUN echo '0 2 * * * root /app/run-transaction.sh ${TX_ARGS} >> /var/log/cron.log 2>&1' > /etc/cron.d/linea-cron && \
    chmod 0644 /etc/cron.d/linea-cron && \
    touch /var/log/cron.log

RUN echo '#!/bin/sh\n\
if [ -n "$CRON_SCHEDULE" ]; then\n\
  echo "$CRON_SCHEDULE root /app/run-transaction.sh ${TX_ARGS} >> /var/log/cron.log 2>&1" > /etc/cron.d/linea-cron\n\
  chmod 0644 /etc/cron.d/linea-cron\n\
fi\n\
crontab /etc/cron.d/linea-cron\n\
echo "Starting cron with schedule: $(cat /etc/cron.d/linea-cron)"\n\
cron\n\
tail -f /var/log/cron.log\n\
' > /entrypoint.sh && chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]
