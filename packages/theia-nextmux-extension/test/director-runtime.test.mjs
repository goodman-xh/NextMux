import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSceneDocument, createSceneObject, createSceneProp, groupSceneObjects, mirrorScenePosture, SCENE_POSES, SCENE_PROPS, sampleScene } from '@nextmux/comic-core';
import { applyDirectorPosture, beginDirectorObjectTransform, createDirectorMannequin, createDirectorObjectGraph, createDirectorProp, directorCameraInParent, directorExportSize, directorRecordingBitrate, directorRecordingMime, readDirectorObjectTransform, withDirectorExportFrame } from '../lib/browser/nextmux-comic-director-runtime.js';

const scene = objects => ({ ...createSceneDocument(), objects });
const vector = (x, y = 0, z = 0) => ({ x, y, z });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('scene objects form a selectable Three graph with exact nested transforms', () => {
    const graph = createDirectorObjectGraph(scene([
        createSceneObject('group', 'parent', { position: vector(3), rotation: vector(0, 90) }),
        createSceneProp('child', 'chair', { position: vector(1), parentId: 'parent' })
    ]));
    try {
        const child = graph.objects.get('child');
        assert.equal(child.parent, graph.objects.get('parent'));
        const world = child.getWorldPosition(new THREE.Vector3());
        close(world.x, 3); close(world.z, -1);
        child.traverse(item => assert.equal(item.userData.sceneObjectId, 'child'));
        assert.ok(child.children.some(item => item.isMesh));
    } finally { graph.dispose(); }
});

test('all 35 prop catalogue entries create renderable primitive geometry', () => {
    assert.equal(SCENE_PROPS.length, 35);
    for (const prop of SCENE_PROPS) {
        const graph = createDirectorObjectGraph(scene([createSceneProp(prop.id, prop.id)]));
        try {
            let meshes = 0;
            graph.objects.get(prop.id).traverse(item => { if (item.isMesh) { meshes++; assert.ok(item.geometry.attributes.position.count > 0); } });
            assert.ok(meshes > 0, prop.id);
        } finally { graph.dispose(); }
    }
    assert.throws(() => createDirectorProp('unknown-unavailable-prop'), /DIRECTOR_PROP_UNSUPPORTED/);
});

test('all rig joints are FK parents and wrists/ankles alter child geometry', () => {
    const rig = createDirectorMannequin();
    const joints = ['body', 'torso', 'head', ...['l', 'r'].flatMap(side => ['arm', 'elbow', 'wrist', 'leg', 'knee', 'ankle'].map(part => `${side}_${part}`))];
    assert.deepEqual(Object.keys(rig.joints).sort(), joints.sort());
    assert.equal(rig.joints.l_wrist.parent, rig.joints.l_elbow);
    assert.equal(rig.joints.l_elbow.parent, rig.joints.l_arm);
    assert.equal(rig.joints.r_ankle.parent, rig.joints.r_knee);
    assert.equal(rig.joints.r_knee.parent, rig.joints.r_leg);
    applyDirectorPosture(rig, { l_wrist: { bend: 35, turn: 20 }, r_ankle: { bend: -15, tilt: 25 }, body: { bend: 5 } });
    close(rig.joints.l_wrist.rotation.x, 35 * Math.PI / 180);
    close(rig.joints.l_wrist.rotation.y, 20 * Math.PI / 180);
    close(rig.joints.r_ankle.rotation.x, -15 * Math.PI / 180);
    close(rig.joints.r_ankle.rotation.z, 25 * Math.PI / 180);
    const graph = createDirectorObjectGraph(scene([createSceneObject('character', 'cleanup')])); graph.dispose();
});

