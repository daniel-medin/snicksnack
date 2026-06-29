# SnickSnack

En minimal svensk P2P-röstchatt byggd med ASP.NET Core Minimal API, WebSocket-signalering, WebRTC och SignalR.

Servern hjälper deltagare att hitta varandra, validerar rum och vidarebefordrar signaling: `join-room`, `offer`, `answer`, `ice-candidate` och `leave-room`. Samtalsljudet skickas direkt mellan klienterna via WebRTC och passerar aldrig backend. Textchatten går via SignalR och är bunden till samma rum.

## Funktioner

- Rumskod med max 8 deltagare per rum
- Frivilligt lösenord när rummet skapas
- Lista över öppna rum utan lösenord via `/api/open-rooms`
- Tydliga statusar: inte ansluten, ansluter, väntar, ansluten, frånkopplad och fel
- Mikrofonval via `enumerateDevices()`
- Rumsinställningar med mikrofonbyte utan att lämna chatten
- Mute-toggle och push-to-talk med valfri tangent i rumsinställningarna
- Input- och deltagarnivåmätare via Web Audio
- `getUserMedia()` med echo cancellation, noise suppression och auto gain control för mikrofonen
- Musikdelning från vald ljudingång, mixad lokalt med mikrofonen innan den skickas via WebRTC
- Textchatt via `/chatHub` med Markdown-rendering, inklistrade bilder och ljud vid inkommande meddelanden
- Individuell inkommande volymkontroll via `HTMLAudioElement.volume`
- WebSocket-signalering på `/ws`
- Automatisk WebSocket-återanslutning om signaleringen tappas
- In-memory rum, ingen databas
- Health check på `/health`
- Docker-kompatibel och körbar på Linux

## Kör Lokalt

```bash
dotnet restore
dotnet run
```

Öppna sedan adressen som skrivs ut av `dotnet run`, till exempel:

```text
http://localhost:5130
```

För att testa röstchatten öppnar du två webbläsarfönster och anger samma rumskod, till exempel `ABC123`.

## Så Funkar Det

`Program.cs` innehåller backend: statiska filer, `/health`, `/api/open-rooms`, WebSocket-endpointen `/ws`, SignalR-hubben `/chatHub` och ett in-memory `RoomRegistry`.

Frontend ligger i `wwwroot/index.html`, `wwwroot/styles.css` och `wwwroot/app.js`. Det finns inget separat frontend-bygge.

När en användare går in i ett rum startar klienten mikrofonen, ansluter till `/ws`, går med i rummet och skapar WebRTC-anslutningar till övriga deltagare. I rumsinställningarna kan användaren byta mikrofon, muta sig eller aktivera push-to-talk genom att välja en tangent och hålla den nere för att prata. Chatten ansluter separat till `/chatHub`, men servern kontrollerar att användaren faktiskt hör till rummet innan chatten släpps in. Chattmeddelanden renderas som sanerad Markdown i klienten, och inklistrade bilder skalas ned och skickas som data-URL i meddelandet.

## Docker

Bygg image:

```bash
docker build -t snicksnack .
```

Kör container:

```bash
docker run --rm -p 8080:8080 snicksnack
```

Öppna:

```text
http://localhost:8080
```

## Produktion

WebRTC-mikrofonåtkomst kräver normalt HTTPS utanför `localhost`. Lägg därför appen bakom en reverse proxy med TLS, till exempel Caddy, Nginx eller Traefik.

Om servern ligger bakom proxy behöver WebSocket-uppgraderingar till `/ws` tillåtas. SignalR-chatten på `/chatHub` behöver också fungera genom proxyn.

## Oracle-Deploy

Deployscriptet ligger i `deploy/oracle/deploy-oracle.ps1` och följer samma serverlayout som Shoppingtajm: `/opt/stacks/snicksnack`, Docker Compose och delad Caddy-proxy på nätverket `shared_backend`.

```powershell
.\deploy\oracle\deploy-oracle.ps1 -PublicUrl "https://snicksnack.mrcheng.se/"
```

DNS-namnet i `-PublicUrl` måste peka mot Oracle-servern för att HTTPS och mikrofonåtkomst ska fungera i webbläsaren.

Deploy körs också via GitHub Actions på push till `main` eller `master`:

```text
.github/workflows/deploy-oracle.yml
```

Required GitHub secret:

```text
ORACLE_SSH_PRIVATE_KEY
```

Optional GitHub variables:

```text
ORACLE_HOST=82.70.47.203
ORACLE_SSH_USER=ubuntu
SNICKSNACK_REMOTE_APP_DIR=/opt/stacks/snicksnack
SNICKSNACK_PUBLIC_URL=https://snicksnack.mrcheng.se/
```
