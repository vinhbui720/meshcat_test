import * as THREE from 'three';

/**
 * XRVisualizer - Renders 21 hand joints as glowing spheres connected by bone lines.
 * Mimics the C# HandLandmarkVisualizer pool pattern.
 *
 * Joint index mapping (matches HandControls.visJointNames):
 *  0: wrist
 *  1-4: thumb (meta, prox, dist, tip)
 *  5-9: index (meta, prox, inter, dist, tip)
 * 10-14: middle
 * 15-19: ring
 * 20: pinky-tip
 */

// Bone connections: pairs of [parentIndex, childIndex]
const BONE_CONNECTIONS = [
    // Thumb chain
    [0, 1], [1, 2], [2, 3], [3, 4],
    // Index chain
    [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
    // Middle chain
    [0, 10], [10, 11], [11, 12], [12, 13], [13, 14],
    // Ring chain
    [0, 15], [15, 16], [16, 17], [17, 18], [18, 19],
    // Pinky (only tip in our 21 list, connect from wrist)
    [0, 20],
    // Palm cross-connections (knuckle line)
    [5, 10], [10, 15],
];

export class XRVisualizer {
    constructor(viewer) {
        this.viewer = viewer;
        this.scene = viewer.scene;
        this.POOL_SIZE = 21;

        this.jointPool  = [];  // sphere meshes at each joint
        this.bonePool   = [];  // line segments connecting joints

        this._positions = new Array(this.POOL_SIZE).fill(null); // cached positions
        this._visible = false;

        this._createJoints();
        this._createBones();
    }

    _createJoints() {
        // Different sizes per joint type
        const sizes = {
            tip:  0.012,
            knuckle: 0.009,
            default: 0.007,
        };
        const tipIndices   = new Set([4, 9, 14, 19, 20]);
        const knuckleIndices = new Set([1, 5, 10, 15]);

        for (let i = 0; i < this.POOL_SIZE; i++) {
            let r = sizes.default;
            if (tipIndices.has(i))    r = sizes.tip;
            if (knuckleIndices.has(i)) r = sizes.knuckle;

            // Glowing teal sphere
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(r, 10, 10),
                new THREE.MeshBasicMaterial({
                    color: i === 9 ? 0xffaa00 : 0x00ffcc,  // index fingertip = orange
                    transparent: true,
                    opacity: 0.9,
                })
            );
            mesh.visible = false;
            this.scene.add(mesh);
            this.jointPool.push(mesh);
        }
    }

    _createBones() {
        const mat = new THREE.LineBasicMaterial({
            color: 0x00aaff,
            linewidth: 2,
            transparent: true,
            opacity: 0.6,
        });

        for (let i = 0; i < BONE_CONNECTIONS.length; i++) {
            const points = [new THREE.Vector3(), new THREE.Vector3()];
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geo, mat);
            line.visible = false;
            this.scene.add(line);
            this.bonePool.push(line);
        }
    }

    update(landmarks) {
        if (!landmarks || landmarks.length === 0) {
            this.toggleAll(false);
            return;
        }

        // Update joint positions
        const count = Math.min(landmarks.length, this.POOL_SIZE);
        for (let i = 0; i < count; i++) {
            const data = landmarks[i];
            if (data && data.position) {
                this.jointPool[i].visible = true;
                this.jointPool[i].position.copy(data.position);
                this._positions[i] = data.position;
            } else {
                this.jointPool[i].visible = false;
                this._positions[i] = null;
            }
        }

        // Update bone lines
        for (let b = 0; b < BONE_CONNECTIONS.length; b++) {
            const [pi, ci] = BONE_CONNECTIONS[b];
            const pPos = this._positions[pi];
            const cPos = this._positions[ci];
            const bone = this.bonePool[b];

            if (pPos && cPos) {
                const positions = bone.geometry.attributes.position;
                positions.setXYZ(0, pPos.x, pPos.y, pPos.z);
                positions.setXYZ(1, cPos.x, cPos.y, cPos.z);
                positions.needsUpdate = true;
                bone.geometry.computeBoundingSphere();
                bone.visible = true;
            } else {
                bone.visible = false;
            }
        }
    }

    toggleAll(state) {
        this.jointPool.forEach(m => m.visible = state);
        this.bonePool.forEach(l => l.visible = state);
    }

    dispose() {
        this.jointPool.forEach(m => {
            this.scene.remove(m);
            m.geometry.dispose();
        });
        this.bonePool.forEach(l => {
            this.scene.remove(l);
            l.geometry.dispose();
        });
    }
}
