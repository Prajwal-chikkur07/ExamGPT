# Deployment Guide

This app is easiest to deploy as three long-running services:

- Next.js frontend
- FastAPI backend
- Postgres with pgvector

The production Docker Compose file is set up for a VPS. It binds frontend and
backend only to `127.0.0.1`, so you should put Nginx, Caddy, or another reverse
proxy in front of it for HTTPS.

## 1. Server Requirements

- Ubuntu VPS with Docker and Docker Compose
- At least 2 GB RAM; 4 GB is better because sentence-transformer models load in memory
- A domain, for example:
  - `yourdomain.com` for frontend
  - `api.yourdomain.com` for backend
- Gemini API key

## 2. Copy The Project To The Server

```bash
git clone https://github.com/Prajwal-chikkur07/ExamGPT.git
cd ExamGPT
```

If your latest work is on a feature branch:

```bash
git checkout codex-gemini-vision-attachments-readme
```

## 3. Create Production Env

```bash
cp .env.production.example .env.production
nano .env.production
```

Set at least:

```bash
GEMINI_API_KEY=your_real_key
POSTGRES_PASSWORD=a_long_random_password
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
CORS_ORIGINS=https://yourdomain.com
```

Important: `NEXT_PUBLIC_API_URL` is baked into the frontend during Docker build,
so rebuild the frontend after changing it.

## 4. Start The App

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Check containers:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Check backend health locally on the server:

```bash
curl http://127.0.0.1:8001/health
```

Expected:

```json
{"status":"ok","service":"examgpt-api"}
```

## 5. Reverse Proxy Example

Use any reverse proxy you like. With Caddy, a simple config is:

```caddyfile
yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}

api.yourdomain.com {
  reverse_proxy 127.0.0.1:8001
}
```

Then reload Caddy.

## 6. Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

## 7. Backups

Back up both Postgres and uploaded files.

Database:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec db \
  pg_dump -U examgpt examgpt > examgpt-backup.sql
```

Uploads live in the Docker volume named `examgpt-uploads`.

## Platform Notes

- A VPS with Docker Compose is the simplest match for this repo.
- Render Postgres supports `pgvector` on supported Postgres versions.
- Railway has Postgres options/templates with `pgvector`.
- Vercel alone is not enough for the whole app because the backend needs FastAPI,
  system packages, persistent uploads, and Postgres with pgvector.
