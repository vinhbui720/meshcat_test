using UnityEngine;
using Oculus.Interaction.Input;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System;
using System.Collections;
using System.Collections.Generic;

public class HandLandmarkStreamer : MonoBehaviour
{
    public enum HandSide { Left, Right }

    [Header("Configuration")]
    [Tooltip("Which hand data to track and stream")]
    [SerializeField] private HandSide _handSide;
    
    [Header("Logging")]
    [SerializeField] private bool _logToHUD = true;
    
    [Tooltip("The Log Source name to push text to (e.g., 'Right' to see everything on the right hand panel)")]
    [SerializeField] private string _hudLogSource = "Right"; // Default to Right as requested
    
    [SerializeField] private float _frequency = 0.00833f; // 120Hz
    [SerializeField] private bool _useBinary = true;

    private IHand _hand;
    // private float _timer;
    private bool _isStreamingLoopRunning = false;

    // Public Accessors
    public IHand Hand => _hand; 
    public HandSide Side => _handSide;
    
    // Networking
    private UdpClient _udpClient;
    private TcpClient _tcpClient;
    private NetworkStream _tcpStream;
    private IPEndPoint _remoteEndPoint;
    private bool _isInitialized = false;
    private int _currentProtocol = -1; 

    // Optimization: Cache StringBuilders
    private StringBuilder _sbPacket = new StringBuilder(2048);
    private StringBuilder _sbLog = new StringBuilder(2048);

    // Numeric buffer for binary packet
    private double[] _binaryValues = new double[54];
    private byte[] _byteBuffer = new byte[54 * 8];
    
    // Indices for the 5 standard fingers tip (Sending)
    private readonly int[] _streamedJoints = {
        5,  // Thumb Tip
        10, // Index Tip
        15, // Middle Tip
        20, // Ring Tip
        25  // Pinky Tip
    };

    // Indices for the HUD Display (Wrist + Tips only)
    private readonly int[] _displayJoints = { 
        5,  // Thumb Tip
        10, // Index Tip
        15, // Middle Tip
        20, // Ring Tip
        25  // Pinky Tip
    };

    private void Start()
    {
        _hand = GetComponent<IHand>();
        if (OVRManager.display != null) {
            OVRManager.display.displayFrequency = 120.0f;
        }
        Application.targetFrameRate = 120;
        QualitySettings.vSyncCount = 0;
        if (_hand == null)
        {
            LogHUD("Error: No IHand component found!");
            enabled = false;
            return;
        }
    }

    private void Update()
    {
        if (AppManager.Instance != null && AppManager.Instance.isStreaming)
        {
            if (!_isStreamingLoopRunning)
            {
                _isStreamingLoopRunning = true;
                StartCoroutine(HighFrequencyStreamLoop());
            }
        }
        else if (_isStreamingLoopRunning)
        {
            _isStreamingLoopRunning = false;
            StopAllCoroutines();
            Disconnect();
        }
    }

    private IEnumerator HighFrequencyStreamLoop()
    {
        if (!_isInitialized) InitializeNetwork();
        var wait = new WaitForSecondsRealtime(_frequency);

        while (_isStreamingLoopRunning)
        {
            if (_hand.IsTrackedDataValid) ProcessHandData();
            yield return wait;
        }
    }

    private void ProcessHandData()
    {
        _sbLog.Clear();
        _sbPacket.Clear();

        if (_useBinary) {
            ProcessBinaryData();
        } else {
            ProcessStringData();
        }
    }

    private void ProcessBinaryData()
    {
        int idx = 0;

        // 1. Wrist Data (7 doubles)
        if (_hand.GetRootPose(out Pose rootPose))
        {
            AddPoseToBinary(rootPose, ref idx);
        }
        else { idx += 7; }

        // 2. Finger Tips & Joints
        if (_hand.GetJointPosesFromWrist(out ReadOnlyHandJointPoses joints))
        {
            // Tips (35 doubles)
            foreach (int jIdx in _streamedJoints)
            {
                if (jIdx < joints.Count) AddPoseToBinary(joints[jIdx], ref idx);
                else idx += 7;
            }

            // 12 Joint Angles (12 doubles)
            AddJointAnglesToBinary(joints, ref idx);
        }

        // Send exactly 432 bytes
        if (idx == 54)
        {
            Buffer.BlockCopy(_binaryValues, 0, _byteBuffer, 0, _byteBuffer.Length);
            SendRawBytes(_byteBuffer);
        }
    }

