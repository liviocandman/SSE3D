import * as THREE from 'three';

/**
 * Geometry Pool
 * 
 * Centralized registry for shared, unit-sized geometries (radius = 1).
 * Components using these MUST use dispose={null} to prevent R3F from
 * disposing them on unmount.
 */

// --- Spheres ---
export const SPHERE_HIGH = new THREE.SphereGeometry(1, 64, 64);
export const SPHERE_MID = new THREE.SphereGeometry(1, 32, 32);
export const SPHERE_LOW = new THREE.SphereGeometry(1, 16, 16);

// --- UI Elements ---
export const TORUS_SELECTION = new THREE.TorusGeometry(1, 0.005, 16, 100);

// --- Hitboxes ---
export const HITBOX_SPHERE = new THREE.SphereGeometry(1, 8, 8);

// --- Asteroids / Rocks ---
export const GEOM_ROCK_LOW = new THREE.IcosahedronGeometry(1, 0);

/**
 * Cleanup function for the global pool (use only on app destruction)
 */
export function disposeGeometryPool() {
  SPHERE_HIGH.dispose();
  SPHERE_MID.dispose();
  SPHERE_LOW.dispose();
  TORUS_SELECTION.dispose();
  HITBOX_SPHERE.dispose();
  GEOM_ROCK_LOW.dispose();
}
