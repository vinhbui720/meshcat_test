import * as THREE from 'three';
import { XRButton } from 'three/examples/jsm/webxr/XRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { HandControls } from './hand-controls.js';
import { TeleportControls } from './teleport.js';
import { XRUI } from './xr-ui.js';
import { XRVisualizer } from './xr-visualizer.js';
import { XR3DPanel } from './xr-3d-panel.js';

// ─────────────────────────────────────────────────────────────────────────────
// COORDINATE SYSTEM NOTE
// ─────────────────────────────────────────────────────────────────────────────
// Drake Meshcat:  Z-up  (robotics convention: X-forward, Y-left, Z-up)
// WebXR / Three.js: Y-up  (X-right, Y-up, Z-toward-viewer)
//
// Strategy:
//  • The Drake scene objects live in the Three.js scene with their raw Z-up
//    coordinates. The desktop camera has makeRotationX(+90°) applied at the
//    "/Cameras/default/rotated" node so they look correct on a flat screen.
//  • For WebXR we apply the SAME +90°X rotation to the XR reference space
//    offset so the HMD camera sees Drake objects correctly (Z becomes up).
//  • The xrRig (containing hands/controllers) is placed OUTSIDE this
//    rotation — directly in Z-up scene space — so hand joint positions
//    returned by frame.getJointPose() (in the offset reference space, now
//    Z-up aligned) map directly onto Drake scene coordinates.
// ─────────────────────────────────────────────────────────────────────────────

export class XRManager {
    constructor(viewer) {
        this.viewer   = viewer;
        this.renderer = viewer.renderer;
        this.scene    = viewer.scene;
        this.camera   = viewer.camera;

        // xrRig lives directly in scene space (Z-up Drake world).
        // Controllers and hands are children of this rig.
        // We do NOT pre-rotate xrRig; instead the reference space offset
        // handles the Y-up → Z-up conversion so joint poses arrive already
        // in Z-up coordinates.
        this.xrRig = new THREE.Group();
        this.xrRig.name = 'xr-rig';
        this.scene.add(this.xrRig);

        this.controllers         = [];
        this.hands               = [];
        this.controllerModelFactory = new XRControllerModelFactory();
        this.handModelFactory       = new XRHandModelFactory();

        this.desktopMock = false;

        this.handControls    = new HandControls(this);
        this.teleportControls = new TeleportControls(this);
        this.ui              = new XRUI(this.viewer);
        this.visualizer      = new XRVisualizer(this.viewer);

        // 3D in-world panel — floats 0.5 m to the right of origin, at 1 m
        // height, 0.6 m in front (in Drake Z-up: x=0.5, z=1.0, y=-0.6)
        this.panel3d = new XR3DPanel(
            this.scene,
            this.ui.settings,
            (key, value) => { console.log('[XR3DPanel] changed', key, '=', value); }
        );
        this.panel3d.setPosition(0.5, 1.0, -0.6);
        this.panel3d.setVisible(true);

        this.setupInputs();
        this.setupSessionHooks();
    }

    setupInputs() {
        for (let i = 0; i < 2; i++) {
            // ── Controllers ──────────────────────────────────────────────────
            const controller = this.renderer.xr.getController(i);
            this.xrRig.add(controller);
            this.controllers.push(controller);

            const grip = this.renderer.xr.getControllerGrip(i);
            grip.add(this.controllerModelFactory.createControllerModel(grip));
            this.xrRig.add(grip);

            // ── Hands ────────────────────────────────────────────────────────
            // Use 'spheres' (NOT 'mesh') — always available, drives all 25
            // joints reliably on Quest 3 without GLTF mesh dependencies.
            // Our custom XRVisualizer draws teal spheres + bone lines using
            // frame.getJointPose() which is more precise.
            const hand = this.renderer.xr.getHand(i);
            hand.add(this.handModelFactory.createHandModel(hand, 'spheres'));
            this.xrRig.add(hand);
            this.hands.push(hand);
        }
    }

