import * as THREE from 'three';
import { XRButton } from 'three/examples/jsm/webxr/XRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { HandControls } from './hand-controls.js';
import { TeleportControls } from './teleport.js';
import { XRUI } from './xr-ui.js';
import { XRVisualizer } from './xr-visualizer.js';
import { XR3DPanel } from './xr-3d-panel.js';

export class XRManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.renderer = viewer.renderer;
        this.scene = viewer.scene;
        this.camera = viewer.camera;
        
        this.xrRig = new THREE.Group();
        this.xrRig.name = 'xr-rig';
        this.scene.add(this.xrRig);

        this.controllers = [];
        this.hands = [];
        this.controllerModelFactory = new XRControllerModelFactory();
        this.handModelFactory = new XRHandModelFactory();
        
        this.desktopMock = false; // Flag to force rendering rig on desktop/phone

        this.handControls = new HandControls(this);
        this.teleportControls = new TeleportControls(this);
        this.ui = new XRUI(this.viewer); // kept as fallback HTML controls
        this.visualizer = new XRVisualizer(this.viewer);

        // 3D in-world panel (replaces flat HTML GUI for XR mode)
        this.panel3d = new XR3DPanel(
            this.scene,
            this.ui.settings,
            (key, value) => { console.log('[XR3DPanel] changed', key, '=', value); }
        );
        // Initial floating position in front of user
        this.panel3d.setPosition(0.5, 1.0, -0.6);
        this.panel3d.setVisible(true);

        this.setupInputs();
        this.setupSessionHooks();
    }

    setupInputs() {
        for (let i = 0; i < 2; i++) {
            // Controllers
            const controller = this.renderer.xr.getController(i);
            this.xrRig.add(controller);
            this.controllers.push(controller);

            const grip = this.renderer.xr.getControllerGrip(i);
            grip.add(this.controllerModelFactory.createControllerModel(grip));
            this.xrRig.add(grip);

            // Hands
            const hand = this.renderer.xr.getHand(i);
            hand.add(this.handModelFactory.createHandModel(hand, 'mesh'));
            this.xrRig.add(hand);
            this.hands.push(hand);
        }
    }

    enableDesktopMock() {
        this.desktopMock = true;
        this.ui.settings.mockMode = true;
        this.ui.settings.showLandmarks = true;
        
        // Ensure the rig is visible in the main scene
        this.xrRig.visible = true;
        
        // Force lighting for the mock models
        const ambient = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambient);
    }

    setupSessionHooks() {
        this.renderer.xr.addEventListener('sessionstart', () => {
            console.log('WebXR session started');
            this.onSessionStart();
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            console.log('WebXR session ended');
            this.onSessionEnd();
        });
    }

    onSessionStart() {
        // Handle transparency for AR passthrough
        const session = this.renderer.xr.getSession();
        if (session && session.isImmersive && this.viewer.xr_manager.ui.settings.handSide) { // check if AR
            // We can check session.activeRenderState.layers or similar, 
            // but session type is usually determined at request time.
            // For now, assume if we are in immersive session, we want transparency if possible.
            this._oldBackground = this.scene.background;
            this.scene.background = null;
            this.renderer.setClearAlpha(0);
        }

        // Sync rig position with current camera position
        this.xrRig.position.copy(this.viewer.camera.position);
        this.xrRig.quaternion.copy(this.viewer.camera.quaternion);

        // MeshCat uses Z-up, Three.js XR usually expects Y-up or handled by reference space.
        // We might need to rotate the rig if the reference space isn't aligned.
        
        if (this.viewer.controls) {
            this.viewer.controls.enabled = false;
        }
    }

    onSessionEnd() {
        if (this._oldBackground !== undefined) {
            this.scene.background = this._oldBackground;
            this.renderer.setClearAlpha(1);
        }

        if (this.viewer.controls) {
            this.viewer.controls.enabled = true;
        }
    }

    update(frame) {
        // Only skip if NOT presenting AND NOT in desktop mock mode
        if (!this.renderer.xr.isPresenting && !this.desktopMock) return;

        // Handle per-frame XR logic
        if (this.handControls) this.handControls.update(frame);
        if (this.teleportControls) this.teleportControls.update(frame);

        // Billboard the 3D panel to face the camera
        if (this.panel3d && this.panel3d.mesh.visible) {
            this.panel3d.lookAt(this.viewer.camera.position);
        }

        // Touch interaction: test index fingertip against panel buttons
        const lastData = this.handControls && this.handControls._lastHandData;
        if (lastData && this.panel3d) {
            // Index fingertip is visLandmarks[9]
            const indexTip = lastData.visLandmarks && lastData.visLandmarks[9];
            if (indexTip && indexTip.position) {
                const touched = this.panel3d.hitTest(indexTip.position);
                if (touched) console.log('[XR] Touched button:', touched);
            }
        }

        // In mock mode, keep the scene dirty so the animation loop keeps rendering
        if (this.desktopMock) this.viewer.set_dirty();
    }
}
