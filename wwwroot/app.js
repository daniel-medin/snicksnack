const joinForm = document.querySelector("#joinForm");
const displayNameInput = document.querySelector("#displayName");
const roomCodeInput = document.querySelector("#roomCode");
const roomPasswordInput = document.querySelector("#roomPassword");
const microphoneSelect = document.querySelector("#microphoneSelect");
const refreshDevicesButton = document.querySelector("#refreshDevicesButton");
const testMicrophoneButton = document.querySelector("#testMicrophoneButton");
const joinButton = document.querySelector("#joinButton");
const leaveButton = document.querySelector("#leaveButton");
const roomSettingsButton = document.querySelector("#roomSettingsButton");
const roomSettingsPanel = document.querySelector("#roomSettingsPanel");
const roomMicrophoneSelect = document.querySelector("#roomMicrophoneSelect");
const refreshRoomDevicesButton = document.querySelector("#refreshRoomDevicesButton");
const muteToggleButton = document.querySelector("#muteToggleButton");
const muteStateText = document.querySelector("#muteStateText");
const pushToTalkToggleButton = document.querySelector("#pushToTalkToggleButton");
const pushToTalkStateText = document.querySelector("#pushToTalkStateText");
const bindPushToTalkButton = document.querySelector("#bindPushToTalkButton");
const pushToTalkKeyText = document.querySelector("#pushToTalkKeyText");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const messageText = document.querySelector("#messageText");
const remoteAudioContainer = document.querySelector("#remoteAudioContainer");
const volumeSlider = document.querySelector("#volumeSlider");
const volumeValue = document.querySelector("#volumeValue");
const inputLevelBar = document.querySelector("#inputLevelBar");
const inputLevelMeter = document.querySelector("#inputLevelMeter");
const roomInputLevelBar = document.querySelector("#roomInputLevelBar");
const roomInputLevelMeter = document.querySelector("#roomInputLevelMeter");
const remoteParticipantsList = document.querySelector("#remoteParticipantsList");
const participantCountText = document.querySelector("#participantCountText");
const musicToggleButton = document.querySelector("#musicToggleButton");
const musicControls = document.querySelector("#musicControls");
const musicInputSelect = document.querySelector("#musicInputSelect");
const refreshMusicDevicesButton = document.querySelector("#refreshMusicDevicesButton");
const startMusicButton = document.querySelector("#startMusicButton");
const stopMusicButton = document.querySelector("#stopMusicButton");
const musicStatusText = document.querySelector("#musicStatusText");
const musicLevelBar = document.querySelector("#musicLevelBar");
const musicLevelMeter = document.querySelector("#musicLevelMeter");
const chatStatusText = document.querySelector("#chatStatusText");
const chatMessages = document.querySelector("#chatMessages");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatSendButton = document.querySelector("#chatSendButton");
const chatImagePreview = document.querySelector("#chatImagePreview");
let pendingImage = null;
const openRoomsList = document.querySelector("#openRoomsList");
const openRoomsEmpty = document.querySelector("#openRoomsEmpty");
const refreshRoomsButton = document.querySelector("#refreshRoomsButton");
const lobbyPanel = document.querySelector("#lobbyPanel");
const roomPanel = document.querySelector("#roomPanel");
const appShell = document.querySelector("#appShell");
const activeRoomTitle = document.querySelector("#activeRoomTitle");
const lobbyMessageText = document.querySelector("#lobbyMessageText");

const reconnectBaseDelayMs = 600;
const reconnectMaxDelayMs = 6000;
const messageSoundUrl = "/assets/duck.mp3";
const pushToTalkStorageKey = "snicksnackPushToTalkKey";

let ws = null;
let ownPeerId = "";
let localStream = null;
let selectedRoomCode = "";
let selectedRoomPassword = "";
let selectedDisplayName = "";
let shouldReconnect = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let audioContext = null;
let analyser = null;
let meterSource = null;
let meterFrame = null;
let meterData = null;
let musicStream = null;
let musicMixContext = null;
let musicMicSource = null;
let musicSource = null;
let musicAnalyser = null;
let musicGain = null;
let musicDestination = null;
let musicMeterFrame = null;
let musicMeterData = null;
let mixedAudioTrack = null;
let isStoppingMusic = false;
let chatConnection = null;
let isMuted = false;
let isPushToTalkEnabled = false;
let isPushToTalkPressed = false;
let isBindingPushToTalkKey = false;
let pushToTalkBinding = loadPushToTalkBinding();
let editingMessageId = null;
const peerConnections = new Map();
const pendingIceCandidates = new Map();
const remoteAudioElements = new Map();
const remoteParticipants = new Map();
const chatMessageElements = new Map();
const ownChatMessageIds = [];
let remoteParticipantCounter = 0;

const rtcConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

if (window.marked) {
  const renderer = new marked.Renderer();
  const _link = renderer.link.bind(renderer);
  renderer.link = (href, title, text) =>
    _link(href, title, text).replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
  marked.use({ renderer, breaks: true, gfm: true });
}

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
  const target = roomPanel.hidden ? lobbyMessageText : messageText;
  target.textContent = message;
  target.classList.toggle("error", isError);

  const otherTarget = target === messageText ? lobbyMessageText : messageText;
  otherTarget.textContent = "";
  otherTarget.classList.remove("error");
}