    private void ProcessStringData()
    {
        if (_hand.GetRootPose(out Pose rootPose))
        {
            _sbPacket.Append(_handSide).Append(" wrist:, ");
            _sbPacket.Append(rootPose.position.x.ToString("F4")).Append(", ")
                     .Append(rootPose.position.y.ToString("F4")).Append(", ")
                     .Append(rootPose.position.z.ToString("F4")).Append(", ")
                     .Append(rootPose.rotation.x.ToString("F3")).Append(", ")
                     .Append(rootPose.rotation.y.ToString("F3")).Append(", ")
                     .Append(rootPose.rotation.z.ToString("F3")).Append(", ")
                     .Append(rootPose.rotation.w.ToString("F3"));
            // Prepare HUD Log
            if (_logToHUD)
            {
                // Added _handSide label to log so you know which hand is which on the shared screen
                _sbLog.AppendLine($"=== [{_handSide}] Wrist ==="); 
                _sbLog.AppendLine($"Pos: {rootPose.position.ToString("F3")}");
                // Optional: Comment out rotation if it clutters the shared screen too much
                // _sbLog.AppendLine($"Rot: {rootPose.rotation.eulerAngles.ToString("F0")}");
            }
        }

        if (_hand.GetJointPosesFromWrist(out ReadOnlyHandJointPoses joints))
        {
            _sbPacket.Append("\n").Append(_handSide).Append(" fingers:");
            foreach (int i in _streamedJoints)
            {
                _sbPacket.Append(", ");
                if (i < joints.Count)
                {
                    Vector3 p = joints[i].position;
                    Quaternion q = joints[i].rotation;
                    _sbPacket.Append(p.x.ToString("F4")).Append(", ").Append(p.y.ToString("F4")).Append(", ").Append(p.z.ToString("F4")).Append(", ")
                             .Append(q.x.ToString("F3")).Append(", ").Append(q.y.ToString("F3")).Append(", ").Append(q.z.ToString("F3")).Append(", ").Append(q.w.ToString("F3"));
                }
                else { _sbPacket.Append("0,0,0,0,0,0,1"); }
            }
            // HUD Log
            if (_logToHUD)
            {
                _sbLog.AppendLine($"=== [{_handSide}] Fingers ===");
                for (int i = 0; i < _displayJoints.Length; i++)
                {
                    int jointIndex = _displayJoints[i];
                    if (jointIndex < joints.Count)
                    {
                        string name = GetRenumberedJointName(i);
                        Vector3 pos = joints[jointIndex].position;
                        _sbLog.AppendLine($"{name}: {pos.ToString("F3")}");
                    }
                }

                _sbLog.AppendLine("--- Angles ---");
                _sbLog.Append(GetThumbAngles(joints));
                _sbLog.Append(GetFingerAngles(joints, HandFinger.Index));
                _sbLog.Append(GetFingerAngles(joints, HandFinger.Middle));
                _sbLog.Append(GetFingerAngles(joints, HandFinger.Ring));
                _sbLog.Append(GetFingerAngles(joints, HandFinger.Pinky));
                
                // Final Push to HUD using the CUSTOM SOURCE
                LogHUD(_sbLog.ToString());
            }
        }
        
        byte[] data = Encoding.UTF8.GetBytes(_sbPacket.ToString() + "\n");
        SendRawBytes(data);
    }