test('pose snapshots and mirroring change the actual skeleton, and crowds create distinct rigs', () => {
    const pose = SCENE_POSES.find(item => item.id === 'wave');
    const graph = createDirectorObjectGraph(scene([
        createSceneObject('character', 'normal', { pose: 'wave', posture: pose.posture }),
        createSceneObject('character', 'mirror', { pose: 'wave', posture: pose.posture, mirror: true }),
        createSceneObject('character', 'crowd', { bodyType: 'group5' })
    ]));
    try {
        const normal = graph.rigs.get('normal')[0]; const mirrored = graph.rigs.get('mirror')[0];
        close(mirrored.joints.l_arm.rotation.x, normal.joints.r_arm.rotation.x);
        const expected = mirrorScenePosture(pose.posture);
        close(mirrored.joints.l_arm.rotation.z, expected.l_arm.straddle * Math.PI / 180);
        assert.equal(graph.rigs.get('crowd').length, 5);
        assert.equal(new Set(graph.rigs.get('crowd').map(rig => rig.root.position.x)).size, 5);
    } finally { graph.dispose(); }
});

test('camera zero targets and light zero values map to real projection and illumination', () => {
    const graph = createDirectorObjectGraph(scene([
        createSceneObject('camera', 'camera', { position: vector(0, 0, 5), lookAt: vector(0), fov: 35 }),
        createSceneObject('light', 'point', { lightType: 'point', intensity: 0, distance: 0, castShadow: false }),
        createSceneObject('light', 'spot', { lightType: 'spot', position: vector(0, 4), lookAt: vector(0), angle: 20, intensity: 7 }),
        createSceneObject('light', 'sun', { lightType: 'directional', intensity: 3 })
    ]));
    try {
        const camera = graph.cameras.get('camera'); assert.equal(camera.fov, 35);
        const direction = camera.getWorldDirection(new THREE.Vector3()); close(direction.z, -1);
        const point = graph.objects.get('point').getObjectByName('director-light');
        assert.ok(point.isPointLight); assert.equal(point.intensity, 0); assert.equal(point.distance, 0); assert.equal(point.castShadow, false);
        const spot = graph.objects.get('spot').getObjectByName('director-light');
        assert.ok(spot.isSpotLight); close(spot.angle, 20 * Math.PI / 180); assert.equal(spot.intensity, 7);
        close(spot.target.getWorldPosition(new THREE.Vector3()).y, 0);
        assert.ok(graph.objects.get('sun').getObjectByName('director-light').isDirectionalLight);
    } finally { graph.dispose(); }
});

test('timeline sampling updates existing object identity and retains affine reparenting matrices', () => {
    const object = createSceneProp('box', 'cube');
    const document = { ...scene([object]), duration: 10, keys: [
        { id: 'start', objectId: 'box', frame: 0, position: vector(0), rotation: vector(0), scale: vector(1, 1, 1) },
        { id: 'end', objectId: 'box', frame: 10, position: vector(10), rotation: vector(0, 90), scale: vector(2, 2, 2) }
    ] };
    const graph = createDirectorObjectGraph(document);
    try {
        const before = graph.objects.get('box'); graph.apply(sampleScene(document, 5));
        assert.equal(graph.objects.get('box'), before); close(before.position.x, 5); close(before.rotation.y, Math.PI / 4);
        const affine = [1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1];
        graph.apply([{ ...object, matrix: affine }]);
        assert.equal(before.matrixAutoUpdate, false); assert.deepEqual(before.matrix.elements, affine);
        const world = before.getWorldPosition(new THREE.Vector3()); close(world.x, 3); close(world.y, 4); close(world.z, 5);
        graph.apply([object]); assert.equal(before.matrixAutoUpdate, true); close(before.getWorldPosition(new THREE.Vector3()).x, 0);
    } finally { graph.dispose(); }
});

test('grouping a camera preserves its actual look-at orientation under a rotated parent', () => {
    const document = scene([
        createSceneObject('group', 'parent', { position: vector(2, 1, -3), rotation: vector(0, 31), scale: vector(1.3, 0.8, 1.1) }),
        createSceneObject('camera', 'cam', { parentId: 'parent', position: vector(3, 2, 5), lookAt: vector(-1, 1, 0), rotation: vector(0, 0, 10) }),
        createSceneProp('prop', 'cube', { position: vector(2) })
    ]);
    const before = createDirectorObjectGraph(document);
    const grouped = groupSceneObjects(document, ['cam', 'prop'], 'group');
    const after = createDirectorObjectGraph(grouped);
    try {
        const a = before.cameras.get('cam').matrixWorld.elements;
        const b = after.cameras.get('cam').matrixWorld.elements;
        a.forEach((value, index) => close(b[index], value));
    } finally { before.dispose(); after.dispose(); }
});

