import * as THREE from 'three';

/**
 * XR3DPanel — A 3D GUI panel rendered as a canvas texture on a Three.js plane.
 * 
 * - Lives in 3D world space (can be positioned anywhere in the scene)
 * - Touch-interactive: call hitTest(fingerTipPos) each frame to detect button presses
 * - Future: attach to off-hand wrist for in-XR control
 * 
 * Usage:
 *   const panel = new XR3DPanel(scene, settings);
 *   panel.setPosition(1, 1.2, -0.5);
 *   // In update loop:
 *   panel.hitTest(indexFingerTipPosition); // Returns button name or null
 *   panel.lookAt(camera.position);          // Billboard to camera
 */
export class XR3DPanel {
    constructor(scene, settings, onChange) {
        this.scene    = scene;
        this.settings = settings;   // shared settings object from HandControls
        this.onChange = onChange || (() => {});

        // Canvas dimensions
        this.W = 512;
        this.H = 400;

        // Physical size in world units
        this.worldW = 0.35;
        this.worldH = (this.H / this.W) * this.worldW;

        // Buttons layout
        this.buttons = this._defineButtons();
        this._hoveredButton = null;

        this._buildMesh();
        this.redraw();
    }

    // ── Layout ──────────────────────────────────────────────────────────────────

    _defineButtons() {
        const pad = 16, bh = 56, gap = 12;
        const w = this.W - pad * 2;

        return [
            {
                key: 'enableStreaming',
                label: () => `Streaming: ${this.settings.enableStreaming ? 'ON ✓' : 'OFF ✗'}`,
                type: 'toggle',
                x: pad, y: 20, w, h: bh,
                color: () => this.settings.enableStreaming ? '#1a7a5e' : '#4a2a2a',
            },
            {
                key: 'mockMode',
                label: () => `Mock Mode: ${this.settings.mockMode ? 'ON' : 'OFF'}`,
                type: 'toggle',
                x: pad, y: 20 + (bh + gap), w, h: bh,
                color: () => this.settings.mockMode ? '#1a4a7a' : '#3a3a3a',
            },
            {
                key: 'showLandmarks',
                label: () => `Landmarks: ${this.settings.showLandmarks ? 'Show' : 'Hide'}`,
                type: 'toggle',
                x: pad, y: 20 + (bh + gap) * 2, w, h: bh,
                color: () => this.settings.showLandmarks ? '#1a5a3a' : '#3a3a3a',
            },
            {
                key: 'freqDown',
                label: () => `◀ ${this.settings.streamFrequency} Hz`,
                type: 'action',
                x: pad, y: 20 + (bh + gap) * 3, w: w / 2 - gap / 2, h: bh,
                color: () => '#2a2a4a',
                action: () => {
                    this.settings.streamFrequency = Math.max(1, this.settings.streamFrequency - 10);
                }
            },
            {
                key: 'freqUp',
                label: () => `${this.settings.streamFrequency} Hz ▶`,
                type: 'action',
                x: pad + w / 2 + gap / 2, y: 20 + (bh + gap) * 3, w: w / 2 - gap / 2, h: bh,
                color: () => '#2a2a4a',
                action: () => {
                    this.settings.streamFrequency = Math.min(120, this.settings.streamFrequency + 10);
                }
            },
            {
                key: 'handSide',
                label: () => `Hand: ${this.settings.handSide}`,
                type: 'action',
                x: pad, y: 20 + (bh + gap) * 4, w, h: bh,
                color: () => '#3a2a4a',
                action: () => {
                    this.settings.handSide = this.settings.handSide === 'Right' ? 'Left' : 'Right';
                }
            },
        ];
    }

    // ── Rendering ────────────────────────────────────────────────────────────────

    _buildMesh() {
        this.canvas  = document.createElement('canvas');
        this.canvas.width  = this.W;
        this.canvas.height = this.H;
        this.ctx = this.canvas.getContext('2d');

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;

        const geo = new THREE.PlaneGeometry(this.worldW, this.worldH);
        const mat = new THREE.MeshBasicMaterial({
            map: this.texture,
            side: THREE.DoubleSide,
            transparent: true,
        });
        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.name = 'xr-3d-panel';
        this.scene.add(this.mesh);

        // Border glow
        const borderGeo = new THREE.PlaneGeometry(this.worldW + 0.005, this.worldH + 0.005);
        const borderMat = new THREE.MeshBasicMaterial({
            color: 0x00aaff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.15,
        });
        this.border = new THREE.Mesh(borderGeo, borderMat);
        this.border.position.z = -0.001;
        this.mesh.add(this.border);
    }

