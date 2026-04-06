# Artemis II Merge Checklist

Use this checklist before merging the Artemis II branch into `master`.

## Blocking

- [ ] Orion models are published to CDN / S3 under `models/orion/`
- [ ] `artemis_ii_high.glb` exists in CDN
- [ ] `artemis_ii_medium.glb` exists in CDN
- [ ] frontend production has `NEXT_PUBLIC_TEXTURE_CDN_URL` configured correctly
- [ ] backend production has `MISSION_OEM_ENABLED=true`
- [ ] backend production has `MISSION_OEM_URL` or `MISSION_OEM_PATH`
- [ ] backend production has `S3_KERNELS_URL`
- [ ] backend production has `SPICE_KERNEL_DIR=/data/kernels`
- [ ] Fly volume `/data` is mounted and writable
- [ ] `.agents/` is excluded from the merge
- [ ] `AGENTS.md` is excluded from the merge unless explicitly intended

## Functional Validation

- [ ] Orion marker / proxy / detailed LOD works in the frontend
- [ ] mission trajectory renders correctly around Earth
- [ ] lunar flyby trajectory remains correct
- [ ] mission HUD renders source / freshness / next event correctly
- [ ] LIVE / REPLAY switching works without browser time becoming source of truth
- [ ] Orion detailed model loads from CDN in a production-like environment

## Backend Validation

- [ ] `python -m pytest tests/test_mission_oem_service.py -q` passes from `sse3d-api/`
- [ ] mission endpoints return valid state / trajectory / health responses
- [ ] OEM ZIP extraction works for the configured source
- [ ] SPICE kernel bootstrap succeeds on cold start

## Frontend Validation

- [ ] `npm test -- --run src/components/three/OrionDetailedModel.test.tsx` passes
- [ ] mission scene tests used by the team are green
- [ ] Orion attitude behavior matches current product decision

## Temporary Accepted Decisions

- [ ] low Orion detailed tier intentionally reuses medium for now
- [ ] current attitude pipeline is accepted as policy-estimated / fallback based, not CK-truth

## Recommended PR Summary Notes

Include these points in the merge/PR description:
- mission domain remains isolated from planetary contracts
- OEM-first geometry is the current authoritative trajectory source
- SPICE kernels are fetched from S3 during backend bootstrap
- Orion detailed models are served from CDN under `models/orion`
- low Orion tier currently reuses medium until a stable low asset is available
