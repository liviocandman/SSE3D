<h1 align="center">⚡ SSE3D API — Solar Explorer 3D Backend</h1>

<p align="center">
  <strong>FastAPI backend providing ephemeris data, AI-powered astronomy Q&A, and user management</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-0.115.8-009688?logo=fastapi" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python" alt="Python"/>
  <img src="https://img.shields.io/badge/PostgreSQL-async-4169E1?logo=postgresql" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/Redis-Upstash-DC382D?logo=redis" alt="Redis"/>
  <img src="https://img.shields.io/badge/Gemini-2.0_Flash-4285F4?logo=google" alt="Gemini"/>
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [API Endpoints](#-api-endpoints)
- [External Integrations](#-external-integrations)
- [Authentication Flow](#-authentication-flow)
- [Database Schema](#-database-schema)
- [Caching Strategy](#-caching-strategy)
- [Rate Limiting](#-rate-limiting)
- [Error Handling](#-error-handling)
- [Project Structure](#-project-structure)
- [Testing](#-testing)
- [Deployment](#-deployment)

---

## 🔭 Overview

The SSE3D API is the Python backend for the Solar Explorer 3D project. It serves as the data layer and business logic engine, handling:

- **Ephemeris data retrieval** from NASA's JPL Horizons system (with Redis caching and JSON fallback)
- **AI-powered question answering** via Google Gemini for the Virtual Astronomer feature
- **User authentication** with OAuth identity linking (Google/GitHub via BFF JWT)
- **Favorites management** for saving and retrieving AI Q&A pairs
- **Rate limiting** to prevent API abuse

The API follows a **resilience-first design** — every external dependency has a fallback mechanism to ensure the application continues to function even when third-party services are unavailable.

---

## 🚀 Quick Start

### Prerequisites

- Python ≥ 3.12
- API keys: Google Gemini, Upstash Redis
- (Optional) PostgreSQL database (Neon recommended)

### Installation

```bash
cd sse3d-api

# Create virtual environment
python -m venv venv

# Activate
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run migrations (if using PostgreSQL)
alembic upgrade head

# Start the server
uvicorn app.main:app --reload --port 8000
```

### Interactive API Docs

Once running, visit:
- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)

---

## ⚙ Configuration

All configuration is managed through environment variables, loaded via Pydantic Settings.

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | ✅ | — | Google Gemini API key |
| `GEMINI_MODEL` | ❌ | `gemini-2.0-flash` | Gemini model to use |
| `UPSTASH_REDIS_REST_URL` | ✅ | — | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | — | Upstash Redis auth token |
| `DATABASE_URL` | ❌ | — | PostgreSQL connection string (asyncpg) |
| `ALLOWED_ORIGINS` | ❌ | `http://localhost:3000` | CORS allowed origins (comma-separated) |
| `RATE_LIMIT_REQUESTS` | ❌ | `5` | Max AI questions per window |
| `RATE_LIMIT_WINDOW_SECONDS` | ❌ | `3600` | Rate limit window duration (seconds) |
| `NEXTAUTH_SECRET` | ❌ | — | NextAuth shared secret |
| `BFF_JWT_SECRET` | ❌ | — | Secret for BFF ↔ API JWT signing |

### `.env.example`

```env
# AI
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash

# Cache (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here

# Database (PostgreSQL/Neon)
DATABASE_URL=postgresql+asyncpg://user:pass@ep-xxx.neon.tech/sse3d?sslmode=require

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app

# Rate Limit
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_SECONDS=3600
```

> **Note**: The API is designed to function without a database. When `DATABASE_URL` is not configured, favorites and user features gracefully degrade (return empty results / 503 status).

---

## 📡 API Endpoints

### Health Check

#### `GET /health`

Simple health check for monitoring and load balancers.

**Response** `200 OK`:
```json
{ "status": "ok" }
```

---

### Ephemeris — Planet Positions

#### `GET /api/ephemeris`

Fetches real-time positional data for Solar System bodies from NASA JPL Horizons.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | Today | Target simulation date |
| `ids` | `string` | All 9 bodies | Comma-separated body IDs (e.g., `399,499`) |
| `force` | `boolean` | `false` | Bypass cache and fetch fresh data |

**Body ID Reference:**

| ID | Body |
|---|---|
| `10` | Sun |
| `199` | Mercury |
| `299` | Venus |
| `399` | Earth |
| `499` | Mars |
| `599` | Jupiter |
| `699` | Saturn |
| `799` | Uranus |
| `899` | Neptune |

**Response** `200 OK`:
```json
{
  "data": [
    {
      "bodyId": "399",
      "name": "Earth",
      "position": {
        "x": -26177913.42,
        "y": 5765133.81,
        "z": 144608222.19
      },
      "velocity": {
        "x": -29.84,
        "y": -0.0012,
        "z": -5.22
      },
      "timestamp": "2026-03-20"
    }
  ],
  "meta": {
    "source": "NASA_LIVE",
    "timestamp": "2026-03-20",
    "requestedDate": "2026-03-20",
    "cacheHits": 7,
    "cacheMisses": 2
  }
}
```

**Data Flow:**
1. Check Redis cache for each requested body ID + date
2. If cache miss → fetch from NASA JPL Horizons API
3. If NASA unavailable → load from local `fallback_planets.json`
4. Store fresh results in Redis with tiered TTLs
5. Return combined cached + fresh results

---

### Virtual Astronomer (AI)

#### `POST /api/ai`

Ask the AI astronomer a context-aware question about a celestial body.

**Request Body:**
```json
{
  "bodyId": "299",
  "date": "2026-03-20",
  "question": "What is Venus's atmosphere made of?",
  "sessionId": "abc123-optional"
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `bodyId` | string | ✅ | Must be a valid body ID (10, 199–899) |
| `date` | date | ✅ | ISO 8601 format |
| `question` | string | ✅ | 3–500 characters |
| `sessionId` | string | ❌ | Max 64 chars, used for rate limiting |

**Response** `200 OK`:
```json
{
  "answer": "Venus's atmosphere is remarkably dense, composed predominantly of carbon dioxide (CO2), which makes up about 96.5% of its mass..."
}
```

**Response** `429 Too Many Requests`:
```json
{
  "error": "RATE_LIMITED",
  "message": "Question limit reached. Please wait before continuing.",
  "retryAfterSeconds": 2847
}
```

**Rate Limit Priority** (identifier resolution):
1. `user:{userId}` — if authenticated via Bearer JWT
2. `session:{sessionId}` — if session ID provided
3. `ip:{clientIp}` — fallback to client IP address

---

### Favorites

#### `POST /api/ai/favorites`

Save a Q&A pair to favorites.

**Request Body:**
```json
{
  "bodyId": "299",
  "bodyName": "Venus",
  "question": "What is Venus's atmosphere made of?",
  "answer": "Venus's atmosphere is remarkably dense...",
  "sessionId": "abc123"
}
```

**Response** `201 Created`:
```json
{ "id": 42 }
```

**Anonymous limits**: 2 favorites per planet per session. Returns `403` when exceeded:
```json
{
  "error": "LIMIT_REACHED",
  "message": "Limit of 2 favorites per planet reached. Log in to save more.",
  "current_count": 2,
  "limit": 2
}
```

---

#### `GET /api/ai/favorites`

Retrieve saved favorites.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `session_id` / `sessionId` | string | Filter by session (anonymous users) |
| `body_id` / `bodyId` | string | Filter by planet |

> Authenticated users: filters by `user_id` automatically via Bearer token.

**Response** `200 OK`:
```json
[
  {
    "id": 42,
    "bodyId": "299",
    "bodyName": "Venus",
    "question": "What is Venus's atmosphere made of?",
    "answer": "Venus's atmosphere is remarkably dense...",
    "created_at": "2026-03-20T06:25:34.123456"
  }
]
```

---

#### `DELETE /api/ai/favorites/{favorite_id}`

Delete a specific favorite. Ownership is verified (user_id match or session_id match).

**Response** `204 No Content` — on success.

**Error Responses:**
- `403 UNAUTHORIZED` — favorite belongs to another user/session
- `404 NOT_FOUND` — favorite doesn't exist
- `401 LOGIN_REQUIRED` — trying to delete an authenticated user's favorite without auth

---

### User Management

#### `POST /api/users/merge-anonymous`

Migrates anonymous favorites to the authenticated user's account. **Requires authentication**.

**Request Body:**
```json
{
  "session_id": "abc123-session-id"
}
```

**Response** `200 OK`:
```json
{
  "migrated": 3,
  "user_id": "uuid-here",
  "message": "3 favorite(s) migrated successfully."
}
```

**Migration logic:**
1. Fetch all anonymous favorites for the given `session_id`
2. Check for duplicates against existing user favorites (by `body_id` + `question`)
3. Migrate non-duplicates (update `user_id`, clear `session_id`)
4. Delete duplicates

---

## 🔌 External Integrations

### NASA JPL Horizons

The primary data source for ephemeris (planet position) data.

| Detail | Value |
|---|---|
| **Base URL** | `https://ssd.jpl.nasa.gov/api/horizons.api` |
| **Request format** | JSON with CSV output |
| **Coordinate system** | Heliocentric, Ecliptic plane |
| **Units** | Astronomical Units (AU) and AU/day |
| **Center** | `500@10` (Sun body center) |
| **Retry strategy** | 2 retries with exponential backoff (2s, 4s) on 503 |
| **Timeout** | 15 seconds per request |
| **Sequential fetching** | 0.5s delay between bodies to avoid rate limiting |

**Conversion applied:**
- Position: AU → kilometers (`× 149,597,870.7`)
- Velocity: AU/day → km/s (`÷ 86,400`)
- Coordinate swap: NASA's Y/Z → Three.js Y-up (Y↔Z)

**Fallback**: When NASA is unreachable, static positions from `app/data/fallback_planets.json` are used. The `meta.source` field in the response indicates `"CACHE_HIT"`, `"NASA_LIVE"`, or `"FALLBACK"`.

---

### Google Gemini AI

Powers the Virtual Astronomer chatbot.

| Detail | Value |
|---|---|
| **Model** | `gemini-2.0-flash` (configurable) |
| **Max output tokens** | 1,024 |
| **Temperature** | 0.7 |
| **Safety settings** | All categories set to `BLOCK_NONE` |

**System prompt** (dynamic per request):
> You are the Virtual Astronomer of Solar Explorer 3D. The user is viewing {planet_name} on the simulated date {date}. Answer about astronomy and {planet_name} in an educational and engaging way. Use a maximum of 2 short paragraphs. IMPORTANT: Never leave a sentence incomplete.

**Post-processing**: If the AI response was truncated (finish reason = `MAX_TOKENS`), the `_ensure_complete_sentence()` function trims the response back to the last complete sentence.

---

### Upstash Redis

Used for two purposes:

1. **Ephemeris caching** — storing planet positions with tiered TTLs
2. **Rate limiting** — tracking AI question counts per identifier

Connection is established per-request using the REST API (serverless-compatible).

---

## 🔐 Authentication Flow

The API uses a **BFF (Backend for Frontend) JWT pattern**, not direct OAuth:

```
┌─────────┐    OAuth     ┌──────────┐   BFF JWT    ┌──────────┐
│  User    │ ──────────> │  Next.js │ ──────────> │  FastAPI │
│ (Browser)│  (Google/   │   BFF    │  (HS256)    │   API    │
│          │   GitHub)   │          │             │          │
└─────────┘             └──────────┘             └──────────┘
```

1. User authenticates via NextAuth (Google/GitHub) in the frontend
2. Next.js BFF receives the OAuth tokens and creates a server-to-server JWT signed with `BFF_JWT_SECRET`
3. The JWT payload contains: `provider`, `provider_account_id`, `email`, `name`
4. FastAPI validates the JWT and performs **identity linking**:
   - **Step 1**: Look up by `Account(provider, provider_account_id)` → return existing user
   - **Step 2**: Look up by `email` → link new account to existing user
   - **Step 3**: Create new `User` + `Account` records

### Identity Linking

This enables users to log in with **multiple OAuth providers** and have all data consolidated under a single user profile. For example:
- User logs in with Google → new User + Account(google) created
- Same user later logs in with GitHub (same email) → Account(github) linked to existing User
- Both sessions see the same favorites

---

## 🗄 Database Schema

The API uses SQLModel (SQLAlchemy + Pydantic) with async PostgreSQL via asyncpg.

### Entity Relationship Diagram

```mermaid
erDiagram
    User ||--o{ Account : "has many"
    User ||--o{ FavoriteQuestion : "has many"

    User {
        string id PK "UUID"
        string email UK "unique, indexed"
        string name
        datetime created_at
    }

    Account {
        int id PK "auto-increment"
        string provider "indexed"
        string provider_account_id "indexed"
        string user_id FK "→ User.id"
    }

    FavoriteQuestion {
        int id PK "auto-increment"
        string session_id "nullable, indexed"
        string user_id FK "nullable → User.id"
        string body_id
        string body_name
        string question "max 500 chars"
        string answer
        datetime created_at
    }
```

### Key Design Decisions

- **`FavoriteQuestion`** is a **hybrid table** supporting both anonymous (`session_id`) and authenticated (`user_id`) ownership. One of the two is always set.
- **`Account`** has a **unique constraint** on `(provider, provider_account_id)` to prevent duplicate linking.
- **`User.id`** is a UUID string (not auto-increment) for better distributed system compatibility.
- **Database is optional** — when `DATABASE_URL` is not configured, all DB-dependent endpoints return graceful empty responses or `503`.

### Migrations

Managed via Alembic:

```bash
# Create a new migration
alembic revision --autogenerate -m "description"

# Apply migrations
alembic upgrade head

# Downgrade one step
alembic downgrade -1
```

---

## 🗃 Caching Strategy

### Ephemeris Cache

Planet position data is cached in Redis with **tiered TTLs** based on orbital speed:

| Bodies | TTL | Rationale |
|---|---|---|
| Earth (`399`) | 1 hour (3,600s) | Fast orbit — noticeable position changes |
| Outer planets (`599`–`899`) | 24 hours (86,400s) | Slow orbits — minimal daily movement |
| All others | 6 hours (21,600s) | Balanced default |

**Cache Key Format**: `ephemeris:{body_id}:{date}` (e.g., `ephemeris:399:2026-03-20`)

### Cache Miss Flow

```
Request → Redis GET (bulk) → missing IDs → NASA fetch (sequential)
                                          → fallback JSON (if NASA fails)
                                          → Redis SET (with TTL)
                                          → return combined results
```

---

## 🚦 Rate Limiting

AI questions are rate-limited using a **sliding window counter** stored in Redis.

| Config | Default | Description |
|---|---|---|
| `RATE_LIMIT_REQUESTS` | 5 | Max questions per window |
| `RATE_LIMIT_WINDOW_SECONDS` | 3600 | Window duration (1 hour) |

**Identifier resolution priority:**
1. **Authenticated user**: `ratelimit:astronomer:user:{userId}`
2. **Session ID**: `ratelimit:astronomer:session:{sessionId}`
3. **IP address**: `ratelimit:astronomer:ip:{clientIp}` (via `X-Forwarded-For`, `X-Real-IP`, or `request.client.host`)

**Fail-open design**: If Redis is unavailable, rate limiting is bypassed (allow request).

---

## ❌ Error Handling

### Global Exception Handlers

The API registers global handlers for common external service errors:

| Exception | HTTP Status | Error Code | Description |
|---|---|---|---|
| `httpx.TimeoutException` | `504` | `UPSTREAM_TIMEOUT` | External service didn't respond in time |
| `httpx.HTTPStatusError` | `502` | `UPSTREAM_ERROR` | External service returned an error status |
| `httpx.RequestError` | `502` | `NETWORK_ERROR` | Cannot connect to external service |

### Endpoint-Specific Errors

| Status | Code | Context |
|---|---|---|
| `400` | `SESSION_REQUIRED` | Missing session_id for anonymous favorite |
| `401` | `UNAUTHORIZED` / `LOGIN_REQUIRED` | Auth required for action |
| `403` | `LIMIT_REACHED` | Anonymous favorite limit exceeded |
| `403` | `UNAUTHORIZED` | Trying to delete another user's favorite |
| `404` | `NOT_FOUND` | Favorite not found |
| `429` | `RATE_LIMITED` | AI question rate limit exceeded |
| `503` | `DATABASE_UNAVAILABLE` | Database not configured |

---

## 📁 Project Structure

```
sse3d-api/
├── app/
│   ├── main.py                   # FastAPI app setup, CORS, exception handlers
│   ├── core/
│   │   ├── config.py             # Pydantic Settings (env vars)
│   │   ├── auth.py               # JWT validation + identity linking
│   │   ├── database.py           # Async SQLAlchemy engine + session
│   │   └── ratelimit.py          # Redis-based rate limiter
│   ├── routers/
│   │   ├── ephemeris.py          # GET /api/ephemeris
│   │   ├── astronomer.py         # POST /api/ai, favorites CRUD
│   │   └── users.py              # POST /api/users/merge-anonymous
│   ├── services/
│   │   ├── nasa_client.py        # NASA JPL Horizons HTTP client
│   │   ├── ai_service.py         # Google Gemini integration
│   │   └── cache_service.py      # Upstash Redis cache operations
│   ├── models/
│   │   ├── schemas.py            # Pydantic request/response models
│   │   └── database.py           # SQLModel table definitions
│   └── data/
│       ├── fallback.py           # Fallback data loader
│       └── fallback_planets.json # Static planet positions (offline mode)
├── alembic/                      # Database migration scripts
│   └── versions/                 # Migration version files
├── tests/                        # Pytest test suite
├── .env.example                  # Environment variable template
├── requirements.txt              # Python dependencies
├── Dockerfile                    # Docker container definition
├── fly.toml                      # Fly.io deployment configuration
└── alembic.ini                   # Alembic configuration
```

---

## 🧪 Testing

The project uses **pytest** with **pytest-asyncio** for async test support.

```bash
# Run all tests
pytest

# Run with verbose output
pytest -v

# Run a specific test file
pytest tests/test_ephemeris.py
```

### Test Dependencies
- `pytest` — test framework
- `pytest-asyncio` — async test support
- `httpx[test]` — async HTTP client test utilities
- `aiosqlite` — in-memory SQLite for DB tests

---

## 🌐 Deployment

### Docker

The API is containerized with a multi-stage Dockerfile:

```dockerfile
FROM python:3.12-slim
# Installs system deps (gcc, python3-dev for asyncpg)
# Installs Python deps from requirements.txt
# Runs: alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8080
```

```bash
# Build
docker build -t sse3d-api .

# Run
docker run -p 8080:8080 --env-file .env sse3d-api
```

### Fly.io

Configured for the **`gru` (São Paulo, Brazil)** region with health checks:

| Config | Value |
|---|---|
| **Region** | `gru` (São Paulo) |
| **Memory** | 256 MB |
| **CPU** | 1 shared |
| **Internal port** | 8000 |
| **Health check** | `GET /health` every 15s |
| **HTTPS** | Enforced |

```bash
# Deploy
fly deploy

# Set secrets
fly secrets set GEMINI_API_KEY=... DATABASE_URL=... UPSTASH_REDIS_REST_URL=...

# View logs
fly logs

# SSH into container
fly ssh console
```

---

## 📦 Dependencies

| Package | Version | Purpose |
|---|---|---|
| `fastapi` | 0.115.8 | Web framework |
| `uvicorn[standard]` | 0.34.0 | ASGI server |
| `pydantic` | 2.10.6 | Data validation |
| `pydantic-settings` | 2.7.1 | Environment configuration |
| `httpx` | 0.28.1 | Async HTTP client (NASA API) |
| `upstash-redis` | 1.3.0 | Serverless Redis client |
| `google-generativeai` | 0.8.4 | Google Gemini AI SDK |
| `sqlmodel` | 0.0.22 | ORM (SQLAlchemy + Pydantic) |
| `alembic` | 1.14.1 | Database migrations |
| `asyncpg` | 0.30.0 | Async PostgreSQL driver |
| `PyJWT` | 2.9.0 | JWT token handling |
| `cryptography` | 43.0.3 | Cryptographic operations |
| `python-jose[cryptography]` | 3.3.0 | JOSE/JWK support |
| `loguru` | 0.7.2 | Structured logging |
| `pytest` | 8.3.4 | Testing framework |
| `pytest-asyncio` | 0.25.3 | Async test support |
| `aiosqlite` | 0.21.0 | SQLite for testing |

---

<p align="center">
  <sub>Part of the <a href="../README.md">Solar Explorer 3D</a> project</sub>
</p>