function setConnectedControls(isConnected) {
  joinButton.disabled = isConnected;
  displayNameInput.disabled = isConnected;
  roomCodeInput.disabled = isConnected;
  roomPasswordInput.disabled = isConnected;
  microphoneSelect.disabled = isConnected;
  refreshDevicesButton.disabled = isConnected;
  testMicrophoneButton.disabled = isConnected;
}

function loadPushToTalkBinding() {
  try {
    const stored = window.localStorage?.getItem(pushToTalkStorageKey);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function savePushToTalkBinding(binding) {
  pushToTalkBinding = binding;

  try {
    if (binding) {
      window.localStorage?.setItem(pushToTalkStorageKey, JSON.stringify(binding));
    } else {
      window.localStorage?.removeItem(pushToTalkStorageKey);
    }
  } catch {
    // Local storage can be blocked; binding still works for this session.
  }
}

function keyDisplayName(event) {
  if (event.code === "Space") {
    return "Mellanslag";
  }

  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.slice(3);
  }

  if (/^Digit\d$/.test(event.code)) {
    return event.code.slice(5);
  }

  return event.key?.length === 1 ? event.key.toUpperCase() : event.key || event.code;
}

function isTypingTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function setMeterLevel(bar, meter, level) {
  bar.style.width = `${level}%`;
  meter.setAttribute("aria-valuenow", String(level));
}

function updateParticipantCount() {
  const count = 1 + remoteParticipants.size;
  participantCountText.textContent = count === 1 ? "1 ansluten" : `${count} anslutna`;
}

function normalizeDisplayName(displayName) {
  return displayName.trim().replace(/\s+/g, " ");
}

function isValidDisplayName(displayName) {
  const normalized = normalizeDisplayName(displayName);
  return normalized.length >= 2
    && normalized.length <= 24
    && /^[\p{L}\p{N} ._-]+$/u.test(normalized);
}

function displayNameErrorMessage() {
  return "Ange ett namn med 2-24 tecken. Bokstäver, siffror, mellanslag, punkt, bindestreck och understreck funkar.";
}

function showLobby() {
  appShell.classList.remove("in-room");
  lobbyPanel.hidden = false;
  roomPanel.hidden = true;
  setRoomSettingsOpen(false);
  activeRoomTitle.textContent = "Rum";
}

function showRoom(roomCode) {
  activeRoomTitle.textContent = `Rum ${roomCode}`;
  appShell.classList.add("in-room");
  lobbyPanel.hidden = true;
  roomPanel.hidden = false;
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

function setRoomSettingsOpen(isOpen) {
  roomSettingsPanel.hidden = !isOpen;
  roomSettingsButton.setAttribute("aria-expanded", String(isOpen));
}

function fillMicrophoneSelect(select, microphones, selectedDeviceId) {
  select.innerHTML = "";

  if (microphones.length === 0) {
    select.append(new Option("Ingen mikrofon hittades", ""));
    return;
  }

  microphones.forEach((device, index) => {
    const label = device.label || (index === 0 ? "Standardmikrofon" : `Mikrofon ${index + 1}`);
    select.append(new Option(label, device.deviceId));
  });

  if ([...select.options].some((option) => option.value === selectedDeviceId)) {
    select.value = selectedDeviceId;
  }
}

function syncMicrophoneSelects(deviceId) {
  for (const select of [microphoneSelect, roomMicrophoneSelect]) {
    if ([...select.options].some((option) => option.value === deviceId)) {
      select.value = deviceId;
    }
  }
}

async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");
    const currentValue = microphoneSelect.value || roomMicrophoneSelect.value;

    fillMicrophoneSelect(microphoneSelect, microphones, currentValue);
    fillMicrophoneSelect(roomMicrophoneSelect, microphones, currentValue);
  } catch (error) {
    setMessage("Kunde inte läsa mikrofonlistan.", true);
  }
}

