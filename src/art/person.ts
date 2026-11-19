import type * as Three from 'three';
import type { AvatarRecipe } from '../identity.js';

type Pattern = number[][];
type Stock = Three.MeshStandardMaterial;
type Part = Three.Group;
type RailOptions = {
  closed?: boolean;
  steps?: number;
  tones?: number[];
  edge?: number;
  tension?: number;
  softFolds?: number;
  panelTones?: number[];
  lined?: boolean;
};

export interface PersonPose {
  x?: number;
  y?: number;
  time?: number;
  reduced?: boolean;
}

// Y is up. The face points along +Z before the portrait's three-quarter turn.
// Each part is an authored cardstock pattern. Switching recipes reuses the meshes.
export function createPerson(T: typeof Three, recipe: AvatarRecipe) {
  const root = new T.Group();
  function group(parent: Part, name: string) {
    const node = new T.Group();
    node.name = name;
    parent.add(node);
    return node;
  }
  const torso = group(root, 'Shoulders');
  const head = group(torso, 'Head pivot');
  const pivotY = 1.235;
  head.position.y = pivotY;
  const portrait = group(head, 'Head, hair and accessories');
  portrait.position.y = -pivotY - 0.035;
  portrait.scale.set(1.19, 1, 1.13);

  function paper() {
    return new T.MeshStandardMaterial({ roughness: 0.93, metalness: 0, vertexColors: true, side: T.DoubleSide });
  }
  const skin = paper(),
    hair = paper(),
    cloth = paper(),
    lining = paper(),
    shirt = paper(),
    ink = paper(),
    gold = paper();
  hair.name = 'Hair stock';
  // Striations follow the unrolled coordinates of each individual cut lock.
  // Filter each octave at its pixel footprint so closely spaced fibers settle
  // into one value when the same portrait is used as a small sidebar icon.
  hair.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 paperFiber; varying vec2 vPaperFiber;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaperFiber = paperFiber;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
       varying vec2 vPaperFiber;
       float cutPaperFiber(float phase) {
         return sin(phase) * (1.0 - smoothstep(1.1, 3.1, fwidth(phase)));
       }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
       float along = vPaperFiber.x;
       float across = vPaperFiber.y + 0.004 * sin(along * 10.0 + vPaperFiber.y * 23.0);
       float ridges = cutPaperFiber(across * 196.0 + 1.6 * sin(across * 48.0));
       float filament = cutPaperFiber(across * 621.0 + 2.4 * sin(along * 6.0 + across * 57.0));
       float torn = smoothstep(-0.8, 0.8, sin(along * 9.0 + across * 21.0));
       diffuseColor.rgb *= 0.997 + (0.003 + 0.004 * torn) * ridges + 0.003 * filament;`
      );
  };
  ink.color.set('#32303a');
  gold.color.set('#c99750');
  shirt.color.set('#353441');

  // The grain lies in the sheet. A world-space unit has the same textile
  // scale on a cheek, a turned cuff, or the underside of a hair ribbon.
  function paperGeometry(parent: Part, name: string, stock: Stock) {
    const positions: number[] = [],
      normals: number[] = [],
      shades: number[] = [],
      uvs: number[] = [];
    const headScale =
      parent === portrait || parent.parent === portrait ? portrait.scale.clone() : new T.Vector3(1, 1, 1);
    if (parent.parent === portrait) headScale.multiply(parent.scale);
    const fibers: number[] = [];
    function polygon(
      points: Three.Vector3[],
      facing: Three.Vector3,
      tone: number,
      smooth?: Three.Vector3[],
      fiberUV?: Three.Vector2[]
    ) {
      const physical = points.map((p) => p.clone().multiply(headScale));
      const surface = new T.Vector3();
      for (let i = 0; i < points.length; i++)
        surface.add(new T.Vector3().crossVectors(physical[i], physical[(i + 1) % points.length]));
      surface.normalize();
      const grain = new T.Vector3(0, 1, 0);
      if (Math.abs(surface.y) > 0.86) grain.set(0, 0, 1);
      const across = new T.Vector3().crossVectors(grain, surface).normalize();
      grain.crossVectors(surface, across).normalize();
      const uv = physical.map((p) => new T.Vector2(p.dot(across), p.dot(grain)));
      const triangles = T.ShapeUtils.triangulateShape(uv, []);
      for (const triangle of triangles) {
        const [a, b, c] = triangle.map((i) => points[i]);
        const cross = new T.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
        if (cross.lengthSq() < 1e-17) continue;
        if (cross.dot(facing) < 0) triangle.reverse();
        for (const i of triangle) {
          const n = smooth ? smooth[i] : facing;
          positions.push(...points[i]);
          normals.push(...n);
          shades.push(tone, tone, tone);
          uvs.push(uv[i].x, uv[i].y);
          if (stock === hair) {
            const f = fiberUV?.[i] ?? uv[i];
            fibers.push(f.x, f.y);
          }
        }
      }
    }
    function finish() {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new T.Float32BufferAttribute(shades, 3));
      geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
      if (fibers.length) geometry.setAttribute('paperFiber', new T.Float32BufferAttribute(fibers, 2));
      const mesh = new T.Mesh(geometry, stock);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }
    return { polygon, finish };
  }
  const vector = ([x, y, z]: number[]) => new T.Vector3(x, y, z);
  function normalOf(points: Three.Vector3[]) {
    const normal = new T.Vector3();
    for (let i = 0; i < points.length; i++)
      normal.add(new T.Vector3().crossVectors(points[i], points[(i + 1) % points.length]));
    return normal.normalize();
  }

  // Flat polygonal nets carry one normal per panel. Exposed outlines can
  // turn under twice: a narrow light-catching arris and a darker cut edge.
  function cut(parent: Part, name: string, stock: Stock, vertices: Pattern, faces: Pattern, edge = 0) {
    const g = paperGeometry(parent, name, stock);
    const boundary = new Map<string, { a: number; b: number; normal: Three.Vector3; tone: number }>();
    for (const [tone, ...ids] of faces) {
      const points = ids.map((i) => vector(vertices[i]));
      const normal = normalOf(points);
      g.polygon(points, normal, tone);
      if (!edge) continue;
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i],
          b = ids[(i + 1) % ids.length],
          key = [Math.min(a, b), Math.max(a, b)].join('-');
        if (boundary.has(key)) {
          boundary.delete(key);
          continue;
        }
        boundary.set(key, { a, b, normal, tone });
      }
    }
    for (const { a, b, normal, tone } of boundary.values()) {
      const start = vector(vertices[a]),
        end = vector(vertices[b]);
      const out = end
        .clone()
        .sub(start)
        .normalize()
        .cross(normal)
        .multiplyScalar(edge * 0.27);
      const bevel = (p: Three.Vector3) =>
        p
          .clone()
          .add(out)
          .addScaledVector(normal, -edge * 0.32);
      const under = (p: Three.Vector3) => p.clone().addScaledVector(normal, -edge);
      for (const [points, t] of [
        [[start, bevel(start), bevel(end), end], tone * 0.99],
        [[bevel(start), under(start), under(end), bevel(end)], tone * 0.7],
      ] as [Three.Vector3[], number][]) {
        g.polygon(points, normalOf(points), t);
      }
    }
    return g.finish();
  }

  // A strip of cardstock bends along each authored rail. Normals follow
  // the bend lengthwise while a deliberate fold across the width stays crisp.
  function strip(
    parent: Part,
    name: string,
    stock: Stock,
    rails: Pattern[],
    {
      closed = false,
      steps = 3,
      tones = [],
      edge = 0.012,
      tension = 0.37,
      softFolds = 0,
      panelTones = [],
      lined = false,
    }: RailOptions = {}
  ) {
    const curves = rails.map((rail) => new T.CatmullRomCurve3(rail.map(vector), closed, 'catmullrom', tension));
    const counts = (rails[0].length - (closed ? 0 : 1)) * steps;
    const rows = curves.map((c) => Array.from({ length: counts + 1 }, (_, i) => c.getPoint(i / counts)));
    const tangents = curves.map((c) => Array.from({ length: counts + 1 }, (_, i) => c.getTangent(i / counts)));
    // The across coordinate is shared at each fold. Changes in lock width
    // fan the fibers towards a tapered end. Closed hair caps grow crown to rim.
    const flow =
      stock === hair
        ? rows.map((rail, row) => {
            let length = 0;
            return rail.map((point, i) => {
              if (i) length += point.distanceTo(rail[i - 1]);
              let width = 0;
              for (let r = 1; r <= row; r++) width += rows[r][i].distanceTo(rows[r - 1][i]);
              return closed ? new T.Vector2(width, length) : new T.Vector2(length, width);
            });
          })
        : undefined;
    const g = paperGeometry(parent, name, stock);
    const edges: [Three.Vector3[], Three.Vector3[], number][] = [];
    for (let v = 0; v < rows.length - 1; v++) {
      const faceNormals = rows[v].map((p, i) => {
        const across = rows[v + 1][i].clone().sub(p);
        return [v, v + 1].map((k) => {
          const foldNormal = tangents[k][i].clone().cross(across).normalize();
          if (softFolds && k > 0 && k < rows.length - 1) {
            const l = rows[k][i]
                .clone()
                .sub(rows[k - 1][i])
                .normalize(),
              r = rows[k + 1][i].clone().sub(rows[k][i]).normalize();
            const blended = tangents[k][i].clone().cross(l.add(r)).normalize();
            foldNormal.lerp(blended, softFolds).normalize();
          }
          return foldNormal;
        });
      });
      for (let i = 0; i < counts; i++) {
        const a = rows[v][i],
          b = rows[v][i + 1],
          c = rows[v + 1][i + 1],
          d = rows[v + 1][i];
        const points = [a, b, c, d],
          smooth = [faceNormals[i][0], faceNormals[i + 1][0], faceNormals[i + 1][1], faceNormals[i][1]];
        const tone = (tones[v] ?? 1) * (panelTones[Math.floor(i / steps)] ?? 1);
        const fiberUV = flow && [flow[v][i], flow[v][i + 1], flow[v + 1][i + 1], flow[v + 1][i]];
        g.polygon(points, normalOf(points), tone, smooth, fiberUV);
        if (lined) {
          const inner = points.map((p, j) => p.clone().addScaledVector(smooth[j], -edge));
          const inward = smooth.map((n) => n.clone().negate());
          g.polygon(inner, normalOf(points).negate(), tone * 0.78, inward, fiberUV);
          if (!closed)
            for (const [j, k] of i === 0 ? [[0, 3]] : i === counts - 1 ? [[1, 2]] : []) {
              const end = [points[j], points[k], inner[k], inner[j]];
              g.polygon(end, normalOf(end), tone * 0.79);
            }
        }
      }
      if (v === 0) edges.push([rows[v], faceNormals.map((n) => n[0]), 1]);
      if (v === rows.length - 2) edges.push([rows[v + 1], faceNormals.map((n) => n[1]), -1]);
    }
    if (edge)
      for (const [border, normals, side] of edges) {
        const chamfer = [],
          reverse = [];
        for (let i = 0; i <= counts; i++) {
          const dir = border[Math.min(i + 1, counts)]
            .clone()
            .sub(border[Math.max(i - 1, 0)])
            .normalize();
          const outward = dir.cross(normals[i]).multiplyScalar(side * edge * 0.26);
          chamfer.push(
            border[i]
              .clone()
              .add(outward)
              .addScaledVector(normals[i], -edge * 0.3)
          );
          reverse.push(border[i].clone().addScaledVector(normals[i], -edge));
        }
        for (let i = 0; i < counts; i++)
          for (const [outer, inner, tone, faceBlend] of [
            [border, chamfer, 1.015, 0.46],
            [chamfer, reverse, 0.88, 0.24],
          ] as [Three.Vector3[], Three.Vector3[], number, number][]) {
            const p = [outer[i], outer[i + 1], inner[i + 1], inner[i]];
            const edgeNormal = normalOf(p).multiplyScalar(-side);
            const cutNormal = (index: number) => edgeNormal.clone().lerp(normals[index], faceBlend).normalize();
            g.polygon(p, edgeNormal, tone, [cutNormal(i), cutNormal(i + 1), cutNormal(i + 1), cutNormal(i)]);
          }
      }
    return g.finish();
  }
  function mirror(points: Pattern, s: number) {
    return points.map(([x, y, z]) => [x * s, y, z]);
  }

  // Three broad sheets meet at the temples and taper into a cut chin.
  // The crease running from cheekbone to chin separates the face and side planes.
  const faceRows = [
    [
      [0, 2.393, 0.148],
      [0.126, 2.385, 0.148],
      [0.247, 2.329, 0.144],
      [0.361, 2.191, 0.089],
      [0.312, 2.221, -0.162],
      [0.217, 2.32, -0.279],
      [0, 2.37, -0.303],
    ],
    [
      [0, 2.175, 0.389],
      [0.151, 2.175, 0.386],
      [0.296, 2.149, 0.371],
      [0.433, 2.075, 0.144],
      [0.421, 2.101, -0.124],
      [0.279, 2.139, -0.295],
      [0, 2.158, -0.347],
    ],
    [
      [0, 1.923, 0.435],
      [0.157, 1.923, 0.433],
      [0.388, 1.88, 0.407],
      [0.465, 1.884, 0.139],
      [0.445, 1.919, -0.126],
      [0.307, 1.945, -0.321],
      [0, 1.96, -0.364],
    ],
    [
      [0, 1.589, 0.435],
      [0.107, 1.59, 0.433],
      [0.271, 1.626, 0.421],
      [0.425, 1.665, 0.123],
      [0.39, 1.646, -0.14],
      [0.255, 1.624, -0.271],
      [0, 1.62, -0.314],
    ],
    [
      [0, 1.202, 0.434],
      [0.056, 1.203, 0.434],
      [0.118, 1.205, 0.429],
      [0.346, 1.414, 0.114],
      [0.279, 1.406, -0.131],
      [0.168, 1.396, -0.218],
      [0, 1.4, -0.239],
    ],
    [
      [0, 1.18, 0.369],
      [0.055, 1.183, 0.367],
      [0.116, 1.193, 0.365],
      [0.305, 1.375, 0.095],
      [0.258, 1.378, -0.116],
      [0.153, 1.375, -0.2],
      [0, 1.385, -0.225],
    ],
  ];

  for (const side of [-1, 1]) {
    const points = faceRows.map((row) => mirror(row, side).map(vector));
    const face = paperGeometry(portrait, 'Face', skin);
    const frontNormal = vector([0, -0.055, 1]).normalize();
    const cheekNormal = vector([0.795 * side, 0.06, 0.605]).normalize();
    for (let row = 0; row < points.length - 1; row++) {
      for (let col = 0; col < points[row].length - 1; col++) {
        const quad = [points[row][col], points[row][col + 1], points[row + 1][col + 1], points[row + 1][col]];
        const normal = normalOf(quad).multiplyScalar(-side);
        // Keep the front quiet, the cheek crease sharp, and the chin hem narrow.
        if (col < 2 && row < 4) normal.copy(frontNormal);
        if (col === 2 && row < 4) normal.copy(cheekNormal);
        if (col < 3 && row === points.length - 2) normal.lerp(frontNormal, 0.28).normalize();
        face.polygon(quad, normal, row === points.length - 2 ? 0.96 : 1);
      }
    }
    face.finish();

    const jaw = points.at(-1)!.map((point) => point.toArray());
    cut(
      portrait, 'Under jaw', skin,
      [...jaw, [0, 1.328, -0.062]],
      jaw.slice(1).map((_, i) => [0.84, i, i + 1, jaw.length])
    );

    // Plain elliptical ear cut from the same matte stock as the face.
    // Its lower tip overlaps the earring's attachment point.
    const rim = mirror([
      [0.422, 1.858, 0.105],
      [0.469, 1.909, 0.08],
      [0.522, 1.9, 0.039],
      [0.552, 1.866, 0.012],
      [0.552, 1.803, 0.006],
      [0.533, 1.725, 0.038],
      [0.503, 1.662, 0.081],
      [0.472, 1.63, 0.119],
      [0.44, 1.656, 0.128],
    ], side);
    const back = rim.map(([x, y, z]) => [x - 0.042 * side, y + 0.009, z - 0.037]);
    cut(
      portrait, 'Folded ear', skin,
      [...rim, ...back],
      [
        [1, ...rim.map((_, i) => i)],
        [0.89, ...rim.map((_, i) => back.length * 2 - 1 - i)],
        ...rim.map((_, i) => [0.92, i, (i + 1) % rim.length, ((i + 1) % rim.length) + rim.length, i + rim.length]),
      ],
    );
  }

  // Two leaves fold toward a narrow bevel above a cut undercut.
  // The brighter bevel stays visible in the front and three-quarter views.
  cut(
    portrait, 'Folded nose', skin,
    [
      [-0.002, 2.067, 0.407],
      [-0.133, 1.599, 0.421],
      [-0.109, 1.599, 0.576],
      [-0.026, 1.595, 0.603],
      [0.108, 1.581, 0.43],
      [0, 1.565, 0.416],
    ],
    [
      [1, 0, 1, 2],
      [1.18, 0, 2, 3],
      [0.92, 0, 3, 4],
      [0.82, 1, 5, 4, 3, 2],
    ],
  );

  // Overlap the underside of the mask through the full head-turn range.
  const neckBottom = [
    [-0.223, 0.76, 0.146],
    [0, 0.736, 0.172],
    [0.23, 0.79, 0.123],
    [0.232, 0.83, -0.105],
    [0, 0.83, -0.202],
    [-0.211, 0.81, -0.103],
  ];
  const neckTop = [
    [-0.181, 1.453, 0.141],
    [0, 1.461, 0.168],
    [0.194, 1.45, 0.105],
    [0.204, 1.415, -0.127],
    [0, 1.4, -0.212],
    [-0.194, 1.42, -0.094],
  ];
  cut(
    torso, 'Neck', skin,
    [...neckBottom, ...neckTop],
    neckBottom.map((_, i) => [0.91, i, (i + 1) % 6, ((i + 1) % 6) + 6, i + 6]),
  );

  function coatBody(parent: Part, stock: Stock, kind: 'wrap' | 'crew') {
    const [hem, shoulder, seamY, depth] = {
      wrap: [1.022, 0.925, 0.65, 0.37],
      crew: [1.015, 0.9, 0.55, 0.391],
    }[kind];
    // Three connected pattern sections give the chest a quiet convexity
    // and let the sleeve turn away from the viewer at the armhole.
    const halfBase = [
      [0, 0, depth],
      [0.52 * hem, 0, depth * 0.985],
      [0.74 * hem, 0, depth * 0.85],
      [0.92 * hem, 0, 0.2],
      [hem, 0, 0.033],
      [0.96 * hem, 0, -0.131],
      [0.78 * hem, 0, -0.27],
      [0.46 * hem, 0, -0.323],
      [0, 0, -0.351],
    ];
    const halfRoll = [
      [0, 0.555, 0.315],
      [0.45, 0.58, 0.287],
      [0.64, 0.593, 0.242],
      [shoulder * 0.91, seamY + 0.011, 0.175],
      [shoulder, seamY, 0],
      [shoulder * 0.96, seamY + 0.023, -0.122],
      [shoulder * 0.748, seamY + 0.105, -0.224],
      [0.43, seamY + 0.2, -0.256],
      [0, 0.869, -0.26],
    ];
    const halfNeck = [
      [0, 0.865, 0.194],
      [0.099, 0.871, 0.183],
      [0.201, 0.912, 0.152],
      [0.255, 0.958, 0.083],
      [0.269, 0.977, -0.005],
      [0.248, 0.992, -0.087],
      [0.177, 0.998, -0.167],
      [0.092, 1.007, -0.189],
      [0, 1.012, -0.199],
    ];
    const loop = (half: Pattern) => [...half, ...mirror(half.slice(1, -1).reverse(), -1)];
    const bottom = loop(halfBase),
      roll = loop(halfRoll),
      neckline = loop(halfNeck);
    const chest = strip(parent, 'Shoulder and chest pattern', stock, [bottom, roll, neckline], {
      closed: true,
      steps: 2,
      tones: [0.99, 1],
      edge: 0,
      tension: 0.32,
      softFolds: 0.59,
      panelTones: [1, 1, 0.986, 0.963, 0.956, 0.967, 1, 1, 1, 1, 0.962, 0.946, 0.968, 0.977, 1, 1],
    });
    cut(parent, 'Cut bust base', stock, bottom, [[0.74, ...bottom.map((_, i) => i)]]);
    return chest;
  }

  function foldedJacket(node: Part) {
    // The front meets as two broad panels with a single center join. The
    // sleeve breaks away along the diagonal from shoulder point to cut hem.
    const seam = [0.14, 0.584, 0.386];
    const hemSeam = [0.2, 0, 0.43];
    const leftTop = [-0.573, 0.873, 0.238];
    const leftShoulder = [-1.028, 0.64, 0.16];
    const leftHem = [-0.799, 0, 0.249];
    const rightTop = [0.534, 0.863, 0.243];
    const rightShoulder = [0.908, 0.607, 0.174];
    const rightHem = [0.924, 0, 0.251];
    const leftEdge = [-1.205, 0, 0.072];
    const rightEdge = [1.065, 0, 0.088];

    cut(node, 'Left front panel', cloth,
      [hemSeam, seam, leftTop, leftShoulder, leftHem], [[1, 0, 1, 2, 3, 4]]);
    cut(node, 'Right front panel', cloth,
      [hemSeam, rightHem, rightShoulder, rightTop, seam], [[0.996, 0, 1, 2, 3, 4]]);
    cut(node, 'Folded sleeve panels', cloth,
      [leftShoulder, leftEdge, leftHem, rightShoulder, rightHem, rightEdge],
      [[0.95, 0, 1, 2], [0.97, 3, 4, 5]]);

    const backEdges = [
      leftEdge,
      [-1.087, 0, -0.124],
      [-0.723, 0, -0.302],
      [0, 0, -0.379],
      [0.748, 0, -0.302],
      [0.989, 0, -0.123],
      rightEdge,
    ];
    const backShoulders = [
      leftShoulder,
      [-0.917, 0.667, -0.032],
      [-0.694, 0.779, -0.181],
      [0, 0.97, -0.231],
      [0.628, 0.777, -0.186],
      [0.840, 0.656, -0.003],
      rightShoulder,
    ];
    const nape = [
      leftTop,
      [-0.419, 0.915, -0.047],
      [-0.27, 0.982, -0.196],
      [0, 0.993, -0.244],
      [0.277, 0.982, -0.197],
      [0.406, 0.925, -0.056],
      rightTop,
    ];
    const length = backEdges.length;
    const sideFaces = backEdges.slice(1).map((_, i) => [0.96, i, i + 1, length + i + 1, length + i]);
    const backFaces = backEdges.slice(1).map((_, i) => [0.98, length + i, length + i + 1, 2 * length + i + 1, 2 * length + i]);
    cut(node, 'Back and shoulder panels', cloth, [...backEdges, ...backShoulders, ...nape], [...sideFaces, ...backFaces]);
    const hem = [hemSeam, leftHem, ...backEdges, rightHem];
    cut(node, 'Cut bust base', cloth, hem, [[0.76, ...hem.map((_, i) => i)]]);

    // The dark liner wraps the neck and shows through the V. Its point
    // sits beneath the shared junction of the two free collar leaves.
    const shirtEdge = [
      [-0.254, 0.927, 0.077],
      [-0.169, 0.924, 0.158],
      [0, 0.893, 0.202],
      [0.166, 0.911, 0.174],
      [0.276, 0.963, 0.08],
    ];
    cut(node, 'Dark undershirt', shirt, [...shirtEdge, [0.14, 0.573, 0.397]],
      shirtEdge.slice(1).map((_, i) => [0.98, i, shirtEdge.length, i + 1]));

    const leftCrown = [-0.3, 1.144, 0.18];
    const rightCrown = [0.282, 1.098, 0.158];
    const innerNape = [
      leftCrown,
      [-0.199, 1.114, -0.004],
      [-0.216, 1.052, -0.158],
      [0, 1.082, -0.207],
      [0.225, 1.056, -0.155],
      [0.243, 1.094, -0.015],
      rightCrown,
    ];
    strip(node, 'Standing collar around the nape', cloth, [nape, innerNape], {
      steps: 2, tones: [0.73], tension: 0.22, edge: 0.009, lined: true
    });

    // Each leaf is a broad card with a narrow cut edge. The left leaf sits
    // just in front of the right at the center to produce a contact shadow.
    const leftJoin = [0.148, 0.6, 0.475];
    const rightJoin = [0.140, 0.598, 0.456];
    cut(node, 'Left collar leaf', cloth,
      [leftCrown, [-0.575, 0.894, 0.286], [-0.256, 0.295, 0.485], leftJoin],
      [[1.023, 0, 1, 2, 3]], 0.010);
    cut(node, 'Right collar leaf', cloth,
      [rightCrown, rightJoin, [0.693, 0.302, 0.469], [0.533, 0.859, 0.309]],
      [[1.006, 0, 1, 2, 3]], 0.010);

    const front = paperGeometry(node, 'Paper front join', cloth);
    const edge = vector(hemSeam);
    const point = vector(seam);
    const join = [
      edge.clone().add(new T.Vector3(-0.004, 0, 0.001)),
      edge.clone().add(new T.Vector3(0.003, 0, 0.001)),
      point.clone().add(new T.Vector3(0.003, 0, 0.001)),
      point.clone().add(new T.Vector3(-0.004, 0, 0.001)),
    ];
    front.polygon(join, normalOf(join), 0.72);
    front.finish();
  }

  const outfits: Record<string, Part> = {};
  for (const style of ['jacket', 'wrap', 'crew'] as const) {
    const node = (outfits[style] = group(torso, style));
    if (style === 'jacket') {
      foldedJacket(node);
      continue;
    }
    const chest = coatBody(node, cloth, style);
    const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, 0, -1));
    // The third pattern coordinate is the distance above this garment’s front surface.
    const fitChest = (pattern: Pattern) =>
      pattern.map(([x, y, lift]) => {
        ray.ray.origin.set(x, y, 1.5);
        const surface = ray.intersectObject(chest, false)[0];
        if (!surface) throw new Error(`Garment pattern outside its shell at ${x}, ${y}`);
        return [x, y, surface.point.z + lift];
      });
    function foldedSeam(name: string, guide: Pattern, side = 1) {
      const curve = new T.SplineCurve(guide.map(([x, y]) => new T.Vector2(x, y)));
      const points = curve.getPoints(32);
      const rails = [0, 0.006 * side].map((offset) =>
        fitChest(points.map(({ x, y }) => [x + offset, y, 0.009]))
      );
      strip(node, name, cloth, rails, { steps: 1, tones: [0.84], edge: 0, tension: 0.15 });
    }
    if (style === 'wrap') {
      const under = [
        [-0.252, 0.998, 0.127],
        [-0.422, 0.839, 0.248],
        [-0.034, 0.521, 0.391],
        [0.121, 0.609, 0.357],
        [-0.046, 0.773, 0.265],
      ];
      cut(node, 'Wrap underlap', cloth, under, [[0.87, 0, 1, 2, 3, 4]], 0.007);

      // A wide folded facing crosses the garment in a single sheet.
      const facing = [
        [0.176, 1.052, 0.182],
        [-0.066, 0.745, 0.303],
        [-0.568, 0.232, 0.485],
        [0.509, 0.787, 0.395],
      ];
      cut(node, 'Folded wrap facing', lining, facing, [[1, 0, 1, 2, 3]], 0.011);
      foldedSeam('Wrap closure join', [
        [-0.53, 0.254],
        [-0.627, 0.132],
        [-0.738, 0.002],
      ]);
    } else {
      const rim = [
        [0, 0.855, 0.222],
        [0.109, 0.873, 0.214],
        [0.207, 0.914, 0.17],
        [0.263, 0.964, 0.088],
        [0.273, 0.986, -0.012],
        [0.21, 1.006, -0.132],
        [0.106, 1.021, -0.187],
        [0, 1.025, -0.207],
      ];
      const full = [...rim, ...mirror(rim.slice(1, -1).reverse(), -1)];
      const band = full.map(([x, y, z]) => [x * 1.16, y - 0.045, z * 1.17 + 0.005]);
      const turn = full.map(([x, y, z]) => [x * 1.018, y + 0.005, z * 1.03]);
      strip(node, 'Folded crew neckline', cloth, [band, turn, full], {
        closed: true,
        steps: 3,
        tones: [0.76, 1.05],
        edge: 0.006,
      });
      for (const side of [-1, 1])
        foldedSeam('Cut sleeve join', [
          [0.285 * side, 0.854],
          [0.495 * side, 0.595],
          [0.722 * side, 0.332],
          [0.893 * side, 0.119],
          [0.942 * side, 0.002],
        ], side);
    }
  }
  const hairstyles: Record<string, Part> = {};
  // Side walls spring out slightly at the cut rim as a bent paper shell does.
  function cap(node: Part, name: string, lower: Pattern, top: Pattern, tone: number) {
    const a = lower.map(vector),
      b = top.map(vector);
    const shoulder = a.map((p, i) => {
      const q = p.clone().lerp(b[i], 0.59);
      q.x *= 1.045;
      q.z *= 1.045;
      q.y += 0.014;
      return q.toArray();
    });
    const peak = Math.max(...b.map((p) => p.y)) + 0.027;
    const crown = b.map((p) => [p.x * 0.47, peak + (p.y - peak) * 0.22, p.z * 0.51 - 0.022]);
    strip(node, name, hair, [lower, shoulder, top, crown], {
      closed: true,
      steps: 4,
      tension: 0.3,
      softFolds: 0.32,
      tones: [tone, tone * 1.015, tone * 1.035],
      edge: 0.009,
    });
    const curve = new T.CatmullRomCurve3(crown.map(vector), true, 'catmullrom', 0.3);
    const roof = curve.getPoints(crown.length * 4).slice(0, -1).map(p => p.toArray());
    cut(node, 'Folded crown', hair, roof, [[tone * 1.035, ...roof.map((_, i) => i)]]);
    const inside = lower.map(([x, y, z]) => [x * 0.81, y + 0.076, z * 0.77]);
    strip(node, 'Cut rim return', hair, [inside, lower], { closed: true, steps: 4, tension: 0.3, tones: [tone * 0.56], edge: 0 });
  }

  {
    const node = (hairstyles.sweep = group(portrait, 'Sweep'));
    // The brow and nape are cut from one shell. Its low side flares out
    // before folding under, while the opposite edge rises to the part.
    const rim = [
      [-0.133, 2.136, 0.511],
      [0.136, 2.305, 0.481],
      [0.284, 2.389, 0.378],
      [0.508, 2.049, 0.128],
      [0.566, 1.698, -0.204],
      [0.315, 1.323, -0.357],
      [0.068, 1.292, -0.481],
      [-0.354, 1.334, -0.418],
      [-0.575, 1.367, -0.224],
      [-0.683, 1.505, 0.111],
      [-0.704, 1.675, 0.329],
      [-0.444, 1.943, 0.493],
    ];
    const shoulder = [
      [-0.091, 2.474, 0.328],
      [0.234, 2.549, 0.308],
      [0.436, 2.515, 0.156],
      [0.576, 2.376, -0.035],
      [0.595, 2.182, -0.203],
      [0.393, 2.254, -0.386],
      [0.096, 2.308, -0.411],
      [-0.292, 2.27, -0.352],
      [-0.484, 2.25, -0.24],
      [-0.599, 2.272, -0.073],
      [-0.613, 2.219, 0.153],
      [-0.397, 2.339, 0.303],
    ];
    const crown = [
      [-0.054, 2.597, 0.131],
      [0.164, 2.658, 0.135],
      [0.287, 2.649, 0.014],
      [0.369, 2.562, -0.101],
      [0.329, 2.518, -0.197],
      [0.195, 2.537, -0.257],
      [0.034, 2.571, -0.265],
      [-0.156, 2.566, -0.229],
      [-0.267, 2.54, -0.167],
      [-0.337, 2.526, -0.083],
      [-0.322, 2.522, 0.056],
      [-0.227, 2.552, 0.125],
    ];
    const round = rim.map((point, i) => {
      const edge = vector(point);
      const p = vector(shoulder[i]).lerp(edge, 0.67);
      // Give the back and near-side wall room to round into the cut edge.
      if (i >= 3 && i <= 7) {
        p.x *= 1.035;
        p.z *= 1.04;
      }
      return p.toArray();
    });
    const tension = 0.35;
    const steps = 4;
    strip(node, 'Swept cap', hair, [rim, round, shoulder, crown], {
      closed: true,
      steps,
      tension,
      softFolds: 0.88,
      tones: [0.985, 1, 1],
      edge: 0,
    });
    // The roof shares the entire curved boundary of the wall, including
    // points between the corners of the cardstock pattern.
    const crownCurve = new T.CatmullRomCurve3(crown.map(vector), true, 'catmullrom', tension);
    const crownRim = crownCurve.getPoints(crown.length * steps);
    const roof = paperGeometry(node, 'Folded crown', hair);
    const apex = vector([0.037, 2.663, -0.051]);
    const up = vector([-0.03, 1, -0.07]).normalize();
    for (let i = 0; i < crownRim.length - 1; i++)
      roof.polygon([crownRim[i], crownRim[i + 1], apex], up, 0.999, [up, up, up]);
    roof.finish();

    // A second cut runs from the part to the walled return around the ear.
    // Its edge rides on the same surface as the wrap below it.
    const templeCurves = [shoulder, round, rim].map(rail =>
      new T.CatmullRomCurve3(rail.map(vector), true, 'catmullrom', tension)
    );
    function templeRail(weights: number[]): Pattern {
      return weights.map((weight, i) => {
        const t = (1.76 + i * 0.42) / rim.length;
        const layer = weight < 0.67 ? 0 : 1;
        const depth = layer ? (weight - 0.67) / 0.33 : weight / 0.67;
        const p = templeCurves[layer].getPoint(t).lerp(templeCurves[layer + 1].getPoint(t), depth);
        const outward = vector([p.x, 0, p.z]).normalize();
        return p.addScaledVector(outward, 0.016).toArray();
      });
    }
    strip(node, 'Temple tuck', hair, [
      templeRail([0.14, 0.105, 0.12, 0.175, 0.3, 0.52, 0.79]),
      templeRail([0.145, 0.44, 0.66, 0.8, 0.89, 0.94, 0.81]),
    ], { steps, tones: [0.956], edge: 0.004, tension });
    const inside = rim.map(([x, y, z]) => [x * 0.83 + 0.012, y + 0.087, z * 0.74]);
    strip(node, 'Turned-under sweep', hair, [inside, rim], {
      closed: true,
      steps: 4,
      tension: 0.35,
      tones: [0.58],
      edge: 0,
    });
  }
  {
    const node = (hairstyles.crop = group(portrait, 'Crop'));
    const lower = [
      [-0.015, 2.201, 0.415],
      [0.277, 2.211, 0.337],
      [0.432, 2.119, 0.193],
      [0.475, 1.988, 0.037],
      [0.456, 1.814, -0.157],
      [0.287, 1.696, -0.318],
      [-0.027, 1.682, -0.366],
      [-0.316, 1.701, -0.282],
      [-0.463, 1.904, -0.102],
      [-0.476, 2.09, 0.129],
      [-0.266, 2.27, 0.347],
    ];
    const top = [
      [-0.013, 2.468, 0.237],
      [0.235, 2.436, 0.147],
      [0.312, 2.381, 0.077],
      [0.357, 2.334, -0.022],
      [0.318, 2.387, -0.148],
      [0.183, 2.45, -0.236],
      [-0.065, 2.504, -0.246],
      [-0.225, 2.461, -0.167],
      [-0.357, 2.395, -0.063],
      [-0.34, 2.395, 0.083],
      [-0.228, 2.466, 0.213],
    ];
    cap(node, 'Close crop', lower, top, 0.96);
    strip(
      node,
      'Crop fringe',
      hair,
      [
        [
          [-0.311, 2.369, -0.101],
          [-0.266, 2.474, -0.052],
          [-0.085, 2.52, 0.023],
          [0.112, 2.501, 0.045],
          [0.269, 2.429, 0.069],
          [0.348, 2.34, 0.087],
        ],
        [
          [-0.382, 2.303, 0.11],
          [-0.267, 2.441, 0.165],
          [-0.075, 2.491, 0.174],
          [0.117, 2.456, 0.198],
          [0.264, 2.381, 0.191],
          [0.365, 2.29, 0.139],
        ],
        [
          [-0.386, 2.29, 0.184],
          [-0.277, 2.39, 0.269],
          [-0.077, 2.424, 0.283],
          [0.124, 2.375, 0.302],
          [0.277, 2.312, 0.263],
          [0.383, 2.226, 0.181],
        ],
      ],
      { steps: 3, tones: [1.008, 1], edge: 0.007, lined: true }
    );
  }
  {
    const node = (hairstyles.bob = group(portrait, 'Bob'));
    node.scale.x = 1.105;
    const lower = [
      [0.0, 2.252, 0.419],
      [0.202, 2.19, 0.387],
      [0.36, 1.912, 0.347],
      [0.512, 1.253, 0.18],
      [0.571, 1.211, -0.026],
      [0.495, 1.335, -0.24],
      [0.075, 1.378, -0.427],
      [-0.413, 1.333, -0.311],
      [-0.583, 1.235, -0.077],
      [-0.569, 1.301, 0.149],
      [-0.351, 1.926, 0.331],
      [-0.182, 2.199, 0.401],
    ];
    const top = [
      [0.013, 2.482, 0.237],
      [0.205, 2.461, 0.189],
      [0.345, 2.375, 0.137],
      [0.44, 2.292, 0.051],
      [0.457, 2.28, -0.062],
      [0.325, 2.421, -0.194],
      [0.033, 2.533, -0.271],
      [-0.27, 2.454, -0.205],
      [-0.428, 2.312, -0.082],
      [-0.427, 2.302, 0.055],
      [-0.333, 2.404, 0.159],
      [-0.15, 2.511, 0.22],
    ];
    cap(node, 'Chin-length bob', lower, top, 0.95);
    for (const side of [-1, 1]) {
      const part = [
        [-0.065, 2.491, 0.155],
        [0.119, 2.519, 0.125],
        [0.347, 2.425, 0.091],
        [0.459, 2.233, 0.072],
        [0.498, 1.899, 0.064],
        [0.532, 1.551, 0.073],
        [0.548, 1.257, 0.061],
      ];
      const turn = [
        [-0.074, 2.478, 0.209],
        [0.123, 2.492, 0.216],
        [0.312, 2.375, 0.216],
        [0.435, 2.168, 0.218],
        [0.489, 1.91, 0.202],
        [0.511, 1.561, 0.194],
        [0.521, 1.271, 0.175],
      ];
      const edge = [
        [-0.084, 2.441, 0.261],
        [0.089, 2.413, 0.32],
        [0.247, 2.276, 0.344],
        [0.373, 2.076, 0.334],
        [0.449, 1.86, 0.291],
        [0.477, 1.53, 0.249],
        [0.49, 1.28, 0.226],
      ];
      const fit = (rail: Pattern) =>
        mirror(rail, side).map(([x, y, z], i) => [x + (side < 0 && i < 2 ? -0.05 : 0), y + (side < 0 ? 0.023 : 0), z]);
      const rails = [fit(part), fit(turn), fit(edge)];
      strip(node, 'Face-framing bob panel', hair, side > 0 ? rails.reverse() : rails, {
        steps: 4,
        tones: [0.985, 1.005],
        edge: 0.008,
        lined: true,
      });
    }
  }
  {
    const node = (hairstyles.curls = group(portrait, 'Curls'));
    const lower = [
      [-0.042, 2.309, 0.38],
      [0.23, 2.316, 0.349],
      [0.408, 2.213, 0.226],
      [0.514, 1.982, 0.072],
      [0.53, 1.856, -0.102],
      [0.397, 1.665, -0.261],
      [0.085, 1.59, -0.413],
      [-0.272, 1.653, -0.353],
      [-0.477, 1.805, -0.185],
      [-0.55, 1.936, 0.067],
      [-0.433, 2.174, 0.231],
      [-0.243, 2.286, 0.359],
    ];
    const top = [
      [-0.048, 2.544, 0.258],
      [0.183, 2.563, 0.194],
      [0.405, 2.431, 0.158],
      [0.505, 2.295, 0.061],
      [0.502, 2.292, -0.105],
      [0.371, 2.468, -0.226],
      [0.076, 2.56, -0.323],
      [-0.248, 2.515, -0.261],
      [-0.446, 2.357, -0.127],
      [-0.508, 2.268, 0.071],
      [-0.374, 2.446, 0.204],
      [-0.241, 2.535, 0.236],
    ];
    const foundations = top.map(([x, y, z]) => [
      x * 1.035,
      y + (z < 0.11 ? 0.088 : 0.026),
      z > 0 ? z - 0.079 : z * 1.085,
    ]);
    cap(node, 'Cropped curls', lower, foundations, 0.85);
    // Each lock is a broad pleat which starts at the crown, projects from
    // the hair mass, then rolls back underneath a neighbouring pleat.
    // The long central curl changes direction halfway across the forehead.
    function lock(name: string, outer: Pattern, inner: Pattern, bulge: Pattern) {
      const spine = outer.map((p, i) => {
        const q = vector(p).lerp(vector(inner[i]), 0.42);
        q.x += bulge[i][0];
        q.y += bulge[i][1];
        q.z += bulge[i][2];
        return q.toArray();
      });
      strip(node, name, hair, [outer, spine, inner], {
        steps: 4,
        tones: [1.013, 0.988],
        edge: 0.009,
        lined: true,
        tension: 0.4,
      });
    }
    lock(
      'Long crown curl',
      [
        [-0.084, 2.546, -0.208],
        [-0.126, 2.663, -0.027],
        [-0.129, 2.712, 0.165],
        [-0.094, 2.662, 0.32],
        [-0.096, 2.574, 0.43],
        [-0.155, 2.405, 0.493],
        [-0.278, 2.267, 0.47],
        [-0.358, 2.234, 0.403],
      ],
      [
        [0.09, 2.565, -0.146],
        [0.153, 2.664, 0.001],
        [0.213, 2.693, 0.182],
        [0.252, 2.617, 0.324],
        [0.219, 2.513, 0.413],
        [0.081, 2.372, 0.485],
        [-0.164, 2.241, 0.455],
        [-0.337, 2.233, 0.389],
      ],
      [
        [0, 0.012, 0],
        [0, 0.035, 0],
        [0, 0.043, 0.012],
        [0.012, 0.036, 0.02],
        [0.016, 0.02, 0.04],
        [0.018, 0.01, 0.035],
        [0.008, -0.002, 0.019],
        [0, 0, 0.001],
      ]
    );
    lock(
      'Swept side curl',
      [
        [-0.409, 2.428, -0.107],
        [-0.406, 2.549, 0.028],
        [-0.385, 2.602, 0.186],
        [-0.342, 2.556, 0.318],
        [-0.341, 2.459, 0.423],
        [-0.412, 2.275, 0.478],
        [-0.515, 2.178, 0.377],
        [-0.538, 2.173, 0.278],
      ],
      [
        [-0.238, 2.5, -0.158],
        [-0.211, 2.598, 0.02],
        [-0.161, 2.642, 0.168],
        [-0.118, 2.567, 0.294],
        [-0.149, 2.467, 0.41],
        [-0.294, 2.275, 0.486],
        [-0.449, 2.182, 0.378],
        [-0.524, 2.176, 0.262],
      ],
      [
        [-0.009, 0.012, 0],
        [-0.016, 0.023, 0.009],
        [-0.023, 0.028, 0.016],
        [-0.029, 0.021, 0.03],
        [-0.026, 0.01, 0.039],
        [-0.016, 0.002, 0.027],
        [-0.008, 0, 0.014],
        [0, 0, 0.001],
      ]
    );
    lock(
      'Temple wave',
      [
        [0.119, 2.538, -0.229],
        [0.17, 2.643, -0.104],
        [0.235, 2.677, 0.033],
        [0.299, 2.628, 0.206],
        [0.33, 2.531, 0.334],
        [0.298, 2.429, 0.404],
        [0.232, 2.34, 0.457],
        [0.15, 2.299, 0.483],
        [0.101, 2.307, 0.479],
        [0.096, 2.337, 0.464],
        [0.123, 2.354, 0.438],
        [0.168, 2.34, 0.406],
      ],
      [
        [0.311, 2.483, -0.204],
        [0.363, 2.583, -0.065],
        [0.416, 2.61, 0.059],
        [0.486, 2.545, 0.168],
        [0.495, 2.445, 0.261],
        [0.459, 2.355, 0.354],
        [0.382, 2.255, 0.426],
        [0.245, 2.174, 0.459],
        [0.131, 2.169, 0.453],
        [0.073, 2.209, 0.436],
        [0.076, 2.292, 0.412],
        [0.147, 2.33, 0.393],
      ],
      [
        [0, 0.006, 0],
        [0.012, 0.02, 0.002],
        [0.022, 0.033, 0.008],
        [0.032, 0.027, 0.018],
        [0.032, 0.015, 0.028],
        [0.022, 0.007, 0.026],
        [0.016, 0.001, 0.023],
        [0.008, -0.005, 0.018],
        [0.002, -0.005, 0.014],
        [-0.002, 0, 0.012],
        [0.002, 0, 0.009],
        [0, 0, 0.002],
      ]
    );
  }
  const accessories = {
    none: group(portrait, 'No accessories'),
    glasses: group(portrait, 'Glasses'),
    earrings: group(portrait, 'Earrings'),
  };
  for (const s of [-1, 1]) {
    const frontZ = (x: number) => 0.528 - 0.17 * (x / 0.433) ** 2;
    const outline = [
      [0.05, 1.964],
      [0.347, 1.986],
      [0.429, 1.951],
      [0.391, 1.794],
      [0.315, 1.751],
      [0.12, 1.755],
      [0.065, 1.792],
    ];
    const inner = [
      [0.082, 1.931],
      [0.343, 1.956],
      [0.393, 1.934],
      [0.361, 1.81],
      [0.302, 1.783],
      [0.135, 1.785],
      [0.092, 1.811],
    ];
    const opening = inner.map(([x, y], i) => [
      T.MathUtils.lerp(x, outline[i][0], 0.17),
      T.MathUtils.lerp(y, outline[i][1], 0.17),
    ]);
    const frame = [...outline, ...opening].map(([x, y]) => [x * s, y, frontZ(x)]);
    const n = outline.length;
    cut(
      accessories.glasses,
      'Open spectacle frame',
      ink,
      frame,
      outline.map((_, i) => [1, i, (i + 1) % n, ((i + 1) % n) + n, i + n]),
      0.006
    );
    cut(
      accessories.glasses,
      'Spectacle arm',
      ink,
      mirror(
        [
          [0.408, 1.96, 0.383],
          [0.437, 1.954, 0.312],
          [0.536, 1.908, 0.009],
          [0.517, 1.855, -0.055],
          [0.511, 1.873, -0.051],
          [0.517, 1.931, 0.012],
          [0.41, 1.978, 0.37],
        ],
        s
      ),
      [[1, 0, 1, 2, 3, 4, 5, 6]],
      0.006
    );
    const bail = Array.from({ length: 8 }, (_, i) => {
      const turn = i * Math.PI / 4;
      return [(0.485 + 0.022 * Math.cos(turn)) * s, 1.629 + 0.039 * Math.sin(turn), 0.118];
    });
    const aperture = bail.map(([x, y, z]) => [
      (x - 0.485 * s) * 0.62 + 0.485 * s,
      (y - 1.629) * 0.7 + 1.629,
      z,
    ]);
    cut(
      accessories.earrings,
      'Earring bail',
      gold,
      [...bail, ...aperture],
      bail.map((_, i) => [0.94, i, (i + 1) % bail.length, ((i + 1) % bail.length) + bail.length, i + bail.length]),
      0.006
    );
    const drop = mirror(
      [
        [0.484, 1.596, 0.12],
        [0.546, 1.534, 0.116],
        [0.495, 1.414, 0.131],
        [0.446, 1.529, 0.146],
        [0.497, 1.519, 0.162],
        [0.494, 1.52, 0.107],
      ],
      s
    );
    cut(accessories.earrings, 'Folded drop', gold, drop, [
      [1.08, 0, 1, 4],
      [1.03, 1, 2, 4],
      [0.85, 2, 3, 4],
      [0.91, 3, 0, 4],
      [0.87, 0, 5, 1],
      [0.84, 1, 5, 2],
      [0.81, 2, 5, 3],
      [0.88, 3, 5, 0],
    ]);
  }
  cut(
    accessories.glasses,
    'Spectacle bridge',
    ink,
    [
      [-0.078, 1.965, 0.522],
      [-0.026, 1.974, 0.541],
      [0.033, 1.97, 0.541],
      [0.078, 1.963, 0.522],
      [0.081, 1.925, 0.522],
      [0.032, 1.939, 0.549],
      [-0.02, 1.942, 0.549],
      [-0.079, 1.928, 0.521],
    ],
    [[1, 0, 1, 2, 3, 4, 5, 6, 7]],
    0.006
  );

  const cream = new T.Color('#eddbc1');
  function show(library: Record<string, Part>, selected: string, fallback: string) {
    const key = Object.hasOwn(library, selected) ? selected : fallback;
    for (const name of Object.keys(library)) library[name].visible = name === key;
  }
  function setRecipe(next: AvatarRecipe) {
    skin.color.set(next.skinColor);
    // Retain the pigment hue while giving the darkest stocks enough
    // reflected light to separate a temple fold from a dark glasses frame.
    const luminance = skin.color.r * 0.2126 + skin.color.g * 0.7152 + skin.color.b * 0.0722;
    const darkStock = 1 - T.MathUtils.smoothstep(luminance, 0.035, 0.15);
    skin.color.multiplyScalar(1 + 0.35 * darkStock);
    // The warm skin dyes soak into the stock and retain their ochre hue under the softbox.
    const warmth = Math.max(0, skin.color.r - skin.color.b);
    skin.color.r *= 1 + 0.06 * warmth;
    skin.color.g *= 1 - 0.33 * warmth;
    skin.color.b *= 1 - 0.32 * warmth;
    hair.color.set(next.hairColor);
    cloth.color.set(next.clothColor).multiplyScalar(0.84);
    lining.color.copy(cloth.color).lerp(cream, 0.52);
    show(outfits, next.outfit, 'jacket');
    show(hairstyles, next.hair, 'sweep');
    show(accessories, next.accessory, 'none');
  }
  function pose({ x = 0, y = 0, reduced = false, time = 0 }: PersonPose = {}) {
    const gazeX = Math.max(-1, Math.min(1, x)),
      gazeY = Math.max(-1, Math.min(1, y));
    torso.rotation.y = 0.07 + gazeX * 0.02618;
    head.rotation.order = 'YXZ';
    head.rotation.y = -0.591 + gazeX * 0.41015;
    head.rotation.x = -gazeY * 0.137 + (!reduced ? 0.006 * Math.sin(time * 1.53) : 0);
    head.rotation.z = -0.025 - gazeX * 0.027;
  }
  setRecipe(recipe);
  pose({ reduced: true });
  return { root, body: torso, head, pose, setRecipe };
}
