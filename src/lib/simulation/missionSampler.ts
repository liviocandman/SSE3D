import * as THREE from 'three';
import { sampleTrajectoryAtTime, type TrajectorySegment } from '../trajectoryEngine';
import type { MissionState, MissionTrajectory } from '@/lib/missionTypes';
import type { MissionSampleSource } from './types';
import { samplePlanet } from './planetarySampler';

// Shared temp objects to avoid GC pressure
const tempEarthPos = new THREE.Vector3();
const tempHeadingVec = new THREE.Vector3();
const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const zAxis = new THREE.Vector3();
const upHint = new THREE.Vector3(0, 1, 0);
const zHint = new THREE.Vector3(0, 0, 1);
const basisMatrix = new THREE.Matrix4();
const missionSegmentBuffer: TrajectorySegment[] = [];

/**
 * Builds a prograde quaternion based on travel direction.
 * Optimized for zero allocation.
 */
function buildProgradeQuaternion(direction: THREE.Vector3, out: THREE.Quaternion) {
  xAxis.copy(direction).normalize();

  yAxis.crossVectors(upHint, xAxis);
  if (yAxis.lengthSq() <= 1e-12) {
    yAxis.crossVectors(zHint, xAxis);
  }
  yAxis.normalize();

  zAxis.crossVectors(xAxis, yAxis).normalize();
  basisMatrix.makeBasis(xAxis, yAxis, zAxis);

  return out.setFromRotationMatrix(basisMatrix);
}

/**
 * Samples the spacecraft state (position and orientation).
 */
export function sampleMission(
  timeMs: number,
  missionState: MissionState | null,
  missionTrajectory: MissionTrajectory | null,
  missionTrajectorySegment: TrajectorySegment | null,
  earthSegments: TrajectorySegment[],
  outAbsolutePositionKm: THREE.Vector3,
  outEarthRelativePositionKm: THREE.Vector3,
  outHeading: THREE.Quaternion,
  previousEarthRelativePositionKm?: THREE.Vector3 | null
): MissionSampleSource {
  
  // 1. Resolve Earth position
  samplePlanet('399', timeMs, earthSegments, tempEarthPos);

  let source: MissionSampleSource = 'none';
  const sceneCoordinates = missionState?.sceneCoordinates;

  // 2. Resolve Earth-relative position
  if (
    sceneCoordinates &&
    Number.isFinite(sceneCoordinates.x) &&
    Number.isFinite(sceneCoordinates.y) &&
    Number.isFinite(sceneCoordinates.z)
  ) {
    outEarthRelativePositionKm.set(sceneCoordinates.x, sceneCoordinates.y, sceneCoordinates.z);
    source = 'telemetry';
  } else if (missionTrajectorySegment) {
    missionSegmentBuffer[0] = missionTrajectorySegment;
    missionSegmentBuffer.length = 1;
    const sampled = sampleTrajectoryAtTime(missionSegmentBuffer, timeMs);
    if (sampled) {
      outEarthRelativePositionKm.set(sampled.position.x, sampled.position.y, sampled.position.z);
      source = 'trajectory';
    }
  }

  if (source !== 'none') {
    outAbsolutePositionKm.copy(tempEarthPos).add(outEarthRelativePositionKm);
  } else {
    outEarthRelativePositionKm.set(0, 0, 0);
    outAbsolutePositionKm.copy(tempEarthPos);
  }

  // 3. Resolve Heading (Prograde)
  let headingResolved = false;

  // Strategy A: Use planned/past trajectory to look ahead/back
  if (missionTrajectory) {
    const EPS = 1e-12;
    if (missionTrajectory.planned?.length) {
      const candidates = missionTrajectory.planned.slice(0, 3);
      for (const candidate of candidates) {
        tempHeadingVec.set(
          candidate.position.x - outEarthRelativePositionKm.x,
          candidate.position.y - outEarthRelativePositionKm.y,
          candidate.position.z - outEarthRelativePositionKm.z
        );
        if (tempHeadingVec.lengthSq() > EPS) {
          buildProgradeQuaternion(tempHeadingVec, outHeading);
          headingResolved = true;
          break;
        }
      }
    }

    if (!headingResolved && missionTrajectory.past?.length) {
      const lastPast = missionTrajectory.past[missionTrajectory.past.length - 1];
      tempHeadingVec.set(
        outEarthRelativePositionKm.x - lastPast.position.x,
        outEarthRelativePositionKm.y - lastPast.position.y,
        outEarthRelativePositionKm.z - lastPast.position.z
      );
      if (tempHeadingVec.lengthSq() > EPS) {
        buildProgradeQuaternion(tempHeadingVec, outHeading);
        headingResolved = true;
      }
    }
  }

  // Strategy B: Use velocity (diff from previous position)
  if (!headingResolved && previousEarthRelativePositionKm) {
    tempHeadingVec.copy(outEarthRelativePositionKm).sub(previousEarthRelativePositionKm);
    if (tempHeadingVec.lengthSq() > 1e-12) {
      buildProgradeQuaternion(tempHeadingVec, outHeading);
      headingResolved = true;
    }
  }

  // Fallback: Neutral orientation
  if (!headingResolved) {
    outHeading.identity();
  }

  return source;
}
