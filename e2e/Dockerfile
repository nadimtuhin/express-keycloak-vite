# tag MUST match @playwright/test in package.json, or the shipped browsers mismatch at runtime
FROM mcr.microsoft.com/playwright:v1.56.0-jammy
# docker CLI so the outage specs can stop/start the real containers (socket is bind-mounted)
RUN apt-get update && apt-get install -y --no-install-recommends docker.io \
 && rm -rf /var/lib/apt/lists/*
