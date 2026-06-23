const joinForm = document.querySelector("#joinForm");
const roomCodeInput = document.querySelector("#roomCode");
const roomPasswordInput = document.querySelector("#roomPassword");
const microphoneSelect = document.querySelector("#microphoneSelect");
const refreshDevicesButton = document.querySelector("#refreshDevicesButton");
const testMicrophoneButton = document.querySelector("#testMicrophoneButton");
const joinButton = document.querySelector("#joinButton");
const leaveButton = document.querySelector("#leaveButton");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const messageText = document.querySelector("#messageText");
const remoteAudio = document.querySelector("#remoteAudio");
const volumeSlider = document.querySelector("#volumeSlider");
const volumeValue = document.querySelector("#volumeValue");
const inputLevelBar = document.querySelector("#inputLevelBar");
const openRoomsList = document.querySelector("#openRoomsList");
const openRoomsEmpty = document.querySelector("#openRoomsEmpty");
const refreshRoomsButton = document.querySelector("#refreshRoomsButton");

const reconnectBaseDelayMs = 600;
const reconnectMaxDelayMs = 6000;
const pendingIceCandidates = [];

let ws = null;
let pc = null;
let localStream = null;
let selectedRoomCode = "";
let selectedRoomPassword = "";
let shouldReconnect = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let audioContext = null;
let analyser = null;
let meterSource = null;
let meterFrame = null;
let meterData = null;

const rtcConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const statuses = {
  idle: "Inte ansluten",
  connecting: "Ansluter",
  waiting: "Väntar på deltagare",
  connected: "Ansluten",
  disconnected: "Frånkopplad",
  error: "Fel"
};

function setStatus(status, detail = "") {
  statusText.textContent = detail || statuses[status] || status;
  statusDot.className = `status-dot ${status}`;
}

function setMessage(message = "", isError = false) {
  messageText.textContent = message;
  messageText.classList.toggle("error", isError);
}

function setConnectedControls(isConnected) {
  joinButton.disabled = isConnected;
  leaveButton.disabled = !isConnected;
  roomCodeInput.disabled = isConnected;
  roomPasswordInput.disabled = isConnected;
  microphoneSelect.disabled = isConnected;
  refreshDevicesButton.disabled = isConnected;
  testMicrophoneButton.disabled = isConnected;
}

function websocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function sendSignal(message) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");
    const currentValue = microphoneSelect.value;

    microphoneSelect.innerHTML = "";

    if (microphones.length === 0) {
      microphoneSelect.append(new Option("Ingen mikrofon hittades", ""));
      return;
    }

    microphones.forEach((device, index) => {
      const label = device.label || (index === 0 ? "Standardmikrofon" : `Mikrofon ${index + 1}`);
      microphoneSelect.append(new Option(label, device.deviceId));
    });

    if ([...microphoneSelect.options].some((option) => option.value === currentValue)) {
      microphoneSelect.value = currentValue;
    }
  } catch (error) {
    setMessage("Kunde inte läsa mikrofonlistan.", true);
  }
}

function selectedDeviceMatchesCurrentStream() {
  const track = localStream?.getAudioTracks()[0];

  if (!track || track.readyState !== "live") {
    return false;
  }

  const selectedDeviceId = microphoneSelect.value;
  const activeDeviceId = track.getSettings().deviceId;

  return !selectedDeviceId || !activeDeviceId || selectedDeviceId === activeDeviceId;
}

function audioConstraints(deviceId) {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    },
    video: false
  };
}

function microphoneErrorMessage(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Mikrofonåtkomst nekades. Tillåt mikrofonen i webbläsaren och operativsystemet.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Ingen mikrofon hittades.";
    case "NotReadableError":
    case "TrackStartError":
      return "Mikrofonen används redan eller kunde inte startas.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Den valda mikrofonen kunde inte användas. Välj en annan mikrofon.";
    case "AbortError":
      return "Mikrofonstarten avbröts av webbläsaren.";
    default:
      return `Mikrofonåtkomst misslyckades${error?.name ? ` (${error.name})` : ""}.`;
  }
}

async function getLocalAudioStream() {
  if (selectedDeviceMatchesCurrentStream()) {
    return localStream;
  }

  cleanupLocalStream();

  const deviceId = microphoneSelect.value;
  try {
    localStream = await navigator.mediaDevices.getUserMedia(audioConstraints(deviceId));
  } catch (error) {
    if (!deviceId || !["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError"].includes(error?.name)) {
      throw error;
    }

    microphoneSelect.value = "";
    localStream = await navigator.mediaDevices.getUserMedia(audioConstraints(""));
  }

  await refreshDevices();
  startInputMeter(localStream);
  return localStream;
}

