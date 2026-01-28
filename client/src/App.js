import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function App() {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);

  const peersRef = useRef({});
  const pendingIceRef = useRef({});
  const audioElsRef = useRef({});
  const localStreamRef = useRef(null);

  const [pos, setPos] = useState({ x: 100, y: 100 });
  const [players, setPlayers] = useState([]);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // ---------- SOCKET SETUP ----------
  useEffect(() => {
    socketRef.current = io("http://localhost:4000");

    socketRef.current.on("connect", () => {
      socketRef.current.emit("move", pos);
    });

    socketRef.current.on("players-update", setPlayers);
    socketRef.current.on("proximity", handleProximity);

    socketRef.current.on("webrtc-offer", handleOffer);
    socketRef.current.on("webrtc-answer", handleAnswer);
    socketRef.current.on("webrtc-ice", handleIce);

    return () => socketRef.current.disconnect();
  }, []);

  // send movement
  useEffect(() => {
    if (socketRef.current) socketRef.current.emit("move", pos);
  }, [pos]);

  // draw
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, 600, 600);

    players.forEach(p => {
      ctx.fillStyle =
        p.id === socketRef.current?.id ? "#2563eb" : "red";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [players]);

  function move(dx, dy) {
    let nx = pos.x + dx;
    let ny = pos.y + dy;
    nx = Math.max(0, Math.min(600, nx));
    ny = Math.max(0, Math.min(600, ny));
    setPos({ x: nx, y: ny });
  }

  // ---------- AUDIO SETUP ----------
  async function enableAudio() {
    if (localStreamRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;

    setAudioEnabled(true);
    console.log("LOCAL MIC READY");
  }

  // ---------- PROXIMITY ----------
  function handleProximity(ids) {
    const active = peersRef.current;

    // disconnect far
    Object.keys(active).forEach(id => {
      if (!ids.includes(id)) {
        console.log("DISCONNECT AUDIO FROM", id);
        active[id].close();
        delete active[id];
        delete pendingIceRef.current[id];

        if (audioElsRef.current[id]) {
          audioElsRef.current[id].remove();
          delete audioElsRef.current[id];
        }
      }
    });

    // connect new
    ids.forEach(id => {
      if (!active[id]) maybeStartConnection(id);
    });
  }

  // ---------- WEBRTC CORE ----------

  function isOfferer(peerId) {
    return socketRef.current.id < peerId;
  }

  function createPeerConnection(peerId) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit("webrtc-ice", {
          to: peerId,
          candidate: e.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("PC STATE", peerId, pc.connectionState);
    };

    pc.ontrack = (e) => {
      console.log("AUDIO TRACK RECEIVED FROM", peerId);

      if (!audioElsRef.current[peerId]) {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.volume = 1.0;
        document.body.appendChild(audio);
        audioElsRef.current[peerId] = audio;
      }

      const audio = audioElsRef.current[peerId];
      audio.srcObject = e.streams[0];
      audio.play().catch(err => console.error("PLAY ERROR", err));
    };

    return pc;
  }

  async function maybeStartConnection(peerId) {
    if (!isOfferer(peerId)) return;
    if (!localStreamRef.current) return;

    console.log("START OFFER TO", peerId);

    const pc = createPeerConnection(peerId);

    localStreamRef.current.getTracks().forEach(t =>
      pc.addTrack(t, localStreamRef.current)
    );

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socketRef.current.emit("webrtc-offer", { to: peerId, offer });

    peersRef.current[peerId] = pc;
  }

  async function handleOffer({ from, offer }) {
    if (isOfferer(from)) return;
    if (!localStreamRef.current) return;

    console.log("RECEIVED OFFER FROM", from);

    const pc = createPeerConnection(from);

    localStreamRef.current.getTracks().forEach(t =>
      pc.addTrack(t, localStreamRef.current)
    );

    await pc.setRemoteDescription(offer);

    if (pendingIceRef.current[from]) {
      pendingIceRef.current[from].forEach(c => pc.addIceCandidate(c));
      delete pendingIceRef.current[from];
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socketRef.current.emit("webrtc-answer", { to: from, answer });

    peersRef.current[from] = pc;
  }

  async function handleAnswer({ from, answer }) {
    console.log("RECEIVED ANSWER FROM", from);
    const pc = peersRef.current[from];
    if (!pc || pc.signalingState !== "have-local-offer") return;
    await pc.setRemoteDescription(answer);
  }

  async function handleIce({ from, candidate }) {
    const pc = peersRef.current[from];

    if (pc && pc.remoteDescription) {
      await pc.addIceCandidate(candidate);
    } else {
      if (!pendingIceRef.current[from]) pendingIceRef.current[from] = [];
      pendingIceRef.current[from].push(candidate);
    }
  }

  // ---------- UI ----------

  return (
    <div style={{ textAlign: "center", marginTop: 20 }}>
      <button onClick={enableAudio}>
        Enable Microphone & Audio
      </button>

      <canvas
        ref={canvasRef}
        width={600}
        height={600}
        style={{ border: "1px solid black", marginTop: 10 }}
      />

      <div style={{ marginTop: 10 }}>
        <button onClick={() => move(0, -10)}>Up</button>
        <button onClick={() => move(0, 10)}>Down</button>
        <button onClick={() => move(-10, 0)}>Left</button>
        <button onClick={() => move(10, 0)}>Right</button>
      </div>
    </div>
  );
}