test('saving a free view into a grouped camera converts both position and target to parent space', () => {
    const parent = new THREE.Group(); parent.position.set(4, 3, -2); parent.rotation.y = 0.6; parent.scale.set(1.5, 0.8, 2);
    const camera = { position: vector(7, 5, 4), lookAt: vector(1, 2, 0), rotation: vector(1, 2, 3), fov: 35 };
    const saved = directorCameraInParent(camera, parent);
    const position = parent.localToWorld(new THREE.Vector3(saved.position.x, saved.position.y, saved.position.z));
    const target = parent.localToWorld(new THREE.Vector3(saved.lookAt.x, saved.lookAt.y, saved.lookAt.z));
    close(position.x, 7); close(position.y, 5); close(position.z, 4);
    close(target.x, 1); close(target.y, 2); close(target.z, 0); assert.equal(saved.fov, 35); assert.deepEqual(saved.rotation, vector(0));
    const graph = createDirectorObjectGraph(scene([
        createSceneObject('group', 'parent', { position: vector(4, 3, -2), rotation: vector(0, 0.6 * 180 / Math.PI), scale: vector(1.5, 0.8, 2) }),
        createSceneObject('camera', 'saved-camera', { ...saved, parentId: 'parent' })
    ]));
    try {
        const expected = new THREE.Matrix4().lookAt(new THREE.Vector3(7, 5, 4), new THREE.Vector3(1, 2, 0), new THREE.Vector3(0, 1, 0)).setPosition(7, 5, 4);
        graph.cameras.get('saved-camera').matrixWorld.elements.forEach((value, index) => close(value, expected.elements[index]));
    } finally { graph.dispose(); }
    parent.scale.x = 0; assert.throws(() => directorCameraInParent(camera, parent), /DIRECTOR_CAMERA_PARENT/);
});

test('committing a camera gizmo uses its sampled look-at target and retains the displayed direction', () => {
    const cameraObject = createSceneObject('camera', 'camera', { position: vector(0, 3, 8), lookAt: vector(0, 1), rotation: vector(7, 12, 4), parentId: 'parent' });
    const document = { ...scene([
        createSceneObject('group', 'parent', { position: vector(2, 1, -3), rotation: vector(0, 31), scale: vector(1.3, 0.8, 1.1) }), cameraObject
    ]), duration: 10, keys: [
        { id: 'first', objectId: 'camera', frame: 0, position: cameraObject.position, rotation: cameraObject.rotation, scale: cameraObject.scale, lookAt: cameraObject.lookAt },
        { id: 'last', objectId: 'camera', frame: 10, position: cameraObject.position, rotation: cameraObject.rotation, scale: cameraObject.scale, lookAt: vector(4, 5, 1) }
    ] };
    const graph = createDirectorObjectGraph(document);
    try {
        const sampled = sampleScene(document, 7); graph.apply(sampled);
        const displayed = graph.cameras.get('camera'); displayed.position.x += 1.2;
        displayed.rotateY(0.2); displayed.updateWorldMatrix(true, false);
        const before = [...displayed.matrixWorld.elements];
        const stored = sampled.find(item => item.id === 'camera');
        assert.notDeepEqual(stored.lookAt, cameraObject.lookAt);
        const committed = readDirectorObjectTransform(displayed, stored);
        graph.apply(sampled.map(item => item.id === 'camera' ? { ...item, ...committed, matrix: undefined } : item));
        displayed.matrixWorld.elements.forEach((value, index) => close(value, before[index]));
    } finally { graph.dispose(); }
});

