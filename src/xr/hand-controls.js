import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// WebXR Hand Tracking — Full 25-joint XRHand spec
// https://www.w3.org/TR/webxr-hand-input-1/#skeleton-joints-section
// ─────────────────────────────────────────────────────────────────────────────
export const XR_JOINT_NAMES = [
    // 0
    'wrist',
    // Thumb (4 joints)
    'thumb-metacarpal',          // 1
    'thumb-phalanx-proximal',    // 2
    'thumb-phalanx-distal',      // 3
    'thumb-tip',                 // 4
    // Index finger (5 joints)
    'index-finger-metacarpal',           // 5
    'index-finger-phalanx-proximal',     // 6
    'index-finger-phalanx-intermediate', // 7
    'index-finger-phalanx-distal',       // 8
    'index-finger-tip',                  // 9
    // Middle finger (5 joints)
    'middle-finger-metacarpal',           // 10
    'middle-finger-phalanx-proximal',     // 11
    'middle-finger-phalanx-intermediate', // 12
    'middle-finger-phalanx-distal',       // 13
    'middle-finger-tip',                  // 14
    // Ring finger (5 joints)
    'ring-finger-metacarpal',           // 15
    'ring-finger-phalanx-proximal',     // 16
    'ring-finger-phalanx-intermediate', // 17
    'ring-finger-phalanx-distal',       // 18
    'ring-finger-tip',                  // 19
    // Pinky finger (5 joints)
    'pinky-finger-metacarpal',           // 20
    'pinky-finger-phalanx-proximal',     // 21
    'pinky-finger-phalanx-intermediate', // 22
    'pinky-finger-phalanx-distal',       // 23
    'pinky-finger-tip',                  // 24
];

export class HandControls {
    constructor(xrManager) {
        this.xrManager = xrManager;
        this.viewer    = xrManager.viewer;
        this.hands     = xrManager.hands;

        // Binary streaming buffer — 54 doubles = 432 bytes
        // Format: wrist(7) + 5 tips×7 + 12 joint angles
        this.binaryBuffer = new Float64Array(54);
        this.byteBuffer   = new Uint8Array(this.binaryBuffer.buffer);

        // Hand-stream socket (port 7002, separate from Drake port 7000)
        this.streamSocket   = null;
        this.streamUrl      = null;
        this.lastStreamTime = 0;
        this.streamInterval = 1000 / 120; // 120 Hz

        // Finger tips for streaming (indices in XR_JOINT_NAMES)
        this.fingerTipIndices = [4, 9, 14, 19, 24]; // thumb→pinky tips

        // Debug: log hand detection once
        this._loggedHands = new Set();
    }

