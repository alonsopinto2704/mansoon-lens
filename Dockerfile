# One image: builds the web app, trains the models at build time, serves web + API on $PORT.
FROM node:24-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN npm install -g pnpm@9.15.9 && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim
WORKDIR /app
# LightGBM needs the OpenMP runtime.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY config ./config
COPY backend ./backend
# All 781 districts need ~1.5 GB RAM at build time; on a small builder pass e.g. --build-arg DISTRICTS=250.
ARG DISTRICTS=""
RUN python -m backend.data.generate_synthetic ${DISTRICTS:+--districts $DISTRICTS} && python -m backend.data.validate && python -m backend.pipeline.train \
    && rm backend/data/synthetic.parquet
COPY --from=web /web/dist ./frontend/dist
ENV PORT=8000
EXPOSE 8000
# One worker keeps a single live-feed fetcher (Open-Meteo rate limits); threads serve concurrent requests.
CMD gunicorn --workers 1 --threads 8 --timeout 120 --bind 0.0.0.0:$PORT "backend.app:create_app()"
