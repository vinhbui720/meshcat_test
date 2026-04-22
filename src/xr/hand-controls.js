import * as THREE from 'three';

export class HandControls {
    constructor(xrManager) {
        this.xrManager = xrManager;
        this.viewer = xrManager.viewer;
        this.hands = xrManager.hands;
        
        // 54 doubles = 432 bytes (matching C# HandLandmarkStreamer format)
        this.binaryBuffer = new Float64Array(54);
        this.byteBuffer = new Uint8Array(this.binaryBuffer.buffer);

        // Separate WebSocket for high-frequency binary hand data.
        // This MUST be separate from Drake's viewer socket (port 7000) because
        // Drake's Meshcat server only accepts msgpack-encoded messages and will
        // crash if it receives raw binary frames.
        this.streamSocket = null;
        this.streamUrl = null; // Set via enableStreaming(url)

        this.lastStreamTime = 0;
        this.streamInterval = 1000 / 120; // 120Hz default

        // 21 joints for visualization — must match XRVisualizer pool size (21)
        this.visJointNames = [
            "wrist",
            "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
            "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
            "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
            "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
            "pinky-finger-tip"
        ]; // 21 total

        this.fingerTips = [
            "thumb-tip", "index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip"
        ];
    }

    update(frame) {
        const settings = this.xrManager.ui.settings;
        const now = performance.now();
        
        let handData = null;
        if (settings.mockMode) {
            handData = this.generateMockHandData(now);
        } else {
            handData = this.getXRHandData(frame);
        }

        // Cache for XRManager (panel touch detection)
        this._lastHandData = handData;

        if (handData) {
            if (this.xrManager.visualizer && settings.showLandmarks) {
                this.xrManager.visualizer.update(handData.visLandmarks);
            }

            if (settings.enableStreaming && (now - this.lastStreamTime >= (1000 / settings.streamFrequency))) {
                this.streamHandData(handData);
                this.lastStreamTime = now;
            }
        } else {
            if (this.xrManager.visualizer) this.xrManager.visualizer.toggleAll(false);
        }
    }

    getXRHandData(frame) {
        const settings = this.xrManager.ui.settings;
        const inputSource = this.findHandInputSource(settings.handSide.toLowerCase());
        if (!inputSource || !inputSource.hand) return null;

        const referenceSpace = this.xrManager.renderer.xr.getReferenceSpace();
        
        // 1. Wrist
        const wristJoint = inputSource.hand.get('wrist');
        const wristPose = frame.getJointSpace(wristJoint, referenceSpace);
        if (!wristPose) return null;

        // 2. All 21 landmark joints for Visualizer
        const visLandmarks = this.visJointNames.map(name => {
            const joint = inputSource.hand.get(name);
            if (!joint) return null;
            const pose = frame.getJointSpace(joint, referenceSpace);
            if (!pose) return null;
            return {
                position: new THREE.Vector3().copy(pose.transform.position),
                rotation: new THREE.Quaternion().copy(pose.transform.orientation)
            };
        });

        // 3. 5 Fingertip poses for binary streaming
        const tipPoses = this.fingerTips.map(name => {
            const joint = inputSource.hand.get(name);
            if (!joint) return null;
            const pose = frame.getJointSpace(joint, referenceSpace);
            return pose ? {
                position: new THREE.Vector3().copy(pose.transform.position),
                rotation: new THREE.Quaternion().copy(pose.transform.orientation)
            } : null;
        });

        // 4. Joint angles (placeholder - complex math)
        const angles = new Array(12).fill(0);
        
        return {
            wrist: {
                position: new THREE.Vector3().copy(wristPose.transform.position),
                rotation: new THREE.Quaternion().copy(wristPose.transform.orientation)
            },
            visLandmarks,
            tips: tipPoses,
            angles
        };
    }