    // ─────────────────────────────────────────────────────────────────────────
    update(frame) {
        const settings = this.xrManager.ui.settings;
        const now = performance.now();

        let handData = null;
        if (settings.mockMode) {
            handData = this.generateMockHandData(now);
        } else {
            handData = this.getXRHandData(frame);
        }

        this._lastHandData = handData;

        if (handData) {
            if (this.xrManager.visualizer && settings.showLandmarks) {
                this.xrManager.visualizer.update(handData.visLandmarks);
            }
            const freq = settings.streamFrequency || 60;
            if (settings.enableStreaming && (now - this.lastStreamTime >= 1000 / freq)) {
                this.streamHandData(handData);
                this.lastStreamTime = now;
            }
        } else {
            if (this.xrManager.visualizer) {
                this.xrManager.visualizer.toggleAll(false);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Read all 25 joints from the XR frame
    getXRHandData(frame) {
        if (!frame) return null;

        const settings    = this.xrManager.ui.settings;
        const side        = (settings.handSide || 'right').toLowerCase();
        const inputSource = this._findHand(side);
        if (!inputSource || !inputSource.hand) return null;

        const refSpace = this.xrManager.renderer.xr.getReferenceSpace();
        if (!refSpace) return null;

        const hand = inputSource.hand;

        // ── Wrist ────────────────────────────────────────────────────────────
        const wristJoint = hand.get('wrist');
        if (!wristJoint) return null;
        const wristPose = frame.getJointPose(wristJoint, refSpace);
        if (!wristPose) return null;

        // Log first detection
        if (!this._loggedHands.has(side)) {
            this._loggedHands.add(side);
            console.log(`[HandControls] ✅ ${side} hand detected — reading ${XR_JOINT_NAMES.length} joints`);
        }

        // ── All 25 joints ────────────────────────────────────────────────────
        const visLandmarks = XR_JOINT_NAMES.map((name) => {
            const joint = hand.get(name);
            if (!joint) return null;
            const pose = frame.getJointPose(joint, refSpace);
            if (!pose) return null;
            return {
                position: new THREE.Vector3(
                    pose.transform.position.x,
                    pose.transform.position.y,
                    pose.transform.position.z
                ),
                rotation: new THREE.Quaternion(
                    pose.transform.orientation.x,
                    pose.transform.orientation.y,
                    pose.transform.orientation.z,
                    pose.transform.orientation.w
                ),
                radius: pose.jointRadius || 0.006,
            };
        });

        // ── Fingertip poses for streaming ────────────────────────────────────
        const tips = this.fingerTipIndices.map(idx => visLandmarks[idx]);

        return {
            wrist: {
                position: new THREE.Vector3(
                    wristPose.transform.position.x,
                    wristPose.transform.position.y,
                    wristPose.transform.position.z
                ),
                rotation: new THREE.Quaternion(
                    wristPose.transform.orientation.x,
                    wristPose.transform.orientation.y,
                    wristPose.transform.orientation.z,
                    wristPose.transform.orientation.w
                ),
            },
            visLandmarks,
            tips,
            angles: new Array(12).fill(0), // TODO: compute flexion angles
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Mock hand data (25 joints, Z-up Drake space)
    generateMockHandData(time) {
        const angle    = time * 0.0008;
        const wristPos = new THREE.Vector3(
            Math.sin(angle) * 0.15,
            0.9 + Math.cos(angle * 0.7) * 0.05,  // 0.9 m up in Drake Z
            -0.4 + Math.sin(angle * 0.3) * 0.05
        );
        const wristRot = new THREE.Quaternion()
            .setFromEuler(new THREE.Euler(Math.PI * 0.1, angle * 0.5, 0));
        const mat = new THREE.Matrix4().makeRotationFromQuaternion(wristRot);

        // 25 joint local offsets [x, y, z] in wrist-local space
        // Thumb: 4, Index: 5, Middle: 5, Ring: 5, Pinky: 5 = 20 + 1 wrist = 25
        const localJoints = [
            // 0: wrist
            [0,     0,     0    ],
            // 1-4: thumb
            [0.035, 0.01,  0.03 ],
            [0.055, 0.01,  0.07 ],
            [0.060, 0.01,  0.10 ],
            [0.060, 0.01,  0.13 ],
            // 5-9: index
            [0.025, 0,     0.09 ],
            [0.025, 0,     0.13 ],
            [0.025, 0,     0.17 ],
            [0.025, 0,     0.20 ],
            [0.025, 0,     0.22 ],
            // 10-14: middle
            [0.005, 0,     0.09 ],
            [0.005, 0,     0.14 ],
            [0.005, 0,     0.19 ],
            [0.005, 0,     0.22 ],
            [0.005, 0,     0.24 ],
            // 15-19: ring
            [-0.02, 0,     0.09 ],
            [-0.02, 0,     0.13 ],
            [-0.02, 0,     0.17 ],
            [-0.02, 0,     0.20 ],
            [-0.02, 0,     0.22 ],
            // 20-24: pinky
            [-0.04, 0,     0.07 ],
            [-0.04, 0,     0.11 ],
            [-0.04, 0,     0.15 ],
            [-0.04, 0,     0.18 ],
            [-0.04, 0,     0.20 ],
        ];

        const visLandmarks = localJoints.map(([lx, ly, lz]) => {
            const local = new THREE.Vector3(lx, ly, lz).applyMatrix4(mat);
            return {
                position: local.add(wristPos),
                rotation: wristRot.clone(),
                radius:   0.007,
            };
        });

        const tips = this.fingerTipIndices.map(i => visLandmarks[i]);

        return {
            wrist:       { position: wristPos.clone(), rotation: wristRot.clone() },
            visLandmarks,
            tips,
            angles:      new Array(12).fill(0),
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    enableStreaming(url) {
        this.streamUrl = url;
        this._connectStreamSocket();
    }

    _connectStreamSocket() {
        if (!this.streamUrl) return;
        if (this.streamSocket && this.streamSocket.readyState === WebSocket.OPEN) return;
        this.streamSocket = new WebSocket(this.streamUrl);
        this.streamSocket.binaryType = 'arraybuffer';
        this.streamSocket.onopen  = () => console.log('[HandStream] Connected to', this.streamUrl);
        this.streamSocket.onclose = () => {
            console.warn('[HandStream] Disconnected, retrying in 2s…');
            setTimeout(() => this._connectStreamSocket(), 2000);
        };
    }

    streamHandData(handData) {
        let idx = 0;
        const pack = (pose) => {
            if (pose && pose.position && pose.rotation) {
                this.binaryBuffer[idx++] = pose.position.x;
                this.binaryBuffer[idx++] = pose.position.y;
                this.binaryBuffer[idx++] = pose.position.z;
                this.binaryBuffer[idx++] = pose.rotation.x;
                this.binaryBuffer[idx++] = pose.rotation.y;
                this.binaryBuffer[idx++] = pose.rotation.z;
                this.binaryBuffer[idx++] = pose.rotation.w;
            } else {
                // Identity pose placeholder
                this.binaryBuffer[idx++] = 0;
                this.binaryBuffer[idx++] = 0;
                this.binaryBuffer[idx++] = 0;
                this.binaryBuffer[idx++] = 0;
                this.binaryBuffer[idx++] = 0;
                this.binaryBuffer[idx++] = 0;
                this.binaryBuffer[idx++] = 1;
            }
        };

        pack(handData.wrist);
        for (let i = 0; i < 5; i++) pack(handData.tips[i]);
        for (let i = 0; i < 12; i++) this.binaryBuffer[idx++] = handData.angles[i] || 0;

        if (this.streamSocket && this.streamSocket.readyState === WebSocket.OPEN) {
            this.streamSocket.send(this.byteBuffer);
        }
        // NOTE: We never send to viewer.connection (Drake port 7000)
        // because Drake only accepts msgpack-encoded messages.
    }

    _findHand(side) {
        const session = this.xrManager.renderer.xr.getSession();
        if (!session) return null;
        for (const source of session.inputSources) {
            if (source.hand && source.handedness === side) return source;
        }
        return null;
    }
}