    enableDesktopMock() {
        this.desktopMock = true;
        this.ui.settings.mockMode     = true;
        this.ui.settings.showLandmarks = true;

        this.xrRig.visible = true;

        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);
    }

    setupSessionHooks() {
        this.renderer.xr.addEventListener('sessionstart', () => {
            console.log('[XRManager] WebXR session started');
            this.onSessionStart();
        });
        this.renderer.xr.addEventListener('sessionend', () => {
            console.log('[XRManager] WebXR session ended');
            this.onSessionEnd();
        });
    }

    onSessionStart() {
        // ── AR passthrough ───────────────────────────────────────────────────
        this._oldBackground         = this.scene.background;
        this._oldClearAlpha         = this.renderer.getClearAlpha();
        this.scene.background       = null;
        this.renderer.setClearAlpha(0);

        // ── Disable desktop orbit controls ────────────────────────────────────
        if (this.viewer.controls) {
            this.viewer.controls.enabled = false;
        }

        // ── Reference space: align Y-up WebXR → Z-up Drake ───────────────────
        //
        // The XR reference space returned by 'local' has Y-up (real world).
        // Drake's scene has Z-up. We need the camera (HMD) to see Drake
        // objects as if their Z-axis is "up" in the real world.
        //
        // XRRigidTransform(position, orientation) defines the transform FROM
        // the new (offset) space TO the existing (local) space.
        //
        // We want: newSpace.Z = localSpace.Y (up)
        //          newSpace.X = localSpace.X  (right, unchanged)
        //          newSpace.Y = localSpace.-Z (into screen → "forward" in Drake)
        //
        // That is a +90° rotation around X applied to the orientation:
        //   q = axis-angle(X, +90°) = {x: sin(45°), y:0, z:0, w: cos(45°)}
        //
        // Combined with the current camera position (Drake Z-up ← already in
        // scene coordinates), we negate it to get the tracking origin position.
        //
        this.renderer.xr.getSession()
            .requestReferenceSpace('local')
            .then((refSpace) => {
                // Camera position in Drake Z-up scene
                const camPos = this.camera.position;

                // +90° around X: maps WebXR Y-up → Drake Z-up
                const q_zup = new THREE.Quaternion()
                    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

                // Offset origin: negate camera position, then rotate into
                // the new (Z-up) reference frame
                const origin = camPos.clone().negate().applyQuaternion(q_zup);

                const xrTransform = new XRRigidTransform(
                    { x: origin.x, y: origin.y, z: origin.z, w: 1 },
                    { x: q_zup.x,  y: q_zup.y,  z: q_zup.z,  w: q_zup.w }
                );

                const offsetSpace = refSpace.getOffsetReferenceSpace(xrTransform);
                this.renderer.xr.setReferenceSpace(offsetSpace);

                console.log('[XRManager] Reference space aligned: Y-up WebXR → Z-up Drake',
                    '\n  Camera pos:', camPos,
                    '\n  Origin offset:', origin,
                    '\n  q_zup:', q_zup
                );
            });

        // Reset xrRig: no pre-rotation — joint poses arrive in Z-up because
        // the reference space offset already converts them.
        this.xrRig.position.set(0, 0, 0);
        this.xrRig.quaternion.identity();

        // Show hand joints
        this.ui.settings.showLandmarks = true;
    }

    onSessionEnd() {
        if (this._oldBackground !== undefined) {
            this.scene.background = this._oldBackground;
        }
        if (this._oldClearAlpha !== undefined) {
            this.renderer.setClearAlpha(this._oldClearAlpha);
        }
        if (this.viewer.controls) {
            this.viewer.controls.enabled = true;
        }
        // Hide hand visualization
        if (this.visualizer) this.visualizer.toggleAll(false);
    }

    update(frame) {
        // Only run when session is live OR desktop mock is active
        if (!this.renderer.xr.isPresenting && !this.desktopMock) return;

        if (this.handControls)    this.handControls.update(frame);
        if (this.teleportControls) this.teleportControls.update(frame);

        // Billboard the 3D panel toward the camera
        if (this.panel3d && this.panel3d.mesh.visible) {
            this.panel3d.lookAt(this.viewer.camera.position);
        }

        // Touch: test index fingertip against panel buttons
        const lastData = this.handControls && this.handControls._lastHandData;
        if (lastData && this.panel3d) {
            const indexTip = lastData.visLandmarks && lastData.visLandmarks[9];
            if (indexTip && indexTip.position) {
                const touched = this.panel3d.hitTest(indexTip.position);
                if (touched) console.log('[XR] Touched button:', touched);
            }
        }

        if (this.desktopMock) this.viewer.set_dirty();
    }
}
