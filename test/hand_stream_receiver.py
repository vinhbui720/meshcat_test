"""
Hand Stream Receiver - Test server for 432-byte binary hand tracking frames.

Listens on port 7001 for binary WebSocket messages from the WebXR viewer.
Run with:  python3 test/hand_stream_receiver.py

In the browser, enable streaming by calling (from browser console):
  viewer.xr_manager.handControls.enableStreaming('ws://localhost:7001')
Or uncomment the line in test/xr-desktop-test.html.
"""
import asyncio
import struct
import time
import websockets

HAND_PORT = 7002  # 7001 is used by nxnode/IDE process
DOUBLE_COUNT = 54  # 7 (wrist) + 5*7 (tips) + 12 (angles)
EXPECTED_BYTES = DOUBLE_COUNT * 8  # 432 bytes

last_print = 0
frame_count = 0

async def handler(websocket, path=None):
    global last_print, frame_count
    print(f"[HandStream] Client connected: {websocket.remote_address}")
    try:
        async for message in websocket:
            if isinstance(message, bytes):
                if len(message) != EXPECTED_BYTES:
                    print(f"[HandStream] Unexpected packet size: {len(message)} bytes (expected {EXPECTED_BYTES})")
                    continue

                frame_count += 1
                doubles = struct.unpack(f'{DOUBLE_COUNT}d', message)

                # Parse packet structure
                wrist = doubles[0:7]   # pos(3) + quat(4)
                tips  = [doubles[7 + i*7 : 7 + (i+1)*7] for i in range(5)]
                angles = doubles[42:54]

                now = time.time()
                if now - last_print >= 1.0:
                    hz = frame_count / (now - last_print) if last_print else 0
                    print(f"[HandStream] {frame_count} frames | ~{hz:.1f} Hz")
                    print(f"  Wrist pos: ({wrist[0]:.3f}, {wrist[1]:.3f}, {wrist[2]:.3f})")
                    frame_count = 0
                    last_print = now
            else:
                print(f"[HandStream] Unexpected text message: {message[:80]}")
    except websockets.exceptions.ConnectionClosed:
        print("[HandStream] Client disconnected")

async def main():
    print(f"[HandStream] Listening on ws://localhost:{HAND_PORT}")
    print(f"[HandStream] Expecting {EXPECTED_BYTES}-byte binary frames at up to 120 Hz\n")
    async with websockets.serve(handler, "0.0.0.0", HAND_PORT):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
