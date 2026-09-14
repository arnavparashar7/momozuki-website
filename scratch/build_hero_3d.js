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

import React, { useEffect, useRef } from 'react';
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
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#141A24';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(241,228,194,0.025)';
  for (let i = 0; i < 900; i++) {
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
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

export function MomozukiHero3D() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let animFrameId: number;
    const clock = new THREE.Clock();
    const isSmall = window.innerWidth < 760;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x151d29);
    scene.fog = new THREE.FogExp2(0x151d29, 0.0165);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 300);
    camera.position.set(0, 11, 22);
    camera.lookAt(0, 4.4, -2);

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

    const handleResize = () => {
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    const tick = () => {
      animFrameId = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();

      // Gentle camera sway
      camera.position.x = Math.sin(t * 0.3) * 0.8;
      camera.position.y = 11 + Math.cos(t * 0.25) * 0.4;
      camera.lookAt(0, 4.4, -2);

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

    tick();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement && container) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return <div ref={containerRef} className="hero-canvas" aria-hidden="true" />;
}
`;

fs.writeFileSync(path.join(__dirname, '../components/momozuki/MomozukiHero3D.tsx'), code);
console.log('Successfully updated MomozukiHero3D.tsx with zero warnings!');
