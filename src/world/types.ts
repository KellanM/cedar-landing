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
  gameplay: Gameplay;
}
