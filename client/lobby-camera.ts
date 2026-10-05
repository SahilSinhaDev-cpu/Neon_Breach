// Shared by live lobby rendering and the in-engine title-sequence capture.
// Eye-height service-lane view; the center pickup stays clear of cover.
export const LOBBY_CAMERA = {
  position: { x: 11.8, y: 1.6, z: 13 },
  target: { x: 0, y: 1.5, z: -2 },
} as const;
