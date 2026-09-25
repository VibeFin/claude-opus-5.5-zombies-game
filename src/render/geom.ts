// Geometry helpers: world-space-UV boxes, batched static geometry and instanced prop templates.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Axis-aligned box whose UVs are in world units divided by `tile`, so textures keep a consistent
 * texel density regardless of box size.
 */
export function worldBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tile = 2,
  skip: { top?: boolean; bottom?: boolean } = {}): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const face = (p: number[][], n: number[], uvs: number[][]) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(...p[i]);
      nor.push(...n);
      uv.push(uvs[i][0] / tile, uvs[i][1] / tile);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // +X
  face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
  // -X
  face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
  // +Z
  face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
  // -Z
  face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
  if (!skip.top) face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]]);
  if (!skip.bottom) face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Horizontal quad (floor / decal) at height y with world UVs. */
export function worldQuad(x0: number, z0: number, x1: number, z1: number, y: number, tile = 2): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([x0 / tile, -z1 / tile, x1 / tile, -z1 / tile, x1 / tile, -z0 / tile, x0 / tile, -z0 / tile], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Normalises attributes so arbitrary three.js primitives can be merged together. */
export function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g : g;
  if (!out.index) {
    const n = out.attributes.position.count;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i);
    out.setIndex(idx);
  }
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  if (!out.attributes.uv) {
    const n = out.attributes.position.count;
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  out = out.toNonIndexed();
  return out;
}

/** Accumulates geometry per material and merges it into a few large static meshes. */
export class StaticBatch {
  private groups = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, g: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const geo = prep(g);
    if (m) geo.applyMatrix4(m);
    let arr = this.groups.get(mat);
    if (!arr) this.groups.set(mat, (arr = []));
    arr.push(geo);
  }

  build(parent: THREE.Object3D, opts: { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [mat, list] of this.groups) {
      // Chunk to keep individual meshes cullable.
      for (let i = 0; i < list.length; i += 400) {
        const merged = mergeGeometries(list.slice(i, i + 400), false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = opts.castShadow ?? true;
        mesh.receiveShadow = opts.receiveShadow ?? true;
        mesh.matrixAutoUpdate = false;
        parent.add(mesh);
        meshes.push(mesh);
      }
      for (const g of list) g.dispose();
    }
    this.groups.clear();
    return meshes;
  }
}

/** A prop made of merged parts per material, placed many times via InstancedMesh. */
export interface PropPart { mat: THREE.Material; geo: THREE.BufferGeometry }

export class PropTemplate {
  parts: PropPart[] = [];
  private pending = new Map<THREE.Material, THREE.BufferGeometry[]>();
  bounds = new THREE.Box3();
  castShadow = true;

  add(mat: THREE.Material, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    const geo = prep(g);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    geo.applyMatrix4(m);
    let arr = this.pending.get(mat);
    if (!arr) this.pending.set(mat, (arr = []));
    arr.push(geo);
    return this;
  }

  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    return this.add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  }

  cyl(mat: THREE.Material, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): this {
    return this.add(mat, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz);
  }

  finish(): this {
    for (const [mat, list] of this.pending) {
      const merged = mergeGeometries(list, false)!;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      this.bounds.union(merged.boundingBox!);
      this.parts.push({ mat, geo: merged });
    }
    this.pending.clear();
    return this;
  }
}

/** Collects placements of templates and emits one InstancedMesh per template part. */
export class InstanceSet {
  private placements = new Map<PropTemplate, THREE.Matrix4[]>();

  place(t: PropTemplate, x: number, y: number, z: number, ry = 0, s = 1): THREE.Matrix4 {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));
    let arr = this.placements.get(t);
    if (!arr) this.placements.set(t, (arr = []));
    arr.push(m);
    return m;
  }

  build(parent: THREE.Object3D): void {
    for (const [t, mats] of this.placements) {
      for (const p of t.parts) {
        const im = new THREE.InstancedMesh(p.geo, p.mat, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = t.castShadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        parent.add(im);
      }
    }
    this.placements.clear();
  }
}
