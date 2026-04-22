# ╔════════════════════════════════════════════════════════════════════╗
# ║  Meta Quest 3 + Drake franka_visualizer — Full Run Commands       ║
# ╚════════════════════════════════════════════════════════════════════╝

# ─────────────────────────────────────────────
# TERMINAL 1  —  Vite dev server (HTTPS mode)
# WebXR hand-tracking REQUIRES https://
# ─────────────────────────────────────────────
cd ~/tset/meshcat_test
npm run dev
# Output:
#   Local:   https://localhost:5173/
#   Network: https://192.168.10.211:5173/

# ─────────────────────────────────────────────
# TERMINAL 2  —  ADB USB tunnel
# Connect Quest 3 via USB-C first, then:
# ─────────────────────────────────────────────
adb devices                         # confirm: <device_id>  device
adb reverse tcp:5173 tcp:5173       # Quest → Vite HTTPS server
# (Port 7000 NOT needed — Drake is bridged via Vite proxy on 5173)

# ─────────────────────────────────────────────
# TERMINAL 3  —  Drake / franka_visualizer
# ─────────────────────────────────────────────
cd ~/tset/dairlib
./bazel-bin/examples/franka/franka_visualizer
# Drake starts Meshcat at ws://localhost:7000

# ─────────────────────────────────────────────
# QUEST 3 — Browser steps
# ─────────────────────────────────────────────
# 1. Put on Quest 3 headset
# 2. Open Meta Quest Browser
# 3. Navigate to:
#       https://localhost:5173/test/xr-quest.html
# 4. Accept the self-signed certificate warning:
#       Advanced → Proceed to localhost (unsafe)
# 5. Check the panel — Drake dot should turn GREEN
# 6. Tap "ENTER AR" button at bottom of screen
# 7. Allow hand-tracking when prompted
# 8. Hold up your hands — badges show "🖐 tracked"

# ─────────────────────────────────────────────
# DESKTOP monitoring (optional, same machine)
# ─────────────────────────────────────────────
# Open a second tab for the full monitor:
#   http://localhost:5173/test/xr-desktop-test.html
# (HTTP is fine for desktop — no WebXR hand tracking needed)

# ─────────────────────────────────────────────
# TROUBLESHOOTING
# ─────────────────────────────────────────────
# Problem: Drake dot stays YELLOW (connecting)
#   → Check that franka_visualizer is running
#   → Check: curl -s http://localhost:7000 | head -3
#
# Problem: ADB not found
#   → sudo apt install adb
#
# Problem: "adb devices" shows nothing
#   → Allow USB debugging on Quest (Settings → Developer → USB Debugging ON)
#   → May need to unplug & re-plug and accept the fingerprint prompt in headset
#
# Problem: "WebXR not supported"
#   → Must be on HTTPS (npm run dev, NOT NOTLS=1)
#   → Must accept the self-signed cert before "Enter AR" appears
#
# Problem: Drake scene blank
#   → Open browser console (on desktop: F12) and check for connection logs
#   → Should see green: "[MeshCat] ✅ Drake WebSocket CONNECTED"
#   → If you see "[MeshCat] 🔒 HTTPS detected. Routing Drake via Vite proxy."
#      that is NORMAL — it means proxy path is active
