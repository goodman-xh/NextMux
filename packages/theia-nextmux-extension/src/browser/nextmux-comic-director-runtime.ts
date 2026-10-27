import * as THREE from 'three';
import { isProjectMediaUri, mirrorScenePosture, normalizeScene, sampleScene, type SceneDocument, type SceneObject, type SceneVector } from '@nextmux/comic-core/director-scene';
import { clampScenePosture, SCENE_POSES } from '@nextmux/comic-core/director-catalogue';

/** Browser URLs are resolved at the project boundary; the scene stores relative media URIs. */
export interface DirectorRuntimeOptions {
    resolveAssetUrl(uri: string): string | Promise<string>;
    onSelect?(ids: string[]): void;
    onTransform?(id: string, transform: Pick<SceneObject, 'position' | 'rotation' | 'scale'>): void;
    onError?(code: string, error: unknown): void;
}
export interface DirectorExportOptions { width: number; height: number; cameraId?: string; frame?: number; sample?: boolean }
export interface DirectorRecordingOptions extends DirectorExportOptions {
    fps: number;
    frames: number;
    onProgress?(frame: number): void;
    signal?: AbortSignal;
}
export interface DirectorCameraState { position: SceneVector; rotation: SceneVector; lookAt: SceneVector; fov: number; matrix?: readonly number[] }
export interface DirectorRuntime {
    readonly canvas: HTMLCanvasElement;
    update(scene: SceneDocument, options?: { sample?: boolean }): void;
    select(ids: string[]): void;
    setCamera(id?: string): void;
    setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void;
    setSnap(enabled: boolean, size: number): void;
    setHelpers(visible: boolean): void;
    setNavigation(options: { flySpeed?: number; rotateSensitivity?: number }): void;
    readFreeCamera(): DirectorCameraState;
    readFreeCameraForObject(id: string): DirectorCameraState;
    readCamera(cameraId?: string): DirectorCameraState;
    setFreeCamera(camera: Pick<DirectorCameraState, 'position' | 'lookAt' | 'fov'>): void;
    focus(ids: string[]): void;
    resize(): void;
    renderFrame(frame: number): void;
    capture(options: DirectorExportOptions): Promise<Blob>;
    record(options: DirectorRecordingOptions): Promise<Blob>;
    setWorld(world?: { kind: 'model' | 'panorama' | 'splat'; uri: string }): Promise<void>;
    dispose(): void;
}

const DEG = Math.PI / 180;
const vector = (v: SceneVector): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);
const plain = (v: THREE.Vector3): SceneVector => ({ x: v.x, y: v.y, z: v.z });
export function directorCameraInParent(state: DirectorCameraState, parent?: THREE.Object3D): DirectorCameraState {
    if (!parent) return { ...state, position: { ...state.position }, lookAt: { ...state.lookAt }, rotation: { x: 0, y: 0, z: 0 } };
    parent.updateWorldMatrix(true, false);
    if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) throw new Error('DIRECTOR_CAMERA_PARENT');
    const world = new THREE.Matrix4().lookAt(vector(state.position), vector(state.lookAt), new THREE.Vector3(0, 1, 0)).setPosition(vector(state.position));
    const local = parent.matrixWorld.clone().invert().multiply(world);
    return { ...state, position: plain(parent.worldToLocal(vector(state.position))), lookAt: plain(parent.worldToLocal(vector(state.lookAt))), rotation: { x: 0, y: 0, z: 0 }, matrix: [...local.elements] };
}
export function beginDirectorObjectTransform(item: THREE.Object3D): void {
    if (!item.matrixAutoUpdate) {
        item.matrix.decompose(item.position, item.quaternion, item.scale);
        item.quaternion.normalize();
        item.matrixAutoUpdate = true; item.updateMatrix();
    }
}
export function readDirectorObjectTransform(item: THREE.Object3D, stored?: SceneObject): Pick<SceneObject, 'position' | 'rotation' | 'scale'> {
    item.matrixAutoUpdate = true; item.updateMatrix();
    let rotation = item.rotation.clone();
    if (stored?.kind === 'camera') {
        const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(item.position, vector(stored.lookAt ?? { x: 0, y: 1, z: 0 }), new THREE.Vector3(0, 1, 0)));
        rotation = new THREE.Euler().setFromQuaternion(base.invert().multiply(item.quaternion), 'XYZ');
    }
    return { position: plain(item.position), rotation: { x: rotation.x / DEG, y: rotation.y / DEG, z: rotation.z / DEG }, scale: plain(item.scale) };
}
function visibleInHierarchy(object: THREE.Object3D): boolean {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false;
    return true;
}

function material(color = '#b8b8b8'): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
}
function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const result = new THREE.Mesh(geometry, mat);
    result.position.set(x, y, z);
    result.castShadow = true;
    result.receiveShadow = true;
    return result;
}
function box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x = 0, y = h / 2, z = 0): THREE.Mesh {
    const result = mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    parent.add(result);
    return result;
}
function cylinder(parent: THREE.Object3D, mat: THREE.Material, radius: number, height: number, x = 0, y = height / 2, z = 0): THREE.Mesh {
    const result = mesh(new THREE.CylinderGeometry(radius, radius, height, 16), mat, x, y, z);
    parent.add(result);
    return result;
}
function sphere(parent: THREE.Object3D, mat: THREE.Material, radius: number, x = 0, y = radius, z = 0): THREE.Mesh {
    const result = mesh(new THREE.SphereGeometry(radius, 16, 12), mat, x, y, z);
    parent.add(result);
    return result;
}