    // --- NETWORK HELPERS ---
    private void InitializeNetwork()
    {
        string ip = AppManager.Instance.ServerIP;
        int port = AppManager.Instance.ServerPort;
        _currentProtocol = AppManager.Instance.SelectedProtocol;

        try
        {
            if (_currentProtocol == 0) // UDP
            {
                _udpClient = new UdpClient();
                _udpClient.Client.SendBufferSize = 0; // Keep this optimization
                _remoteEndPoint = new IPEndPoint(IPAddress.Parse(ip), port);
                
                // FIX: Start listening for the Ping-Pong reply
                _udpClient.BeginReceive(new AsyncCallback(OnUdpReceive), null);
                // Log success to the configured HUD source
                LogHUD($"UDP Ready: {ip}:{port}");
            }
            else // TCP (Wired=1 OR Wireless=2)
            {
                // Force IPv4 to fix "Access Denied" on Android
                _tcpClient = new TcpClient(AddressFamily.InterNetwork);
                
                // 1. Critical: Disable Nagle for speed
                _tcpClient.NoDelay = true; 

                // 2. Critical: Set Timeout so the app doesn't freeze on Write()
                _tcpClient.SendTimeout = 1000; // 1 second max hang time
                _tcpClient.ReceiveTimeout = 1000;

                _tcpClient.Connect(ip, port);
                _tcpStream = _tcpClient.GetStream();
                
                string type = _currentProtocol == 1 ? "Wired" : "WiFi";
                LogHUD($"TCP({type}) Connected: {ip}:{port}");
            }
            _isInitialized = true;
        }
        catch (Exception ex)
        {
            LogHUD($"Conn Error: {ex.Message}");
            AppManager.Instance.StopStreaming();
        }
    }

    // The Callback that processes the incoming "ACK" from Python
    private void OnUdpReceive(IAsyncResult res)
    {
        try
        {
            IPEndPoint remote = new IPEndPoint(IPAddress.Any, 0);
            // Receive the dummy byte (and ignore it)
            _udpClient.EndReceive(res, ref remote);
            
            // Listen for the next one immediately
            _udpClient.BeginReceive(new AsyncCallback(OnUdpReceive), null);
        }
        catch { }
    }
    
    private void SendRawBytes(byte[] data)
    {
        try
        {
            if (_currentProtocol == 0 && _udpClient != null)
                _udpClient.Send(data, data.Length, _remoteEndPoint);
            else if (_tcpStream != null && _tcpStream.CanWrite)
                _tcpStream.Write(data, 0, data.Length);
        }
        catch (Exception ex)
        {
            Debug.LogError("[Streamer] Send Error: " + ex.Message);
            Disconnect();
            if (AppManager.Instance != null)
            {
                AppManager.Instance.HandleDisconnection("Host Closed Connection");
            }
        }
    }

    private void Disconnect()
    {
        try
        {
            if (_udpClient != null) { _udpClient.Close(); _udpClient = null; }
            if (_tcpStream != null) { _tcpStream.Close(); _tcpStream = null; }
            if (_tcpClient != null) { _tcpClient.Close(); _tcpClient = null; }
        }
        catch { }
        _isInitialized = false;
    }

    // --- UTILITY HELPERS ---
    private void AppendVector3(StringBuilder sb, Vector3 vec)
    {
        sb.Append(vec.x.ToString("F4")).Append(", ")
          .Append(vec.y.ToString("F4")).Append(", ")
          .Append(vec.z.ToString("F4"));
    }

    private void AppendQuaternion(StringBuilder sb, Quaternion q)
    {
        sb.Append(q.x.ToString("F3")).Append(", ")
          .Append(q.y.ToString("F3")).Append(", ")
          .Append(q.z.ToString("F3")).Append(", ")
          .Append(q.w.ToString("F3"));
    }

    private string GetRenumberedJointName(int index)
    {
        switch (index)
        {
            case 0: return "Thumb";
            case 1: return "Index";
            case 2: return "Mid";
            case 3: return "Ring";
            case 4: return "Pinky";
            default: return "J";
        }
    }

    private void AddPoseToBinary(Pose p, ref int i)
    {
        _binaryValues[i++] = p.position.x; _binaryValues[i++] = p.position.y; _binaryValues[i++] = p.position.z;
        _binaryValues[i++] = p.rotation.x; _binaryValues[i++] = p.rotation.y; _binaryValues[i++] = p.rotation.z; _binaryValues[i++] = p.rotation.w;
    }