    generateMockHandData(time) {
        const angle = time * 0.0008; // slow rotation

        // Wrist world position (floats gently)
        const wristPos = new THREE.Vector3(
            Math.sin(angle) * 0.15,
            0.9 + Math.cos(angle * 0.7) * 0.05,
            -0.4 + Math.sin(angle * 0.3) * 0.05
        );
        // Wrist orientation - tilted like a natural hand held in front
        const wristRot = new THREE.Quaternion()
            .setFromEuler(new THREE.Euler(Math.PI * 0.1, angle * 0.5, 0));

        // --- Hand anatomy in WRIST-LOCAL space (right hand, Z = palm outward) ---
        // Each entry: [x-right, y-up, z-forward from palm]
        const localJoints = [
            // 0: wrist
            [0,     0,     0   ],
            // Thumb (fans to the side)
            [0.035, 0.01,  0.03],  // 1 thumb-meta
            [0.055, 0.01,  0.07],  // 2 thumb-prox
            [0.060, 0.01,  0.10],  // 3 thumb-dist
            [0.060, 0.01,  0.13],  // 4 thumb-tip
            // Index finger
            [0.025, 0,     0.09],  // 5 index-meta
            [0.025, 0,     0.13],  // 6 index-prox
            [0.025, 0,     0.17],  // 7 index-inter
            [0.025, 0,     0.20],  // 8 index-dist
            [0.025, 0,     0.22],  // 9 index-tip
            // Middle finger (longest)
            [0.005, 0,     0.09],  // 10 middle-meta
            [0.005, 0,     0.14],  // 11 middle-prox
            [0.005, 0,     0.19],  // 12 middle-inter
            [0.005, 0,     0.22],  // 13 middle-dist
            [0.005, 0,     0.24],  // 14 middle-tip
            // Ring finger
            [-0.02, 0,     0.09],  // 15 ring-meta
            [-0.02, 0,     0.13],  // 16 ring-prox
            [-0.02, 0,     0.17],  // 17 ring-inter
            [-0.02, 0,     0.20],  // 18 ring-dist
            [-0.02, 0,     0.22],  // 19 ring-tip
            // Pinky (just tip in our 21-joint list)
            [-0.04, 0,     0.18],  // 20 pinky-tip
        ];

        // Build a rotation matrix from the wrist quaternion
        const mat = new THREE.Matrix4().makeRotationFromQuaternion(wristRot);

        const visLandmarks = localJoints.map(([lx, ly, lz]) => {
            const local = new THREE.Vector3(lx, ly, lz).applyMatrix4(mat);
            return {
                position: local.add(wristPos),
                rotation: wristRot.clone()
            };
        });

        // Finger tips for streaming (indices 4, 9, 14, 19, 20)
        const tipIndices = [4, 9, 14, 19, 20];
        const tips = tipIndices.map(i => ({
            position: visLandmarks[i].position.clone(),
            rotation: wristRot.clone()
        }));

        return {
            wrist: { position: wristPos.clone(), rotation: wristRot.clone() },
            visLandmarks,
            tips,
            angles: new Array(12).fill(0)
        };
    }

    enableStreaming(url) {
        this.streamUrl = url;
        this._connectStreamSocket();
    }

    _connectStreamSocket() {
        if (!this.streamUrl) return;
        if (this.streamSocket && this.streamSocket.readyState === WebSocket.OPEN) return;
        this.streamSocket = new WebSocket(this.streamUrl);
        this.streamSocket.binaryType = 'arraybuffer';
        this.streamSocket.onopen = () => console.log('[HandStream] Connected to', this.streamUrl);
        this.streamSocket.onclose = () => {
            console.warn('[HandStream] Disconnected, retrying in 2s...');
            setTimeout(() => this._connectStreamSocket(), 2000);
        };
    }

    streamHandData(handData) {
        let idx = 0;
        
        const packPose = (pose) => {
            this.binaryBuffer[idx++] = pose.position.x;
            this.binaryBuffer[idx++] = pose.position.y;
            this.binaryBuffer[idx++] = pose.position.z;
            this.binaryBuffer[idx++] = pose.rotation.x;
            this.binaryBuffer[idx++] = pose.rotation.y;
            this.binaryBuffer[idx++] = pose.rotation.z;
            this.binaryBuffer[idx++] = pose.rotation.w;
        };

        packPose(handData.wrist);
        
        for (let i = 0; i < 5; i++) {
            const tip = handData.tips[i];
            if (tip) {
                packPose(tip);
            } else {
                // Identity pose placeholder
                this.binaryBuffer[idx++] = 0; this.binaryBuffer[idx++] = 0; this.binaryBuffer[idx++] = 0;
                this.binaryBuffer[idx++] = 0; this.binaryBuffer[idx++] = 0; this.binaryBuffer[idx++] = 0;
                this.binaryBuffer[idx++] = 1;
            }
        }
        
        for (let i = 0; i < 12; i++) {
            this.binaryBuffer[idx++] = handData.angles[i] || 0;
        }

        if (this.streamSocket && this.streamSocket.readyState === WebSocket.OPEN) {
            this.streamSocket.send(this.byteBuffer);
        }
        // NOTE: We do NOT send to this.viewer.connection (Drake's viewer socket)
        // because Drake only accepts msgpack-encoded messages.
    }

    findHandInputSource(side) {
        const session = this.xrManager.renderer.xr.getSession();
        if (!session) return null;
        for (const source of session.inputSources) {
            if (source.hand && source.handedness === side) {
                return source;
            }
        }
        return null;
    }
}
