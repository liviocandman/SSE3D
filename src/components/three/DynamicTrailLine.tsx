import React, { useRef, useMemo, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Line2 } from 'three-stdlib';
import {
  createDynamicTrailBuffers,
  updateDynamicTrailBuffers,
  type DynamicTrailBuffers,
  type TrailSample,
} from '@/lib/dynamicTrailBuffers';
import { KM_TO_UNIT } from '@/lib/scales';
import { useSolarStore } from '@/store/solarStore';
import { findTemporalInterval, createTemporalLookupCache, resetCacheIfDataChanged } from '@/lib/temporalLookup';
import { clockRuntime } from '@/lib/time/clockRuntime';

interface DynamicTrailLineProps {
  /** Shared absolute scientific positions in KM. */
  samples: TrailSample[];
  maxTrailPoints: number;
  subdivisions?: number;
  color: string | THREE.Color;
  opacity?: number;
  lineWidth?: number;
  graceMs?: number;
}

const INITIAL_POINTS: [number, number, number][] = [[0, 0, 0], [0, 0, 0]];
const INITIAL_COLORS: [number, number, number][] = [[1, 1, 1], [1, 1, 1]];

/** Planet trails with persistent GPU attributes and camera-relative positions. */
export const DynamicTrailLine: React.FC<DynamicTrailLineProps> = ({
  samples,
  maxTrailPoints,
  subdivisions = 1,
  color,
  opacity = 0.8,
  lineWidth = 1.5,
  graceMs = 12 * 60 * 60 * 1000,
}) => {
  const lineRef = useRef<Line2>(null);
  const buffersRef = useRef<DynamicTrailBuffers | null>(null);
  const baseColor = useMemo(() => new THREE.Color(color), [color]);
  const lookupCache = useRef(createTemporalLookupCache());
  const pointTimesMs = useMemo(() => samples.map((sample) => sample.timestampMs), [samples]);
  const lastUpload = useRef({
    buffers: null as DynamicTrailBuffers | null,
    samples: null as TrailSample[] | null,
    color: null as THREE.Color | null,
    lastVisibleIndex: -1,
    subdivisions: 1,
    originX: NaN,
    originY: NaN,
    originZ: NaN,
  });

  useLayoutEffect(() => {
    resetCacheIfDataChanged(lookupCache.current, pointTimesMs);
  }, [pointTimesMs]);

  useLayoutEffect(() => {
    if (!lineRef.current) return;
    // Line is remounted when capacity changes; Drei disposes the old geometry
    // and its GPU buffers. Attribute replacement happens before first upload.
    buffersRef.current = createDynamicTrailBuffers(lineRef.current.geometry, maxTrailPoints);
    return () => { buffersRef.current = null; };
  }, [maxTrailPoints]);

  useFrame(() => {
    const line = lineRef.current;
    const buffers = buffersRef.current;
    if (!line || !buffers) return;

    const cutoffMs = clockRuntime.getTimeMs() + graceMs;
    let lastVisibleIndex = -1;
    const len = pointTimesMs.length;
    if (len > 0) {
      if (cutoffMs >= pointTimesMs[len - 1]) {
        lastVisibleIndex = (len - 1) * subdivisions;
      } else {
        const interval = findTemporalInterval(pointTimesMs, cutoffMs, lookupCache.current);
        lastVisibleIndex = interval
          ? interval.leftIndex * subdivisions + (samples[interval.rightIndex].breakBefore && interval.alpha < 1
            ? 0 : Math.floor(interval.alpha * subdivisions))
          : cutoffMs >= pointTimesMs[0] ? 0 : -1;
      }
    }

    const count = Math.min(lastVisibleIndex + 1, maxTrailPoints);
    if (count < 2) {
      line.visible = false;
      buffers.geometry.instanceCount = 0;
      lastUpload.current.lastVisibleIndex = -1;
      return;
    }
    const origin = useSolarStore.getState().renderOrigin;
    const previous = lastUpload.current;
    // Time changes only affect geometry when the visible sample changes.
    if (previous.buffers === buffers && previous.samples === samples && previous.color === baseColor
      && previous.subdivisions === subdivisions
      && previous.lastVisibleIndex === lastVisibleIndex && previous.originX === origin.x
      && previous.originY === origin.y && previous.originZ === origin.z) return;

    updateDynamicTrailBuffers(buffers, samples, lastVisibleIndex, count, origin, KM_TO_UNIT, baseColor, subdivisions);
    line.visible = buffers.geometry.instanceCount > 0;
    previous.buffers = buffers;
    previous.samples = samples;
    previous.color = baseColor;
    previous.lastVisibleIndex = lastVisibleIndex;
    previous.subdivisions = subdivisions;
    previous.originX = origin.x;
    previous.originY = origin.y;
    previous.originZ = origin.z;
  });

  return (
    <Line
      key={maxTrailPoints}
      ref={lineRef}
      points={INITIAL_POINTS}
      vertexColors={INITIAL_COLORS}
      transparent
      opacity={opacity}
      lineWidth={lineWidth}
      depthWrite={false}
      frustumCulled={false}
    />
  );
};

export default DynamicTrailLine;
