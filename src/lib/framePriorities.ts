/** All simulation state is settled before controls and visible objects update. */
export const FRAME_PRIORITIES = {
  CLOCK: -3,
  ORIGIN: -2,
  CONTROLS: -1,
  BODIES: 0,
} as const;