    private void AddJointAnglesToBinary(ReadOnlyHandJointPoses joints, ref int idx)
    {
        // Thumb (4 angles)
        int[] tIdx = GetFingerJointIndices(HandFinger.Thumb);
        if (tIdx.Length >= 4) {
            Quaternion q1 = Quaternion.Inverse(joints[tIdx[0]].rotation) * joints[tIdx[1]].rotation;
            _binaryValues[idx++] = NormalizeAngle(q1.eulerAngles.x);
            _binaryValues[idx++] = NormalizeAngle(q1.eulerAngles.y);
            Quaternion q2 = Quaternion.Inverse(joints[tIdx[1]].rotation) * joints[tIdx[2]].rotation;
            _binaryValues[idx++] = NormalizeAngle(q2.eulerAngles.x);
            _binaryValues[idx++] = NormalizeAngle(q2.eulerAngles.y);
        } else { idx += 4; }

        // Non-thumb fingers (8 angles)
        HandFinger[] fingers = { HandFinger.Index, HandFinger.Middle, HandFinger.Ring, HandFinger.Pinky };
        foreach (var f in fingers) {
            int[] fIdx = GetFingerJointIndices(f);
            if (fIdx.Length >= 5) {
                Quaternion q = Quaternion.Inverse(joints[fIdx[1]].rotation) * joints[fIdx[2]].rotation;
                _binaryValues[idx++] = NormalizeAngle(q.eulerAngles.x); // MCP Flexion
                Quaternion qp = Quaternion.Inverse(joints[fIdx[2]].rotation) * joints[fIdx[3]].rotation;
                qp.ToAngleAxis(out float angle, out Vector3 axis);
                _binaryValues[idx++] = NormalizeAngle(angle); // PIP Flexion
            } else { idx += 2; }
        }
    }

    /// <summary>
    /// Normalize Euler angle to range [-180, 180].
    /// </summary>
    private float NormalizeAngle(float angle)
    {
        angle %= 360f;
        if (angle > 180f) angle -= 360f;
        else if (angle < -180f) angle += 360f;
        return angle;
    }

    /// <summary>
    /// Returns a multi-line string containing all thumb joint angles.
    /// Each line is formatted as "JointName: Angle".
    /// </summary>
    private string GetThumbAngles(ReadOnlyHandJointPoses jointPoses)
    {
        int[] indices = GetFingerJointIndices(HandFinger.Thumb);
        if (indices.Length < 4)
        {
            return "Insufficient joint data for Thumb\n";
        }

        // Transition: CMC → MCP
        Quaternion cmcToMcp = Quaternion.Inverse(jointPoses[indices[0]].rotation) * jointPoses[indices[1]].rotation;
        Vector3 cmcToMcpEuler = cmcToMcp.eulerAngles;
        float cmcMcpFlexion = NormalizeAngle(cmcToMcpEuler.x);
        float cmcMcpAdduction = NormalizeAngle(cmcToMcpEuler.y);

        // Transition: MCP → IP
        Quaternion mcpToIp = Quaternion.Inverse(jointPoses[indices[1]].rotation) * jointPoses[indices[2]].rotation;
        Vector3 mcpToIpEuler = mcpToIp.eulerAngles;
        float mcpIpFlexion = NormalizeAngle(mcpToIpEuler.x);

        // Transition: IP → TIP
        Quaternion ipToTip = Quaternion.Inverse(jointPoses[indices[2]].rotation) * jointPoses[indices[3]].rotation;
        Vector3 ipToTipEuler = ipToTip.eulerAngles;
        float ipTipFlexion = NormalizeAngle(ipToTipEuler.x);

        string s = "";
        s += $"Thumb CMC Flexion: {cmcMcpFlexion:F1}°\n";
        s += $"Thumb CMC Adduction: {cmcMcpAdduction:F1}°\n";
        s += $"Thumb MCP Flexion: {mcpIpFlexion:F1}°\n";
        s += $"Thumb IP Flexion: {ipTipFlexion:F1}°\n";
        return s;
    }

    /// <summary>
    /// Returns a multi-line string containing joint angles for a non-thumb finger.
    /// For non-thumb fingers, we compute:
    /// - MCP→PIP rotation (Euler flexion)
    /// - PIP→DIP rotation (axis-angle flexion)
    /// </summary>
    private string GetFingerAngles(ReadOnlyHandJointPoses jointPoses, HandFinger finger)
    {
        int[] indices = GetFingerJointIndices(finger);
        if (indices.Length < 5)
        {
            return $"Insufficient joint data for {finger} finger\n";
        }

        // MCP → PIP rotation
        Quaternion mcpToPip = Quaternion.Inverse(jointPoses[indices[1]].rotation) * jointPoses[indices[2]].rotation;
        Vector3 mcpEuler = mcpToPip.eulerAngles;
        float mcpFlexion = NormalizeAngle(mcpEuler.x);

        // PIP → DIP rotation (axis–angle for flexion only)
        Quaternion pipToDip = Quaternion.Inverse(jointPoses[indices[2]].rotation) * jointPoses[indices[3]].rotation;
        pipToDip.ToAngleAxis(out float pipAngle, out Vector3 pipAxis);
        float pipFlexion = NormalizeAngle(pipAngle);

        string s = "";
        s += $"{finger} MCP Flexion: {mcpFlexion:F1}°\n";
        s += $"{finger} PIP Flexion: {pipFlexion:F1}°\n";
        return s;
    }