function startInputMeter(stream) {
  stopInputMeter();

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return;
  }

  audioContext = new AudioContextCtor();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.72;
  meterData = new Uint8Array(analyser.fftSize);
  meterSource = audioContext.createMediaStreamSource(stream);
  meterSource.connect(analyser);

  const draw = () => {
    analyser.getByteTimeDomainData(meterData);

    let sum = 0;
    for (const sample of meterData) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(sum / meterData.length);
    inputLevelBar.style.width = `${Math.min(100, Math.round(rms * 260))}%`;
    meterFrame = window.requestAnimationFrame(draw);
  };

  draw();
}

function stopInputMeter() {
  if (meterFrame) {
    window.cancelAnimationFrame(meterFrame);
    meterFrame = null;
  }

  meterSource?.disconnect();
  meterSource = null;
  analyser = null;
  meterData = null;
  inputLevelBar.style.width = "0%";

  const contextToClose = audioContext;
  audioContext = null;

  if (contextToClose && contextToClose.state !== "closed") {
    contextToClose.close();
  }
}

function createPeerConnection() {
  if (pc) {
    return pc;
  }

  pc = new RTCPeerConnection(rtcConfiguration);

  localStream?.getAudioTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  pc.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }

    sendSignal({
      type: "ice-candidate",
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex
    });
  };

  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    remoteAudio.srcObject = remoteStream;
  };

  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === "connected") {
      setStatus("connected");
      setMessage("");
    }

    if (["failed", "disconnected", "closed"].includes(pc?.connectionState)) {
      if (shouldReconnect) {
        setStatus("waiting");
      }
    }
  };

  return pc;
}

function cleanupPeerConnection() {
  pendingIceCandidates.length = 0;
  remoteAudio.srcObject = null;

  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
    pc = null;
  }
}

function cleanupLocalStream() {
  stopInputMeter();

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
}

async function flushPendingIceCandidates() {
  if (!pc?.remoteDescription) {
    return;
  }

  while (pendingIceCandidates.length > 0) {
    await pc.addIceCandidate(pendingIceCandidates.shift());
  }
}

async function createAndSendOffer() {
  const peerConnection = createPeerConnection();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  sendSignal({ type: "offer", sdp: offer.sdp });
}

async function handleOffer(message) {
  const peerConnection = createPeerConnection();
  await peerConnection.setRemoteDescription({ type: "offer", sdp: message.sdp });
  await flushPendingIceCandidates();

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  sendSignal({ type: "answer", sdp: answer.sdp });
}

async function handleAnswer(message) {
  if (!pc) {
    return;
  }

  await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
  await flushPendingIceCandidates();
}

async function handleIceCandidate(message) {
  const candidate = new RTCIceCandidate({
    candidate: message.candidate,
    sdpMid: message.sdpMid,
    sdpMLineIndex: message.sdpMLineIndex
  });

  if (pc?.remoteDescription) {
    await pc.addIceCandidate(candidate);
  } else {
    pendingIceCandidates.push(candidate);
  }
}

async function refreshOpenRooms() {
  try {
    const response = await fetch("/api/open-rooms", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const rooms = await response.json();
    renderOpenRooms(rooms);
  } catch (error) {
    openRoomsList.innerHTML = "";
    openRoomsEmpty.textContent = "Kunde inte hämta öppna rum.";
    openRoomsEmpty.hidden = false;
  }
}

function renderOpenRooms(rooms) {
  openRoomsList.innerHTML = "";
  openRoomsEmpty.textContent = "Inga öppna rum just nu.";
  openRoomsEmpty.hidden = rooms.length > 0;

  rooms.forEach((room) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "room-button";
    button.disabled = shouldReconnect;
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = room.name || room.roomCode;
    button.querySelector("span").textContent = `${room.participantCount}/2`;
    button.addEventListener("click", async () => {
      roomCodeInput.value = room.roomCode;
      roomPasswordInput.value = "";
      await connect(room.roomCode, "");
    });
    openRoomsList.append(button);
  });
}