async function refreshMusicDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === "audioinput");
    const currentValue = musicInputSelect.value;

    musicInputSelect.innerHTML = "";

    if (audioInputs.length === 0) {
      musicInputSelect.dataset.hasDevices = "false";
      musicInputSelect.append(new Option("Ingen ljudingång hittades", ""));
      startMusicButton.disabled = true;
      return;
    }

    musicInputSelect.dataset.hasDevices = "true";
    audioInputs.forEach((device, index) => {
      const label = device.label || (index === 0 ? "Standardljudingång" : `Ljudingång ${index + 1}`);
      musicInputSelect.append(new Option(label, device.deviceId));
    });

    if ([...musicInputSelect.options].some((option) => option.value === currentValue)) {
      musicInputSelect.value = currentValue;
    }

    startMusicButton.disabled = Boolean(musicStream);
  } catch (error) {
    setMessage("Kunde inte läsa musikingångar.", true);
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

function musicAudioConstraints(deviceId) {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
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

  const deviceId = microphoneSelect.value;
  let nextStream = null;
  try {
    nextStream = await navigator.mediaDevices.getUserMedia(audioConstraints(deviceId));
  } catch (error) {
    if (!deviceId || !["OverconstrainedError", "ConstraintNotSatisfiedError", "NotFoundError"].includes(error?.name)) {
      throw error;
    }

    microphoneSelect.value = "";
    syncMicrophoneSelects("");
    nextStream = await navigator.mediaDevices.getUserMedia(audioConstraints(""));
  }

  cleanupLocalStream();
  localStream = nextStream;
  await refreshDevices();
  await refreshMusicDevices();
  startInputMeter(localStream);
  updateMicrophoneTransmission();
  return localStream;
}

async function changeMicrophone() {
  if (!localStream) {
    return;
  }

  roomMicrophoneSelect.disabled = true;
  refreshRoomDevicesButton.disabled = true;
  setMessage("");

  try {
    if (musicStream || mixedAudioTrack) {
      await stopMusicSharing("Musik pausad efter mikrofonbyte.");
    }

    await getLocalAudioStream();

    const microphoneTrack = getLocalAudioTrack();
    if (microphoneTrack) {
      await replaceOutgoingAudioTrack(microphoneTrack);
    }

    setMessage("Mikrofonen är bytt.");
  } catch (error) {
    syncMicrophoneSelects(getLocalAudioTrack()?.getSettings().deviceId || "");
    await refreshDevices();
    setStatus("error");
    setMessage(microphoneErrorMessage(error), true);
    console.error(error);
  } finally {
    roomMicrophoneSelect.disabled = false;
    refreshRoomDevicesButton.disabled = false;
  }
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
    const level = Math.min(100, Math.round(rms * 260));
    setMeterLevel(inputLevelBar, inputLevelMeter, level);
    setMeterLevel(roomInputLevelBar, roomInputLevelMeter, level);
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
  setMeterLevel(inputLevelBar, inputLevelMeter, 0);
  setMeterLevel(roomInputLevelBar, roomInputLevelMeter, 0);

  const contextToClose = audioContext;
  audioContext = null;

  if (contextToClose && contextToClose.state !== "closed") {
    contextToClose.close();
  }
}

function getLocalAudioTrack() {
  return localStream?.getAudioTracks()[0] || null;
}

function isMicrophoneOpen() {
  return !isMuted && (!isPushToTalkEnabled || isPushToTalkPressed);
}

function updateMicrophoneTransmission() {
  const track = getLocalAudioTrack();
  if (track) {
    track.enabled = isMicrophoneOpen();
  }

  muteToggleButton.setAttribute("aria-pressed", String(isMuted));
  muteStateText.textContent = isMuted ? "Av" : "På";
  pushToTalkToggleButton.setAttribute("aria-pressed", String(isPushToTalkEnabled));
  pushToTalkStateText.textContent = isPushToTalkEnabled ? "På" : "Av";

  if (isBindingPushToTalkKey) {
    pushToTalkKeyText.textContent = "Tryck en tangent...";
  } else {
    pushToTalkKeyText.textContent = pushToTalkBinding?.label || "Ingen tangent vald";
  }

  bindPushToTalkButton.classList.toggle("is-listening", isBindingPushToTalkKey);
}

function setMuted(nextMuted) {
  isMuted = nextMuted;
  updateMicrophoneTransmission();
}

function setPushToTalkEnabled(nextEnabled) {
  isPushToTalkEnabled = nextEnabled;
  isPushToTalkPressed = false;
  updateMicrophoneTransmission();
}

function getOutgoingAudioTrack() {
  return mixedAudioTrack || getLocalAudioTrack();
}

function getOutgoingAudioStream() {
  return musicDestination?.stream || localStream;
}

async function replaceOutgoingAudioTrack(track) {
  await Promise.all([...peerConnections.values()].map(async (peerConnection) => {
    const sender = peerConnection.getSenders().find((candidate) => candidate.track?.kind === "audio");
    if (sender) {
      await sender.replaceTrack(track);
    }
  }));
}

function setMusicControls(isPlaying) {
  startMusicButton.disabled = isPlaying || musicInputSelect.dataset.hasDevices !== "true";
  musicInputSelect.disabled = isPlaying;
  refreshMusicDevicesButton.disabled = isPlaying;
  stopMusicButton.disabled = !isPlaying;
}

function stopMusicMeter() {
  if (musicMeterFrame) {
    window.cancelAnimationFrame(musicMeterFrame);
    musicMeterFrame = null;
  }

  setMeterLevel(musicLevelBar, musicLevelMeter, 0);
  musicMeterData = null;
}

function cleanupMusicMix() {
  stopMusicMeter();

  musicMicSource?.disconnect();
  musicSource?.disconnect();
  musicAnalyser?.disconnect();
  musicGain?.disconnect();

  musicMicSource = null;
  musicSource = null;
  musicAnalyser = null;
  musicGain = null;
  musicDestination = null;

  if (mixedAudioTrack) {
    mixedAudioTrack.stop();
    mixedAudioTrack = null;
  }

  if (musicStream) {
    musicStream.getTracks().forEach((track) => track.stop());
    musicStream = null;
  }

  const contextToClose = musicMixContext;
  musicMixContext = null;

  if (contextToClose && contextToClose.state !== "closed") {
    contextToClose.close();
  }
}

function startMusicMix(stream) {
  cleanupMusicMix();

  const microphoneTrack = getLocalAudioTrack();
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!microphoneTrack || !AudioContextCtor) {
    throw new Error("Musikmix stöds inte i den här webbläsaren.");
  }

  musicStream = stream;
  musicMixContext = new AudioContextCtor();
  musicDestination = musicMixContext.createMediaStreamDestination();
  musicMicSource = musicMixContext.createMediaStreamSource(new MediaStream([microphoneTrack]));
  musicSource = musicMixContext.createMediaStreamSource(stream);
  musicAnalyser = musicMixContext.createAnalyser();
  musicGain = musicMixContext.createGain();

  musicAnalyser.fftSize = 256;
  musicAnalyser.smoothingTimeConstant = 0.72;
  musicMeterData = new Uint8Array(musicAnalyser.fftSize);
  musicGain.gain.value = 1;

  musicMicSource.connect(musicDestination);
  musicSource.connect(musicAnalyser);
  musicAnalyser.connect(musicGain);
  musicGain.connect(musicDestination);

  mixedAudioTrack = musicDestination.stream.getAudioTracks()[0];
  musicMixContext.resume?.().catch(() => {});

  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", () => {
      if (!isStoppingMusic) {
        stopMusicSharing("Musikströmmen stoppades.");
      }
    });
  }

  const draw = () => {
    if (!musicAnalyser || !musicMeterData) {
      return;
    }

    musicAnalyser.getByteTimeDomainData(musicMeterData);

    let sum = 0;
    for (const sample of musicMeterData) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(sum / musicMeterData.length);
    const level = Math.min(100, Math.round(rms * 260));
    setMeterLevel(musicLevelBar, musicLevelMeter, level);
    musicMeterFrame = window.requestAnimationFrame(draw);
  };

  draw();
}

