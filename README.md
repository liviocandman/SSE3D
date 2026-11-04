<p align="center">
  <img src="public/prints/Captura de tela 2026-03-20 061423.png" alt="Solar Explorer 3D — Didactic View" width="100%"/>
</p>

<h1 align="center">🪐 Solar Explorer 3D</h1>

<p align="center">
  <strong>Real-time 3D Solar System visualization powered by SPICE kernels</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js 16"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19"/>
  <img src="https://img.shields.io/badge/Three.js-0.182-black?logo=three.js" alt="Three.js"/>
  <img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python" alt="Python"/>
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss" alt="Tailwind CSS 4"/>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License"/>
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Product Walkthrough](#-product-walkthrough--usability-guide)
- [API Documentation](#-api-documentation)
- [Project Structure](#-project-structure)
- [Performance Targets](#-performance-targets)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🔭 Overview

**Solar Explorer 3D (SE3D)** is a web application that renders the Solar System in real time, transforming complex orbital data into an accessible, interactive 3D visualization. Built for astronomy enthusiasts, students, and educators, it combines scientifically accurate ephemeris data from SPICE kernels (via `spiceypy`) with an AI-powered virtual astronomer chatbot.

The application features a **heliocentric coordinate system** based on real ephemeris data, two visualization scales (Didactic and Realistic), and an intelligent assistant powered by Google Gemini that can answer questions about any celestial body in context.

### 🎯 Product Vision

| Perspective | Goal |
|---|---|
| **Product Owner / PM** | Deliver an educational tool that makes Solar System exploration accessible to all audiences, with progressive engagement through anonymous usage → OAuth login |
| **Tech Lead / Dev Team** | Build a performant WebGL application with a resilient backend that gracefully degrades when external APIs are unavailable |
| **UX Designer / Tech Writer** | Create an intuitive interface where users discover features naturally — from viewing planets to chatting with an AI astronomer |

---

## ✨ Key Features

### 🌍 3D Solar System Visualization
- **Real-time rendering** of 9 celestial bodies (Sun, Mercury through Neptune) with high-resolution textures
- **Elliptical orbit paths** drawn from real NASA data
- **Two scale modes**: Didactic (inflated planet sizes for visibility) and Realistic (proportional to real distances)
- **Orbital camera** with zoom, pan, and rotation controls
- **Click-to-focus** — click any planet to smoothly fly to its close-up view
- **Time travel** — pick any date or use ± 1 Year buttons to see planet positions at different points in time

### 🤖 Virtual Astronomer (AI Assistant)
- **Context-aware AI** powered by Google Gemini — knows which planet you're viewing and the simulation date
- **Chat interface** with message history within the session
- **Favorite system** — save interesting Q&A pairs for later reference
- **Rate limiting** — 5 questions per hour (anonymous) / configurable for authenticated users

### 🔐 Authentication & User System
- **OAuth 2.0** with Google and GitHub providers via NextAuth.js
- **Anonymous-first design** — full app access without login; login unlocks unlimited favorites
- **Identity linking** — multiple OAuth providers merge into a single user profile
- **Anonymous-to-authenticated migration** — favorites saved before login automatically transfer to the user's account

### 📊 Planet Information Panel
- **Orbital data**: Distance from Sun, Distance from Earth, Orbital Velocity, Orbital Period
- **Physical properties**: Surface Gravity, Day Length, Temperature, Diameter
- **Orbital mechanics**: Semi-Major Axis, Eccentricity, Inclination, Body Type
- **Data attribution**: SPICE-kernel-backed ephemeris source clearly displayed

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Three.js /   │  │   React UI   │  │   Zustand    │  │
│  │  R3F Scene    │  │  Components  │  │   Store      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │
│         │                  │                             │
│  ┌──────┴──────────────────┴───────────────┐            │
│  │         Next.js App Router (BFF)         │            │
│  │   /api/ephemeris  /api/ai  /api/auth     │            │
│  └──────────────────┬──────────────────────┘            │
└─────────────────────┼───────────────────────────────────┘
                      │ HTTPS
┌─────────────────────┼───────────────────────────────────┐
│              SSE3D-API (FastAPI)                         │
│  ┌─────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │ Ephemeris│  │  Astronomer │  │  Users / Auth     │    │
│  │ Router   │  │  Router     │  │  Router           │    │
│  └────┬─────┘  └─────┬───────┘  └──────┬───────────┘    │
│       │              │                  │                │
│  ┌────┴────┐   ┌─────┴──────┐   ┌──────┴──────────┐    │
│  │  NASA   │   │  Gemini AI │   │  PostgreSQL     │    │
│  │  Client │   │  Service   │   │  (SQLModel)     │    │
│  └────┬────┘   └────────────┘   └─────────────────┘    │
│       │                                                  │
│  ┌────┴────────────────────────────────┐                │
│  │         Upstash Redis (Cache)        │                │
│  └─────────────────────────────────────┘                │
└─────────────────────┬────────────────────────────────────┘
                      │
         ┌────────────┼────────────┬────────────┐
         ▼            ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐
   │  NAIF    │ │  Google  │ │  Postgres│ │ GitHub        │
   │  SPICE   │ │  Gemini  │ │  DB      │ │ Releases      │
   │  Kernels │ │  API     │ │ (Fly/Neon)│ │ (Assets)      │
   └──────────┘ └──────────┘ └──────────┘ └───────────────┘
```

### Data Flow

1. **Ephemeris data**: Frontend requests planet positions → Next.js BFF → FastAPI → Redis cache check → SPICE kernel computation (if cache miss) → fallback JSON data (if SPICE is unavailable)
2. **AI questions**: User sends question → Next.js BFF → FastAPI (rate limit check) → Google Gemini API → response with sentence completion post-processing
3. **Authentication**: NextAuth (Google/GitHub) → JWT session → BFF signs server-to-server JWT → FastAPI validates and performs identity linking
4. **Textures**: Client loads versioned KTX2 files from the application `/textures/<version>/` path. The published GitHub Release prepares all tiers at build time; [the texture lock](assets/textures.lock.json) pins the version, sizes and SHA-256 values. Basis stays in Git.

---

## 🛠 Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **Next.js 16** | App Router, SSR, API Routes (BFF layer) |
| **React 19** | UI components with React Compiler |
| **Three.js + React Three Fiber** | WebGL 3D rendering engine |
| **@react-three/drei** | Camera controls, HTML overlays, helper components |
| **@react-three/postprocessing** | Post-processing effects (bloom, etc.) |
| **Tailwind CSS 4** | Utility-first styling |
| **Zustand 5** | Lightweight global state management |
| **TanStack React Query** | Server state management and data fetching |
| **NextAuth.js 5 (Beta)** | OAuth authentication (Google, GitHub) |
| **Lucide React** | Icon library |
| **Sonner** | Toast notifications |

### Backend (`sse3d-api`)
| Technology | Purpose |
|---|---|
| **FastAPI** | High-performance async Python web framework |
| **Uvicorn** | ASGI server |
| **Pydantic v2** | Request/response validation and serialization |
| **SQLModel** | ORM combining SQLAlchemy + Pydantic |
| **Alembic** | Database migration management |
| **asyncpg** | Async PostgreSQL driver |
| **httpx** | Async HTTP client for external service integrations |
| **google-generativeai** | Google Gemini AI SDK |
| **Upstash Redis** | Serverless Redis for caching and rate limiting |
| **Loguru** | Structured logging |
| **PyJWT** | JWT token validation for auth |

### Infrastructure
| Service | Purpose |
|---|---|
| **Vercel** | Frontend hosting (Next.js) |
| **Fly.io** | Backend API hosting (Docker) |
| **PostgreSQL (Fly/Neon)** | Serverless/Managed PostgreSQL database |
| **Upstash** | Serverless Redis (caching + rate limiting) |
| **GitHub Releases** | Pinned asset packages; Vercel serves KTX2, Fly stores kernels on its volume |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 20.x
- **Python** ≥ 3.12
- **npm** or **yarn**
- **Flyctl** (for backend management)
- API keys for enabled application services (Google Gemini, Upstash Redis); no AWS key is needed for asset preparation

### 1. Clone the repository

```bash
git clone https://github.com/liviocandman/SSE3D.git
cd SSE3D
```

### 2. Frontend & Assets Setup

```bash
# Install dependencies
npm ci

# Download and verify all pinned KTX2 tiers from the published Release
npm run assets:prepare
npm run assets:verify

# Create .env.local using the configuration block below.
# Environment templates are not tracked in this repository.
```

Edit `.env.local` with your credentials:
```env
# NextAuth
AUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=http://localhost:3000
AUTH_GOOGLE_ID=your_google_client_id
AUTH_GOOGLE_SECRET=your_google_client_secret
AUTH_GITHUB_ID=your_github_client_id
AUTH_GITHUB_SECRET=your_github_client_secret

# Backend API
NEXT_PUBLIC_API_URL=http://localhost:8000
PYTHON_API_URL=http://localhost:8000
BFF_JWT_SECRET=shared_secret_between_bff_and_api

# KTX2 origin comes from assets/textures.lock.json; no CDN variable.
```

```bash
# Start the development server
npm run dev
```

The frontend will be available at **http://localhost:3000**.

### 3. Backend Setup (`sse3d-api`)

```bash
cd sse3d-api

# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Create sse3d-api/.env using the configuration block below.
# Run this from sse3d-api; the local filename is .env.
```

Edit `.env` with your credentials:
```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
UPSTASH_REDIS_REST_URL=https://your-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token
DATABASE_URL=postgresql+asyncpg://user:pass@host/dbname
ALLOWED_ORIGINS=http://localhost:3000
RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_SECONDS=3600
BFF_JWT_SECRET=shared_secret_between_bff_and_api
SPICE_ENABLED=true
SPICE_KERNEL_DIR=kernels
SPICE_LOCK_FILE=assets/kernels.lock.json
```

```bash
# Run database migrations
alembic upgrade head

# Prepare the image-pinned kernels, then start the API
python scripts/fetch_kernels.py --ensure
uvicorn app.main:app --reload --port 8000
```

The API will be available at **http://localhost:8000** with interactive docs at `/docs`.

---

## 📖 Product Walkthrough & Usability Guide

This section guides you through the complete user experience of Solar Explorer 3D, showcasing each feature in the order a typical user would discover them.

### Step 1 — Solar System Overview (Didactic Scale)

When you first open the application, you see the entire Solar System from a bird's-eye perspective. In **Didactic** mode, planet sizes are inflated so that every body — from tiny Mercury to giant Jupiter — is clearly visible.

![Solar System in Didactic Scale — planets are enlarged for visibility](public/prints/Captura%20de%20tela%202026-03-20%20061423.png)

**What you see:**
- The **Sun** at the center with a radiating glow
- All **8 planets** (Mercury through Neptune) with labeled names
- **Elliptical orbit paths** rendered as subtle lines
- The **information panel** on the right showing data for the selected planet (Earth by default)
- Top-right controls: **Favorites** (♥), **Scale toggle** (Didactic/Realistic)
- **Simulation Date** picker and quick navigation buttons (Today, ±1 Year)

---

### Step 2 — Switching to Realistic Scale

Click the **"Realistic"** toggle in the top-right corner to switch to proportional scale. In this mode, distances and sizes reflect real astronomical proportions.

![Solar System in Realistic Scale — true proportional distances](public/prints/Captura%20de%20tela%202026-03-20%20061624.png)

**Key differences from Didactic mode:**
- Inner planets (Mercury, Venus, Earth, Mars) cluster tightly around the Sun
- Outer planets (Jupiter, Saturn, Uranus, Neptune) spread out at their real distances
- This mode helps users appreciate the vastness of space between planets

---

### Step 3 — Planet Focus View

Click on any planet to smoothly fly to a close-up view. The camera will orbit the selected celestial body while the information panel updates with its data.

![Earth close-up focus view with orbit ring](public/prints/Captura%20de%20tela%202026-03-20%20061832.png)

**Information panel sections:**
- **Distance from Sun** and **Distance from Earth** (in millions of km)
- **Orbital Velocity** (km/s) and **Orbital Period** (days)
- **Physical Properties**: Surface Gravity, Day Length, Temperature, Diameter
- **Orbital Data**: Semi-Major Axis (AU), Eccentricity, Inclination, Body Type
- **Data source attribution**: "High-precision ephemeris data provided by SPICE kernels"

---

### Step 4 — Exploring Different Planets

Navigate between planets by clicking their labels or 3D models. Each planet features unique high-resolution textures and distinctive data.

![Venus close-up with detailed physical properties](public/prints/Captura%20de%20tela%202026-03-20%20062155.png)

**Example — Venus data shown:**
- Temperature: +464 °C (hottest planet)
- Day Length: 116d 18h (longer than its year!)
- Orbital Period: 225 days
- Body Type: Rocky

---

### Step 5 — Opening the Virtual Astronomer

Click the **"Virtual Astronomer"** button on the information panel to open the AI chat modal. The astronomer is context-aware — it knows which planet you're viewing and the current simulation date.

![Virtual Astronomer modal — empty state with prompt](public/prints/Captura%20de%20tela%202026-03-20%20062203.png)

**The modal shows:**
- Header with "ASTRÔNOMO VIRTUAL" (Virtual Astronomer), planet name, and date
- Instructional text: *"Ask a question about the selected planet"*
- Note: *"Temporary history (this tab only). Use the star to favorite and save answers."*
- Input field and Send button

---

### Step 6 — Typing a Question

Type any astronomy question about the selected planet. The AI can answer questions about composition, atmosphere, history, size comparisons, and more.

![Typing a question about Venus's atmosphere](public/prints/Captura%20de%20tela%202026-03-20%20062429.png)

---

### Step 7 — Receiving the AI Response

The AI generates a response in real time. A loading indicator ("Gerando resposta...") appears while the answer is being generated.

![AI generating response — loading state](public/prints/Captura%20de%20tela%202026-03-20%20062438.png)

---

### Step 8 — Reading the Answer

The astronomer delivers a rich, educational response. Each answer appears in a styled message bubble.

![Full AI response about Venus's atmosphere composition](public/prints/Captura%20de%20tela%202026-03-20%20062444.png)

**Response features:**
- Detailed, scientific yet accessible explanation
- Context-aware (references the specific planet, uses current data)
- Clear, complete sentences (post-processing ensures no truncation)

---

### Step 9 — Saving to Favorites

Click the **star icon (⭐)** on any AI response to save it to your favorites. A success toast notification appears confirming the save.

![Response saved to favorites with success notification](public/prints/Captura%20de%20tela%202026-03-20%20062534.png)

---

### Step 10 — Viewing Your Discoveries

Click the **heart icon (♥)** in the header to view all saved favorites. The "Suas Descobertas" (Your Discoveries) modal lists all saved Q&A pairs with planet and date tags.

![Favorites modal — "Suas Descobertas" with saved questions](public/prints/Captura%20de%20tela%202026-03-20%20062604.png)

---

### Step 11 — Continuing the Conversation & Favorite Limits

Continue asking questions in the same session. Anonymous users have a limit of **2 favorites per planet**. When the limit is reached, a tooltip indicates login is required for more.

![Multiple chat messages with favorite limit tooltip](public/prints/Captura%20de%20tela%202026-03-20%20063151.png)

---

### Step 12 — Login Prompt

When you reach the anonymous favorite limit, a login modal appears offering **Google** and **GitHub** authentication options. Logging in unlocks unlimited favorites and migrates all anonymous data.

![OAuth login modal with Google and GitHub options](public/prints/Captura%20de%20tela%202026-03-20%20063212.png)

---

### Step 13 — Full Favorites Collection

After saving multiple questions, the favorites modal shows your complete collection with all Q&A pairs, tagged by planet and date.

![Full favorites collection with multiple saved entries](public/prints/Captura%20de%20tela%202026-03-20%20063230.png)

---

### Step 14 — Exploring the Outer Solar System

Navigate to outer planets like Jupiter to see the vast scale of the Solar System. The Realistic view particularly highlights the enormous distances between outer planets.

![Jupiter selected in Realistic view showing outer Solar System](public/prints/Captura%20de%20tela%202026-03-20%20063259.png)

---

## 📡 API Documentation

The backend API is fully documented in a separate README. See **[sse3d-api/README.md](sse3d-api/README.md)** for complete API documentation including:

- All endpoints with request/response schemas
- Authentication flow details
- Rate limiting configuration
- External integrations (SPICE kernels, Google Gemini)
- Database schema and models
- Error handling strategy
- Deployment instructions

### Quick API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ephemeris` | Fetch planet positions for a given date |
| `POST` | `/api/ai` | Ask the Virtual Astronomer a question |
| `POST` | `/api/ai/favorites` | Save a Q&A pair to favorites |
| `GET` | `/api/ai/favorites` | List saved favorites |
| `DELETE` | `/api/ai/favorites/{id}` | Delete a favorite |
| `POST` | `/api/users/merge-anonymous` | Migrate anonymous favorites to authenticated user |
| `GET` | `/health` | Process/configuration inspection |
| `GET` | `/ready` | Verified SPICE orbital readiness; 200 or 503 |

---

## 📁 Project Structure

```
solar-explore-3d/
├── src/                          # Next.js Frontend
│   ├── app/
│   │   ├── api/                  # BFF API Routes
│   │   │   ├── ai/               # AI proxy endpoint
│   │   │   ├── auth/             # NextAuth handlers
│   │   │   ├── ephemeris/        # Ephemeris proxy endpoint
│   │   │   ├── favorites/        # Favorites proxy endpoint
│   │   │   └── users/            # User management proxy
│   │   ├── layout.tsx            # Root layout
│   │   ├── page.tsx              # Main 3D scene page
│   │   ├── providers.tsx         # React Query + Auth providers
│   │   └── globals.css           # Global styles
│   ├── components/
│   │   ├── three/                # 3D Scene Components
│   │   │   ├── SceneManager.tsx  # Main scene orchestrator
│   │   │   ├── CelestialBody.tsx # Planet rendering
│   │   │   ├── OrbitLine.tsx     # Elliptical orbit paths
│   │   │   ├── PlanetMarker.tsx  # Planet label markers
│   │   │   └── Sun.tsx           # Sun with glow effects
│   │   └── ui/                   # UI Components
│   │       ├── HUD.tsx           # Main info panel (HUD)
│   │       ├── PlanetInfo.tsx    # Planet data display
│   │       ├── AstronomerModal.tsx  # AI chat modal
│   │       ├── FavoritesModal.tsx   # Saved favorites viewer
│   │       ├── AuthModal.tsx     # OAuth login modal
│   │       ├── DateSelector.tsx  # Date picker component
│   │       ├── FavoriteButton.tsx   # Star/favorite toggle
│   │       ├── ErrorOverlay.tsx  # Error state display
│   │       ├── LoadingScreen.tsx # Loading animation
│   │       └── Button.tsx        # Reusable button component
│   ├── services/                 # Frontend services
│   │   ├── nasaClient.ts         # Ephemeris data fetcher
│   │   └── cacheService.ts       # Client-side caching
│   ├── contexts/                 # React contexts
│   ├── hooks/                    # Custom React hooks
│   ├── store/                    # Zustand stores
│   ├── lib/                      # Utility functions
│   └── auth.ts                   # NextAuth configuration
├── sse3d-api/                    # Python Backend API
│   ├── app/
│   │   ├── main.py               # FastAPI app entry point
│   │   ├── routers/              # API route handlers
│   │   ├── services/             # Business logic
│   │   ├── models/               # Pydantic + SQLModel schemas
│   │   ├── core/                 # Config, auth, DB, rate limit
│   │   └── data/                 # Fallback data
│   ├── alembic/                  # DB migrations
│   ├── tests/                    # Pytest test suite
│   ├── Dockerfile                # Container image
│   ├── fly.toml                  # Fly.io deployment config
│   └── requirements.txt          # Python dependencies
├── public/                       # Static assets & textures
├── scripts/                      # Setup scripts
├── docs/                         # Documentation & screenshots
│   └── prints/                   # Product screenshots
└── package.json                  # Node.js dependencies
```

---

## ⚡ Performance Targets

| Metric | Target | Strategy |
|---|---|---|
| **Desktop FPS** | 60 FPS | WebGL with optimized Three.js scene graph, React Compiler |
| **Mobile FPS** | 30 FPS | Adaptive quality tiers, texture downsizing |
| **API Response (cached)** | < 50ms | Upstash Redis with tiered TTLs (1h–24h based on planet) |
| **API Response (fresh)** | < 3s | SPICE-based ephemeris computation with Redis caching |
| **JS Heap Memory** | < 100MB | Texture disposal, geometry pooling, memory optimization |
| **Resilience** | Graceful degradation | Fallback JSON when SPICE data is unavailable |

### Cache Strategy (TTL by Planet)

| Bodies | TTL | Rationale |
|---|---|---|
| Earth (399) | 1 hour | Fast orbit, positions change noticeably |
| Outer planets (599–899) | 24 hours | Slow orbits, minimal position change daily |
| All others | 6 hours | Balanced default |

---

## 🌐 Deployment

### Assets (GitHub Releases → Vercel/Fly)
The public asset packages are [textures-2026-11-04.1](https://github.com/liviocandman/SSE3D/releases/tag/textures-2026-11-04.1) and [kernels-2026-11-04.1](https://github.com/liviocandman/SSE3D/releases/tag/kernels-2026-11-04.1). Their ZIPs and manifests were downloaded anonymously and verified against the [texture lock](assets/textures.lock.json) and [kernel lock](sse3d-api/assets/kernels.lock.json). Each Release also includes checksums and attribution information.

`npm run build` prepares and verifies pinned KTX2 through `prebuild`; configure this command in Vercel. A clean build downloads the packages without AWS credentials. `npm run assets:verify` checks the installed files. Basis is committed under `public/basis/`, while KTX2 files are served from `/textures/<version>/`. Existing AWS uploaders are historical tools outside this flow.

New asset bytes require a new version, published packages and updated locks. Keep the previous texture descriptor in `retained` when upgrading. Asset publication does not complete application delivery: validate the Preview, Docker image and Fly startup/rollback before promoting a deployment.

### Frontend (Vercel)
Verify the connected branch and build command in Vercel before promoting a Preview. The repository workflow deploys Fly; it does not establish the Vercel integration.

Required environment variables on Vercel:
- `AUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`
- `NEXT_PUBLIC_API_URL`, `PYTHON_API_URL` (points to Fly.io backend)
- `BFF_JWT_SECRET`

### Backend (Fly.io)
The FastAPI backend is containerized with Docker and deployed to **Fly.io** in the `gru` (São Paulo) region.

The image contains the kernel lock and validator, while kernels live on the `spice_data` volume mounted at `/data`. The CMD installs or verifies `/data/kernels/releases/<version>` before starting Uvicorn. Provision adequate free space for the archive, extraction and safety margin. Prefer preparing the volume before rollout: the configured 180-second grace period has not established that an empty Fly volume can hydrate in time.

Use `/ready` for orbital readiness (200 only after verification and SPICE initialization); `/health` describes process state. For installation, verification and rollback commands, see [backend deployment](sse3d-api/README.md#-deployment).

```bash
# Deploy
cd sse3d-api
fly deploy

# View logs
fly logs
```

Required secrets on Fly.io:
- `GEMINI_API_KEY`, `DATABASE_URL` (postgresql+asyncpg), `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`, `ALLOWED_ORIGINS`, `BFF_JWT_SECRET`, `NEXTAUTH_SECRET`

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` — New features
- `fix:` — Bug fixes
- `perf:` — Performance improvements
- `docs:` — Documentation changes
- `refactor:` — Code restructuring

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **[NASA SPICE Toolkit](https://naif.jpl.nasa.gov/naif/toolkit.html)** — High-precision ephemeris data kernels
- **[Google Gemini](https://ai.google.dev/)** — AI language model for the Virtual Astronomer
- **[Three.js](https://threejs.org/)** & **[React Three Fiber](https://docs.pmnd.rs/react-three-fiber)** — 3D rendering framework
- **[Solar System Scope](https://www.solarsystemscope.com/textures/)** — Planet texture assets

---

<p align="center">
  <sub>Built with ☀️ by the SE3D Team</sub>
</p>
