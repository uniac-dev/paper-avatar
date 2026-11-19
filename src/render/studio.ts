import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPerson } from '../art/person.js';
import type { AvatarRecipe } from '../identity.js';
import { paperMaps } from './paper-maps.js';
import type { CameraOptions } from './types.js';
import { clamp, finite, type Frame } from './surface.js';

function paperContactShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Paper avatars require a Canvas 2D context.');
  function footprint(x: number, y: number, rx: number, ry: number, stops: number[][]) {
    ctx!.save();
    ctx!.translate(x, y);
    ctx!.scale(rx, ry);
    const fade = ctx!.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const stop of stops) fade.addColorStop(stop[0]!, 'rgba(49,37,30,' + stop[1] + ')');
    ctx!.fillStyle = fade;
    ctx!.fillRect(-1, -1, 2, 2);
    ctx!.restore();
  }
  footprint(279, 112, 221, 83, [
    [0, 0.3],
    [0.52, 0.18],
    [0.78, 0.06],
    [1, 0]
  ]);
  footprint(259, 133, 159, 69, [
    [0, 0.56],
    [0.63, 0.47],
    [0.81, 0.29],
    [0.91, 0.08],
    [1, 0]
  ]);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 2.5),
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      toneMapped: false
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.009;
  return ground;
}

