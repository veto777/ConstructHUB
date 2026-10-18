/**
 * Hover3DViewer — renders a HOVER capture (the JSON mesh from GET …/model3d, shared/hover-mesh.ts) with three.js.
 *
 * Loaded lazily (hover-3d-dialog.tsx imports it with React.lazy) so three.js never lands in other pages' bundles.
 *
 *   • orbit / zoom / pan (mouse, trackpad, one- and two-finger touch) — OrbitControls with damping
 *   • roof and wall faces shaded separately, in the colors picked in the design panel
 *   • openings (windows/doors) cut out of their wall and drawn as outlined glass; "show windows/doors" off fills the
 *     wall instead
 *   • tap/click a face → onSelect(face) (label, area, pitch shown by the dialog); the face is highlighted
 *   • view presets: front / back / left / right / top, in the export's own frame (see the dialog's note)
 *   • a measurements overlay: facet name · area · pitch floating at each roof facet and named wall
 *
 * HOVER's frame is z-up, feet. three.js is y-up, so a HOVER point (x, y, z) is drawn at (x, z, −y), re-centred on
 * the footprint and grounded at the lowest point.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OPENING_TYPES, type HoverMesh, type MeshFace } from "@shared/hover-mesh";

export type ViewPreset = "front" | "back" | "left" | "right" | "top" | "iso";

export interface Hover3DViewerProps {
  mesh: HoverMesh;
  sidingColor: string;
  roofColor: string;
  /** Window glass tint and door panel colour (previews, like the siding and roof). */
  windowColor: string;
  doorColor: string;
  showOpenings: boolean;
  /** Horizontal lap-siding lines on every wall at this reveal (inches); null = plain walls. */
  sidingReveal: number | null;
  /** Shingle course lines across every roof facet (5⅝" exposure, the common 3-tab/architectural course). */
  roofShingles: boolean;
  showLabels: boolean;
  /** Bump `seq` to re-apply the same preset. */
  view: { preset: ViewPreset; seq: number };
  /** Highlighted faces — one, or several in "select several" mode. */
  selectedIds: string[];
  onSelect: (face: MeshFace | null) => void;
}

type V3 = THREE.Vector3;

function toThree(mesh: HoverMesh): { pts: V3[]; center: V3; radius: number } {
  const { min, max } = mesh.bounds;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, z0 = min[2];
  const pts: V3[] = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const x = mesh.vertices[i] - cx, y = mesh.vertices[i + 1] - cy, z = mesh.vertices[i + 2] - z0;
    pts.push(new THREE.Vector3(x, z, -y));
  }
  const box = new THREE.Box3().setFromPoints(pts);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return { pts, center: sphere.center, radius: Math.max(sphere.radius, 1) };
}

/** Newell normal of a 3D ring. */
function ringNormal(ring: V3[]): V3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.lengthSq() > 0 ? n.normalize() : new THREE.Vector3(0, 1, 0);
}

/** Triangulate a planar ring (with optional planar holes) → flat triangle positions. */
function triangulate(ring: V3[], holes: V3[][]): number[] {
  if (ring.length < 3) return [];
  const n = ringNormal(ring);
  const u = new THREE.Vector3().subVectors(ring[1], ring[0]);
  u.sub(n.clone().multiplyScalar(u.dot(n)));
  if (u.lengthSq() < 1e-12) u.set(1, 0, 0);
  u.normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const o = ring[0];
  const to2 = (p: V3) => new THREE.Vector2(new THREE.Vector3().subVectors(p, o).dot(u), new THREE.Vector3().subVectors(p, o).dot(v));
  const contour = ring.map(to2);
  const holes2 = holes.filter((h) => h.length >= 3).map((h) => h.map(to2));
  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, holes2);
  } catch {
    tris = [];
  }
  const all = [...ring, ...holes.filter((h) => h.length >= 3).flat()];
  const out: number[] = [];
  for (const t of tris) for (const i of t) { const p = all[i]; if (p) out.push(p.x, p.y, p.z); }
  return out;
}

