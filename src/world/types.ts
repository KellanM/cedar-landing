import type * as THREE from 'three';

/** Shapes follow docs/web_export_contract.md (v1 + coordinator updates). All coords three.js Y-up metres. */
export type Vec3 = [number, number, number];

export interface Interact {
  name: string;
  kind: string;
  pos: Vec3;
  props?: Record<string, unknown> & { prompt?: string; label?: string };
}

export interface Hotspot {
  name: string;
  pos: Vec3;
  biome?: string;
  fish_pool: string[];
  time_of_day?: string;
  act?: number;
  tier?: string;
}

/**
 * gameplay.json.birds (export v2): live, animated birds instead of birds baked into chunks.
 * `hotspot` = feeding frenzy over a fishing spot, `flock` = circling group, `perched` = idle on a spot.
 */
export interface BirdSpawn {
  name?: string;
  species?: string;
  kind: 'hotspot' | 'flock' | 'perched';
  pos?: Vec3;
  center?: Vec3;
  radius?: number;
  height?: number;
  count?: number;
}

/**
 * gameplay.json.mammals (export v3): marine mammals animated in-game (src/game/mammals.ts) instead of
 * statics baked into chunks. One entry per designer object; `parts` are the individual animals found in
 * a joined group (bottom-centre pos, heading dir in xz, body length), so the designer's layout is kept.
 */
export interface MammalSpawn {
  name: string;
  species: string;
  /** pod (deep/underwater), surface (travelling at the surface), haulout (on rocks), heads (bobbing),
   *  float (otters), fluke (fluke-up diving whale), swim (single underwater animal) */
  kind: 'pod' | 'surface' | 'haulout' | 'heads' | 'float' | 'fluke' | 'swim' | string;
  behaviour?: string;
  pos: Vec3;
  rotY?: number;
  count?: number;
  calf?: number;
  radius?: number;
  bounds?: number[];
  underwater?: boolean;
  in_region?: boolean;
  parts?: { pos: Vec3; top?: number; dir: [number, number]; length: number }[];
  props?: Record<string, unknown>;
}

export interface Buoy { name: string; pos: Vec3; side?: string }
export interface CameraShot { name: string; pos: Vec3; target: Vec3; fov?: number }
export interface Npc { name?: string; npc_name?: string; pos: Vec3; rotY?: number; role?: string; props?: Record<string, unknown> }

export interface TimeOfDay {
  zenith: string;
  horizon: string;
  sea: string;
  shallow?: string;
  haze: string;
  tint: [number, number, number];
}

export interface LandGrid {
  originX: number;
  originZ: number;
  cell: number;
  w: number;
  h: number;
  /** base64, row-major, row 0 at originZ, 1 = blocked */
  data: string;
}

export type Collider =
  | { name?: string; type: 'circle'; pos: Vec3; r: number }
  | { name?: string; type: 'poly'; pts: [number, number][] };

export interface Spawn { pos: Vec3; dir?: [number, number]; rotY?: number }

export interface Gameplay {
  spawn: Spawn;
  interacts: Interact[];
  hotspots: Hotspot[];
  birds?: BirdSpawn[];
  mammals?: MammalSpawn[];
  /** smoke emitters (chimneys, stacks, smoke holes, the burner, steam) */
  smoke?: { pos: Vec3; size?: number; kind?: string }[];
  buoys?: Buoy[];
  dive_sites?: { name: string; site: string; pos: Vec3 }[];
  npcs?: Npc[];
  colliders?: Collider[];
  landgrid?: LandGrid;
  cameras?: CameraShot[];
  time_of_day: Record<string, TimeOfDay>;
  route?: [number, number][];
}

export interface Manifest {
  chunks: { file: string; bounds: number[]; tris?: number }[];
  backdrops: string[];
  clouds?: string;
  protos?: string;
  /** world/dynamic.glb: bobbing buoys/boats/kelp (floaters.ts) and flutter flags (flutterMat) */
  dynamic?: string;
}

/** instances.json: [x,y,z, qx,qy,qz,qw, s] per instance (older rotY form [x,y,z,rotY,s] also accepted). */
export interface Instances { protos: Record<string, number[][]> }

export interface LoadedChunk { object: THREE.Object3D; bounds: THREE.Box3; center: THREE.Vector3 }

export interface LoadedWorld {
  source: 'placeholder' | 'export';
  chunks: LoadedChunk[];
  backdrops: THREE.Object3D[];
  clouds: THREE.Object3D[];
  /** proto geometry (merged, vertex coloured) by name */
  protos: Map<string, THREE.BufferGeometry>;
  instances: Instances;
  boat: THREE.Object3D | null;
  /** all player boat tiers by node name (BOAT_T0, BOAT_T1, ...), paintable (game/progression/boatpaint.ts) */
  boats?: Record<string, THREE.Object3D>;
  gameplay: Gameplay;
  /** world/dynamic.glb nodes (buoys, moored boats, flotsam, kelp) animated by game/floaters.ts */
  dynamic?: THREE.Object3D[];
}