function lightStudio(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  renderer.setClearColor(0, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  let environment: THREE.WebGLRenderTarget;
  try {
    environment = pmrem.fromScene(room, 0.06);
  } finally {
    pmrem.dispose();
    room.dispose();
  }
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.38;
  scene.add(new THREE.HemisphereLight(0xfff5e6, 0xd2b6a7, 0.42));
  const target = new THREE.Object3D();
  target.position.set(0, 1.25, 0);
  scene.add(target);
  // Three samples across one softbox keep the nose, lapels and hair edges legible.
  for (const [x, y, z] of [
    [-5.8, 7.0, 4.85],
    [-3.45, 6.6, 5.15],
    [-4.3, 5.05, 5.35]
  ] as const) {
    const light = new THREE.DirectionalLight(0xffedde, 0.89);
    light.position.set(x, y, z);
    light.target = target;
    light.castShadow = true;
    const shadow = light.shadow;
    shadow.mapSize.set(768, 768);
    Object.assign(shadow.camera, { left: -2.1, right: 2.1, top: 2.1, bottom: -2.1, near: 2, far: 13 });
    shadow.camera.updateProjectionMatrix();
    shadow.radius = 4.8;
    shadow.blurSamples = 6;
    shadow.bias = 0.00003;
    shadow.normalBias = 0.003;
    scene.add(light);
  }
  // The matte fill returns a little light to the folded side of the face.
  const bounce = new THREE.DirectionalLight(0xf7eeeb, 0.26);
  bounce.position.set(3.6, 2.1, 3.4);
  scene.add(bounce);
  const rim = new THREE.DirectionalLight(0xe9f0ff, 0.54);
  rim.position.set(2.2, 3.7, -3.8);
  scene.add(rim);
  return environment;
}

async function loadPaper() {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled(paperMaps.map((map) => loader.loadAsync(map)));
  const maps: THREE.Texture[] = [];
  let failure: PromiseRejectedResult | undefined;
  for (const result of results) {
    if (result.status === 'fulfilled') maps.push(result.value);
    else failure = result;
  }
  if (failure) {
    maps.forEach((texture) => texture.dispose());
    throw failure.reason;
  }
  return maps;
}

async function createStudio(initialRecipe: AvatarRecipe) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  const scene = new THREE.Scene();
  let environment: THREE.WebGLRenderTarget | undefined;
  let paper: THREE.Texture[] = [];
  function dispose() {
    const buffers = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse((node) => {
      if (node instanceof THREE.DirectionalLight) node.shadow.dispose();
      if (!(node instanceof THREE.Mesh)) return;
      buffers.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        materials.add(material);
    });
    const textures = new Set(paper);
    for (const material of materials) {
      for (const prop of Object.values(material)) if (prop instanceof THREE.Texture) textures.add(prop);
      material.dispose();
    }
    for (const geometry of buffers) geometry.dispose();
    for (const texture of textures) texture.dispose();
    environment?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    scene.clear();
  }

  try {
    const rig = createPerson(THREE, initialRecipe);
    scene.add(rig.root);
    environment = lightStudio(renderer, scene);
    const floor = paperContactShadow();
    scene.add(floor);
    paper = await loadPaper();
    const [diffuse, normal, roughness] = paper;
    diffuse!.colorSpace = THREE.SRGBColorSpace;
    for (const map of paper) {
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.setScalar(0.96);
      map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
    rig.root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials: THREE.Material[] = Array.isArray(node.material) ? node.material : [node.material];
      for (const mat of materials) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        mat.map = diffuse!;
        mat.normalMap = normal!;
        mat.normalScale.set(0.37, 0.37);
        mat.roughnessMap = roughness!;
        mat.roughness = 1;
        mat.needsUpdate = true;
      }
    });
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 30);
    let current = initialRecipe;
    const radians = THREE.MathUtils.degToRad;
    return {
      draw(recipe: AvatarRecipe, options: CameraOptions, frame: Frame, idle: boolean) {
        if (recipe !== current) {
          rig.setRecipe(recipe);
          current = recipe;
        }
        const yawRange = clamp(finite(options.headYawRange, 25), 0, 100);
        const pitchRange = clamp(finite(options.headPitchRange, 8), 0, 60);
        const body = 4 + frame.x * clamp(finite(options.bodyYawRange, 1.5), 0, 90);
        const drift = idle && !frame.reduced ? Math.sin(frame.seconds * 0.97) : 0;
        const yaw = clamp(frame.x + drift * 0.019, -1, 1) * yawRange;
        const pitch = clamp(frame.y + drift * 0.024, -1, 1) * pitchRange;
        rig.body.rotation.y = radians(body);
        rig.head.rotation.order = 'YXZ';
        rig.head.rotation.y = radians(finite(options.neutralYaw, -30) - body + yaw);
        rig.head.rotation.x = -radians(finite(options.neutralPitch, 0) + pitch);
        rig.head.rotation.z = radians(-1.43 - yaw * 0.062);
        const portrait = options.framing === 'portrait';
        const aspect = frame.width / frame.height;
        const scale = clamp(finite(options.zoom, 1), 0.2, 5);
        const height = Math.max(portrait ? 1.93 : 3.05, (portrait ? 1.43 : 2.55) / aspect) / scale;
        const width = height * aspect;
        const aimX = -finite(options.position?.x, 0) * width;
        const aimY = (portrait ? 1.81 : 1.31) - finite(options.position?.y, 0) * height;
        camera.left = -width / 2;
        camera.right = width / 2;
        camera.top = height / 2;
        camera.bottom = -height / 2;
        camera.position.set(aimX, aimY + 0.55, 6);
        camera.lookAt(aimX, aimY, 0);
        camera.updateProjectionMatrix();
        floor.visible = !portrait;
        if (renderer.domElement.width !== frame.width || renderer.domElement.height !== frame.height) {
          renderer.setSize(frame.width, frame.height, false);
        }
        renderer.render(scene, camera);
        return renderer.domElement;
      },
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

// One private context serves a roster of avatars. Each draw is immediately copied
// to its owning canvas before another viewer or an atlas can change the scene.
type Studio = Awaited<ReturnType<typeof createStudio>>;
let studio: Promise<Studio> | undefined;
let holders = 0;
let closing: ReturnType<typeof setTimeout> | undefined;

export function acquireStudio(recipe: AvatarRecipe) {
  if (closing !== undefined) clearTimeout(closing);
  const ready = (studio ??= createStudio(recipe));
  holders++;
  let released = false;
  return {
    ready,
    release() {
      if (released) return;
      released = true;
      holders--;
      if (holders) return;
      closing = setTimeout(() => {
        if (holders || studio !== ready) return;
        studio = undefined;
        closing = undefined;
        void ready.then(
          (value) => value.dispose(),
          () => {}
        );
      }, 250);
    }
  };
}
