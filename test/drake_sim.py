"""
Drake Simulation Test - Rotating box overlay for WebXR testing.

Architecture:
  - Drake Meshcat server: port 7000  → scene data (geometry, transforms)
  - Hand streaming receiver: port 7001 → receives 432-byte binary hand tracking frames
    (run test/hand_stream_receiver.py separately if you want to log hand data)

Usage:
  python3 test/drake_sim.py
"""
import time
import math
from pydrake.all import (
    DiagramBuilder, Meshcat, MeshcatVisualizer,
    RigidTransform, RollPitchYaw, StartMeshcat,
    Box, Rgba, RotationMatrix
)

def run_sim():
    # 1. Start Meshcat on default port 7000
    meshcat = StartMeshcat()
    print(f"Meshcat server started at: {meshcat.web_url()}")
    print("Connect your viewer to ws://localhost:7000")
    print("For hand streaming, run: python3 test/hand_stream_receiver.py")

    # 2. Build the scene
    # Ground plane (semi-transparent green)
    ground_shape = Box(5, 5, 0.01)
    meshcat.SetObject("ground", ground_shape, Rgba(0, 0.5, 0, 0.3))
    meshcat.SetTransform("ground", RigidTransform([0, 0, -0.005]))

    # Static robot base (grey)
    base_shape = Box(0.4, 0.4, 0.1)
    meshcat.SetObject("robot_base", base_shape, Rgba(0.3, 0.3, 0.3, 1))
    meshcat.SetTransform("robot_base", RigidTransform([0, 0, 0.05]))

    # Moving test box (red)
    box_shape = Box(0.1, 0.2, 0.3)
    meshcat.SetObject("test_box", box_shape, Rgba(1, 0, 0, 1))

    print("\nBox added to scene. Entering simulation loop (60 Hz)...")
    print("Press Ctrl+C to stop.\n")

    angle = 0.0
    try:
        while True:
            angle += 0.02  # ~1.15 deg per frame at 60Hz
            
            # Rotate the box in a circle
            x = math.cos(angle) * 0.5
            y = math.sin(angle) * 0.5
            z = 0.3 + math.sin(angle * 2) * 0.1

            X_WB = RigidTransform(
                RollPitchYaw(0, 0, angle),
                [x, y, z]
            )
            meshcat.SetTransform("test_box", X_WB)
            time.sleep(1 / 60.0)

    except KeyboardInterrupt:
        print("\nSimulation stopped.")

if __name__ == "__main__":
    run_sim()