interface Built {
  root: THREE.Group;
  pickables: THREE.Mesh[];
  /** triangle index → face, per pickable mesh */
  triFace: Map<THREE.Mesh, MeshFace[]>;
  roofMat: THREE.MeshStandardMaterial;
  wallMat: THREE.MeshStandardMaterial;
  glassMat: THREE.MeshStandardMaterial;
  doorMat: THREE.MeshStandardMaterial;
  wallCut: THREE.Mesh;
  wallFull: THREE.Mesh;
  openings: THREE.Object3D[];
  sidingLines: THREE.Object3D | null;
  shingleLines: THREE.Object3D | null;
  ringOf: Map<string, V3[]>;
  holesOf: Map<string, V3[][]>;
  center: V3;
  radius: number;
  labelAnchors: { face: MeshFace; at: V3 }[];
}

/** A darker shade of a hex colour for the siding lines, so they read on light and dark siding alike. */
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  return `#${c.multiplyScalar(k).getHexString()}`;
}

/**
 * Course lines — lap siding on walls, shingle courses on roofs: each face ring cut by horizontal planes spaced so
 * the courses are `stepFt` apart ALONG the surface (a 7" reveal up a wall, a 5⅝" exposure up a 6/12 roof), the cut
 * points paired across the face into segments (even-odd), drawn a hair in front of and behind the face so they
 * show from either side. Faces flatter than ~6° (flat roofs, decks) get none.
 */
function makeCourseLines(faces: MeshFace[], ringOf: Map<string, V3[]>, holesOf: Map<string, V3[][]>, stepFt: number, color: string): THREE.LineSegments {
  const pos: number[] = [];
  // Where a ring crosses the plane y = h, as points.
  const crossings = (ring: V3[], h: number): V3[] => {
    const hits: V3[] = [];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if ((p.y - h) * (q.y - h) >= 0 || p.y === q.y) continue;
      hits.push(new THREE.Vector3().lerpVectors(p, q, (h - p.y) / (q.y - p.y)));
    }
    return hits;
  };
  for (const f of faces) {
    const ring = ringOf.get(f.id);
    if (!ring || ring.length < 3) continue;
    const holes = holesOf.get(f.id) ?? [];
    const n = ringNormal(ring);
    const u = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0));
    const sinTilt = Math.sqrt(Math.max(0, 1 - n.y * n.y));
    if (u.lengthSq() < 1e-6 || sinTilt < 0.1) continue;
    u.normalize();
    const revealFt = stepFt * sinTilt; // vertical rise per course on this face
    let minY = Infinity, maxY = -Infinity;
    for (const p of ring) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    for (let h = Math.ceil(minY / revealFt) * revealFt; h < maxY - 1e-3; h += revealFt) {
      if (h - minY < 1e-3) continue;
      const hits = crossings(ring, h).sort((a, b) => a.dot(u) - b.dot(u));
      // A course never runs through a window or door: the spans where an opening crosses this height are cut out.
      const cuts: [number, number][] = [];
      for (const hole of holes) {
        const hc = crossings(hole, h).map((p) => p.dot(u)).sort((a, b) => a - b);
        for (let i = 0; i + 1 < hc.length; i += 2) cuts.push([hc[i], hc[i + 1]]);
      }
      for (let i = 0; i + 1 < hits.length; i += 2) {
        const a = hits[i], ta = a.dot(u), tb = hits[i + 1].dot(u);
        // Courses stop a trim board's width short of every face edge — corner boards, rake and fascia trim.
        if (tb - ta <= 2 * TRIM_FT) continue;
        let spans: [number, number][] = [[ta + TRIM_FT, tb - TRIM_FT]];
        for (const [c0, c1] of cuts) {
          spans = spans.flatMap(([s0, s1]) => (c1 <= s0 || c0 >= s1 ? [[s0, s1]] : [[s0, Math.max(s0, c0)], [Math.min(s1, c1), s1]].filter(([x, y]) => y - x > 0.02) as [number, number][]));
        }
        for (const [s0, s1] of spans) {
          for (const side of [0.03, -0.03]) {
            const off = n.clone().multiplyScalar(side);
            const p0 = a.clone().add(u.clone().multiplyScalar(s0 - ta)).add(off);
            const p1 = a.clone().add(u.clone().multiplyScalar(s1 - ta)).add(off);
            pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
          }
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }));
}

const SHINGLE_EXPOSURE_FT = 5.625 / 12;
/** A 5½" trim board: courses never run into the corner, rake or fascia trim. */
const TRIM_FT = 5.5 / 12;

