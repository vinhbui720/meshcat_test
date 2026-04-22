# MeshCat WebXR — Meta Quest 3 + Drake C++ Integration

> A WebXR-enabled fork of [MeshCat](https://github.com/meshcat-dev/meshcat) for real-time robotics visualization on Meta Quest 3, with 120Hz hand tracking and USB-tethered Drake C++ connectivity.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Quick Start (Desktop Mock)](#quick-start-desktop-mock)
4. [Meta Quest 3 Setup](#meta-quest-3-setup)
5. [Drake C++ Integration](#drake-c-integration)
6. [Hand Tracking Data Protocol](#hand-tracking-data-protocol)
7. [3D Panel — Touch Interaction](#3d-panel--touch-interaction)
8. [Development Workflow](#development-workflow)
9. [Future Implementation Checklist](#future-implementation-checklist)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  HOST MACHINE (Linux / Ubuntu)                          │
│                                                         │
│  ┌──────────────────┐    ws://localhost:7000            │
│  │  Drake C++       │◄──────────────────────────────┐  │
│  │  simulation      │   msgpack scene commands       │  │
│  │  (Meshcat server)│                                │  │
│  └──────────────────┘                                │  │
│                                                       │  │
│  ┌──────────────────┐    ws://localhost:7002          │  │
│  │  Hand Stream     │◄──── 432-byte binary frames ───┤  │
│  │  Receiver        │      at up to 120 Hz           │  │
│  │  (python)        │                                │  │
│  └──────────────────┘                                │  │
│                                                       │  │
│  ┌──────────────────┐                                │  │
│  │  Vite Dev Server │  https://localhost:5173 ────────┘  │
│  │  (MeshCat XR)    │                                   │
│  └──────────────────┘                                   │
│           │                                             │
│   adb reverse tcp:5173 tcp:5173                         │
│   adb reverse tcp:7000 tcp:7000                         │
└───────────┼─────────────────────────────────────────────┘
            │ USB (ADB Tunnel)
┌───────────▼─────────────────────────────────────────────┐
│  META QUEST 3                                           │
│                                                         │
│  Browser: https://localhost:5173                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  MeshCat Viewer (WebXR)                          │  │
│  │  ├── Drake Scene (ws://localhost:7000)           │  │
│  │  ├── XR Hand Skeleton (21 joints, 120Hz)         │  │
│  │  ├── 3D Touch Panel (XR3DPanel)                  │  │
│  │  └── AR Passthrough (immersive-ar)               │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
meshcat/
├── src/
│   ├── index.js               ← MeshCat Viewer core (Webpack→Vite migrated)
│   └── xr/
│       ├── xr-manager.js      ← Central XR orchestrator
│       ├── hand-controls.js   ← 120Hz hand tracking + binary streaming
│       ├── xr-visualizer.js   ← 21-joint hand skeleton with bone lines
│       ├── xr-3d-panel.js     ← 3D touch-interactive GUI panel
│       ├── xr-ui.js           ← HTML fallback dat.GUI controls
│       └── teleport.js        ← Teleportation locomotion
│
├── test/
│   ├── xr-desktop-test.html   ← Desktop/phone mock viewer (no headset needed)
│   ├── xr-mock.html           ← Minimal XR test page
│   ├── drake_sim.py           ← Drake simulation testbed (rotating box)
│   └── hand_stream_receiver.py← 432-byte binary hand data logger (port 7002)
│
├── old_code/
│   ├── HandLandmarkStreamer.cs ← Reference C# implementation (data protocol)
│   └── HandLandmarkVisualizer.cs ← Reference C# visualizer
│
├── vite.config.js             ← Vite build (NOTLS=1 for phone testing)
└── package.json
```

---

## Quick Start (Desktop Mock)

> No headset required. Tests the full stack on laptop or phone.

**Terminal 1 — Dev Server:**
```bash
# HTTP mode (phone/laptop — no SSL certificates needed)
NOTLS=1 npm run dev

# HTTPS mode (required for real Quest 3 WebXR hardware)
npm run dev
```

**Terminal 2 — Drake Simulation:**
```bash
python3 test/drake_sim.py
# → Starts Meshcat on http://localhost:7000
# → Adds rotating box, robot base, ground plane
```

**Terminal 3 — (Optional) Hand Data Logger:**
```bash
python3 test/hand_stream_receiver.py
# → Listens on ws://localhost:7002 for 120Hz binary frames
```

**Browser:**
```
http://localhost:5173/test/xr-desktop-test.html
```

You will see:
- 🔵 The Drake simulation scene (box, ground, robot base)
- 🟢 A realistic 21-joint hand skeleton with teal spheres + blue bones
- 🎛️ A dark glassmorphic **3D panel** floating in the scene

---

## Meta Quest 3 Setup

### Prerequisites

- Meta Quest 3 headset with **Developer Mode** enabled
  - Go to Meta Quest phone app → Devices → Developer Mode → ON
- `adb` (Android Debug Bridge) installed on host machine
  - `sudo apt install adb` on Ubuntu
- USB-C cable (data capable)

### Connection Steps

```bash
# 1. Connect Quest 3 over USB and authorize
adb devices
# Should show: <device_id>  device

# 2. Set up port tunnels (host → headset)
adb reverse tcp:5173 tcp:5173   # Vite dev server
adb reverse tcp:7000 tcp:7000   # Drake scene WebSocket
# (port 7002 for hand stream if needed)

# 3. Start the HTTPS dev server (required for WebXR)
npm run dev

# 4. Start Drake simulation
python3 test/drake_sim.py
```

### Opening in Quest Browser

1. Put on the headset
2. Open **Meta Quest Browser**
3. Navigate to: `https://localhost:5173/test/xr-desktop-test.html`
4. Accept the self-signed certificate warning (Advanced → Proceed)
5. Click **"Enter AR"** or **"Enter VR"** button
6. Your hand tracking will be visible as a 3D skeleton overlay on the Drake world

> **Key insight:** Using `localhost` (via ADB reverse) grants a "secure context" exemption, so WebXR hand tracking is enabled without real TLS certificates.

---

## Drake C++ Integration

### How the Scene Connection Works

The MeshCat viewer connects as a **WebSocket client** to Drake's built-in Meshcat server.  
Drake sends `msgpack`-encoded commands; the viewer renders them in Three.js.

```cpp
// In your Drake C++ code:
#include <drake/geometry/meshcat.h>

auto meshcat = std::make_shared<drake::geometry::Meshcat>();
// Default port: 7000

// Add geometry:
meshcat->SetObject("robot/arm", shape, color);
meshcat->SetTransform("robot/arm", X_World);
```

The browser viewer automatically receives these as real-time updates via WebSocket.

### Recommended Drake Workflow

```
Drake Process                   MeshCat Viewer
─────────────────               ──────────────────
DrakeSystem ──LCM──► C++ bridge ──ws://7000──► Three.js scene
                                               +
Quest 3 hand data ──ws://7002──► Python receiver ──► custom LCM msg
```

**Receiving hand data in Python (for prototyping):**
```python
# test/hand_stream_receiver.py already implements this
# Parse: 54 doubles = [wrist(7), thumb_tip(7), index_tip(7),
#                      middle_tip(7), ring_tip(7), pinky_tip(7),
#                      joint_angles(12)]
```

**Forwarding to Drake via `lcm-python`:**
```python
import lcm
lc = lcm.LCM()
# Publish hand pose to LCM channel for Drake to subscribe to
lc.publish("HAND_POSE", msg.encode())
```

### Drake C++ Receiving Hand Data

```cpp
// Subscribe to LCM hand pose channel
lcm::LCM lcm;
lcm.subscribe("HAND_POSE", &MySystem::HandleHandPose, this);
```

---

## Hand Tracking Data Protocol

### Binary Packet Format (432 bytes)

The `HandControls` class streams a **54-double** (432-byte) binary WebSocket frame at up to 120Hz.  
Format is identical to the legacy C# `HandLandmarkStreamer`:

| Offset (doubles) | Field | Size |
|---|---|---|
| 0–6 | Wrist pose `[x, y, z, qx, qy, qz, qw]` | 7 |
| 7–13 | Thumb tip pose | 7 |
| 14–20 | Index tip pose | 7 |
| 21–27 | Middle tip pose | 7 |
| 28–34 | Ring tip pose | 7 |
| 35–41 | Pinky tip pose | 7 |
| 42–53 | 12 joint angles (placeholder — see below) | 12 |
| **Total** | | **54 doubles** |

### Enabling Hand Streaming

```javascript
// In browser console or from xr-desktop-test.html:
viewer.xr_manager.handControls.enableStreaming('ws://localhost:7002');

// Or configure frequency:
viewer.xr_manager.ui.settings.streamFrequency = 120; // Hz
viewer.xr_manager.ui.settings.enableStreaming = true;
```

### Joint Angles (TODO)

The 12 joint angles currently output zeros. Future work:
- Map WebXR joint quaternions to flexion/extension angles per finger
- Implement using relative rotation between parent–child joint pairs
- Reference: `old_code/HandLandmarkStreamer.cs` → `CalculateJointAngles()`

---

## 3D Panel — Touch Interaction

The `XR3DPanel` lives in 3D world space as a billboard panel.

### Current Features
- Toggle buttons: **Streaming**, **Mock Mode**, **Show Landmarks**
- Frequency: **± 10Hz** stepping  
- **Hand Side** toggle (Left / Right)
- Billboard mode: always faces the camera
- Hover glow on proximity

### Touch Interaction (Future Quest 3)

Touch detection is already implemented via `hitTest()`:

```javascript
// Called automatically each frame in xr-manager.js update():
panel3d.hitTest(indexFingerTipPosition);
// Returns button key if index fingertip is within 1cm of the panel
```

To enable wrist attachment (attach panel to off-hand wrist):

```javascript
// In xr-manager.js update(), find left wrist pose:
const leftWrist = this.handControls.getLeftWristPose(frame);
if (leftWrist) {
    this.panel3d.attachToWrist(leftWrist.position, leftWrist.rotation);
}
```

---

## Development Workflow

### Adding a New Visualization to the Scene

1. **From Python (Drake):**
   ```python
   meshcat.SetObject("my_object", Box(0.1, 0.1, 0.1), Rgba(0,1,0,1))
   meshcat.SetTransform("my_object", RigidTransform([x, y, z]))
   ```

2. **From JavaScript (local overlay):**
   ```javascript
   const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
   const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
   viewer.scene.add(mesh);
   ```

### Adding a New Button to the 3D Panel

In `src/xr/xr-3d-panel.js`, add to `_defineButtons()`:
```javascript
{
    key: 'myFeature',
    label: () => `My Feature: ${this.settings.myFeature ? 'ON' : 'OFF'}`,
    type: 'toggle',
    x: pad, y: 20 + (bh + gap) * N,  // N = row number
    w, h: bh,
    color: () => '#1a2a4a',
}
```

---

## Future Implementation Checklist

### Phase 1 — Hardware Verification ✅ (Mock done, Hardware pending)
- [x] WebXR session management (AR/VR)
- [x] 120Hz hand tracking stream (mock)
- [x] 21-joint skeleton visualization
- [x] Drake simulation overlay (desktop)
- [x] ADB reverse tunnel setup
- [ ] **Real Quest 3 test** — verify hand tracking activates at 120Hz
- [ ] **Latency measurement** — confirm sub-20ms round-trip over USB

### Phase 2 — Drake C++ Integration
- [ ] LCM bridge: receive hand poses in Drake C++
- [ ] Joint angle calculation (replace placeholder zeros)
- [ ] Scene transform sync (align Quest 3 tracking space with Drake world frame)
- [ ] Real-time robot state visualization from Drake LCM

### Phase 3 — Advanced XR Interaction
- [ ] Left wrist panel attachment (off-hand menu)
- [ ] Pinch gesture detection (thumb+index distance < threshold)
- [ ] Ray-casting from controller for scene object selection
- [ ] Haptic feedback on button touch
- [ ] Voice commands via WebSpeech API

### Phase 4 — Production Hardening
- [ ] Reconnect logic for WebSocket drops
- [ ] Complete joint angle math (flexion/extension from quaternion relatives)
- [ ] Build pipeline: `npm run build` → self-contained static site to serve from Drake

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `require is not defined` | Stale Vite cache | `rm -rf node_modules/.vite && npm run dev` |
| Drake crashes "insufficient bytes" | Browser sending binary to Drake's msgpack socket | Hand stream goes to **port 7002**, not 7000 — check `enableStreaming('ws://...:7002')` |
| Black screen on laptop | `desktopMock` not enabled | Use `xr-desktop-test.html`, not `xr-mock.html` |
| iPhone "can't load page" | SSL cert rejected | Use `NOTLS=1 npm run dev` for HTTP mode |
| Quest can't reach server | ADB tunnel not set up | Run `adb reverse tcp:5173 tcp:5173 && adb reverse tcp:7000 tcp:7000` |
| "WebXR not available" on laptop | Browser doesn't support WebXR | Use Chrome/Edge with `--enable-features=WebXR` flag or use Mock Mode |
| Port 7001 in use | NX IDE process | Use port 7002 for hand stream (already configured) |

---

## References

- [Meta Quest Hand Tracking WebXR](https://github.com/marlon360/webxr-handtracking)
- [Drake Meshcat C++ API](https://drake.mit.edu/doxygen_cxx/classdrake_1_1geometry_1_1_meshcat.html)
- [WebXR Hand Tracking Spec](https://www.w3.org/TR/webxr-hand-input-1/)
- [Original C# HandLandmarkStreamer](old_code/HandLandmarkStreamer.cs)
- [Original C# HandLandmarkVisualizer](old_code/HandLandmarkVisualizer.cs)
