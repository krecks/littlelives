/**
 * The part of Babylon.js the game uses, imported from its own modules instead of the package
 * root (which pulls in all of Babylon: about 6 MB of script). Rendering code imports Babylon
 * from here, so this list is the whole surface; add a name here when a file needs a new one.
 *
 * Each module registers its own side effects (scene components, shaders on demand). Features
 * that patch other classes have to be imported for their side effect alone (below).
 */

// Thin instances (`thinInstanceSetBuffer` & co. on `Mesh`).
import '@babylonjs/core/Meshes/thinInstanceMesh';
// `scene.createPickingRay` (analytic picking in `BabylonRenderer.pick`).
import '@babylonjs/core/Culling/ray';
// Multiple render targets, for ambient occlusion's geometry buffer (SSAO2, Ultra quality).
import '@babylonjs/core/Engines/Extensions/engine.multiRender';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender';

export { Bone } from '@babylonjs/core/Bones/bone';
export { Skeleton } from '@babylonjs/core/Bones/skeleton';
export { Buffer, VertexBuffer } from '@babylonjs/core/Buffers/buffer';
export { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
export { Camera } from '@babylonjs/core/Cameras/camera';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput';
export type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
export { Constants } from '@babylonjs/core/Engines/constants';
export { Engine } from '@babylonjs/core/Engines/engine';
export { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
export { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
export { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
export { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { Light } from '@babylonjs/core/Lights/light';
export { PointLight } from '@babylonjs/core/Lights/pointLight';
export { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
export { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
export { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
export { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
export { Material } from '@babylonjs/core/Materials/material';
export type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
export { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
export { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
export { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
export { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
export { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
export { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { Matrix, Quaternion, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
export { Viewport } from '@babylonjs/core/Maths/math.viewport';
export type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
export { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
export type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { CreateScreenshotAsync } from '@babylonjs/core/Misc/screenshotTools';
// Loaded on demand (`buildFx.ts`).
export type { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
export { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
export { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
export { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
export { Scene } from '@babylonjs/core/scene';
export type { Nullable } from '@babylonjs/core/types';
