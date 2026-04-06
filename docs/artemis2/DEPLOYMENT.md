# Artemis II Deployment

This runbook describes the production deployment assumptions for the Artemis II feature set.

## Overview

Artemis II deploy requires coordination across:
- frontend CDN configuration
- backend SPICE bootstrap
- backend OEM mission source
- model asset publication

## Frontend

### Required runtime assumptions

- `NEXT_PUBLIC_TEXTURE_CDN_URL` points to the public CDN base used by textures
- Orion detailed models are resolved from that same base under `models/orion`

Example:
- textures: `https://cdn.example.com/textures/...`
- Orion models: `https://cdn.example.com/models/orion/...`

### Orion model files expected in CDN

- `artemis_ii_high.glb`
- `artemis_ii_medium.glb`

Optional but not currently used by product:
- `artemis_ii_low.glb`

Current behavior:
- low quality tier reuses `artemis_ii_medium.glb`

### Uploading Orion models

Models can be uploaded with:

```bash
npm run upload:models
```

This publishes `.glb` files from `public/models/orion` to:

`models/orion/*`

in the configured S3 bucket and invalidates CloudFront.

## Backend

### SPICE bootstrap

The backend does not read kernels from S3 during normal request handling.

Instead:
1. the container starts
2. `scripts/fetch_kernels.py` runs
3. it downloads kernels from `S3_KERNELS_URL`
4. it stores them in the mounted volume, typically `/data/kernels`
5. the application loads kernels locally from `SPICE_KERNEL_DIR`

This is wired through:
- `sse3d-api/Dockerfile`
- `sse3d-api/fly.toml`
- `sse3d-api/scripts/fetch_kernels.py`

### OEM mission source

Replay / trajectory geometry depends on OEM-first mission data.

Production should provide one of:
- `MISSION_OEM_URL`
- `MISSION_OEM_PATH`

Recommended production choice:
- `MISSION_OEM_URL`

The service supports:
- direct OEM payloads
- remote ZIP payloads containing an OEM file

ZIP extraction is hardened to prefer `.oem` / `.asc` payloads over incidental `.txt` files.

### Persistence

Production backend should have a writable persistent path for:
- SPICE kernels
- OEM cache

Suggested layout:
- kernels: `/data/kernels`
- OEM cache: `/data/mission_oem`

## Fly.io Notes

Current Fly assumptions:
- mounted volume at `/data`
- `SPICE_KERNEL_DIR=/data/kernels`
- `S3_KERNELS_URL` available in environment

Before deploy, verify:
- Fly volume exists
- S3 bucket contains required kernels
- OEM URL is reachable from the Fly runtime
- CORS origins match the frontend host

## Validation After Deploy

Minimum smoke checks:
- backend `/health` responds
- mission `/api/missions/artemis2/health` responds
- mission `/api/missions/artemis2/state` returns an Orion state
- Orion detailed model loads in frontend close-up
- mission trajectory renders correctly in replay
- LIVE / REPLAY transitions remain functional