/** Geometry belongs to each instance, so disposal never invalidates another object. */
export function createDirectorProp(assetId: string, color?: string): THREE.Group {
    const group = new THREE.Group();
    group.userData.assetId = assetId;
    const mat = material(color);
    const dark = material('#333333');
    const primitive = assetId.replace(/_(red|blue|green|yellow)$/, '');
    switch (primitive) {
        case 'cube': box(group, mat, 1, 1, 1); break;
        case 'sphere': sphere(group, mat, 0.5); break;
        case 'box': case 'cuboid': case 'rectangle': box(group, mat, 1.6, 0.7, 0.8); break;
        case 'cylinder': cylinder(group, mat, 0.45, 1); break;
        case 'cone': group.add(mesh(new THREE.ConeGeometry(0.5, 1.2, 24), mat, 0, 0.6)); break;
        case 'pyramid': group.add(mesh(new THREE.ConeGeometry(0.7, 1.2, 4), mat, 0, 0.6)); break;
        case 'torus': group.add(mesh(new THREE.TorusGeometry(0.45, 0.13, 12, 24), mat, 0, 0.65)); break;
        case 'capsule': group.add(mesh(new THREE.CapsuleGeometry(0.3, 0.7, 6, 16), mat, 0, 0.65)); break;
        case 'plane': {
            mat.side = THREE.DoubleSide;
            const plane = mesh(new THREE.PlaneGeometry(2, 2), mat);
            plane.rotation.x = -Math.PI / 2;
            group.add(plane);
            break;
        }
        case 'chair': case 'bench': {
            const width = assetId === 'bench' ? 1.8 : 0.6;
            box(group, mat, width, 0.1, 0.65, 0, 0.48);
            box(group, mat, width, 0.55, 0.1, 0, 0.8, -0.3);
            for (const x of [-width / 2 + 0.08, width / 2 - 0.08]) {
                for (const z of [-0.23, 0.23]) box(group, dark, 0.08, 0.45, 0.08, x, 0.225, z);
            }
            break;
        }
        case 'table_rect': {
            box(group, mat, 1.5, 0.1, 0.85, 0, 0.78);
            for (const x of [-0.63, 0.63]) for (const z of [-0.3, 0.3]) box(group, dark, 0.08, 0.73, 0.08, x, 0.365, z);
            break;
        }
        case 'table_round': cylinder(group, mat, 0.65, 0.1, 0, 0.78); cylinder(group, dark, 0.1, 0.73); cylinder(group, dark, 0.4, 0.05); break;
        case 'sofa':
            box(group, mat, 2, 0.4, 0.8, 0, 0.32);
            box(group, mat, 2, 0.65, 0.18, 0, 0.67, -0.32);
            for (const x of [-0.9, 0.9]) box(group, mat, 0.2, 0.5, 0.85, x, 0.52);
            break;
        case 'wall_2m': case 'wall_3m': box(group, mat, assetId === 'wall_3m' ? 3 : 2, 2.6, 0.15); break;
        case 'pillar': cylinder(group, mat, 0.23, 2.8); break;
        case 'stairs': for (let i = 0; i < 6; i++) box(group, mat, 1.3, (i + 1) * 0.18, 0.3, 0, (i + 1) * 0.09, i * 0.3); break;
        case 'tree_small': case 'tree_large': {
            const size = assetId === 'tree_large' ? 1.5 : 1;
            cylinder(group, material('#775432'), 0.12 * size, 1.6 * size);
            sphere(group, mat, 0.75 * size, 0, 1.9 * size);
            break;
        }
        case 'rock': { const rock = mesh(new THREE.DodecahedronGeometry(0.6), mat, 0, 0.4); rock.scale.set(1.2, 0.8, 1); group.add(rock); break; }
        case 'bush': sphere(group, mat, 0.55, 0, 0.4); sphere(group, mat, 0.4, 0.45, 0.35); sphere(group, mat, 0.4, -0.4, 0.35); break;
        case 'car': {
            box(group, mat, 1.6, 0.55, 3, 0, 0.55);
            box(group, mat, 1.35, 0.65, 1.65, 0, 1.05, -0.15);
            for (const x of [-0.76, 0.76]) for (const z of [-1, 1]) {
                const wheel = cylinder(group, dark, 0.33, 0.18, x, 0.33, z);
                wheel.rotation.z = Math.PI / 2;
            }
            break;
        }
        case 'bicycle': {
            for (const z of [-0.7, 0.7]) {
                const wheel = mesh(new THREE.TorusGeometry(0.35, 0.035, 8, 28), dark, 0, 0.36, z);
                wheel.rotation.y = Math.PI / 2;
                group.add(wheel);
            }
            const points = [[0, 0.36, -0.7], [0, 0.85, -0.35], [0, 0.4, 0], [0, 0.86, 0.4], [0, 0.36, 0.7]];
            for (const [a, b] of [[0, 1], [1, 2], [0, 2], [1, 3], [2, 3], [3, 4], [2, 4]]) {
                const start = new THREE.Vector3(...points[a] as [number, number, number]);
                const end = new THREE.Vector3(...points[b] as [number, number, number]);
                const tube = cylinder(group, mat, 0.03, start.distanceTo(end));
                tube.position.copy(start).add(end).multiplyScalar(0.5);
                tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
            }
            box(group, dark, 0.18, 0.05, 0.28, 0, 0.9, -0.35);
            box(group, dark, 0.55, 0.05, 0.05, 0, 1, 0.4);
            break;
        }
        case 'streetlamp': cylinder(group, mat, 0.06, 3); box(group, mat, 0.5, 0.07, 0.07, 0.22, 2.96); sphere(group, material('#ffefbe'), 0.17, 0.43, 2.8); break;
        case 'trash_bin': cylinder(group, mat, 0.32, 0.8); cylinder(group, dark, 0.35, 0.06, 0, 0.82); break;
        case 'arrow_marker': {
            box(group, mat, 0.18, 0.06, 0.8, 0, 0.04);
            const head = mesh(new THREE.ConeGeometry(0.25, 0.45, 3), mat, 0, 0.04, -0.55);
            head.rotation.x = -Math.PI / 2;
            group.add(head);
            break;
        }
        case 'area_marker': {
            mat.transparent = true; mat.opacity = 0.35; mat.side = THREE.DoubleSide;
            const area = mesh(new THREE.PlaneGeometry(2, 2), mat, 0, 0.015);
            area.rotation.x = -Math.PI / 2;
            group.add(area);
            break;
        }
        case 'image_board': {
            const board = mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshBasicMaterial({ color: color ?? '#777777', side: THREE.DoubleSide }), 0, 1.4);
            board.name = 'picture-board';
            group.add(board);
            for (const x of [-0.85, 0.85]) box(group, dark, 0.07, 0.65, 0.07, x, 0.325);
            break;
        }
        default:
            mat.dispose(); dark.dispose();
            throw new Error('DIRECTOR_PROP_UNSUPPORTED');
    }
    // Some branches do not need the accessory material; do not retain unused GPU resources.
    const used = new Set<THREE.Material>();
    group.traverse(child => { if (child instanceof THREE.Mesh) for (const item of Array.isArray(child.material) ? child.material : [child.material]) used.add(item); });
    if (!used.has(mat)) mat.dispose();
    if (!used.has(dark)) dark.dispose();
    return group;
}

