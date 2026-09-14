const fs = require('fs');
const path = require('path');

const srcHtml = fs.readFileSync(path.join(__dirname, '../reference/momozuki-3d.prototype.html'), 'utf8');

// Extract ASSET_TORII_GLB_B64
const t1 = srcHtml.indexOf('ASSET_TORII_GLB_B64');
const tStart = srcHtml.indexOf('"', t1) + 1;
const tEnd = srcHtml.indexOf('"', tStart);
const toriiB64 = srcHtml.substring(tStart, tEnd);

// Extract ASSET_SAKURA_GLB_B64
const s1 = srcHtml.indexOf('ASSET_SAKURA_GLB_B64');
const sStart = srcHtml.indexOf('"', s1) + 1;
const sEnd = srcHtml.indexOf('"', sStart);
const sakuraB64 = srcHtml.substring(sStart, sEnd);

const code = `'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const ASSET_TORII_GLB_B64 = "${toriiB64}";
const ASSET_SAKURA_GLB_B64 = "${sakuraB64}";

function b64ToBuffer(b64: string): ArrayBuffer {
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

interface GLTFPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
}

interface GLTFMesh {
  primitives: GLTFPrimitive[];
}

interface GLTFMaterial {
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    roughnessFactor?: number;
    metallicFactor?: number;
  };
}

interface GLTFJson {
  meshes: GLTFMesh[];
  accessors: Array<{
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }>;
  bufferViews: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
  }>;
  materials?: GLTFMaterial[];
}

function parseGLB(buf: ArrayBuffer): { json: GLTFJson; bin: ArrayBuffer } {
  const view = new DataView(buf);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error('Not a GLB file');
  const jsonChunkLen = view.getUint32(12, true);
  const jsonChunkType = view.getUint32(16, true);
  if (jsonChunkType !== 0x4e4f534a) throw new Error('First GLB chunk not JSON');
  const jsonBytes = new Uint8Array(buf, 20, jsonChunkLen);
  const jsonStr = new TextDecoder('utf-8').decode(jsonBytes);
  const json: GLTFJson = JSON.parse(jsonStr);

  const binOffset = 20 + jsonChunkLen;
  let bin = new ArrayBuffer(0);
  if (binOffset < buf.byteLength) {
    const binChunkLen = view.getUint32(binOffset, true);
    bin = buf.slice(binOffset + 8, binOffset + 8 + binChunkLen);
  }
  return { json, bin };
}

function readAccessor(json: GLTFJson, bin: ArrayBuffer, accessorIdx: number): Float32Array | Uint16Array | Uint32Array {
  const acc = json.accessors[accessorIdx]!;
  const bv = json.bufferViews[acc.bufferView]!;
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);

  const count = acc.count;
  const numComp = acc.type === 'VEC3' ? 3 : acc.type === 'VEC2' ? 2 : 1;
  const total = count * numComp;

  if (acc.componentType === 5126) {
    return new Float32Array(bin, byteOffset, total);
  } else if (acc.componentType === 5123) {
    return new Uint16Array(bin, byteOffset, total);
  } else if (acc.componentType === 5125) {
    return new Uint32Array(bin, byteOffset, total);
  } else {
    throw new Error('Unsupported componentType ' + acc.componentType);
  }
}

function glbToGeometry(b64: string): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  const { json, bin } = parseGLB(b64ToBuffer(b64));
  const prim = json.meshes[0]!.primitives[0]!;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(readAccessor(json, bin, prim.attributes['POSITION']!), 3));
  if (prim.attributes['NORMAL'] !== undefined) {
    geom.setAttribute('normal', new THREE.BufferAttribute(readAccessor(json, bin, prim.attributes['NORMAL']!), 3));
  }
  if (prim.indices !== undefined) {
    geom.setIndex(new THREE.BufferAttribute(readAccessor(json, bin, prim.indices), 1));
  }
  if (!geom.getAttribute('normal')) geom.computeVertexNormals();

  const materials = json.materials || [];
  const matIdx = prim.material ?? 0;
  const matDef = materials[matIdx] || {};
  const pbr = matDef.pbrMetallicRoughness || {};
  const color = pbr.baseColorFactor ? new THREE.Color(pbr.baseColorFactor[0]!, pbr.baseColorFactor[1]!, pbr.baseColorFactor[2]!) : new THREE.Color(0xf4c6ce);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: pbr.roughnessFactor ?? 0.6,
    metalness: pbr.metallicFactor ?? 0.0,
    side: THREE.DoubleSide,
  });
  return { geometry: geom, material: mat };
}

function glbToGroup(b64: string): THREE.Group {
  const { json, bin } = parseGLB(b64ToBuffer(b64));
  const group = new THREE.Group();
  const materials = json.materials || [];
  (json.meshes || []).forEach((meshDef) => {
    (meshDef.primitives || []).forEach((prim) => {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(readAccessor(json, bin, prim.attributes['POSITION']!), 3));
      if (prim.attributes['NORMAL'] !== undefined) {
        geom.setAttribute('normal', new THREE.BufferAttribute(readAccessor(json, bin, prim.attributes['NORMAL']!), 3));
      }
      if (prim.indices !== undefined) {
        geom.setIndex(new THREE.BufferAttribute(readAccessor(json, bin, prim.indices!), 1));
      }
      if (!geom.getAttribute('normal')) geom.computeVertexNormals();

      const matIdx = prim.material ?? 0;
      const matDef = materials[matIdx] || {};
      const pbr = matDef.pbrMetallicRoughness || {};
      const col = pbr.baseColorFactor
        ? new THREE.Color(pbr.baseColorFactor[0]!, pbr.baseColorFactor[1]!, pbr.baseColorFactor[2]!)
        : new THREE.Color(0xc25a48);

      const mat = new THREE.MeshStandardMaterial({
        color: col,
        roughness: pbr.roughnessFactor ?? 0.6,
        metalness: pbr.metallicFactor ?? 0.1,
      });

      const mesh = new THREE.Mesh(geom, mat);
      group.add(mesh);
    });
  });
  return group;
}

function makeGroundTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;

  const grad = ctx.createRadialGradient(256, 256, 10, 256, 256, 360);
  grad.addColorStop(0, '#1e2d23');
  grad.addColorStop(0.5, '#152019');
  grad.addColorStop(1, '#0e1611');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = '#2e342e';
  const pathWidth = 100;
  ctx.fillRect((512 - pathWidth) / 2, 0, pathWidth, 512);

  ctx.strokeStyle = '#212621';
  ctx.lineWidth = 3;
  for (let y = 0; y < 512; y += 42) {
    ctx.beginPath();
    ctx.moveTo((512 - pathWidth) / 2, y);
    ctx.lineTo((512 + pathWidth) / 2, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#2b4434';
  for (let i = 0; i < 3500; i++) {
    const rx = Math.random() * 512;
    if (rx > (512 - pathWidth) / 2 && rx < (512 + pathWidth) / 2) continue;
    ctx.fillRect(rx, Math.random() * 512, 2.5, 2.5);
  }

  ctx.fillStyle = 'rgba(244,198,206,0.5)';
  for (let i = 0; i < 500; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  return tex;
}

function makeAdam127GrassGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const rawV = [
    -0.192843, 0.000000, -1.787765,
     0.192843, 0.000000,  1.787765,
    -0.205069, 3.824270, -1.901107,
     0.205069, 3.824270,  1.901107,
    -1.543872, -0.000000, 1.128148,
     1.543872, -0.000000,-1.128148,
    -1.543873, 3.419215,  1.128148,
     1.543872, 3.419215, -1.128148,
    -1.809653, -0.000000,-0.617587,
     1.809653, -0.000000, 0.617587,
    -1.809654, 4.322569, -0.617588,
     1.809654, 4.322569,  0.617587
  ];

  const positions = new Float32Array(rawV.map((v) => v * 0.35));

  const uvs = new Float32Array([
    0, 0,  1, 0,  0, 1,  1, 1,
    0, 0,  1, 0,  0, 1,  1, 1,
    0, 0,  1, 0,  0, 1,  1, 1
  ]);

  const indices = new Uint16Array([
    0, 1, 3,  0, 3, 2,
    4, 5, 7,  4, 7, 6,
    8, 9, 11, 8, 11, 10
  ]);

  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  return geom;
}

function makeGrassTufts(): THREE.InstancedMesh {
  const geom = makeAdam127GrassGeometry();
  const texture = new THREE.TextureLoader().load('/3d/free_grass.png');
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.35,
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 0.8
  });

  const count = 900;
  const instancedMesh = new THREE.InstancedMesh(geom, mat, count);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    let x = (Math.random() - 0.5) * 100;
    if (Math.abs(x) < 2.5) {
      x += (Math.random() > 0.5 ? 4 : -4);
    }
    const z = (Math.random() - 0.5) * 100;
    const scaleY = 0.5 + Math.random() * 0.6;
    const scaleXZ = 0.6 + Math.random() * 0.5;

    dummy.position.set(x, 0, z);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();

    instancedMesh.setMatrixAt(i, dummy.matrix);
  }
  instancedMesh.instanceMatrix.needsUpdate = true;
  return instancedMesh;
}

function makeMoonTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(110, 110, 10, 128, 128, 128);
  grad.addColorStop(0, '#FFFBEB');
  grad.addColorStop(0.6, '#F1E4C2');
  grad.addColorStop(1, '#D9C89F');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = 'rgba(180,160,120,0.14)';
  [
    [70, 90, 28],
    [150, 140, 36],
    [120, 180, 22],
    [170, 80, 18],
    [90, 160, 20],
  ].forEach(([x, y, r]) => {
    ctx.beginPath();
    ctx.arc(x!, y!, r!, 0, Math.PI * 2);
    ctx.fill();
  });

  return new THREE.CanvasTexture(c);
}

function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(241,228,194,0.9)');
  grad.addColorStop(0.4, 'rgba(241,228,194,0.35)');
  grad.addColorStop(1, 'rgba(241,228,194,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function makePetalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,238,241,1)');
  grad.addColorStop(0.55, 'rgba(244,198,206,0.85)');
  grad.addColorStop(1, 'rgba(244,198,206,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(32, 32, 32, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

function buildTorii(): THREE.Group {
  const group = new THREE.Group();
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x9c4536, roughness: 0.65 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xdfa23b, roughness: 0.4, metalness: 0.15 });
  const gakuMat = new THREE.MeshStandardMaterial({ color: 0xf1e4c2, roughness: 0.6 });

  const pillarGeo = new THREE.CylinderGeometry(0.35, 0.42, 8, 10);
  const pL = new THREE.Mesh(pillarGeo, pillarMat);
  pL.position.set(-3.2, 4, 0);
  group.add(pL);
  const pR = new THREE.Mesh(pillarGeo, pillarMat);
  pR.position.set(3.2, 4, 0);
  group.add(pR);

  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(9, 0.6, 1.1), pillarMat);
  kasagi.position.set(0, 8.3, 0);
  group.add(kasagi);
  const kasagiTop = new THREE.Mesh(new THREE.BoxGeometry(9.7, 0.32, 1.4), trimMat);
  kasagiTop.position.set(0, 8.66, 0);
  group.add(kasagiTop);
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 0.8), trimMat);
  nuki.position.set(0, 6.7, 0);
  group.add(nuki);
  const gaku = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 0.15), gakuMat);
  gaku.position.set(0, 7.55, 0.48);
  group.add(gaku);

  group.position.set(0, 0, -2);
  return group;
}

function makeLantern(x: number, z: number, trimMat: THREE.Material) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x2c2016, roughness: 0.8 }));
  pole.position.set(0, 1.3, 0);
  group.add(pole);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.56, 0.46),
    new THREE.MeshStandardMaterial({ color: 0xe7b15a, emissive: 0xb6631f, emissiveIntensity: 0.75, roughness: 0.5 })
  );
  body.position.set(0, 2.75, 0);
  group.add(body);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 0.58), trimMat);
  cap.position.set(0, 3.06, 0);
  group.add(cap);
  group.position.set(x, 0, z);
  const light = new THREE.PointLight(0xe7a94a, 0.9, 7, 2);
  light.position.set(x, 2.75, z);
  return { group, light };
}

function makeStairs(stoneMat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.28, 1.15), stoneMat);
    step.position.set(0, i * 0.24, 15 - i * 1.25);
    group.add(step);
  }
  return group;
}

function makeMountains(): THREE.Group {
  const group = new THREE.Group();

  const matFar = new THREE.MeshStandardMaterial({ color: 0x16202e, roughness: 0.95 });
  const matMid = new THREE.MeshStandardMaterial({ color: 0x1a2636, roughness: 0.9 });

  const farPeaks = [
    [-65, 22, -80, 28],
    [-35, 30, -95, 38],
    [0, 35, -110, 45],
    [40, 28, -90, 35],
    [70, 20, -75, 26],
  ];
  farPeaks.forEach(([x, h, z, r]) => {
    const geo = new THREE.ConeGeometry(r!, h!, 7);
    const m = new THREE.Mesh(geo, matFar);
    m.position.set(x!, h! / 2, z!);
    group.add(m);
  });

  const midPeaks = [
    [-45, 16, -55, 20],
    [-20, 22, -60, 26],
    [22, 18, -50, 22],
    [50, 14, -45, 18],
  ];
  midPeaks.forEach(([x, h, z, r]) => {
    const geo = new THREE.ConeGeometry(r!, h!, 6);
    const m = new THREE.Mesh(geo, matMid);
    m.position.set(x!, h! / 2, z!);
    group.add(m);
  });

  return group;
}

function makeTrees(): THREE.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x251b14, roughness: 0.9 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1c2b24, roughness: 0.8 });

  const treePositions = [
    [-12, 0, 12],
    [-14, 0, 4],
    [-11, 0, -6],
    [-15, 0, -18],
    [18, 0, 14],
    [22, 0, 4],
    [19, 0, -6],
    [24, 0, -20],
  ];

  treePositions.forEach(([x, , z]) => {
    const treeGroup = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 4.5, 6), trunkMat);
    trunk.position.set(0, 2.25, 0);
    treeGroup.add(trunk);

    [
      [3.8, 1.8],
      [5.2, 1.4],
      [6.4, 0.9],
    ].forEach(([y, r]) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r!, 2.2, 7), foliageMat);
      cone.position.set(0, y!, 0);
      treeGroup.add(cone);
    });

    treeGroup.position.set(x!, 0, z!);
    group.add(treeGroup);
  });

  return group;
}

function makeRocks(): THREE.InstancedMesh {
  const geom = new THREE.DodecahedronGeometry(0.35, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x363b38, roughness: 0.95 });

  const count = 90;
  const mesh = new THREE.InstancedMesh(geom, mat, count);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    let x = (Math.random() - 0.5) * 50;
    if (Math.abs(x) < 2.8) x += (Math.random() > 0.5 ? 1 : -1) * 3.2;
    const z = (Math.random() - 0.5) * 50;
    const s = 0.4 + Math.random() * 0.8;

    dummy.position.set(x, s * 0.15, z);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    dummy.scale.set(s, s * (0.6 + Math.random() * 0.4), s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

const KF = [
  { pos: [0, 11, 20], look: [0, 4.4, -2] },
  { pos: [-15, 7, 5], look: [2, 4.4, -3] },
  { pos: [10, 6, 6], look: [-2, 4.4, -3] },
];

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function CinematicHero3D() {
  const cinemaRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [activeChapter, setActiveChapter] = useState(0);

  useEffect(() => {
    const container = canvasContainerRef.current;
    const cinema = cinemaRef.current;
    if (!container || !cinema) return;

    let animFrameId: number;
    let introDone = false;
    let targetProgress = 0;
    let renderedProgress = -1;

    const clock = new THREE.Clock();
    const isSmall = window.innerWidth < 760;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x151d29);
    scene.fog = new THREE.FogExp2(0x151d29, 0.0165);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);

    const introStart = { pos: [0, 14, 72], look: [0, 4, -2] };
    camera.position.set(introStart.pos[0]!, introStart.pos[1]!, introStart.pos[2]!);
    camera.lookAt(introStart.look[0]!, introStart.look[1]!, introStart.look[2]!);

    // Lights
    scene.add(new THREE.HemisphereLight(0x3a4a63, 0x141018, 0.65));
    scene.add(new THREE.AmbientLight(0x223247, 0.45));
    const moonLight = new THREE.DirectionalLight(0xf1e4c2, 0.85);
    moonLight.position.set(10, 20, -30);
    scene.add(moonLight);

    // Ground
    const groundMat = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Lightweight 1-draw-call InstancedMesh Grass Tufts
    scene.add(makeGrassTufts());

    scene.add(makeRocks());

    // Distant 3D Mountains & Trees
    scene.add(makeMountains());
    scene.add(makeTrees());

    // Stairs & Torii model
    const stoneMat: THREE.Material = new THREE.MeshStandardMaterial({ color: 0x4b4b46, roughness: 1 });
    scene.add(makeStairs(stoneMat));
    try {
      const toriiModel = glbToGroup(ASSET_TORII_GLB_B64);
      toriiModel.scale.set(0.017, 0.017, 0.017);
      toriiModel.position.set(0, 0, -2);
      scene.add(toriiModel);
    } catch {
      scene.add(buildTorii());
    }

    // Lanterns
    const trimMat: THREE.Material = new THREE.MeshStandardMaterial({ color: 0xdfa23b, roughness: 0.4, metalness: 0.15 });
    [
      [-4.2, 10],
      [4.2, 10],
      [-5.6, 4],
      [5.6, 4],
    ].forEach(([x, z]) => {
      const { group, light } = makeLantern(x!, z!, trimMat);
      scene.add(group);
      scene.add(light);
    });

    // Moon & Halo
    const moonMat = new THREE.MeshBasicMaterial({ map: makeMoonTexture() });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 32), moonMat);
    moon.position.set(11, 17, -42);
    scene.add(moon);

    const haloMat = new THREE.SpriteMaterial({ map: makeGlowTexture(), color: 0xf1e4c2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(30, 30, 1);
    halo.position.copy(moon.position);
    scene.add(halo);

    // Stars
    const starCount = isSmall ? 220 : 400;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 90 + Math.random() * 60;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * 0.9;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = 10 + Math.random() * 60;
      starPos[i * 3 + 2] = -20 - Math.random() * 90;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xf2ead3, size: 0.55, sizeAttenuation: true }));
    scene.add(stars);

    // Sakura Petals
    const petalCount = isSmall ? 130 : 240;
    const petalVel: Array<{
      x: number;
      y: number;
      z: number;
      vy: number;
      phase: number;
      freq: number;
      amp: number;
      rx: number;
      ry: number;
      rz: number;
      spin: number;
      scale: number;
    }> = [];

    for (let i = 0; i < petalCount; i++) {
      petalVel.push({
        x: (Math.random() - 0.5) * 46,
        y: Math.random() * 26,
        z: (Math.random() - 0.5) * 40,
        vy: 0.5 + Math.random() * 0.9,
        phase: Math.random() * Math.PI * 2,
        freq: 0.4 + Math.random() * 0.6,
        amp: 0.4 + Math.random() * 1.1,
        rx: Math.random() * Math.PI * 2,
        ry: Math.random() * Math.PI * 2,
        rz: Math.random() * Math.PI * 2,
        spin: 0.4 + Math.random() * 1.1,
        scale: 0.32 + Math.random() * 0.45,
      });
    }

    let petalMesh: THREE.InstancedMesh | THREE.Points;
    let petalDummy: THREE.Object3D | null = null;
    let petalUsesMesh = false;

    try {
      const { geometry, material } = glbToGeometry(ASSET_SAKURA_GLB_B64);
      petalMesh = new THREE.InstancedMesh(geometry, material, petalCount);
      petalDummy = new THREE.Object3D();
      for (let i = 0; i < petalCount; i++) {
        const v = petalVel[i]!;
        petalDummy.position.set(v.x, v.y, v.z);
        petalDummy.rotation.set(v.rx, v.ry, v.rz);
        petalDummy.scale.setScalar(v.scale);
        petalDummy.updateMatrix();
        (petalMesh as THREE.InstancedMesh).setMatrixAt(i, petalDummy.matrix);
      }
      petalUsesMesh = true;
      scene.add(petalMesh);
    } catch {
      const petalGeo = new THREE.BufferGeometry();
      const petalPos = new Float32Array(petalCount * 3);
      for (let i = 0; i < petalCount; i++) {
        const v = petalVel[i]!;
        petalPos[i * 3] = v.x;
        petalPos[i * 3 + 1] = v.y;
        petalPos[i * 3 + 2] = v.z;
      }
      petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
      const petalMat = new THREE.PointsMaterial({
        map: makePetalTexture(),
        color: 0xf4c6ce,
        size: isSmall ? 0.35 : 0.45,
        transparent: true,
        alphaTest: 0.08,
        depthWrite: false,
        sizeAttenuation: true,
      });
      petalMesh = new THREE.Points(petalGeo, petalMat);
      petalUsesMesh = false;
      scene.add(petalMesh);
    }

    const applyCamera = (progress: number) => {
      let a, b, t;
      if (progress <= 0.5) {
        a = KF[0]!;
        b = KF[1]!;
        t = smoothStep(progress / 0.5);
      } else {
        a = KF[1]!;
        b = KF[2]!;
        t = smoothStep((progress - 0.5) / 0.5);
      }
      const px = lerp(a.pos[0]!, b.pos[0]!, t);
      const py = lerp(a.pos[1]!, b.pos[1]!, t);
      const pz = lerp(a.pos[2]!, b.pos[2]!, t);
      const lx = lerp(a.look[0]!, b.look[0]!, t);
      const ly = lerp(a.look[1]!, b.look[1]!, t);
      const lz = lerp(a.look[2]!, b.look[2]!, t);

      camera.position.set(px, py, pz);
      camera.lookAt(lx, ly, lz);
    };

    const computeProgress = () => {
      if (!cinema) return 0;
      const rect = cinema.getBoundingClientRect();
      const total = cinema.offsetHeight - window.innerHeight;
      if (total <= 0) return 0;
      const p = -rect.top / total;
      return Math.min(1, Math.max(0, p));
    };

    const handleScroll = () => {
      targetProgress = computeProgress();
      const idx = targetProgress < 0.33 ? 0 : targetProgress < 0.66 ? 1 : 2;
      setActiveChapter(idx);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    const tick = () => {
      animFrameId = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();

      if (!introDone) {
        // Handled by intro animation
      } else if (renderedProgress !== targetProgress) {
        applyCamera(targetProgress);
        renderedProgress = targetProgress;
      }

      if (petalMesh) {
        if (petalUsesMesh && petalDummy) {
          for (let i = 0; i < petalCount; i++) {
            const v = petalVel[i]!;
            v.y -= v.vy * dt;
            v.x += Math.sin(t * v.freq + v.phase) * v.amp * dt;
            v.rx += v.spin * dt * 0.4;
            v.ry += v.spin * dt * 0.6;
            v.rz += v.spin * dt * 0.3;
            if (v.y < -1) {
              v.y = 24 + Math.random() * 4;
              v.x = (Math.random() - 0.5) * 46;
              v.z = (Math.random() - 0.5) * 40;
            }
            petalDummy.position.set(v.x, v.y, v.z);
            petalDummy.rotation.set(v.rx, v.ry, v.rz);
            petalDummy.scale.setScalar(v.scale);
            petalDummy.updateMatrix();
            (petalMesh as THREE.InstancedMesh).setMatrixAt(i, petalDummy.matrix);
          }
          (petalMesh as THREE.InstancedMesh).instanceMatrix.needsUpdate = true;
        } else {
          const attr = (petalMesh as THREE.Points).geometry.getAttribute('position') as THREE.BufferAttribute;
          if (attr && attr.array) {
            const pos = attr.array as Float32Array;
            for (let i = 0; i < petalCount; i++) {
              const v = petalVel[i]!;
              const yVal = pos[i * 3 + 1] ?? 0;
              const xVal = pos[i * 3] ?? 0;
              const zVal = pos[i * 3 + 2] ?? 0;

              const nextY = yVal - v.vy * dt;
              const nextX = xVal + Math.sin(t * v.freq + v.phase) * v.amp * dt;

              if (nextY < -1) {
                pos[i * 3 + 1] = 24 + Math.random() * 4;
                pos[i * 3] = (Math.random() - 0.5) * 46;
                pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
              } else {
                pos[i * 3 + 1] = nextY;
                pos[i * 3] = nextX;
                pos[i * 3 + 2] = zVal;
              }
            }
            attr.needsUpdate = true;
          }
        }
      }

      renderer.render(scene, camera);
    };

    // Intro camera step
    const duration = 1900;
    const startTime = performance.now();
    const runIntro = () => {
      const step = (now: number) => {
        const progressT = Math.min(1, (now - startTime) / duration);
        const e = 1 - Math.pow(1 - progressT, 3);
        const a = introStart;
        const b = KF[0]!;
        const px = lerp(a.pos[0]!, b.pos[0]!, e);
        const py = lerp(a.pos[1]!, b.pos[1]!, e);
        const pz = lerp(a.pos[2]!, b.pos[2]!, e);
        const lx = lerp(a.look[0]!, b.look[0]!, e);
        const ly = lerp(a.look[1]!, b.look[1]!, e);
        const lz = lerp(a.look[2]!, b.look[2]!, e);
        camera.position.set(px, py, pz);
        camera.lookAt(lx, ly, lz);

        if (progressT < 1) {
          requestAnimationFrame(step);
        } else {
          introDone = true;
          renderedProgress = -1;
        }
      };
      requestAnimationFrame(step);
    };

    tick();
    const timer = setTimeout(() => {
      runIntro();
    }, 260);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement && container) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div id="cinema" ref={cinemaRef}>
      <div className="cinema-sticky">
        <div ref={canvasContainerRef} id="webgl" />

        <div className="cinema-overlay">
          <div className="vertical-jp">
            また、どこかで<span className="en">SEE YOU SOMEWHERE AGAIN</span>
          </div>

          <div className="chapter-marker">
            <span className={\`num \${activeChapter === 0 ? 'active' : ''}\`}>00</span>
            <span className={\`num \${activeChapter === 1 ? 'active' : ''}\`}>01</span>
            <span className={\`num \${activeChapter === 2 ? 'active' : ''}\`}>02</span>
          </div>

          <div className="scroll-cue" style={{ opacity: activeChapter === 0 ? 1 : 0 }}>
            <span>Scroll to explore</span>
            <span className="line" />
          </div>

          {/* Chapter 00 */}
          <div className={\`chapter-text \${activeChapter === 0 ? 'visible' : ''}\`} id="chapter-0">
            <div className="eyebrow-row">
              <span className="dot" />
              <span className="tagline">Chapter 00: Early Access</span>
            </div>
            <h1 className="hand">
              Small souls,
              <br />
              a seat reserved.
            </h1>
            <p>
              555 hand-drawn companions from a forgotten world are waiting at the gate. Verify your wallet and claim your place before the moon sets.
            </p>
            <div className="actions interactive">
              <a href="#claim" className="btn btn-coral">
                Connect Wallet
              </a>
            </div>
          </div>

          {/* Chapter 01 */}
          <div className={\`chapter-text \${activeChapter === 1 ? 'visible' : ''}\`} id="chapter-1">
            <div className="eyebrow-row">
              <span className="tagline">Chapter 01: The Collection</span>
              <span className="dot" />
            </div>
            <h2 className="hand">
              Every companion carries
              <br />
              a story, and a reason to wander.
            </h2>
            <p>
              Each MOMO travels a different road under the same moon, collecting memories, mending broken things, and finding beauty in the ordinary.
            </p>
            <div className="stats">
              <div>
                <div className="stat-num mono">555</div>
                <div className="label stat-label">Companions</div>
              </div>
              <div>
                <div className="stat-num mono">555</div>
                <div className="label stat-label">Spots Available</div>
              </div>
            </div>
          </div>

          {/* Chapter 02 */}
          <div className={\`chapter-text \${activeChapter === 2 ? 'visible' : ''}\`} id="chapter-2">
            <div className="eyebrow-row">
              <span className="dot" />
              <span className="tagline">Chapter 02: Step Through</span>
            </div>
            <h2 className="hand">
              The gate is open.
              <br />
              Your seat is not guaranteed.
            </h2>
            <p>
              Verification takes under a minute. No gas, no mint queue, just a signature and a place among the collectors.
            </p>
            <div className="actions interactive">
              <a href="#claim" className="btn btn-outline">
                Enter the Claim →
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
`;

fs.writeFileSync(path.join(__dirname, '../components/momozuki/CinematicHero3D.tsx'), code);
console.log('Successfully updated build_cinematic_hero.js with GLTFLoader for Grass.glb!');