async function startMusicSharing() {
  if (musicStream) {
    return;
  }

  if (!localStream) {
    setMessage("Starta rummet först så mikrofonen finns i mixen.", true);
    return;
  }

  setMessage("");
  startMusicButton.disabled = true;
  musicStatusText.textContent = "Startar musik...";

  try {
    const deviceId = musicInputSelect.value;
    const stream = await navigator.mediaDevices.getUserMedia(musicAudioConstraints(deviceId));
    startMusicMix(stream);

    if (mixedAudioTrack) {
      await replaceOutgoingAudioTrack(mixedAudioTrack);
    }

    await refreshMusicDevices();
    setMusicControls(true);
    musicStatusText.textContent = "Musik streamas";
    setMessage("Musiken streamas från din valda ingång.");
  } catch (error) {
    cleanupMusicMix();
    setMusicControls(false);
    musicStatusText.textContent = "Ingen musik streamas";
    setMessage(`Musikingången kunde inte startas${error?.name ? ` (${error.name})` : ""}.`, true);
    console.error(error);
  }
}

async function stopMusicSharing(musicText = "Ingen musik streamas") {
  if (!musicStream && !mixedAudioTrack) {
    musicStatusText.textContent = musicText;
    setMusicControls(false);
    return;
  }

  isStoppingMusic = true;
  try {
    const microphoneTrack = getLocalAudioTrack();
    if (microphoneTrack) {
      await replaceOutgoingAudioTrack(microphoneTrack);
    }
  } finally {
    cleanupMusicMix();
    isStoppingMusic = false;
    setMusicControls(false);
    musicStatusText.textContent = musicText;
  }
}

function setChatControls(isConnected, status = "") {
  chatInput.contentEditable = isConnected ? "true" : "false";
  chatSendButton.disabled = !isConnected;
  chatStatusText.textContent = status || (isConnected ? "Ansluten" : "Inte ansluten");

  if (!isConnected) {
    clearEditingState();
  }
}