export interface DirectorMannequinRig { root: THREE.Group; joints: Record<string, THREE.Group> }
export function createDirectorMannequin(color = '#c8c8c8'): DirectorMannequinRig {
    const root = new THREE.Group();
    const joints: Record<string, THREE.Group> = {};
    const skin = material(color);
    const jointMat = material('#606060');
    function joint(name: string, parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
        const result = new THREE.Group(); result.name = name; result.position.set(x, y, z);
        parent.add(result); joints[name] = result;
        sphere(result, jointMat, 0.055, 0, 0);
        return result;
    }
    const body = joint('body', root, 0, 0.92);
    box(body, skin, 0.35, 0.18, 0.22, 0, 0);
    const torso = joint('torso', body, 0, 0.14);
    box(torso, skin, 0.42, 0.43, 0.24, 0, 0.2);
    const head = joint('head', torso, 0, 0.54);
    sphere(head, skin, 0.15, 0, 0.12);
    // The small front marker makes head yaw and mirrored orientation visible.
    box(head, jointMat, 0.045, 0.035, 0.06, 0, 0.12, 0.15);
    for (const side of ['l', 'r']) {
        const sign = side === 'l' ? 1 : -1;
        const arm = joint(`${side}_arm`, torso, sign * 0.25, 0.43);
        cylinder(arm, skin, 0.065, 0.3, 0, -0.15);
        const elbow = joint(`${side}_elbow`, arm, 0, -0.31);
        cylinder(elbow, skin, 0.05, 0.27, 0, -0.135);
        const wrist = joint(`${side}_wrist`, elbow, 0, -0.29);
        box(wrist, skin, 0.08, 0.14, 0.04, 0, -0.07);
        const leg = joint(`${side}_leg`, body, sign * 0.12, -0.06);
        cylinder(leg, skin, 0.09, 0.41, 0, -0.205);
        const knee = joint(`${side}_knee`, leg, 0, -0.43);
        cylinder(knee, skin, 0.065, 0.36, 0, -0.18);
        const ankle = joint(`${side}_ankle`, knee, 0, -0.38);
        box(ankle, skin, 0.12, 0.07, 0.25, 0, -0.025, 0.07);
    }
    return { root, joints };
}

export function applyDirectorPosture(rig: DirectorMannequinRig, posture: SceneObject['posture']): void {
    for (const [name, node] of Object.entries(rig.joints)) {
        const values = posture?.[name] ?? {};
        const side = name.startsWith('r_') ? -1 : 1;
        if (name === 'head') node.rotation.set((values.nod ?? 0) * DEG, (values.turn ?? 0) * DEG, (values.tilt ?? 0) * DEG);
        else if (name === 'body' || name === 'torso') node.rotation.set((values.bend ?? 0) * DEG, (values.turn ?? 0) * DEG, (values.tilt ?? 0) * DEG);
        else if (name.endsWith('_arm') || name.endsWith('_leg')) node.rotation.set(-(values.raise ?? 0) * DEG, (values.turn ?? 0) * DEG, side * (values.straddle ?? 0) * DEG);
        else if (name.endsWith('_elbow')) node.rotation.set(-(values.bend ?? 0) * DEG, 0, 0);
        else if (name.endsWith('_knee')) node.rotation.set((values.bend ?? 0) * DEG, 0, 0);
        else if (name.endsWith('_wrist')) node.rotation.set((values.bend ?? 0) * DEG, (values.turn ?? 0) * DEG, 0);
        else if (name.endsWith('_ankle')) node.rotation.set((values.bend ?? 0) * DEG, 0, (values.tilt ?? 0) * DEG);
    }
    rig.root.updateMatrixWorld(true);
}

export interface DirectorObjectGraph {
    root: THREE.Group;
    helpers: THREE.Group;
    objects: Map<string, THREE.Object3D>;
    cameras: Map<string, THREE.PerspectiveCamera>;
    rigs: Map<string, DirectorMannequinRig[]>;
    apply(objects: readonly SceneObject[]): void;
    dispose(): void;
}

function disposeObject(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse(child => {
        // Addons may use Three's ESM build while the Theia shell emits CommonJS.
        const drawable = child as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isSprite?: boolean; geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
        if ((drawable.isMesh || drawable.isLine || drawable.isSprite) && drawable.material) {
            if (drawable.geometry) geometries.add(drawable.geometry);
            for (const item of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
                materials.add(item);
                for (const value of Object.values(item)) if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture) textures.add(value as THREE.Texture);
            }
        }
    });
    geometries.forEach(item => item.dispose());
    textures.forEach(item => item.dispose());
    materials.forEach(item => item.dispose());
    root.removeFromParent();
    root.clear();
}

