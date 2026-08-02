# BetPlatform — Setup Guide

## Requirements

Install these before starting:

- [Node.js 20+](https://nodejs.org) — download LTS version
- [PostgreSQL 16](https://www.postgresql.org/download/windows/) — set password to `password` during install
- [Git](https://git-scm.com/download/win) — optional but recommended

---

## Step 1 — Extract the zip

Unzip `betting-platform.zip` to any folder, e.g. `C:\betting`

---

## Step 2 — Set up the database

1. Open **Start menu** → search **SQL Shell (psql)** → open it
2. Press **Enter** 4 times to accept defaults
3. Type your postgres password
4. Run these commands:

```sql
CREATE DATABASE betting_db;
\q
```

---

## Step 3 — Set up the backend

Open PowerShell and run:

```
cd C:\betting\backend
npm install
cp .env.example .env
```

Now open `.env` in Notepad:
```
notepad .env
```

Find this line and update the password to match your PostgreSQL password:
```
DATABASE_URL="postgresql://postgres:password@localhost:5432/betting_db?schema=public"
```

Also set a JWT secret (any random string):
```
JWT_SECRET=your_random_secret_string_here
JWT_REFRESH_SECRET=another_random_secret_string_here
```

Save and close Notepad.

Now run the database migrations:
```
npx prisma migrate deploy
npx prisma db seed
```

---

## Step 4 — Start the backend

```
cd C:\betting\backend
npm run start:dev
```

Wait until you see:
```
Server running on http://localhost:3000/api/v1
```

Keep this window open.

---

## Step 5 — Set up the frontend

Open a **new** PowerShell window:

```
cd C:\betting\frontend
npm install
npm run dev
```

Wait until you see:
```
Ready on http://localhost:3001
```

Keep this window open.

---

## Step 6 — Open the platform

Open your browser and go to:

| Page | URL |
|---|---|
| Player platform | http://localhost:3001 |
| Admin dashboard | http://localhost:3001/admin |
| API docs | http://localhost:3000/api/v1/docs |

---

## Login credentials

| Field | Value |
|---|---|
| Email | betplatformhq@gmail.com |
| Password | Admin@12345 |
| Role | SUPER_ADMIN |

---

## Verify your account (first time only)

If login says "please verify your email", open PowerShell and run:

```
Invoke-WebRequest -Uri "http://localhost:3000/api/v1/auth/dev/verify/betplatformhq@gmail.com" -Method POST -UseBasicParsing
```

Then try logging in again.

---

## Stopping the servers

Just close both PowerShell windows.

## Starting again next time

Open two PowerShell windows and run:

**Window 1:**
```
cd C:\betting\backend
npm run start:dev
```

**Window 2:**
```
cd C:\betting\frontend
npm run dev
```

---

## Troubleshooting

**Cannot connect to database**
- Make sure PostgreSQL is running (check Windows Services)
- Check your password in `.env` matches what you set during PostgreSQL install

**Port already in use**
```
netstat -ano | findstr :3000
taskkill /PID <PID_NUMBER> /F
```

**npm install fails**
- Make sure Node.js 20+ is installed: `node --version`
- Delete `node_modules` folder and try again

**Games not showing**
- Make sure backend is running and migrations ran successfully
- Check http://localhost:3000/api/v1/provider/html5/games in your browser

---

## Platform features

- 10 playable HTML5 games (slots, puzzle, cards, dice and more)
- Real wallet system with double-entry accounting
- Admin dashboard (users, payments, reports, analytics)
- VIP system, bonus engine, referral system
- JWT authentication with refresh tokens
- 321 backend unit tests