function formatChatTime(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

function renderChatText(element, raw) {
  if (window.marked && window.DOMPurify) {
    element.innerHTML = DOMPurify.sanitize(marked.parse(raw));
  } else {
    element.textContent = raw;
  }
}

function setChatDraft(text) {
  chatInput.textContent = text || "";
}

function getChatDraft() {
  return chatInput.innerText.replace(/\u00a0/g, " ").trim();
}

function focusChatInputAtEnd() {
  chatInput.focus();

  const range = document.createRange();
  range.selectNodeContents(chatInput);
  range.collapse(false);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function clearEditingState() {
  editingMessageId = null;
  chatForm.classList.remove("is-editing");
  chatSendButton.textContent = "Skicka";
  chatInput.dataset.placeholder = "Skriv ett meddelande (Shift+Enter för ny rad)";
}

function resetChatState() {
  chatMessages.replaceChildren();
  chatMessageElements.clear();
  ownChatMessageIds.length = 0;
  clearEditingState();
}

function startEditingMessage(messageId) {
  const record = chatMessageElements.get(messageId);
  if (!record?.isOwn) {
    return;
  }

  editingMessageId = messageId;
  pendingImage = null;
  clearChatImagePreview();
  setChatDraft(record.rawText);
  chatForm.classList.add("is-editing");
  chatSendButton.textContent = "Spara";
  chatInput.dataset.placeholder = "Redigera meddelande";
  focusChatInputAtEnd();
}

function startEditingLatestOwnMessage() {
  for (let index = ownChatMessageIds.length - 1; index >= 0; index -= 1) {
    const messageId = ownChatMessageIds[index];
    if (chatMessageElements.has(messageId)) {
      startEditingMessage(messageId);
      return true;
    }
  }

  return false;
}

function appendChatMessage(message, isOwn) {
  const messageId = message.id || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const item = document.createElement("article");
  item.className = `chat-message ${isOwn ? "own" : "incoming"}`;
  item.dataset.messageId = messageId;

  const meta = document.createElement("span");
  const time = formatChatTime(message.sentAt);
  meta.textContent = `${isOwn ? "Du" : (message.senderName || "Deltagare")}${time ? ` ${time}` : ""}`;

  const body = document.createElement("div");
  body.className = "chat-message-body";

  const text = document.createElement("p");
  const raw = message.text || "";
  renderChatText(text, raw);
  body.append(text);

  if (isOwn) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "chat-edit-button";
    editButton.title = "Redigera meddelande";
    editButton.setAttribute("aria-label", "Redigera meddelande");
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => startEditingMessage(messageId));
    body.append(editButton);

    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      startEditingMessage(messageId);
    });

    ownChatMessageIds.push(messageId);
  }

  const edited = document.createElement("small");
  edited.className = "chat-edited-text";
  if (message.editedAt) {
    edited.textContent = `Redigerat ${formatChatTime(message.editedAt)}`;
  }

  item.append(meta, body, edited);
  chatMessages.append(item);
  chatMessageElements.set(messageId, {
    item,
    text,
    edited,
    rawText: raw,
    isOwn
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateChatMessage(message) {
  const messageId = message.id;
  const record = messageId ? chatMessageElements.get(messageId) : null;
  if (!record) {
    appendChatMessage(message, message.senderId === chatConnection?.connectionId);
    return;
  }

  record.rawText = message.text || "";
  renderChatText(record.text, record.rawText);
  record.edited.textContent = message.editedAt ? `Redigerat ${formatChatTime(message.editedAt)}` : "";
}

function playQuack() {
  const sound = new Audio(messageSoundUrl);
  sound.volume = 0.65;
  sound.play().catch(() => {});
}

async function startChatConnection(roomCode) {
  if (!window.signalR) {
    setChatControls(false, "SignalR saknas");
    return;
  }

  await stopChatConnection();
  resetChatState();
  setChatControls(false, "Ansluter");

  chatConnection = new signalR.HubConnectionBuilder()
    .withUrl("/chatHub")
    .withAutomaticReconnect()
    .build();

  chatConnection.on("ReceiveMessage", (message) => {
    const isOwn = message.senderId === chatConnection?.connectionId;
    appendChatMessage(message, isOwn);

    if (!isOwn) {
      playQuack();
    }
  });

  chatConnection.on("ReceiveMessageEdited", (message) => {
    updateChatMessage(message);
  });

  chatConnection.onreconnecting(() => {
    setChatControls(false, "Återansluter");
  });

  chatConnection.onreconnected(async () => {
    try {
      await chatConnection.invoke("JoinRoom", roomCode, selectedRoomPassword, selectedDisplayName);
      setChatControls(true);
    } catch (error) {
      setChatControls(false, "Chatfel");
      console.error(error);
    }
  });

  chatConnection.onclose(() => {
    setChatControls(false);
  });

  try {
    await chatConnection.start();
    await chatConnection.invoke("JoinRoom", roomCode, selectedRoomPassword, selectedDisplayName);
    setChatControls(true);
  } catch (error) {
    setChatControls(false, "Chatfel");
    console.error(error);
  }
}

async function stopChatConnection() {
  const connection = chatConnection;
  chatConnection = null;
  setChatControls(false);
  resetChatState();

  if (connection) {
    await connection.stop().catch(() => {});
  }
}

async function sendChatMessage() {
  const text = getChatDraft();
  const image = pendingImage;
  if (!text && !image) {
    return;
  }

  if (!chatConnection || chatConnection.state !== signalR.HubConnectionState.Connected) return;

  const imageMarkdown = image ? `![bild](${image})` : "";
  const message = [text, imageMarkdown].filter(Boolean).join("\n\n");

  try {
    if (editingMessageId) {
      await chatConnection.invoke("EditMessage", editingMessageId, message);
      clearEditingState();
    } else {
      await chatConnection.invoke("SendMessage", message);
    }

    setChatDraft("");
    clearChatImagePreview();
  } catch (error) {
    setMessage("Kunde inte skicka chattmeddelandet.", true);
    console.error(error);
  }
}

function showChatImagePreview(dataUrl) {
  const thumb = document.createElement("img");
  thumb.src = dataUrl;
  thumb.alt = "Bild att skicka";
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-image-btn";
  removeBtn.textContent = "X";
  removeBtn.addEventListener("click", clearChatImagePreview);
  chatImagePreview.replaceChildren(thumb, removeBtn);
}

function clearChatImagePreview() {
  pendingImage = null;
  chatImagePreview.replaceChildren();
}

function createPeerConnection(peerId) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const peerConnection = new RTCPeerConnection(rtcConfiguration);
  peerConnections.set(peerId, peerConnection);
  getRemoteParticipant(peerId);

  const outgoingTrack = getOutgoingAudioTrack();
  const outgoingStream = getOutgoingAudioStream();
  if (outgoingTrack && outgoingStream) {
    peerConnection.addTrack(outgoingTrack, outgoingStream);
  }

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }

    sendSignal({
      type: "ice-candidate",
      peerId,
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex
    });
  };

  peerConnection.ontrack = (event) => {
    const remoteStream = event.streams[0] || new MediaStream([event.track]);
    const audio = getRemoteAudioElement(peerId);
    audio.srcObject = remoteStream;
    startRemoteMeter(peerId, remoteStream);
  };

  peerConnection.onconnectionstatechange = () => {
    if ([...peerConnections.values()].some((connection) => connection.connectionState === "connected")) {
      setStatus("connected");
      setMessage("");
    }

    if (["failed", "disconnected", "closed"].includes(peerConnection.connectionState) && shouldReconnect) {
      setStatus("waiting");
    }
  };

  return peerConnection;
}

function getRemoteAudioElement(peerId) {
  return getRemoteParticipant(peerId).audio;
}