/** Pure scene-to-Three mapping: no renderer, DOM, asset fetching or canvas is needed. */
export function createDirectorObjectGraph(document: SceneDocument): DirectorObjectGraph {
    const scene = normalizeScene(document);
    const root = new THREE.Group(); root.name = 'director-objects';
    const helpers = new THREE.Group(); helpers.name = 'director-helpers';
    const objects = new Map<string, THREE.Object3D>();
    const cameras = new Map<string, THREE.PerspectiveCamera>();
    const rigs = new Map<string, DirectorMannequinRig[]>();
    const cameraHelpers: THREE.CameraHelper[] = [];
    for (const obj of scene.objects) {
        let item: THREE.Object3D;
        if (obj.kind === 'prop') item = createDirectorProp(obj.assetId ?? 'cube_blue', obj.color);
        else if (obj.kind === 'character') {
            const character = new THREE.Group();
            const count = obj.bodyType === 'group3' ? 3 : obj.bodyType === 'group5' ? 5 : 1;
            const chars: DirectorMannequinRig[] = [];
            for (let i = 0; i < count; i++) {
                const rig = createDirectorMannequin(obj.color);
                rig.root.position.x = (i - (count - 1) / 2) * 0.75;
                const bodyScales: Record<string, [number, number, number]> = {
                    mannequin_female: [0.9, 0.96, 0.92], mannequin_child: [0.65, 0.66, 0.65],
                    mannequin_stocky: [1.3, 0.98, 1.25], mannequin_slim: [0.78, 1.06, 0.82]
                };
                rig.root.scale.set(...(bodyScales[obj.bodyType ?? ''] ?? [1, 1, 1]));
                character.add(rig.root); chars.push(rig);
            }
            rigs.set(obj.id, chars); item = character;
        } else if (obj.kind === 'camera') {
            const camera = new THREE.PerspectiveCamera(obj.fov ?? 50, 1, 0.01, 2000);
            cameras.set(obj.id, camera); item = camera;
            const helper = new THREE.CameraHelper(camera); helper.userData.sceneObjectId = obj.id;
            cameraHelpers.push(helper); helpers.add(helper);
            const marker = mesh(new THREE.BoxGeometry(0.2, 0.14, 0.15), material(obj.color ?? '#47a3de'));
            marker.name = 'camera-marker'; camera.add(marker);
        } else if (obj.kind === 'light') {
            const container = new THREE.Group();
            const light = obj.lightType === 'spot' ? new THREE.SpotLight() : obj.lightType === 'directional' ? new THREE.DirectionalLight() : new THREE.PointLight();
            light.name = 'director-light'; container.add(light);
            if (light instanceof THREE.SpotLight || light instanceof THREE.DirectionalLight) container.add(light.target);
            item = container;
        } else item = new THREE.Group();
        item.name = obj.label;
        item.userData.sceneObjectId = obj.id;
        item.userData.kind = obj.kind;
        item.traverse(child => { child.userData.sceneObjectId = obj.id; });
        objects.set(obj.id, item);
    }
    for (const obj of scene.objects) (obj.parentId ? objects.get(obj.parentId) ?? root : root).add(objects.get(obj.id)!);
    function apply(values: readonly SceneObject[]): void {
        for (const obj of values) {
            const item = objects.get(obj.id); if (!item) continue;
            item.position.copy(vector(obj.position)); item.rotation.set(obj.rotation.x * DEG, obj.rotation.y * DEG, obj.rotation.z * DEG);
            item.scale.copy(vector(obj.scale)); item.visible = obj.visible;
            item.matrixAutoUpdate = !obj.matrix;
            if (obj.matrix) item.matrix.fromArray([...obj.matrix]);
            item.userData.locked = obj.locked;
            if (obj.kind === 'character') {
                const stored = obj.posture && Object.keys(obj.posture).length ? obj.posture : SCENE_POSES.find(entry => entry.id === obj.pose)?.posture;
                const pose = stored ? clampScenePosture(stored) : undefined;
                const posture = obj.mirror && pose ? mirrorScenePosture(pose) : pose;
                for (const rig of rigs.get(obj.id) ?? []) applyDirectorPosture(rig, posture);
            }
            if (obj.kind === 'light') {
                const light = item.getObjectByName('director-light') as THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight;
                light.color.set(obj.color ?? '#ffffff'); light.intensity = obj.intensity ?? 1; light.castShadow = obj.castShadow ?? true;
                if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) light.distance = obj.distance ?? 0;
                if (light instanceof THREE.SpotLight) { light.angle = (obj.angle ?? 45) * DEG; light.penumbra = 0.25; }
            }
        }
        root.updateMatrixWorld(true);
        for (const obj of values) {
            if (obj.kind === 'light') {
                const container = objects.get(obj.id)!;
                const light = container.getObjectByName('director-light') as THREE.PointLight | THREE.SpotLight | THREE.DirectionalLight;
                if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
                    const target = vector(obj.lookAt ?? { x: obj.position.x, y: 0, z: obj.position.z });
                    container.parent?.localToWorld(target); container.worldToLocal(target); light.target.position.copy(target);
                }
            }
            const camera = cameras.get(obj.id); if (!camera) continue;
            // lookAt is parent-local, matching the portable scene matrix convention.
            // Camera.lookAt(world) cannot preserve this basis under a scaled parent.
            camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(vector(obj.position), vector(obj.lookAt ?? { x: 0, y: 1, z: 0 }), new THREE.Vector3(0, 1, 0)));
            camera.rotateX(obj.rotation.x * DEG); camera.rotateY(obj.rotation.y * DEG); camera.rotateZ(obj.rotation.z * DEG);
            camera.fov = obj.fov ?? 50; camera.updateProjectionMatrix();
            if (obj.matrix) camera.matrix.fromArray([...obj.matrix]);
        }
        root.updateMatrixWorld(true);
        for (const helper of cameraHelpers) { helper.update(); helper.visible = visibleInHierarchy(helper.camera); }
    }
    apply(scene.objects);
    return { root, helpers, objects, cameras, rigs, apply, dispose: () => { disposeObject(root); disposeObject(helpers); } };
}

export interface DirectorRendererPort {
    domElement: HTMLCanvasElement;
    getSize(target: THREE.Vector2): THREE.Vector2;
    getPixelRatio(): number;
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: THREE.Scene, camera: THREE.Camera): void;
}

export function directorExportSize(width: number, height: number): { width: number; height: number } {
    if (![width, height].every(value => Number.isFinite(value) && value >= 2 && value <= 8192) || width * height > 33_554_432) throw new Error('DIRECTOR_EXPORT_SIZE');
    const size = { width: Math.round(width / 2) * 2, height: Math.round(height / 2) * 2 };
    if (size.width * size.height > 33_554_432) throw new Error('DIRECTOR_EXPORT_SIZE');
    return size;
}

/** Always restores editor dimensions/projection/helpers, including rejected canvas writes. */
export async function withDirectorExportFrame<T>(renderer: DirectorRendererPort, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
    helpers: readonly THREE.Object3D[], options: Pick<DirectorExportOptions, 'width' | 'height'>, action: () => Promise<T>): Promise<T> {
    const size = directorExportSize(options.width, options.height);
    const oldSize = renderer.getSize(new THREE.Vector2()).clone();
    const ratio = renderer.getPixelRatio(); const aspect = camera.aspect;
    const visible = helpers.map(item => item.visible);
    try {
        helpers.forEach(item => { item.visible = false; });
        renderer.setPixelRatio(1); renderer.setSize(size.width, size.height, false);
        camera.aspect = size.width / size.height; camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        return await action();
    } finally {
        helpers.forEach((item, index) => { item.visible = visible[index]; });
        renderer.setPixelRatio(ratio); renderer.setSize(oldSize.x, oldSize.y, false);
        camera.aspect = aspect; camera.updateProjectionMatrix();
        renderer.render(scene, camera);
    }
}

export function directorRecordingMime(isSupported: (type: string) => boolean): string | undefined {
    return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(isSupported);
}
export function directorRecordingBitrate(fps: number, frames: number): number {
    if (!Number.isFinite(fps) || fps < 1 || fps > 60 || !Number.isInteger(frames) || frames < 1 || frames > 18000) throw new Error('DIRECTOR_RECORDING_RANGE');
    return Math.min(8_000_000, Math.floor(192 * 1024 * 1024 * 8 * fps / frames));
}

