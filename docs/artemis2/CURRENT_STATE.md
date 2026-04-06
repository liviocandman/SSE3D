# Artemis II Current State

This file is the canonical summary of the Artemis II feature set as implemented in the current branch.

Historical epic documents under `docs/artemis2/*` remain useful for context, but this file reflects the current operational shape of the product.

## Scope

Artemis II is implemented as a mission-specific domain layered beside the existing solar system domain.

It includes:
- dedicated backend mission schemas, services, and router
- Next.js BFF routes for mission state, trajectory, events, and health
- dedicated frontend mission types, store, hooks, and controller
- dedicated 3D Orion rendering and mission trajectory rendering
- dedicated mission HUD, live/replay controls, and source observability

It does not overload planetary contracts as a shortcut.

## Implemented Areas

### Backend

- AROW live ingestion with normalization, freshness, and fallback handling
- OEM-first geometry and replay state resolution
- mission geometry enrichment and explicit frame handling
- mission health, source transition, gap, and recovery semantics
- SPICE-backed predicted fallback and mission-relative geometry
- policy-estimated attitude metadata when CK truth is unavailable

### Frontend

- dedicated `missionStore` and mission polling via `useMissionData()`
- mission mode HUD routing (`MissionInfo` vs `PlanetInfo`)
- backend-authoritative LIVE / REPLAY behavior
- dedicated mission trajectory line and milestone markers
- dedicated Orion rendering through marker / proxy / detailed LOD
- mission source banners and freshness visibility in HUD
- guided event camera and mobile-oriented mission HUD refinements

## Geometry and Source Model

### Geometry

Current mission geometry priority:
1. OEM archive / replay geometry
2. AROW freshness and operational metadata
3. SPICE predicted fallback

Important note:
- Orion geometry should not regress to ambiguous `Parameter_*` mappings unless formally revalidated.

### Source visibility

Mission state always exposes source and freshness metadata so the UI does not silently pretend predicted data is live.

Primary values currently surfaced:
- `source`
- `mode`
- `sourceTimestamp`
- `freshness`
- fallback state / degraded state

## Orion 3D Rendering

### LOD pipeline

Orion renders through:
- marker for far zoom
- procedural proxy for mid zoom
- detailed GLB for close zoom

The detailed model is selected by frontend quality tier:
- `high` -> `artemis_ii_high.glb`
- `mid` -> `artemis_ii_medium.glb`
- `low` -> temporarily also `artemis_ii_medium.glb`

Current product decision:
- the generated `low` detailed asset is not visually stable yet
- until a corrected low model exists, the low tier reuses the medium detailed model

### CDN path

The detailed model is resolved from the same CDN base used for textures, but under:

`models/orion`

## Attitude

Current attitude pipeline exposes:
- `attitudeQuaternion`
- `inertialAttitudeQuaternion`
- `lvlhAttitudeQuaternion`
- `attitudeSource`
- `attitudeMode`
- `attitudeConfidence`
- `referenceFrame`

Priority is:
1. CK/SPICE when available
2. policy-estimated attitude
3. geometric fallback / heading fallback

Important constraint:
- Artemis II CK truth is not yet available in the current implementation
- the current attitude solution is operational and visually coherent, but not final mission-truth CK attitude

## Production Assumptions

Frontend:
- textures and Orion models are served from CDN / object storage
- detailed Orion models live under `models/orion`

Backend:
- SPICE kernels are fetched from S3 during container startup
- kernels are persisted locally in the Fly volume and loaded from the filesystem
- OEM mission geometry is expected via `MISSION_OEM_URL` or `MISSION_OEM_PATH`

## Known Temporary Decisions

- Orion `low` detailed tier currently reuses `medium`
- attitude feature flags were simplified to code-level booleans in `MISSION_CONFIG`
- mission docs under this folder are now the preferred current-state reference; epic files remain historical