    /// <summary>
    /// Append joint-angle values (only the numeric angles) into the packet
    /// </summary>
    private void AppendJointAnglesToPacket(StringBuilder sb, ReadOnlyHandJointPoses jointPoses)
    {
        sb.Append("\n").Append(_handSide).Append(" angles:");

        // Thumb
        {
            int[] indices = GetFingerJointIndices(HandFinger.Thumb);
            if (indices.Length >= 4)
            {
                Quaternion cmcToMcp = Quaternion.Inverse(jointPoses[indices[0]].rotation) * jointPoses[indices[1]].rotation;
                Vector3 cmcToMcpEuler = cmcToMcp.eulerAngles;
                float cmcMcpFlexion = NormalizeAngle(cmcToMcpEuler.x);
                float cmcMcpAdduction = NormalizeAngle(cmcToMcpEuler.y);

                Quaternion mcpToIp = Quaternion.Inverse(jointPoses[indices[1]].rotation) * jointPoses[indices[2]].rotation;
                Vector3 mcpToIpEuler = mcpToIp.eulerAngles;
                float mcpIpFlexion = NormalizeAngle(mcpToIpEuler.x);
                float mcpIpAdduction = NormalizeAngle(mcpToIpEuler.y);

                // Append four angles
                sb.Append(", ").Append(cmcMcpFlexion.ToString("F1"));
                sb.Append(", ").Append(cmcMcpAdduction.ToString("F1"));
                sb.Append(", ").Append(mcpIpFlexion.ToString("F1"));
                sb.Append(", ").Append(mcpIpAdduction.ToString("F1"));
            }
        }

        // Other fingers
        HandFinger[] fingers = { HandFinger.Index, HandFinger.Middle, HandFinger.Ring, HandFinger.Pinky };
        foreach (var finger in fingers)
        {
            int[] indices = GetFingerJointIndices(finger);
            if (indices.Length >= 5)
            {
                // MCP → PIP
                Quaternion mcpToPip = Quaternion.Inverse(jointPoses[indices[1]].rotation) * jointPoses[indices[2]].rotation;
                Vector3 mcpEuler = mcpToPip.eulerAngles;
                float mcpFlexion = NormalizeAngle(mcpEuler.x);

                // PIP → DIP
                Quaternion pipToDip = Quaternion.Inverse(jointPoses[indices[2]].rotation) * jointPoses[indices[3]].rotation;
                pipToDip.ToAngleAxis(out float pipAngle, out Vector3 pipAxis);
                float pipFlexion = NormalizeAngle(pipAngle);

                sb.Append(", ").Append(mcpFlexion.ToString("F1"));
                sb.Append(", ").Append(pipFlexion.ToString("F1"));
            }
        }
    }

    /// <summary>
    /// Returns joint indices for the given finger based on the standard Oculus hand skeleton.
    /// For the thumb, we assume a 4-joint chain (e.g. indices 1,2,3,4).
    /// For non-thumb fingers, we assume a 5-joint chain.
    /// Adjust these if your actual data uses different indexing.
    /// </summary>
    private int[] GetFingerJointIndices(HandFinger finger)
    {
        switch (finger)
        {
            case HandFinger.Thumb:
                return new int[] { 1, 2, 3, 4 };
            case HandFinger.Index:
                return new int[] { 5, 6, 7, 8, 9 };
            case HandFinger.Middle:
                return new int[] { 10, 11, 12, 13, 14 };
            case HandFinger.Ring:
                return new int[] { 15, 16, 17, 18, 19 };
            case HandFinger.Pinky:
                return new int[] { 20, 21, 22, 23, 24 };
            default:
                return new int[0];
        }
    }

    private void LogHUD(string msg)
    {
        if (_logToHUD && LogManager.Instance != null)
        {
            // Use the specific HUD Source name instead of the HandSide
            LogManager.Instance.Log(_hudLogSource, msg);
        }
    }
}