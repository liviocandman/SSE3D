# Artemis II Environment

This file lists the environment variables relevant to the current Artemis II implementation.

## Frontend

### Required

- `NEXT_PUBLIC_API_URL`
  - public backend/BFF API base used by the app
- `PYTHON_API_URL`
  - server-side BFF target for backend requests
- `NEXT_PUBLIC_TEXTURE_CDN_URL`
  - CDN base for textures
  - also used to derive the Orion model base under `models/orion`

### No longer required for Artemis II

These mission flags are now fixed in code through `MISSION_CONFIG`:
- `NEXT_PUBLIC_MISSION_ENABLE_ATTITUDE`
- `NEXT_PUBLIC_MISSION_ENABLE_POLICY_ATTITUDE`
- `NEXT_PUBLIC_MISSION_ENABLE_SPIN_MODE`

## Backend

### Required for production

- `DATABASE_URL`
- `ALLOWED_ORIGINS`
- `SPICE_ENABLED`
- `SPICE_KERNEL_DIR`
- `S3_KERNELS_URL`
- `MISSION_OEM_ENABLED`
- `MISSION_OEM_URL` or `MISSION_OEM_PATH`

### Strongly recommended to set explicitly

- `MISSION_OEM_CACHE_DIR`
- `MISSION_OEM_REFRESH_SECONDS`
- `MISSION_OEM_DOWNLOAD_TIMEOUT_SECONDS`
- `SPICE_STRICT_KERNELS`

### AROW settings

These already have code defaults and can remain implicit unless operational tuning is needed:
- `AROW_LIVE_ENABLED`
- `AROW_LIVE_URL`
- `AROW_TIMEOUT_SECONDS`
- `AROW_CACHE_TTL_SECONDS`
- `AROW_STALE_WARNING_SECONDS`
- `AROW_STALE_FALLBACK_SECONDS`
- `AROW_USER_AGENT`
- `AROW_RETRY_COUNT`
- `AROW_INPUT_FRAME`
- `AROW_POSITION_ORIGIN`

### SPICE settings with code defaults

These have defaults in `sse3d-api/app/core/config.py`, but the files must exist locally after bootstrap:
- `SPICE_ENABLED`
- `SPICE_STRICT_KERNELS`
- `SPICE_KERNEL_DIR`
- `SPICE_LSK_FILE`
- `SPICE_PLANETARY_SPK_FILE`
- `SPICE_MOON_SPK_FILES`

## Suggested Production Values

### Frontend

```env
NEXT_PUBLIC_API_URL=https://your-frontend-host-or-bff
PYTHON_API_URL=https://your-backend-host
NEXT_PUBLIC_TEXTURE_CDN_URL=https://your-cloudfront-or-cdn-base/textures
```

### Backend

```env
DATABASE_URL=postgresql+asyncpg://...
ALLOWED_ORIGINS=https://your-frontend-host
SPICE_ENABLED=true
SPICE_KERNEL_DIR=/data/kernels
S3_KERNELS_URL=https://your-bucket.s3.amazonaws.com/kernels
MISSION_OEM_ENABLED=true
MISSION_OEM_URL=https://...
MISSION_OEM_CACHE_DIR=/data/mission_oem
MISSION_OEM_REFRESH_SECONDS=900
MISSION_OEM_DOWNLOAD_TIMEOUT_SECONDS=15
```

## Operational Notes

- SPICE kernels are downloaded from S3 at container startup and then loaded from the filesystem.
- OEM mission data is resolved at runtime from local path or remote source.
- Orion detailed models are not versioned through Git by default because `public/` is ignored; they are expected to be published through object storage/CDN.
