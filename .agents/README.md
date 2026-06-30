# SnickSnack Agent Notes

## What This App Is

SnickSnack is a small Swedish browser voice-chat app built with ASP.NET Core 8, a vanilla static frontend, WebSocket signaling, WebRTC audio, and SignalR text chat.

The backend helps clients discover each other and exchange session metadata. Call audio is peer-to-peer through WebRTC and should not pass through the ASP.NET backend.

## Runtime Pieces

- `Program.cs` is the whole backend. It serves static files, exposes `/health`, `/api/open-rooms`, `/ws`, and `/chatHub`.
- `/ws` is the WebSocket signaling endpoint for `join-room`, `offer`, `answer`, `ice-candidate`, and `leave-room`.
- `/chatHub` is a SignalR hub for room-scoped text chat. Chat membership is validated against the in-memory room registry.
- `RoomRegistry` stores rooms in memory. Rooms are lost on process restart. Maximum participants per room is 8.
- `/api/open-rooms` returns only rooms without passwords that have at least one participant and are not full.
- `wwwroot/index.html`, `wwwroot/styles.css`, and `wwwroot/app.js` make up the frontend. There is no build step or frontend framework.

## Frontend Behavior

- Lobby users enter display name, room code, optional password, and microphone.
- The browser asks for microphone access with `getUserMedia()` and uses echo cancellation, noise suppression, and auto gain control for the main microphone.
- WebRTC peer connections are created per remote participant. Remote audio is attached to hidden `audio` elements.
- Local and remote level meters use Web Audio `AnalyserNode`s.
- The room header has a cog settings menu for switching the microphone while staying in the room. This should replace the outgoing audio track, not disconnect chat or signaling.
- Room settings also include a mute toggle and push-to-talk. PTT stores the bound key in local storage, mutes the microphone unless the key is held, and the hard mute toggle always takes priority.
- In room view, the vertical divider between voice controls and text chat is draggable. Its left-panel width is stored in local storage and should stay within the desktop min/max clamps.
- Music sharing captures a selected audio input without voice-processing constraints, mixes it with the microphone in Web Audio, and replaces the outgoing track with the mixed stream.
- Text chat is separate from WebRTC audio and uses SignalR. Incoming chat messages play `wwwroot/assets/duck.mp3`.
- Chat messages can contain sanitized Markdown. Pasted images are resized client-side and sent as data URLs inside the chat message, so SignalR message-size limits matter.
- Own chat messages can be edited with ArrowUp from an empty input, `/edit`, `/edit replacement text`, or the per-message Edit button. Edits update the existing message and show a small edited timestamp.
- The open-room list refreshes manually and periodically while the user is not connected.

## Change Guidelines

- Keep frontend changes in plain HTML/CSS/JS unless the project intentionally adopts a frontend build pipeline.
- When changing `wwwroot/app.js` or `wwwroot/styles.css`, update the cache-busting query string in `wwwroot/index.html`.
- Do not route audio through the backend. Keep audio capture, mixing, and playback client-side.
- Preserve the room/password validation model: signaling joins create or enter rooms; SignalR chat joins must validate against the existing room.
- Be careful with media streams. Prefer acquiring a replacement stream before stopping the active microphone so failed device switches do not break an ongoing call.
- Mute and push-to-talk should gate the local microphone track with `track.enabled`; do not renegotiate or disconnect peers for basic muting.
- If changing rich chat rendering, keep the `marked` and `DOMPurify` script tags in `wwwroot/index.html` aligned with `wwwroot/app.js`.
- If changing WebSocket message shapes, update both `ClientMessage`/`ServerMessage` in `Program.cs` and the matching handlers in `wwwroot/app.js`.
- If changing room visibility rules, update both `RoomRegistry.GetOpenRooms()` and the README wording.

## Useful Commands

```powershell
dotnet restore
dotnet build
dotnet run --urls http://localhost:5130
```

For a quick smoke test after starting the app:

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:5130/).StatusCode
(Invoke-WebRequest -UseBasicParsing http://localhost:5130/api/open-rooms).Content
```