test('an affine object starts gizmo editing from its matrix and committed TRS replaces the old override', () => {
    const affine = [1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1];
    const stored = createSceneProp('box', 'cube', { matrix: affine });
    const graph = createDirectorObjectGraph(scene([stored]));
    try {
        const item = graph.objects.get('box'); assert.equal(item.position.x, 0); assert.equal(item.matrixAutoUpdate, false);
        beginDirectorObjectTransform(item);
        assert.equal(item.matrixAutoUpdate, true); close(item.position.x, 3); close(item.position.y, 4); close(item.position.z, 5);
        const dragStart = item.position.clone(); item.position.x = dragStart.x + 2;
        item.rotateZ(0.15); item.updateWorldMatrix(true, false);
        const before = [...item.matrixWorld.elements]; const committed = readDirectorObjectTransform(item, stored);
        graph.apply([{ ...stored, ...committed, matrix: undefined }]);
        close(item.position.x, 5); item.matrixWorld.elements.forEach((value, index) => close(value, before[index]));
    } finally { graph.dispose(); }
});

function rendererMock() {
    let width = 500; let height = 300; let ratio = 2;
    const calls = [];
    return {
        calls,
        getSize: target => target.set(width, height), getPixelRatio: () => ratio,
        setPixelRatio: value => { ratio = value; },
        setSize: (w, h) => { width = w; height = h; },
        render: (scene, camera) => calls.push({ width, height, ratio, aspect: camera.aspect, visible: scene.children.map(item => item.visible) })
    };
}
test('export renders the requested aspect and size with helpers hidden, then restores editor state', async () => {
    const renderer = rendererMock(); const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(50, 5 / 3);
    const helper = new THREE.Group(); const alreadyHidden = new THREE.Group(); alreadyHidden.visible = false; scene.add(helper, alreadyHidden);
    const result = await withDirectorExportFrame(renderer, scene, camera, [helper, alreadyHidden], { width: 1080, height: 1920 }, async () => {
        assert.equal(helper.visible, false); close(camera.aspect, 9 / 16); assert.equal(renderer.getPixelRatio(), 1);
        return new Blob(['real-image-bytes'], { type: 'image/png' });
    });
    assert.equal(result.type, 'image/png'); assert.equal(helper.visible, true); assert.equal(alreadyHidden.visible, false);
    close(camera.aspect, 5 / 3); assert.equal(renderer.getPixelRatio(), 2);
    assert.deepEqual(renderer.calls[0], { width: 1080, height: 1920, ratio: 1, aspect: 9 / 16, visible: [false, false] });
    assert.equal(renderer.calls.at(-1).width, 500); assert.equal(renderer.calls.at(-1).height, 300);
});

test('export failures restore the editor and never return a synthetic success', async () => {
    const renderer = rendererMock(); const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(50, 5 / 3); const helper = new THREE.Group(); scene.add(helper);
    await assert.rejects(withDirectorExportFrame(renderer, scene, camera, [helper], { width: 1920, height: 1080 }, async () => { throw new Error('tainted canvas'); }), /tainted canvas/);
    assert.equal(helper.visible, true); close(camera.aspect, 5 / 3); assert.equal(renderer.getPixelRatio(), 2); assert.equal(renderer.getSize(new THREE.Vector2()).x, 500);
});

test('output limits are enforced before rendering and WebM codecs use supported fallback only', () => {
    assert.deepEqual(directorExportSize(1919, 1079), { width: 1920, height: 1080 });
    for (const size of [[NaN, 100], [8193, 100], [8192, 8192], [0, 100]]) assert.throws(() => directorExportSize(...size), /DIRECTOR_EXPORT_SIZE/);
    assert.equal(directorRecordingMime(type => type.includes('vp8')), 'video/webm;codecs=vp8');
    assert.equal(directorRecordingMime(type => type === 'video/webm'), 'video/webm');
    assert.equal(directorRecordingMime(() => false), undefined);
    assert.equal(directorRecordingBitrate(24, 120), 8_000_000);
    for (const fps of [12, 24, 25, 30, 60]) assert.ok(directorRecordingBitrate(fps, 18000) * 18000 / fps / 8 <= 192 * 1024 * 1024);
    assert.throws(() => directorRecordingBitrate(0, 120), /DIRECTOR_RECORDING_RANGE/);
});