function getRemoteParticipant(peerId, displayName = "") {
  if (remoteParticipants.has(peerId)) {
    const participant = remoteParticipants.get(peerId);
    if (displayName) {
      participant.name.textContent = displayName;
      participant.meter.setAttribute("aria-label", `Ljudnivå för ${displayName}`);
      participant.volumeSlider.setAttribute("aria-label", `Volym för ${displayName}`);
    }
    return participant;
  }

  const participantNumber = ++remoteParticipantCounter;
  const participantName = displayName || `Deltagare ${participantNumber}`;

  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.playsInline = true;
  audio.volume = Number(volumeSlider.value) / 100;

  const card = document.createElement("article");
  card.className = "participant-card remote-participant";

  const info = document.createElement("div");
  info.className = "participant-info";

  const name = document.createElement("strong");
  name.textContent = participantName;

  const status = document.createElement("span");
  status.textContent = "Ansluter ljud";

  info.append(name, status);

  const meter = document.createElement("div");
  meter.className = "level-meter participant-meter";
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-label", `Ljudnivå för ${participantName}`);
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", "0");

  const levelBar = document.createElement("span");
  meter.append(levelBar);

  const volumeGroup = document.createElement("label");
  volumeGroup.className = "participant-volume";

  const volumeHeader = document.createElement("span");
  volumeHeader.className = "participant-volume-header";

  const volumeText = document.createElement("span");
  volumeText.textContent = "Volym";

  const volumeValueText = document.createElement("output");
  volumeValueText.textContent = `${volumeSlider.value}%`;

  volumeHeader.append(volumeText, volumeValueText);

  const participantVolumeSlider = document.createElement("input");
  participantVolumeSlider.type = "range";
  participantVolumeSlider.min = "0";
  participantVolumeSlider.max = "100";
  participantVolumeSlider.value = volumeSlider.value;
  participantVolumeSlider.setAttribute("aria-label", `Volym för ${participantName}`);

  participantVolumeSlider.addEventListener("input", () => {
    const volume = Number(participantVolumeSlider.value);
    audio.volume = volume / 100;
    volumeValueText.textContent = `${volume}%`;
  });

  volumeGroup.append(volumeHeader, participantVolumeSlider);
  card.append(info, meter, volumeGroup);

  const participant = {
    audio,
    card,
    name,
    status,
    meter,
    levelBar,
    volumeSlider: participantVolumeSlider,
    volumeValueText,
    audioContext: null,
    analyser: null,
    meterSource: null,
    meterFrame: null,
    meterData: null
  };

  remoteParticipants.set(peerId, participant);
  remoteAudioElements.set(peerId, audio);
  remoteAudioContainer.append(audio);
  remoteParticipantsList.append(card);
  updateParticipantCount();

  return participant;
}

function startRemoteMeter(peerId, stream) {
  const participant = getRemoteParticipant(peerId);
  participant.status.textContent = "Ljud anslutet";
  stopRemoteMeter(participant);

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return;
  }

  const remoteAudioContext = new AudioContextCtor();
  const remoteAnalyser = remoteAudioContext.createAnalyser();
  remoteAnalyser.fftSize = 256;
  remoteAnalyser.smoothingTimeConstant = 0.72;

  const remoteMeterData = new Uint8Array(remoteAnalyser.fftSize);
  const remoteMeterSource = remoteAudioContext.createMediaStreamSource(stream);
  remoteMeterSource.connect(remoteAnalyser);
  remoteAudioContext.resume?.().catch(() => {});

  participant.audioContext = remoteAudioContext;
  participant.analyser = remoteAnalyser;
  participant.meterSource = remoteMeterSource;
  participant.meterData = remoteMeterData;

  const draw = () => {
    remoteAnalyser.getByteTimeDomainData(remoteMeterData);

    let sum = 0;
    for (const sample of remoteMeterData) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }

    const rms = Math.sqrt(sum / remoteMeterData.length);
    const level = Math.min(100, Math.round(rms * 260));
    setMeterLevel(participant.levelBar, participant.meter, level);
    participant.meterFrame = window.requestAnimationFrame(draw);
  };

  draw();
}

function stopRemoteMeter(participant) {
  if (participant.meterFrame) {
    window.cancelAnimationFrame(participant.meterFrame);
    participant.meterFrame = null;
  }

  participant.meterSource?.disconnect();
  participant.meterSource = null;
  participant.analyser = null;
  participant.meterData = null;
  setMeterLevel(participant.levelBar, participant.meter, 0);

  const contextToClose = participant.audioContext;
  participant.audioContext = null;

  if (contextToClose && contextToClose.state !== "closed") {
    contextToClose.close();
  }
}

function cleanupPeerConnection(peerId) {
  const peerConnection = peerConnections.get(peerId);
  pendingIceCandidates.delete(peerId);

  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.ontrack = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnections.delete(peerId);
  }

  const audio = remoteAudioElements.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudioElements.delete(peerId);
  }

  const participant = remoteParticipants.get(peerId);
  if (participant) {
    stopRemoteMeter(participant);
    participant.card.remove();
    remoteParticipants.delete(peerId);
    updateParticipantCount();
  }
}

function cleanupPeerConnections() {
  for (const peerId of [...peerConnections.keys()]) {
    cleanupPeerConnection(peerId);
  }

  pendingIceCandidates.clear();
  remoteAudioContainer.replaceChildren();
  remoteParticipantsList.replaceChildren();
  remoteAudioElements.clear();
  remoteParticipants.clear();
  remoteParticipantCounter = 0;
  updateParticipantCount();
}

function cleanupLocalStream() {
  stopInputMeter();

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
}

async function flushPendingIceCandidates(peerId) {
  const peerConnection = peerConnections.get(peerId);
  if (!peerConnection?.remoteDescription) {
    return;
  }

  const candidates = pendingIceCandidates.get(peerId) || [];
  while (candidates.length > 0) {
    await peerConnection.addIceCandidate(candidates.shift());
  }
}

