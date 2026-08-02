# Betting Platform — Local Prototype

Full-stack gaming platform: NestJS API · Next.js 14 frontend · PostgreSQL 16 · Redis 7 · nginx.

## Run in 3 commands

```bash
# 1. Copy environment file (edit JWT_SECRET and passwords before any real deployment)
cp .env.example .env          # .env is already provided — skip if it exists

# 2. Build images and start all services
docker compose up --build -d

# 3. Follow logs (optional)
docker compose logs -f
```

> First boot takes ~2–3 minutes while images build and Prisma migrations run.

## Service URLs

| Service          | URL                            | Notes                        |
|------------------|--------------------------------|------------------------------|
| Player UI        | http://localhost               | nginx → Next.js              |
| Admin dashboard  | http://localhost/admin         | Role: ADMIN or SUPER_ADMIN   |
| API (direct)     | http://localhost:3000/api/v1   | NestJS on port 3000          |
| API (via nginx)  | http://localhost/api/v1        | proxied through port 80      |
| Frontend (raw)   | http://localhost:3001          | Next.js before nginx         |
| PostgreSQL       | localhost:5432                 | db: betting_db user: postgres|
| Redis            | localhost:6379                 | password: redis_secret       |

## Useful commands

```bash
# Stop everything (keeps volumes)
docker compose down

# Stop and wipe all data
docker compose down -v

# Rebuild a single service after code changes
docker compose up --build backend -d

# Open a psql shell
docker exec -it betting_postgres psql -U postgres -d betting_db

# Run a new Prisma migration (development)
cd backend && npx prisma migrate dev --name <description>

# View backend logs only
docker compose logs -f backend
```

## Architecture

```
Browser
  └─ nginx :80
       ├─ /api/*  →  NestJS :3000  (global prefix: /api/v1)
       └─ /*      →  Next.js :3000 (standalone build)

NestJS
  ├─ PostgreSQL :5432  (Prisma ORM, double-entry ledger)
  └─ Redis :6379       (session cache, rate-limit counters)
```

## Environment variables

All variables live in `.env` at the repo root.  
Docker Compose reads it automatically; the backend service overrides `DATABASE_URL`  
and `REDIS_URL` to use container hostnames instead of `localhost`.

| Variable               | Default                                    |
|------------------------|--------------------------------------------|
| `POSTGRES_PASSWORD`    | `password`                                 |
| `REDIS_PASSWORD`       | `redis_secret`                             |
| `JWT_SECRET`           | ⚠️ change before any real deployment        |
| `NEXT_PUBLIC_API_URL`  | `http://localhost/api/v1`                  |