function scheduleReconnect() {
  if (!shouldReconnect || reconnectTimer) {
    return;
  }

  const delay = Math.min(reconnectBaseDelayMs * 2 ** reconnectAttempts, reconnectMaxDelayMs);
  reconnectAttempts += 1;

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

function connectWebSocket() {
  if (ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(ws.readyState)) {
    return;
  }

  setStatus("connecting");
  setMessage("");
  ws = new WebSocket(websocketUrl());

  ws.addEventListener("open", () => {
    reconnectAttempts = 0;
    sendSignal({
      type: "join-room",
      roomCode: selectedRoomCode,
      password: selectedRoomPassword
    });
  });

  ws.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);

    try {
      switch (message.type) {
        case "joined-room":
          setStatus(message.participantCount === 2 ? "connecting" : "waiting");
          setConnectedControls(true);
          setMessage(`Rum ${message.roomCode}`);
          await refreshOpenRooms();
          break;

        case "peer-joined":
          setStatus("connecting");
          cleanupPeerConnection();
          createPeerConnection();
          if (message.initiator) {
            await createAndSendOffer();
          }
          break;

        case "offer":
          await handleOffer(message);
          break;

        case "answer":
          await handleAnswer(message);
          break;

        case "ice-candidate":
          await handleIceCandidate(message);
          break;

        case "leave-room":
          cleanupPeerConnection();
          setStatus("waiting");
          setMessage("Den andra deltagaren lämnade rummet.");
          await refreshOpenRooms();
          break;

        case "error":
          setStatus("error");
          setMessage(message.message || "Något gick fel.", true);
          if (message.message?.includes("fullt") || message.message?.includes("lösenord")) {
            disconnect(false, "error", message.message, true);
          }
          break;
      }
    } catch (error) {
      setStatus("error");
      setMessage("WebRTC-signalering misslyckades.", true);
      console.error(error);
    }
  });

  ws.addEventListener("close", () => {
    ws = null;
    cleanupPeerConnection();

    if (shouldReconnect) {
      setStatus("connecting", "Ansluter");
      setMessage("Signaleringen tappades. Försöker återansluta...");
      scheduleReconnect();
    } else if (!statusDot.classList.contains("error")) {
      setStatus("disconnected");
    }
  });

  ws.addEventListener("error", () => {
    ws?.close();
  });
}

async function connect(roomCode, password) {
  selectedRoomCode = roomCode.trim().toUpperCase();
  selectedRoomPassword = password.trim();
  shouldReconnect = true;
  reconnectAttempts = 0;
  setConnectedControls(true);
  setStatus("connecting");
  setMessage("");

  try {
    await getLocalAudioStream();
    connectWebSocket();
  } catch (error) {
    shouldReconnect = false;
    setConnectedControls(false);
    setStatus("error");
    setMessage(microphoneErrorMessage(error), true);
    console.error(error);
  }
}

async function testMicrophone() {
  try {
    await getLocalAudioStream();
    setMessage("Mikrofontest aktivt.");
  } catch (error) {
    setStatus("error");
    setMessage(microphoneErrorMessage(error), true);
    console.error(error);
  }
}

function disconnect(notifyServer = true, finalStatus = "disconnected", finalMessage = "", isError = false) {
  shouldReconnect = false;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (notifyServer) {
    sendSignal({ type: "leave-room" });
  }

  ws?.close();
  ws = null;
  cleanupPeerConnection();
  cleanupLocalStream();
  setConnectedControls(false);
  setStatus(finalStatus);
  setMessage(finalMessage, isError);
  refreshOpenRooms();
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const roomCode = roomCodeInput.value;
  if (!roomCode.trim()) {
    setStatus("error");
    setMessage("Ange en rumskod.", true);
    return;
  }

  await connect(roomCode, roomPasswordInput.value);
});

leaveButton.addEventListener("click", () => disconnect(true));

refreshDevicesButton.addEventListener("click", async () => {
  await refreshDevices();
});

testMicrophoneButton.addEventListener("click", testMicrophone);

microphoneSelect.addEventListener("change", () => {
  if (localStream && !shouldReconnect) {
    getLocalAudioStream();
  }
});

refreshRoomsButton.addEventListener("click", refreshOpenRooms);

volumeSlider.addEventListener("input", () => {
  const volume = Number(volumeSlider.value);
  remoteAudio.volume = volume / 100;
  volumeValue.textContent = `${volume}%`;
});

window.addEventListener("beforeunload", () => {
  sendSignal({ type: "leave-room" });
});

if (!("mediaDevices" in navigator) || !("getUserMedia" in navigator.mediaDevices) || !("RTCPeerConnection" in window)) {
  setStatus("error");
  setMessage("Din webbläsare saknar stöd för WebRTC eller mikrofonåtkomst.", true);
  setConnectedControls(false);
  joinButton.disabled = true;
  testMicrophoneButton.disabled = true;
} else {
  refreshDevices();
  refreshOpenRooms();
  window.setInterval(() => {
    if (!shouldReconnect) {
      refreshOpenRooms();
    }
  }, 5000);
}
