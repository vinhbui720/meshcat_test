import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Full 25-joint XRHand bone topology
// Index mapping matches XR_JOINT_NAMES in hand-controls.js
// ─────────────────────────────────────────────────────────────────────────────

// [parentIndex, childIndex] pairs
const BONES = [
    // Thumb chain
    [0, 1], [1, 2], [2, 3], [3, 4],
    // Index chain
    [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
    // Middle chain
    [0, 10], [10, 11], [11, 12], [12, 13], [13, 14],
    // Ring chain
    [0, 15], [15, 16], [16, 17], [17, 18], [18, 19],
    // Pinky chain (full 5-joint)
    [0, 20], [20, 21], [21, 22], [22, 23], [23, 24],
    // Palm cross-connections (metacarpal knuckle arch)
    [5, 10], [10, 15], [15, 20],
];

// Color per finger (material index)
// 0=wrist/palm, 1=thumb, 2=index, 3=middle, 4=ring, 5=pinky
const JOINT_COLORS = [
    0x88aaff, // 0  wrist
    0xff9957, // 1  thumb-meta
    0xff9957, // 2  thumb-prox
    0xff9957, // 3  thumb-dist
    0xffcc44, // 4  thumb-TIP  ← yellow
    0x00ffcc, // 5  index-meta
    0x00ffcc, // 6  index-prox
    0x00ffcc, // 7  index-inter
    0x00ffcc, // 8  index-dist
    0xff5500, // 9  index-TIP  ← orange (primary interaction)
    0x44ddff, // 10 middle-meta
    0x44ddff, // 11 middle-prox
    0x44ddff, // 12 middle-inter
    0x44ddff, // 13 middle-dist
    0x44ddff, // 14 middle-TIP
    0xaa88ff, // 15 ring-meta
    0xaa88ff, // 16 ring-prox
    0xaa88ff, // 17 ring-inter
    0xaa88ff, // 18 ring-dist
    0xaa88ff, // 19 ring-TIP
    0x88ffaa, // 20 pinky-meta
    0x88ffaa, // 21 pinky-prox
    0x88ffaa, // 22 pinky-inter
    0x88ffaa, // 23 pinky-dist
    0x88ffaa, // 24 pinky-TIP
];

// Tip and knuckle indices for larger spheres
const TIPS_SET    = new Set([4, 9, 14, 19, 24]);
const KNUCKLE_SET = new Set([1, 5, 10, 15, 20]);

export class XRVisualizer {
    constructor(viewer) {
        this.viewer    = viewer;
        this.scene     = viewer.scene;
        this.POOL_SIZE = 25; // full XRHand joint count

        this.jointPool = [];  // sphere mesh per joint
        this.bonePool  = [];  // line segment per bone

        this._positions = new Array(this.POOL_SIZE).fill(null);
        this._visible   = false;

        this._createJoints();
        this._createBones();
    }

    _createJoints() {
        for (let i = 0; i < this.POOL_SIZE; i++) {
            const isTip     = TIPS_SET.has(i);
            const isKnuckle = KNUCKLE_SET.has(i);
            const r = isTip ? 0.013 : isKnuckle ? 0.010 : 0.007;

            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(r, 12, 8),
                new THREE.MeshBasicMaterial({
                    color:       JOINT_COLORS[i] ?? 0x00ffcc,
                    transparent: true,
                    opacity:     isTip ? 1.0 : 0.85,
                    depthTest:   false,  // always render on top (visible through Drake mesh)
                })
            );
            mesh.visible = false;
            mesh.renderOrder = 999;     // draw last so they are never occluded
            this.scene.add(mesh);
            this.jointPool.push(mesh);
        }
    }

    _createBones() {
        const mat = new THREE.LineBasicMaterial({
            color:       0x5599dd,
            linewidth:   2,
            transparent: true,
            opacity:     0.55,
            depthTest:   false,
        });

        for (let i = 0; i < BONES.length; i++) {
            const pts = [new THREE.Vector3(), new THREE.Vector3()];
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const line = new THREE.Line(geo, mat);
            line.visible     = false;
            line.renderOrder = 998;
            this.scene.add(line);
            this.bonePool.push(line);
        }
    }

    // landmarks: array[25] of { position: THREE.Vector3, rotation, radius }
    update(landmarks) {
        if (!landmarks || landmarks.length === 0) {
            this.toggleAll(false);
            return;
        }

        const count = Math.min(landmarks.length, this.POOL_SIZE);

        // ── Update joint spheres ───────────────────────────────────────────
        for (let i = 0; i < count; i++) {
            const lm   = landmarks[i];
            const mesh = this.jointPool[i];
            if (lm && lm.position) {
                mesh.position.copy(lm.position);
                // Optionally scale sphere to match joint radius from XR spec
                if (lm.radius && lm.radius > 0) {
                    const s = lm.radius / 0.007; // normalise to base size
                    mesh.scale.setScalar(Math.max(0.5, Math.min(s, 3.0)));
                }
                mesh.visible = true;
                this._positions[i] = lm.position;
            } else {
                mesh.visible     = false;
                this._positions[i] = null;
            }
        }

        // ── Update bone lines ──────────────────────────────────────────────
        for (let b = 0; b < BONES.length; b++) {
            const [pi, ci] = BONES[b];
            const pPos = this._positions[pi];
            const cPos = this._positions[ci];
            const line = this.bonePool[b];

            if (pPos && cPos) {
                const attr = line.geometry.attributes.position;
                attr.setXYZ(0, pPos.x, pPos.y, pPos.z);
                attr.setXYZ(1, cPos.x, cPos.y, cPos.z);
                attr.needsUpdate = true;
                line.geometry.computeBoundingSphere();
                line.visible = true;
            } else {
                line.visible = false;
            }
        }
    }

    toggleAll(state) {
        this.jointPool.forEach(m => { m.visible = state; });
        this.bonePool.forEach(l => { l.visible  = state; });
    }

    dispose() {
        this.jointPool.forEach(m => {
            this.scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        });
        this.bonePool.forEach(l => {
            this.scene.remove(l);
            l.geometry.dispose();
        });
        this.jointPool = [];
        this.bonePool  = [];
    }
}
