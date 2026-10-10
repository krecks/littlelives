/**
 * Camera-facing foliage cards. The nature and garden glbs (tools/art/nature_models.py) store, per
 * vertex of a leaf card, the card's centre (uv2.x, uv3.x, uv2.y) and the vertex's corner offset in
 * the card (uv3.y, packed): `NatureWindPlugin` turns each card to face the camera around its
 * centre, so crowns read as soft, full clumps from every side instead of showing cards edge-on.
 * Shadows and positions stay those of the static cards. Vertices that don't turn have a zero
 * offset.
 *
 * Packing: offsets are in metres within [-4, 4) at 1/512 m; `ix * 4096 + iy` (exact in float32).
 * A negative value -1 - packed turns the card about the vertical only (hanging strands).
 */

import { Matrix, Vector3, VertexBuffer, type Mesh } from './core';

const STEPS = 4096;
const PER_METRE = 512;

/**
 * Applies a transform being baked into `mesh`'s vertices to its card centres too (and scales the
 * offsets by the transform's uniform scale). Call right before `bakeTransformIntoVertices(m)`.
 */
export function bakeFoliageCards(mesh: Mesh, m: Matrix): void {
  const uv2 = mesh.getVerticesData(VertexBuffer.UV2Kind);
  const uv3 = mesh.getVerticesData(VertexBuffer.UV3Kind);
  if (!uv2 || !uv3) return;
  const scale = Math.cbrt(Math.abs(m.determinant()));
  const p = new Vector3();
  for (let i = 0; i < uv2.length / 2; i++) {
    p.set(uv2[i * 2], uv3[i * 2], uv2[i * 2 + 1]);
    Vector3.TransformCoordinatesToRef(p, m, p);
    uv2[i * 2] = p.x;
    uv2[i * 2 + 1] = p.z;
    uv3[i * 2] = p.y;
    if (Math.abs(scale - 1) > 1e-4) uv3[i * 2 + 1] = rescale(uv3[i * 2 + 1], scale);
  }
  mesh.setVerticesData(VertexBuffer.UV2Kind, uv2, false);
  mesh.setVerticesData(VertexBuffer.UV3Kind, uv3, false);
}

function rescale(packed: number, k: number): number {
  const cylinder = packed < 0;
  const p = cylinder ? -1 - packed : packed;
  const ix = Math.floor(p / STEPS);
  const iy = p - ix * STEPS;
  const enc = (i: number) => Math.min(STEPS - 1, Math.max(0, Math.round((i - STEPS / 2) * k + STEPS / 2)));
  const out = enc(ix) * STEPS + enc(iy);
  return cylinder ? -1 - out : out;
}

/** Vertex-shader code (GLSL or WGSL) that turns the cards; runs on `positionUpdated` (model space). */
export function foliageCardCode(wgsl: boolean): string {
  if (wgsl) {
    return `
#if defined(NATUREBILLBOARD) && defined(UV2) && defined(UV3)
{
  var cardPacked: f32 = vertexInputs.uv3.y;
  var cardCylinder: bool = cardPacked < 0.0;
  if (cardCylinder) { cardPacked = -1.0 - cardPacked; }
  let cardIx: f32 = floor(cardPacked / ${STEPS}.0);
  let cardOff: vec2f = (vec2f(cardIx, cardPacked - cardIx * ${STEPS}.0) - ${STEPS / 2}.0) / ${PER_METRE}.0;
  if (dot(cardOff, cardOff) > 0.0) {
    var cardRight: vec3f = vec3f(scene.view[0][0], scene.view[1][0], scene.view[2][0]);
    var cardUp: vec3f = vec3f(scene.view[0][1], scene.view[1][1], scene.view[2][1]);
    if (cardCylinder) {
      cardRight = normalize(vec3f(cardRight.x, 0.0, cardRight.z) + vec3f(0.00001, 0.0, 0.0));
      cardUp = vec3f(0.0, 1.0, 0.0);
    }
#ifdef INSTANCES
    let cardC0: vec3f = vertexInputs.world0.xyz;
    let cardC1: vec3f = vertexInputs.world1.xyz;
    let cardC2: vec3f = vertexInputs.world2.xyz;
#else
    let cardC0: vec3f = mesh.world[0].xyz;
    let cardC1: vec3f = mesh.world[1].xyz;
    let cardC2: vec3f = mesh.world[2].xyz;
#endif
    let cardS: f32 = max(length(cardC0), 0.0001);
    let cardR: vec3f = vec3f(dot(cardC0, cardRight), dot(cardC1, cardRight), dot(cardC2, cardRight)) / cardS;
    let cardU: vec3f = vec3f(dot(cardC0, cardUp), dot(cardC1, cardUp), dot(cardC2, cardUp)) / cardS;
    positionUpdated = vec3f(vertexInputs.uv2.x, vertexInputs.uv3.x, vertexInputs.uv2.y) + cardR * cardOff.x + cardU * cardOff.y;
  }
}
#endif
`;
  }
  return `
#if defined(NATUREBILLBOARD) && defined(UV2) && defined(UV3)
{
  float cardPacked = uv3.y;
  bool cardCylinder = cardPacked < 0.0;
  if (cardCylinder) cardPacked = -1.0 - cardPacked;
  float cardIx = floor(cardPacked / ${STEPS}.0);
  vec2 cardOff = (vec2(cardIx, cardPacked - cardIx * ${STEPS}.0) - ${STEPS / 2}.0) / ${PER_METRE}.0;
  if (dot(cardOff, cardOff) > 0.0) {
    vec3 cardRight = vec3(view[0][0], view[1][0], view[2][0]);
    vec3 cardUp = vec3(view[0][1], view[1][1], view[2][1]);
    if (cardCylinder) {
      cardRight = normalize(vec3(cardRight.x, 0.0, cardRight.z) + vec3(0.00001, 0.0, 0.0));
      cardUp = vec3(0.0, 1.0, 0.0);
    }
#ifdef INSTANCES
    vec3 cardC0 = world0.xyz;
    vec3 cardC1 = world1.xyz;
    vec3 cardC2 = world2.xyz;
#else
    vec3 cardC0 = world[0].xyz;
    vec3 cardC1 = world[1].xyz;
    vec3 cardC2 = world[2].xyz;
#endif
    float cardS = max(length(cardC0), 0.0001);
    vec3 cardR = vec3(dot(cardC0, cardRight), dot(cardC1, cardRight), dot(cardC2, cardRight)) / cardS;
    vec3 cardU = vec3(dot(cardC0, cardUp), dot(cardC1, cardUp), dot(cardC2, cardUp)) / cardS;
    positionUpdated = vec3(uv2.x, uv3.x, uv2.y) + cardR * cardOff.x + cardU * cardOff.y;
  }
}
#endif
`;
}