    redraw() {
        const { ctx, W, H } = this;

        // Background
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(10, 16, 30, 0.92)';
        this._roundRect(ctx, 0, 0, W, H, 18);
        ctx.fill();

        // Title
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('XR HAND CONTROL', W / 2, 16);

        // Draw each button
        for (const btn of this.buttons) {
            const hovered = this._hoveredButton === btn.key;
            const bgColor = btn.color ? btn.color() : '#2a2a2a';

            // Button background
            ctx.fillStyle = hovered ? this._lighten(bgColor) : bgColor;
            this._roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 10);
            ctx.fill();

            // Button border glow on hover
            if (hovered) {
                ctx.strokeStyle = '#00ffcc';
                ctx.lineWidth = 2;
                this._roundRect(ctx, btn.x, btn.y, btn.w, btn.h, 10);
                ctx.stroke();
            }

            // Button label
            ctx.fillStyle = '#f0f0f0';
            ctx.font = 'bold 18px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(
                btn.label(),
                btn.x + btn.w / 2,
                btn.y + btn.h / 2 + 6
            );
        }

        this.texture.needsUpdate = true;
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    _lighten(hexColor) {
        // Simple brighten by shifting toward white
        try {
            const r = parseInt(hexColor.slice(1, 3), 16);
            const g = parseInt(hexColor.slice(3, 5), 16);
            const b = parseInt(hexColor.slice(5, 7), 16);
            const f = 60;
            return `rgb(${Math.min(255, r+f)},${Math.min(255, g+f)},${Math.min(255, b+f)})`;
        } catch { return hexColor; }
    }

    // ── Position & Visibility ────────────────────────────────────────────────────

    setPosition(x, y, z) {
        this.mesh.position.set(x, y, z);
    }

    lookAt(targetPos) {
        this.mesh.lookAt(targetPos);
    }

    setVisible(visible) {
        this.mesh.visible = visible;
    }

    // ── Touch / Hit Detection ────────────────────────────────────────────────────

    /**
     * Call this each frame with the index fingertip position (world coords).
     * Returns the button key if touched, null otherwise.
     * Also updates hover state for visual feedback.
     */
    hitTest(fingerPos) {
        if (!this.mesh.visible) return null;

        // Convert world finger position to panel local coords
        const localPos = this.mesh.worldToLocal(fingerPos.clone());

        // Panel is in XY plane (local), Z indicates depth
        // Only trigger if finger is within ~2cm of the panel surface
        if (Math.abs(localPos.z) > 0.025) {
            if (this._hoveredButton) {
                this._hoveredButton = null;
                this.redraw();
            }
            return null;
        }

        // Map local XY (−worldW/2..+worldW/2) to canvas UV (0..W, 0..H)
        const u = ((localPos.x / this.worldW) + 0.5) * this.W;
        const v = ((localPos.y / this.worldH * -1) + 0.5) * this.H; // flip Y

        let touched = null;
        let newHover = null;

        for (const btn of this.buttons) {
            if (u >= btn.x && u <= btn.x + btn.w &&
                v >= btn.y && v <= btn.y + btn.h) {
                newHover = btn.key;
                // On "touch" (very close to surface)
                if (Math.abs(localPos.z) < 0.01) {
                    touched = btn.key;
                    if (btn.type === 'toggle') {
                        this.settings[btn.key] = !this.settings[btn.key];
                        this.onChange(btn.key, this.settings[btn.key]);
                    } else if (btn.type === 'action' && btn.action) {
                        btn.action();
                        this.onChange(btn.key, null);
                    }
                }
                break;
            }
        }

        if (newHover !== this._hoveredButton) {
            this._hoveredButton = newHover;
            this.redraw();
        }

        return touched;
    }

    // ── Attach to Wrist ──────────────────────────────────────────────────────────

    /**
     * Attach the panel to the left wrist (mirror of the tracked right hand).
     * Call this every frame with the wrist landmark pose.
     */
    attachToWrist(wristPos, wristRot) {
        const offset = new THREE.Vector3(-0.15, 0.05, 0.05)
            .applyQuaternion(wristRot);
        this.mesh.position.copy(wristPos).add(offset);
        this.mesh.quaternion.copy(wristRot);
    }
}