async function createAndSendOffer(peerId) {
  const peerConnection = createPeerConnection(peerId);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  sendSignal({ type: "offer", peerId, sdp: offer.sdp });
}

async function handleOffer(message) {
  const peerId = message.peerId;
  const peerConnection = createPeerConnection(peerId);
  await peerConnection.setRemoteDescription({ type: "offer", sdp: message.sdp });
  await flushPendingIceCandidates(peerId);

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  sendSignal({ type: "answer", peerId, sdp: answer.sdp });
}

async function handleAnswer(message) {
  const peerId = message.peerId;
  const peerConnection = peerConnections.get(peerId);
  if (!peerConnection) {
    return;
  }

  await peerConnection.setRemoteDescription({ type: "answer", sdp: message.sdp });
  await flushPendingIceCandidates(peerId);
}

async function handleIceCandidate(message) {
  const peerId = message.peerId;
  const candidate = new RTCIceCandidate({
    candidate: message.candidate,
    sdpMid: message.sdpMid,
    sdpMLineIndex: message.sdpMLineIndex
  });

  const peerConnection = peerConnections.get(peerId);
  if (peerConnection?.remoteDescription) {
    await peerConnection.addIceCandidate(candidate);
  } else {
    const candidates = pendingIceCandidates.get(peerId) || [];
    candidates.push(candidate);
    pendingIceCandidates.set(peerId, candidates);
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
    button.querySelector("span").textContent = `${room.participantCount}/8`;
    button.addEventListener("click", async () => {
      if (!isValidDisplayName(displayNameInput.value)) {
        setStatus("error");
        setMessage(displayNameErrorMessage(), true);
        displayNameInput.focus();
        return;
      }

      roomCodeInput.value = room.roomCode;
      roomPasswordInput.value = "";
      await connect(room.roomCode, "", displayNameInput.value);
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
      password: selectedRoomPassword,
      displayName: selectedDisplayName
    });
  });

  ws.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);

    try {
      switch (message.type) {
        case "joined-room":
          ownPeerId = message.peerId || "";
          showRoom(message.roomCode);
          await startChatConnection(message.roomCode);
          setStatus(message.participantCount > 1 ? "connecting" : "waiting");
          setConnectedControls(true);
          setMessage(message.participantCount > 1 ? "Kopplar upp samtalet..." : "Du är inne. Väntar på fler deltagare.");
          for (const peer of message.peers || []) {
            getRemoteParticipant(peer.peerId, peer.displayName);
            await createAndSendOffer(peer.peerId);
          }
          await refreshOpenRooms();
          break;

        case "peer-joined":
          setStatus("connecting");
          getRemoteParticipant(message.peerId, message.displayName);
          createPeerConnection(message.peerId);
          setMessage("En deltagare anslöt. Kopplar upp samtalet...");
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
          cleanupPeerConnection(message.peerId);
          if (peerConnections.size === 0) {
            setStatus("waiting");
            setMessage("Du är kvar i rummet. Väntar på fler deltagare.");
          }
          await refreshOpenRooms();
          break;

        case "error":
          setStatus("error");
          setMessage(message.message || "Något gick fel.", true);
          if (roomPanel.hidden || message.message?.includes("fullt") || message.message?.includes("lösenord")) {
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
    cleanupPeerConnections();
    stopChatConnection();

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

async function connect(roomCode, password, displayName = selectedDisplayName) {
  selectedRoomCode = roomCode.trim().toUpperCase();
  selectedRoomPassword = password.trim();
  selectedDisplayName = normalizeDisplayName(displayName);

  if (!isValidDisplayName(selectedDisplayName)) {
    shouldReconnect = false;
    setConnectedControls(false);
    setStatus("error");
    setMessage(displayNameErrorMessage(), true);
    return;
  }

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
  isPushToTalkPressed = false;
  window.clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (notifyServer) {
    sendSignal({ type: "leave-room" });
  }

  ws?.close();
  ws = null;
  cleanupPeerConnections();
  cleanupMusicMix();
  setMusicControls(false);
  musicStatusText.textContent = "Ingen musik streamas";
  stopChatConnection();
  cleanupLocalStream();
  updateMicrophoneTransmission();
  ownPeerId = "";
  setConnectedControls(false);
  showLobby();
  setStatus(finalStatus);
  setMessage(finalMessage, isError);
  refreshOpenRooms();
}

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isValidDisplayName(displayNameInput.value)) {
    setStatus("error");
    setMessage(displayNameErrorMessage(), true);
    displayNameInput.focus();
    return;
  }

  const roomCode = roomCodeInput.value;
  if (!roomCode.trim()) {
    setStatus("error");
    setMessage("Ange en rumskod.", true);
    return;
  }

  await connect(roomCode, roomPasswordInput.value, displayNameInput.value);
});

leaveButton.addEventListener("click", () => disconnect(true));

refreshDevicesButton.addEventListener("click", async () => {
  await refreshDevices();
});

testMicrophoneButton.addEventListener("click", testMicrophone);

async function handleMicrophoneChange(event) {
  syncMicrophoneSelects(event.target.value);

  if (localStream) {
    await changeMicrophone();
  }
}

microphoneSelect.addEventListener("change", handleMicrophoneChange);

roomSettingsButton.addEventListener("click", async () => {
  const isExpanded = roomSettingsButton.getAttribute("aria-expanded") === "true";
  setRoomSettingsOpen(!isExpanded);

  if (!isExpanded) {
    await refreshDevices();
  }
});