function build(mesh: HoverMesh, sidingColor: string, roofColor: string, windowColor: string, doorColor: string, sidingReveal: number | null, roofShingles: boolean): Built {
  const { pts, center, radius } = toThree(mesh);
  const ringOf = new Map<string, V3[]>();
  for (const f of mesh.faces) ringOf.set(f.id, f.polygon.map((i) => pts[i]).filter(Boolean));
  const holesOf = new Map<string, V3[][]>();
  for (const f of mesh.faces) {
    if (!OPENING_TYPES.includes(f.type) || !f.parentId) continue;
    const list = holesOf.get(f.parentId) ?? [];
    list.push(ringOf.get(f.id)!);
    holesOf.set(f.parentId, list);
  }

  const group = (faces: MeshFace[], withHoles: boolean) => {
    const pos: number[] = [];
    const triFace: MeshFace[] = [];
    for (const f of faces) {
      const tri = triangulate(ringOf.get(f.id)!, withHoles ? holesOf.get(f.id) ?? [] : []);
      for (let k = 0; k < tri.length / 9; k++) triFace.push(f);
      pos.push(...tri);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return { g, triFace };
  };

  const roofMat = new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide, flatShading: true });
  const wallMat = new THREE.MeshStandardMaterial({ color: sidingColor, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  const glassMat = new THREE.MeshStandardMaterial({
    color: windowColor, roughness: 0.25, metalness: 0.2, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });

  // Doors as a solid panel, soffits as light trim under the eaves; windows (and untyped cut-outs) as glass.
  const doorMat = new THREE.MeshStandardMaterial({
    color: doorColor, roughness: 0.7, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const soffitMat = new THREE.MeshStandardMaterial({ color: "#efece4", roughness: 0.95, metalness: 0, side: THREE.DoubleSide, flatShading: true });

  const roofs = mesh.faces.filter((f) => f.type === "roof");
  const walls = mesh.faces.filter((f) => f.type === "wall");
  const opens = mesh.faces.filter((f) => f.type === "opening" || f.type === "window");
  const doors = mesh.faces.filter((f) => f.type === "door");
  const soffits = mesh.faces.filter((f) => f.type === "soffit");
  const root = new THREE.Group();
  const triFace = new Map<THREE.Mesh, MeshFace[]>();

  const r = group(roofs, false);
  const roofMesh = new THREE.Mesh(r.g, roofMat);
  triFace.set(roofMesh, r.triFace);
  const wc = group(walls, true);
  const wallCut = new THREE.Mesh(wc.g, wallMat);
  triFace.set(wallCut, wc.triFace);
  const wf = group(walls, false);
  const wallFull = new THREE.Mesh(wf.g, wallMat);
  triFace.set(wallFull, wf.triFace);
  wallFull.visible = false;
  const o = group(opens, false);
  const openMesh = new THREE.Mesh(o.g, glassMat);
  triFace.set(openMesh, o.triFace);
  const d = group(doors, false);
  const doorMesh = new THREE.Mesh(d.g, doorMat);
  triFace.set(doorMesh, d.triFace);
  const sf = group(soffits, false);
  const soffitMesh = new THREE.Mesh(sf.g, soffitMat);
  triFace.set(soffitMesh, sf.triFace);
  root.add(roofMesh, wallCut, wallFull, openMesh, doorMesh, soffitMesh);
  const sidingLines = sidingReveal ? makeCourseLines(walls, ringOf, holesOf, sidingReveal / 12, shade(sidingColor, 0.55)) : null;
  if (sidingLines) root.add(sidingLines);
  const shingleLines = roofShingles ? makeCourseLines(roofs, ringOf, holesOf, SHINGLE_EXPOSURE_FT, shade(roofColor, 0.6)) : null;
  if (shingleLines) root.add(shingleLines);

  // Outlines: every facet edge once; openings in a lighter tone so they read as frames.
  const edgeGeo = (faces: MeshFace[]) => {
    const seen = new Set<string>();
    const pos: number[] = [];
    for (const f of faces) {
      const ring = f.polygon;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const k = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(k) || !pts[a] || !pts[b]) continue;
        seen.add(k);
        pos.push(pts[a].x, pts[a].y, pts[a].z, pts[b].x, pts[b].y, pts[b].z);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  };
  const structLines = new THREE.LineSegments(edgeGeo([...roofs, ...walls]), new THREE.LineBasicMaterial({ color: "#1f2328", transparent: true, opacity: 0.55 }));
  const openLines = new THREE.LineSegments(edgeGeo([...opens, ...doors]), new THREE.LineBasicMaterial({ color: "#f5f5f0" }));
  root.add(structLines, openLines);

  // Ground: a soft disc under the house.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 2.2, 64),
    new THREE.MeshStandardMaterial({ color: "#9aa59a", roughness: 1, metalness: 0, transparent: true, opacity: 0.35 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  root.add(ground);

  const centroid = (ring: V3[]) => ring.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(ring.length, 1));
  const labelAnchors = mesh.faces
    .filter((f) => f.type === "roof" || (f.type === "wall" && f.name && !/^unclassified/i.test(f.name) && (f.areaSqft ?? 0) >= 40))
    .map((f) => {
      const ring = ringOf.get(f.id)!;
      return { face: f, at: centroid(ring).add(ringNormal(ring).multiplyScalar(0.3)) };
    });

  return {
    root, pickables: [roofMesh, wallCut, wallFull, openMesh, doorMesh, soffitMesh], triFace, roofMat, wallMat, glassMat, doorMat, wallCut, wallFull,
    openings: [openMesh, doorMesh, openLines], sidingLines, shingleLines, ringOf, holesOf, center, radius, labelAnchors,
  };
}

const PRESET_DIRS: Record<ViewPreset, [number, number, number]> = {
  // HOVER −y is three +z (see toThree) — "front" looks at the side facing HOVER's −y.
  front: [0, 0.35, 1], back: [0, 0.35, -1], left: [-1, 0.35, 0], right: [1, 0.35, 0], top: [0, 1, 0.0001], iso: [0.9, 0.7, 1.1],
};

const fmtArea = (n: number | null) => (n === null ? null : `${Math.round(n).toLocaleString("en-US")} sf`);
export const faceLabel = (f: MeshFace) => [f.name, fmtArea(f.areaSqft), f.pitch].filter(Boolean).join(" · ");

export default function Hover3DViewer(props: Hover3DViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const state = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    built: Built; highlight: THREE.Mesh | null; labels: HTMLDivElement[]; frame: number;
  } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // Scene setup — once per mesh.
  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    } catch {
      host.innerHTML = '<p style="padding:1rem;font-size:.875rem">This browser could not start 3D graphics (WebGL). The Wireframes tab still works.</p>';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("data-testid", "hover-3d-canvas");

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f86, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    scene.add(fill);

    const built = build(propsRef.current.mesh, propsRef.current.sidingColor, propsRef.current.roofColor, propsRef.current.windowColor, propsRef.current.doorColor, propsRef.current.sidingReveal, propsRef.current.roofShingles);
    scene.add(built.root);
    sun.position.set(built.radius * 1.5, built.radius * 2.5, built.radius * 1.2);
    fill.position.set(-built.radius * 1.5, built.radius, -built.radius);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, built.radius * 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = built.radius * 0.3;
    controls.maxDistance = built.radius * 8;
    controls.screenSpacePanning = true;

    // Labels (HTML, positioned each frame).
    const labelHost = labelsRef.current!;
    labelHost.innerHTML = "";
    const labels = built.labelAnchors.map(({ face }) => {
      const el = document.createElement("div");
      el.className = "hover3d-label";
      el.textContent = faceLabel(face);
      el.dataset.type = face.type;
      labelHost.appendChild(el);
      return el;
    });

    const s = { renderer, scene, camera, controls, built, highlight: null as THREE.Mesh | null, labels, frame: 0 };
    state.current = s;

    const resize = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const v = new THREE.Vector3();
    const tick = () => {
      s.frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
      if (propsRef.current.showLabels) {
        const w = host.clientWidth, h = host.clientHeight;
        built.labelAnchors.forEach((a, i) => {
          const el = labels[i];
          v.copy(a.at).project(camera);
          const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
          el.style.display = visible ? "block" : "none";
          if (visible) el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        });
      }
    };
    tick();

    // Tap / click to pick (a drag is an orbit, not a pick).
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(built.pickables.filter((m) => m.visible), false);
      const hit = hits.find((x) => x.faceIndex !== undefined && x.faceIndex !== null);
      const face = hit ? built.triFace.get(hit.object as THREE.Mesh)?.[hit.faceIndex!] ?? null : null;
      propsRef.current.onSelect(face);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    return () => {
      cancelAnimationFrame(s.frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      scene.traverse((o: any) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m: THREE.Material) => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      labelHost.innerHTML = "";
      state.current = null;
    };
  }, [props.mesh]);

  // Colors.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.built.wallMat.color.set(props.sidingColor);
    s.built.roofMat.color.set(props.roofColor);
    s.built.glassMat.color.set(props.windowColor);
    s.built.doorMat.color.set(props.doorColor);
  }, [props.sidingColor, props.roofColor, props.windowColor, props.doorColor, props.mesh]);

  // Course lines follow the reveal / shingle switches and the colours they are shaded from.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const b = s.built;
    const swap = (old: THREE.Object3D | null, next: THREE.Object3D | null) => {
      if (old) { b.root.remove(old); (old as THREE.LineSegments).geometry?.dispose(); ((old as THREE.LineSegments).material as THREE.Material)?.dispose(); }
      if (next) b.root.add(next);
      return next;
    };
    const walls = props.mesh.faces.filter((f) => f.type === "wall");
    const roofs = props.mesh.faces.filter((f) => f.type === "roof");
    // Windows and doors hidden → solid walls, so the courses run straight through where they were.
    const holes = props.showOpenings ? b.holesOf : new Map<string, V3[][]>();
    b.sidingLines = swap(b.sidingLines, props.sidingReveal ? makeCourseLines(walls, b.ringOf, holes, props.sidingReveal / 12, shade(props.sidingColor, 0.55)) : null);
    b.shingleLines = swap(b.shingleLines, props.roofShingles ? makeCourseLines(roofs, b.ringOf, holes, SHINGLE_EXPOSURE_FT, shade(props.roofColor, 0.6)) : null);
  }, [props.sidingReveal, props.roofShingles, props.sidingColor, props.roofColor, props.showOpenings, props.mesh]);

  // Windows/doors on → walls with cut-outs + glass; off → solid walls.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.built.wallCut.visible = props.showOpenings;
    s.built.wallFull.visible = !props.showOpenings;
    s.built.openings.forEach((o) => { o.visible = props.showOpenings; });
  }, [props.showOpenings, props.mesh]);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.labels.forEach((el) => { el.style.display = props.showLabels ? "block" : "none"; });
  }, [props.showLabels, props.mesh]);

  // View presets.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const d = new THREE.Vector3(...PRESET_DIRS[props.view.preset]).normalize();
    const dist = s.built.radius / Math.sin(THREE.MathUtils.degToRad(s.camera.fov / 2)) * 0.8;
    s.controls.target.copy(s.built.center);
    s.camera.position.copy(s.built.center).add(d.multiplyScalar(dist));
    s.camera.up.set(0, 1, 0);
    s.camera.lookAt(s.built.center);
    s.controls.update();
  }, [props.view.preset, props.view.seq, props.mesh]);

  // Selection highlight.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    if (s.highlight) {
      s.built.root.remove(s.highlight);
      s.highlight.geometry.dispose();
      (s.highlight.material as THREE.Material).dispose();
      s.highlight = null;
    }
    const ids = new Set(props.selectedIds);
    const pos: number[] = [];
    for (const face of props.mesh.faces) {
      if (!ids.has(face.id)) continue;
      const ring = s.built.ringOf.get(face.id);
      if (!ring) continue;
      pos.push(...triangulate(ring, face.type === "wall" && props.showOpenings ? s.built.holesOf.get(face.id) ?? [] : []));
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.MeshBasicMaterial({
      color: "#f5b301", transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    s.highlight = new THREE.Mesh(g, mat);
    s.built.root.add(s.highlight);
  }, [props.selectedIds, props.mesh, props.showOpenings]);

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="hover-3d-viewer">
      <div ref={hostRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
      <style>{`
        .hover3d-label { position:absolute; left:0; top:0; white-space:nowrap; font-size:11px; line-height:1.2;
          padding:2px 6px; border-radius:6px; background:rgba(17,24,39,.78); color:#fff; font-variant-numeric:tabular-nums; }
        .hover3d-label[data-type="wall"] { background:rgba(255,255,255,.85); color:#111827; }
      `}</style>
    </div>
  );
}
