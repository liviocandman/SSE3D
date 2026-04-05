import * as THREE from 'three';

/**
 * Orion mesh-to-body calibration used by mission attitude rendering.
 *
 * Backend policy/CK quaternions assume body axes:
 * - +X: nose/forward
 * - +Z: dorsal/up
 *
 * Current Orion meshes (proxy + detailed) are authored with their longitudinal
 * axis on local +Y. We rotate mesh space into body space once, then compose:
 * worldFromMesh = worldFromBody * bodyFromMesh.
 */
export const ORION_MESH_TO_BODY_QUATERNION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0, 0, -Math.PI / 2)
);