roomMicrophoneSelect.addEventListener("change", handleMicrophoneChange);
refreshRoomDevicesButton.addEventListener("click", refreshDevices);

muteToggleButton.addEventListener("click", () => {
  setMuted(!isMuted);
});

pushToTalkToggleButton.addEventListener("click", () => {
  if (!isPushToTalkEnabled && !pushToTalkBinding) {
    isBindingPushToTalkKey = true;
    updateMicrophoneTransmission();
    setMessage("Tryck den tangent du vill använda för push to talk.");
    return;
  }

  setPushToTalkEnabled(!isPushToTalkEnabled);
});

bindPushToTalkButton.addEventListener("click", () => {
  isBindingPushToTalkKey = true;
  updateMicrophoneTransmission();
  setMessage("Tryck en tangent för push to talk. Esc avbryter, Backspace tar bort.");
});

document.addEventListener("keydown", (event) => {
  if (isBindingPushToTalkKey) {
    event.preventDefault();

    if (event.key === "Escape") {
      isBindingPushToTalkKey = false;
      updateMicrophoneTransmission();
      setMessage("");
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      savePushToTalkBinding(null);
      isBindingPushToTalkKey = false;
      setPushToTalkEnabled(false);
      setMessage("Push to talk-tangenten är borttagen.");
      return;
    }

    if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) {
      return;
    }

    savePushToTalkBinding({ code: event.code, label: keyDisplayName(event) });
    isBindingPushToTalkKey = false;
    setPushToTalkEnabled(true);
    setMessage(`Push to talk är bunden till ${pushToTalkBinding.label}.`);
    return;
  }

  if (!isPushToTalkEnabled || !pushToTalkBinding || event.code !== pushToTalkBinding.code || isTypingTarget(event.target)) {
    return;
  }

  event.preventDefault();

  if (!event.repeat) {
    isPushToTalkPressed = true;
    updateMicrophoneTransmission();
  }
});

document.addEventListener("keyup", (event) => {
  if (!isPushToTalkEnabled || !pushToTalkBinding || event.code !== pushToTalkBinding.code) {
    return;
  }

  event.preventDefault();
  isPushToTalkPressed = false;
  updateMicrophoneTransmission();
});

window.addEventListener("blur", () => {
  if (!isPushToTalkPressed) {
    return;
  }

  isPushToTalkPressed = false;
  updateMicrophoneTransmission();
});

refreshRoomsButton.addEventListener("click", refreshOpenRooms);

musicToggleButton.addEventListener("click", async () => {
  const isExpanded = musicToggleButton.getAttribute("aria-expanded") === "true";
  musicToggleButton.setAttribute("aria-expanded", String(!isExpanded));
  musicControls.hidden = isExpanded;

  if (isExpanded) {
    return;
  }

  await refreshMusicDevices();
});

refreshMusicDevicesButton.addEventListener("click", refreshMusicDevices);
startMusicButton.addEventListener("click", startMusicSharing);
stopMusicButton.addEventListener("click", () => {
  stopMusicSharing();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendChatMessage();
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && editingMessageId) {
    e.preventDefault();
    clearEditingState();
    setChatDraft("");
    clearChatImagePreview();
    return;
  }

  if (e.key === "ArrowUp" && !editingMessageId && getChatDraft().length === 0) {
    if (startEditingLatestOwnMessage()) {
      e.preventDefault();
    }
    return;
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

chatInput.addEventListener("paste", (e) => {
  if (editingMessageId) {
    return;
  }

  const items = [...(e.clipboardData?.items ?? [])];
  const imageItem = items.find(i => i.type.startsWith("image/"));
  if (imageItem) {
    e.preventDefault();
    const file = imageItem.getAsFile();
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 800;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
          else { width = Math.round(width * maxSize / height); height = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        pendingImage = canvas.toDataURL("image/jpeg", 0.72);
        showChatImagePreview(pendingImage);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    return;
  }

});

volumeSlider.addEventListener("input", () => {
  const volume = Number(volumeSlider.value);
  for (const participant of remoteParticipants.values()) {
    participant.audio.volume = volume / 100;
    participant.volumeSlider.value = String(volume);
    participant.volumeValueText.textContent = `${volume}%`;
  }
  volumeValue.textContent = `${volume}%`;
});

window.addEventListener("beforeunload", () => {
  sendSignal({ type: "leave-room" });
});

setChatControls(false);
updateMicrophoneTransmission();

if (!("mediaDevices" in navigator) || !("getUserMedia" in navigator.mediaDevices) || !("RTCPeerConnection" in window)) {
  setStatus("error");
  setMessage("Din webbläsare saknar stöd för WebRTC eller mikrofonåtkomst.", true);
  setConnectedControls(false);
  joinButton.disabled = true;
  testMicrophoneButton.disabled = true;
  roomSettingsButton.disabled = true;
  roomMicrophoneSelect.disabled = true;
  refreshRoomDevicesButton.disabled = true;
  muteToggleButton.disabled = true;
  pushToTalkToggleButton.disabled = true;
  bindPushToTalkButton.disabled = true;
  musicToggleButton.disabled = true;
  startMusicButton.disabled = true;
  stopMusicButton.disabled = true;
} else {
  refreshDevices();
  refreshMusicDevices();
  refreshOpenRooms();
  window.setInterval(() => {
    if (!shouldReconnect) {
      refreshOpenRooms();
    }
  }, 5000);
}