function labelSprite(label: string, fontSize: number): THREE.Sprite | undefined {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d'); if (!ctx) return undefined;
    const font = Math.min(96, Math.max(12, fontSize));
    ctx.font = `${font}px sans-serif`;
    canvas.width = Math.min(2048, Math.ceil(ctx.measureText(label).width) + 24); canvas.height = font + 20;
    ctx.font = `${font}px sans-serif`; ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.fillText(label, 12, canvas.height / 2);
    const result = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    result.scale.set(canvas.width / canvas.height * 0.22, 0.22, 1);
    return result;
}

function textInput(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export async function createDirectorRuntime(container: HTMLElement, options: DirectorRuntimeOptions): Promise<DirectorRuntime> {
    const [{ OrbitControls }, { TransformControls }, { GLTFLoader }] = await Promise.all([
        import('three/addons/controls/OrbitControls.js'), import('three/addons/controls/TransformControls.js'), import('three/addons/loaders/GLTFLoader.js')
    ]);
    const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: false });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.tabIndex = 0; renderer.domElement.className = 'nmx-director-canvas'; container.appendChild(renderer.domElement);
    const stage = new THREE.Scene();
    const freeCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000); freeCamera.position.set(4, 3, 6);
    const orbit = new OrbitControls(freeCamera, renderer.domElement); orbit.target.set(0, 1, 0); orbit.enableDamping = true; orbit.update();
    const transform = new TransformControls(freeCamera, renderer.domElement); const gizmo = transform.getHelper(); stage.add(gizmo);
    const ambient = new THREE.HemisphereLight('#ffffff', '#68686c', 1.3); stage.add(ambient);
    const sun = new THREE.DirectionalLight('#ffffff', 2); sun.position.set(4, 8, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); stage.add(sun);
    const groundMat = material('#8a8a8a'); groundMat.transparent = true;
    const ground = mesh(new THREE.PlaneGeometry(200, 200), groundMat); ground.rotation.x = -Math.PI / 2; ground.castShadow = false; stage.add(ground);
    const grid = new THREE.GridHelper(40, 40, '#555555', '#aaaaaa'); stage.add(grid);
    const labels = new THREE.Group(); stage.add(labels);
    const worldRoot = new THREE.Group(); stage.add(worldRoot);
    const gltf = new GLTFLoader(); const textures = new THREE.TextureLoader();
    let document = normalizeScene({});
    let graph = createDirectorObjectGraph(document); stage.add(graph.root, graph.helpers);
    let disposed = false; let exporting = false; let helpersVisible = true; let cameraId: string | undefined;
    let selected: string[] = []; let frame = 0; let previewSample = true; let sceneEpoch = 0; let worldEpoch = 0;
    let flySpeed = 3; let lastTime = performance.now(); let requestId = 0;
    let backgroundTexture: THREE.Texture | undefined; let worldBackgroundTexture: THREE.Texture | undefined; let panoramaUri: string | undefined;
    let pendingAssets: Promise<void>[] = []; let assetError: unknown;
    let worldPending: Promise<void> = Promise.resolve(); let worldError: unknown;
    let recordingAbort: (() => void) | undefined;
    let spark: Awaited<ReturnType<typeof createSpark>> | undefined;
    let sparkPending: ReturnType<typeof createSpark> | undefined;
    const held = new Set<string>();
    const error = (code: string, cause: unknown): void => { if (!disposed) options.onError?.(code, cause); };
    function camera(): THREE.PerspectiveCamera { return (cameraId && graph.cameras.get(cameraId)) || freeCamera; }
    function refreshHelpers(): void {
        const editing = !cameraId && !exporting;
        graph.helpers.visible = helpersVisible && editing;
        labels.visible = helpersVisible && editing;
        gizmo.visible = editing && !!transform.object;
        orbit.enabled = editing && !transform.dragging;
        for (const cam of graph.cameras.values()) cam.children.forEach(child => { child.visible = helpersVisible && editing; });
    }
    function applySelection(): void {
        transform.detach();
        const target = selected.length === 1 ? graph.objects.get(selected[0]) : undefined;
        if (target && !target.userData.locked && !cameraId) transform.attach(target);
        refreshHelpers();
    }
    function updateLabels(): void {
        disposeObject(labels); stage.add(labels);
        for (const obj of document.objects) {
            if (document.showLabels) {
                const sprite = labelSprite(obj.label, document.labelFontSize);
                if (sprite) { sprite.userData.sceneObjectId = obj.id; sprite.userData.label = true; labels.add(sprite); }
            }
            if (document.showBaseMarker && obj.kind === 'character') {
                const ring = mesh(new THREE.RingGeometry(0.28, 0.34, 32), new THREE.MeshBasicMaterial({ color: obj.color ?? '#888888', side: THREE.DoubleSide }));
                ring.rotation.x = -Math.PI / 2; ring.userData.sceneObjectId = obj.id; labels.add(ring);
            }
        }
    }
    function placeLabels(): void {
        for (const item of labels.children) {
            const owner = graph.objects.get(item.userData.sceneObjectId); if (!owner) continue;
            item.position.copy(owner.getWorldPosition(new THREE.Vector3()));
            item.position.y += item.userData.label ? 2.1 : 0.015;
            item.visible = visibleInHierarchy(owner);
        }
    }
    async function assetUrl(uri: string): Promise<string> {
        // Local persisted URIs cannot turn into remote fetches or temporary JSON payloads.
        if (!isProjectMediaUri(uri)) throw new Error('DIRECTOR_ASSET_URI');
        return options.resolveAssetUrl(uri);
    }
    async function loadPanorama(uri: string | undefined, epoch: number): Promise<void> {
        if (uri === panoramaUri && (uri === undefined || backgroundTexture)) return;
        if (!uri) { panoramaUri = undefined; backgroundTexture?.dispose(); backgroundTexture = undefined; stage.background = worldBackgroundTexture ?? new THREE.Color(document.skyColor); return; }
        const texture = await textures.loadAsync(await assetUrl(uri));
        if (disposed || epoch !== sceneEpoch) { texture.dispose(); return; }
        texture.mapping = THREE.EquirectangularReflectionMapping; texture.colorSpace = THREE.SRGBColorSpace;
        backgroundTexture?.dispose(); backgroundTexture = texture; panoramaUri = uri; stage.background = worldBackgroundTexture ?? texture;
    }
    async function hydrate(obj: SceneObject, epoch: number, targetGraph: DirectorObjectGraph): Promise<void> {
        const item = targetGraph.objects.get(obj.id); if (!item) return;
        if (obj.kind === 'model' && obj.modelUri) {
            const loaded = await gltf.loadAsync(await assetUrl(obj.modelUri));
            if (disposed || sceneEpoch !== epoch) { disposeObject(loaded.scene); return; }
            loaded.scene.traverse(child => { child.userData.sceneObjectId = obj.id; if ((child as THREE.Mesh).isMesh) { child.castShadow = true; child.receiveShadow = true; } });
            item.add(loaded.scene);
        } else if (obj.kind === 'prop' && obj.assetId === 'image_board' && obj.imageUri) {
            const texture = await textures.loadAsync(await assetUrl(obj.imageUri));
            if (disposed || sceneEpoch !== epoch) { texture.dispose(); return; }
            texture.colorSpace = THREE.SRGBColorSpace;
            const board = item.getObjectByName('picture-board') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
            board.material.map = texture; board.material.color.set('#ffffff'); board.material.needsUpdate = true;
        }
    }
    function applyFrame(next: number): void {
        frame = Number.isFinite(next) ? Math.max(0, Math.min(document.duration, next)) : 0;
        graph.apply(sampleScene(document, frame)); placeLabels();
    }
    function draw(): void {
        for (const cam of graph.cameras.values()) { cam.aspect = renderer.domElement.width / Math.max(1, renderer.domElement.height); cam.updateProjectionMatrix(); }
        renderer.render(stage, camera());
    }
    function resize(): void {
        if (disposed || exporting) return;
        const width = Math.max(2, container.clientWidth); const height = Math.max(2, container.clientHeight);
        renderer.setSize(width, height, true); freeCamera.aspect = width / height; freeCamera.updateProjectionMatrix(); draw();
    }
    function fly(delta: number): void {
        if (!held.has('Alt') || cameraId || exporting) return;
        const forward = freeCamera.getWorldDirection(new THREE.Vector3());
        const right = forward.clone().cross(freeCamera.up).normalize();
        const shift = held.has('Shift') ? 4 : 1; const move = new THREE.Vector3();
        if (held.has('w')) move.add(forward); if (held.has('s')) move.sub(forward);
        if (held.has('d')) move.add(right); if (held.has('a')) move.sub(right);
        if (held.has('e')) move.y += 1; if (held.has('q')) move.y -= 1;
        if (move.lengthSq()) { move.normalize().multiplyScalar(flySpeed * delta * shift); freeCamera.position.add(move); orbit.target.add(move); }
    }
    function animate(now: number): void {
        if (disposed) return;
        const dt = Math.min(0.1, (now - lastTime) / 1000); lastTime = now;
        if (!exporting) { fly(dt); if (orbit.enabled) orbit.update(); draw(); }
        requestId = requestAnimationFrame(animate);
    }
    const onKeyDown = (event: KeyboardEvent): void => {
        if (textInput(event.target)) return;
        if (event.altKey) held.add('Alt'); if (event.shiftKey) held.add('Shift');
        held.add(event.key.length === 1 ? event.key.toLowerCase() : event.key);
        if (event.altKey && ['w', 'a', 's', 'd', 'q', 'e'].includes(event.key.toLowerCase())) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
        held.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
        if (!event.altKey) held.delete('Alt'); if (!event.shiftKey) held.delete('Shift');
    };
    const onBlur = (): void => { held.clear(); };
    let pointerStart: { x: number; y: number } | undefined;
    const onPointerDown = (event: PointerEvent): void => { renderer.domElement.focus({ preventScroll: true }); if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY }; };
    const onPointerUp = (event: PointerEvent): void => {
        if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4 || transform.dragging || transform.axis || cameraId || exporting) { pointerStart = undefined; return; }
        pointerStart = undefined;
        const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return;
        const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera());
        const hits = ray.intersectObjects([...graph.objects.values()], true);
        const hit = hits.find(item => visibleInHierarchy(item.object) && !!item.object.userData.sceneObjectId);
        const id = hit?.object.userData.sceneObjectId as string | undefined;
        selected = id ? event.ctrlKey || event.metaKey ? selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] : [id] : [];
        applySelection(); options.onSelect?.([...selected]);
    };
    transform.addEventListener('dragging-changed', () => refreshHelpers());
    // Controls cache their starting TRS before dispatching mouseDown.
    const pointerDown = transform.pointerDown.bind(transform);
    transform.pointerDown = pointer => {
        if (transform.object && transform.axis !== null && !transform.dragging && (pointer === null || pointer.button === 0)) beginDirectorObjectTransform(transform.object);
        pointerDown(pointer);
    };
    transform.addEventListener('mouseUp', () => {
        const item = transform.object; if (!item) return;
        const values = previewSample ? sampleScene(document, frame) : document.objects;
        const stored = values.find(obj => obj.id === item.userData.sceneObjectId);
        options.onTransform?.(item.userData.sceneObjectId, readDirectorObjectTransform(item, stored));
    });
    renderer.domElement.addEventListener('pointerdown', onPointerDown); renderer.domElement.addEventListener('pointerup', onPointerUp);
    container.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('blur', onBlur);
    const observer = new ResizeObserver(resize); observer.observe(container); resize(); requestId = requestAnimationFrame(animate);

    async function createSpark(): Promise<{ renderer: THREE.Object3D & { dispose(): void; sorting: boolean; autoUpdate: boolean; update(options: { scene: THREE.Scene; camera: THREE.Camera }): Promise<void> }; mesh?: THREE.Object3D & { dispose(): void } }> {
        const { SparkRenderer } = await import('@sparkjsdev/spark');
        if (disposed) throw new Error('DIRECTOR_DISPOSED');
        const splatRenderer = new SparkRenderer({ renderer }); stage.add(splatRenderer);
        return { renderer: splatRenderer };
    }
    async function assetsReady(): Promise<void> { await Promise.all([...pendingAssets, worldPending]); if (assetError) throw assetError; if (worldError) throw worldError; if (disposed) throw new Error('DIRECTOR_DISPOSED'); }
    async function prepareSplatFrame(): Promise<void> {
        if (!spark?.mesh) return;
        const engine = spark.renderer; const auto = engine.autoUpdate; engine.autoUpdate = false;
        try {
            while (engine.sorting) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); if (disposed) throw new Error('DIRECTOR_DISPOSED'); }
            await engine.update({ scene: stage, camera: camera() });
        } finally { engine.autoUpdate = auto; }
    }
    const exportHelpers = (): THREE.Object3D[] => [gizmo, graph.helpers, labels, grid, ...[...graph.cameras.values()].flatMap(cam => cam.children)];
    function ensureExport(): void { if (disposed) throw new Error('DIRECTOR_DISPOSED'); if (exporting) throw new Error('DIRECTOR_EXPORT_BUSY'); }

    const runtime: DirectorRuntime = {
        canvas: renderer.domElement,
        update(value, updateOptions): void {
            if (disposed || exporting) return;
            const next = normalizeScene(value); const nextGraph = createDirectorObjectGraph(next);
            document = next; sceneEpoch++;
            transform.detach(); graph.dispose(); graph = nextGraph; stage.add(graph.root, graph.helpers);
            if (cameraId && !graph.cameras.has(cameraId)) cameraId = undefined;
            selected = selected.filter(id => graph.objects.has(id)); assetError = undefined;
            const epoch = sceneEpoch;
            pendingAssets = document.objects.map(obj => hydrate(obj, epoch, graph)).concat(loadPanorama(document.panoramaUri, epoch)).map(promise => promise.catch(cause => {
                if (epoch === sceneEpoch && !disposed) { assetError = cause; error('DIRECTOR_ASSET_LOAD', cause); }
            }));
            if (!document.panoramaUri) stage.background = worldBackgroundTexture ?? new THREE.Color(document.skyColor);
            ground.position.y = document.groundHeight; groundMat.opacity = document.groundOpacity; ground.visible = document.groundOpacity > 0;
            grid.position.y = document.groundHeight + 0.005; grid.visible = document.showGrid;
            previewSample = updateOptions?.sample !== false;
            updateLabels(); if (previewSample) applyFrame(frame); else { graph.apply(document.objects); placeLabels(); } applySelection(); draw();
        },
        select(ids): void { selected = ids.filter(id => graph.objects.has(id)); applySelection(); },
        setCamera(id): void { cameraId = id && graph.cameras.has(id) ? id : undefined; applySelection(); draw(); },
        setTransformMode(mode): void { transform.setMode(mode); },
        setSnap(enabled, size): void { transform.setTranslationSnap(enabled ? Math.max(0.05, Number.isFinite(size) ? size : 0.5) : null); transform.setRotationSnap(enabled ? 15 * DEG : null); transform.setScaleSnap(enabled ? 0.1 : null); },
        setHelpers(visible): void { helpersVisible = visible; refreshHelpers(); },
        setNavigation(value): void { if (value.flySpeed !== undefined && Number.isFinite(value.flySpeed)) flySpeed = Math.min(100, Math.max(0.1, value.flySpeed)); if (value.rotateSensitivity !== undefined && Number.isFinite(value.rotateSensitivity)) orbit.rotateSpeed = Math.min(5, Math.max(0.1, value.rotateSensitivity)); },
        readFreeCamera(): DirectorCameraState { return { position: plain(freeCamera.position), lookAt: plain(orbit.target), rotation: { x: 0, y: 0, z: 0 }, fov: freeCamera.fov }; },
        readFreeCameraForObject(id): DirectorCameraState { return directorCameraInParent(runtime.readFreeCamera(), graph.objects.get(id)?.parent ?? undefined); },
        readCamera(id): DirectorCameraState {
            const rendered = id && graph.cameras.get(id) || camera();
            const rotation = new THREE.Euler().setFromQuaternion(rendered.getWorldQuaternion(new THREE.Quaternion()), 'XYZ');
            const obj = (previewSample ? sampleScene(document, frame) : document.objects).find(value => value.id === (id ?? cameraId));
            const target = obj?.lookAt ? vector(obj.lookAt) : orbit.target.clone();
            if (obj?.lookAt) rendered.parent?.localToWorld(target);
            return { position: plain(rendered.getWorldPosition(new THREE.Vector3())), lookAt: plain(target), rotation: { x: rotation.x / DEG, y: rotation.y / DEG, z: rotation.z / DEG }, fov: rendered.fov };
        },
        setFreeCamera(value): void { freeCamera.position.copy(vector(value.position)); orbit.target.copy(vector(value.lookAt)); freeCamera.fov = value.fov; freeCamera.updateProjectionMatrix(); orbit.update(); draw(); },
        focus(ids): void {
            const bounds = new THREE.Box3(); for (const id of ids) { const item = graph.objects.get(id); if (item) bounds.expandByObject(item); }
            if (bounds.isEmpty()) return;
            cameraId = undefined; const target = bounds.getCenter(new THREE.Vector3()); const radius = Math.max(0.75, bounds.getSize(new THREE.Vector3()).length() / 2);
            const direction = freeCamera.position.clone().sub(orbit.target).normalize(); freeCamera.position.copy(target).addScaledVector(direction, radius * 3);
            orbit.target.copy(target); orbit.update(); applySelection();
        },
        resize,
        renderFrame(next): void { if (!disposed && !exporting) { previewSample = true; applyFrame(next); draw(); } },
        async capture(value): Promise<Blob> {
            ensureExport(); exporting = true;
            const oldFrame = frame; const oldCamera = cameraId; const oldPreview = previewSample;
            try {
                await assetsReady(); if (value.cameraId !== undefined) cameraId = graph.cameras.has(value.cameraId) ? value.cameraId : undefined;
                if (value.sample !== false) { previewSample = true; applyFrame(value.frame ?? frame); }
                else { previewSample = false; graph.apply(document.objects); placeLabels(); }
                return await withDirectorExportFrame(renderer, stage, camera(), exportHelpers(), value, async () => {
                    await prepareSplatFrame(); renderer.render(stage, camera());
                    return new Promise<Blob>((resolve, reject) => { renderer.domElement.toBlob(blob => blob ? resolve(blob) : reject(new Error('DIRECTOR_CAPTURE_EMPTY')), 'image/png'); });
                });
            } finally { exporting = false; cameraId = oldCamera; previewSample = oldPreview; if (!disposed) { if (oldPreview) applyFrame(oldFrame); else { graph.apply(document.objects); placeLabels(); } refreshHelpers(); resize(); } }
        },
        async record(value): Promise<Blob> {
            ensureExport(); exporting = true;
            const oldFrame = frame; const oldCamera = cameraId; const oldPreview = previewSample;
            try {
                if (!Number.isFinite(value.fps) || value.fps < 1 || value.fps > 60 || !Number.isInteger(value.frames) || value.frames < 1 || value.frames > 18000) throw new Error('DIRECTOR_RECORDING_RANGE');
                if (typeof MediaRecorder === 'undefined' || typeof renderer.domElement.captureStream !== 'function') throw new Error('DIRECTOR_RECORDING_UNSUPPORTED');
                const mime = directorRecordingMime(type => MediaRecorder.isTypeSupported(type)); if (!mime) throw new Error('DIRECTOR_RECORDING_UNSUPPORTED');
                await assetsReady(); if (value.cameraId !== undefined) cameraId = graph.cameras.has(value.cameraId) ? value.cameraId : undefined;
                previewSample = true; applyFrame(value.frame ?? 0);
                return await withDirectorExportFrame(renderer, stage, camera(), exportHelpers(), value, async () => {
                    await prepareSplatFrame(); renderer.render(stage, camera());
                    const stream = renderer.domElement.captureStream(value.fps); const chunks: Blob[] = [];
                    let recorder: MediaRecorder | undefined; let ticker = 0; let bytes = 0; let aborted = false; let sizeExceeded = false;
                    const cancel = (): void => { aborted = true; if (recorder?.state !== 'inactive') recorder?.stop(); };
                    recordingAbort = cancel;
                    try {
                        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: directorRecordingBitrate(value.fps, value.frames) });
                        return await new Promise<Blob>((resolve, reject) => {
                            recorder!.ondataavailable = event => { if (event.data.size) { bytes += event.data.size; chunks.push(event.data); if (bytes > 256 * 1024 * 1024) { sizeExceeded = true; if (recorder?.state !== 'inactive') recorder?.stop(); } } };
                            recorder!.onerror = event => reject(event);
                            recorder!.onstop = () => { cancelAnimationFrame(ticker); if (sizeExceeded) reject(new Error('DIRECTOR_RECORDING_SIZE')); else if (aborted) reject(new DOMException('DIRECTOR_RECORDING_CANCELLED', 'AbortError')); else if (!chunks.length) reject(new Error('DIRECTOR_RECORDING_EMPTY')); else resolve(new Blob(chunks, { type: mime })); };
                            value.signal?.addEventListener('abort', cancel, { once: true });
                            if (value.signal?.aborted || disposed) { reject(new DOMException('DIRECTOR_RECORDING_CANCELLED', 'AbortError')); return; }
                            let started = 0;
                            const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
                            const tick = (now: number): void => {
                                if (aborted || disposed) { cancel(); return; }
                                const elapsed = Math.max(0, Math.floor((now - started) * value.fps / 1000));
                                if (elapsed >= value.frames) { recorder?.stop(); return; }
                                applyFrame((value.frame ?? 0) + elapsed); renderer.render(stage, camera()); track.requestFrame?.(); value.onProgress?.(elapsed);
                                ticker = requestAnimationFrame(tick);
                            };
                            recorder!.onstart = () => {
                                try {
                                    started = performance.now(); renderer.render(stage, camera()); track.requestFrame?.(); value.onProgress?.(0);
                                    ticker = requestAnimationFrame(tick);
                                } catch (cause) { reject(cause); }
                            };
                            recorder!.start(1000);
                        });
                    } finally {
                        cancelAnimationFrame(ticker); value.signal?.removeEventListener('abort', cancel); recordingAbort = undefined;
                        if (recorder && recorder.state !== 'inactive') recorder.stop();
                        stream.getTracks().forEach(track => track.stop());
                    }
                });
            } finally { exporting = false; cameraId = oldCamera; previewSample = oldPreview; if (!disposed) { if (oldPreview) applyFrame(oldFrame); else { graph.apply(document.objects); placeLabels(); } refreshHelpers(); resize(); } }
        },
        setWorld(value): Promise<void> {
            if (disposed) throw new Error('DIRECTOR_DISPOSED');
            const epoch = ++worldEpoch; disposeObject(worldRoot); stage.add(worldRoot);
            spark?.mesh?.dispose(); if (spark) spark.mesh = undefined;
            worldBackgroundTexture?.dispose(); worldBackgroundTexture = undefined;
            stage.background = backgroundTexture ?? new THREE.Color(document.skyColor);
            worldError = undefined;
            const load = async (): Promise<void> => {
                if (!value) { draw(); return; }
                const url = await assetUrl(value.uri);
                if (disposed || epoch !== worldEpoch) return;
                if (value.kind === 'panorama') {
                    const texture = await textures.loadAsync(url);
                    if (disposed || epoch !== worldEpoch) { texture.dispose(); return; }
                    texture.mapping = THREE.EquirectangularReflectionMapping; texture.colorSpace = THREE.SRGBColorSpace;
                    worldBackgroundTexture = texture; stage.background = texture;
                } else if (value.kind === 'model') {
                    const loaded = await gltf.loadAsync(url);
                    if (disposed || epoch !== worldEpoch) { disposeObject(loaded.scene); return; }
                    worldRoot.add(loaded.scene);
                } else {
                    spark ??= await (sparkPending ??= createSpark().catch(cause => { sparkPending = undefined; throw cause; }));
                    if (disposed || epoch !== worldEpoch) return;
                    const { SplatMesh } = await import('@sparkjsdev/spark');
                    const splats = new SplatMesh({ url, fileName: value.uri, lod: false, raycastable: true });
                    try { await splats.initialized; } catch (cause) { splats.dispose(); throw cause; }
                    if (disposed || epoch !== worldEpoch) { splats.dispose(); return; }
                    spark.mesh = splats; worldRoot.add(splats);
                }
                draw();
            };
            // Store a settled promise to avoid unhandled rejections when the dialog closes.
            const pending = load().catch(cause => { if (epoch === worldEpoch && !disposed) { worldError = cause; error(value?.kind === 'splat' ? 'DIRECTOR_SPLAT_LOAD' : 'DIRECTOR_WORLD_LOAD', cause); } });
            worldPending = pending;
            return pending.then(() => { if (epoch === worldEpoch && worldError) throw worldError; });
        },
        dispose(): void {
            if (disposed) return; disposed = true; sceneEpoch++; worldEpoch++; recordingAbort?.(); cancelAnimationFrame(requestId); observer.disconnect(); held.clear();
            container.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur);
            renderer.domElement.removeEventListener('pointerdown', onPointerDown); renderer.domElement.removeEventListener('pointerup', onPointerUp);
            transform.dispose(); orbit.dispose(); graph.dispose(); disposeObject(labels); disposeObject(worldRoot); spark?.mesh?.dispose(); spark?.renderer.dispose();
            backgroundTexture?.dispose(); worldBackgroundTexture?.dispose(); ground.geometry.dispose(); groundMat.dispose(); grid.geometry.dispose();
            for (const item of Array.isArray(grid.material) ? grid.material : [grid.material]) item.dispose();
            renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
        }
    };
    return runtime;
}
