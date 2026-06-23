# Snick Snack

En minimal svensk P2P-rostchat byggd med ASP.NET Core Minimal API, WebSocket-signalering och WebRTC.

Servern hanterar endast signaling: `join-room`, `offer`, `answer`, `ice-candidate` och `leave-room`. Ljudet skickas direkt mellan klienterna via WebRTC och passerar aldrig backend.

## Funktioner

- Rumskod med max 2 deltagare per rum
- Tydliga statusar: inte ansluten, ansluter, väntar, ansluten, frånkopplad och fel
- Mikrofonval via `enumerateDevices()`
- `getUserMedia()` med echo cancellation, noise suppression och auto gain control
- Inkommande volymkontroll via `HTMLAudioElement.volume`
- WebSocket-signalering på `/ws`
- Automatisk WebSocket-återanslutning om signaleringen tappas
- In-memory rum, ingen databas
- Docker-kompatibel och körbar på Linux

## Kör lokalt

```bash
dotnet restore
dotnet run
```

Öppna sedan adressen som skrivs ut av `dotnet run`, till exempel:

```text
http://localhost:5000
```

För att testa röstchatten öppnar du två webbläsarfönster och anger samma rumskod, till exempel `ABC123`.

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

Om servern ligger bakom proxy behöver WebSocket-uppgraderingar till `/ws` tillåtas.

## Oracle-deploy

Deployscriptet ligger i `deploy/oracle/deploy-oracle.ps1` och följer samma serverlayout som Shoppingtajm: `/opt/stacks/snicksnack`, Docker Compose och delad Caddy-proxy på nätverket `shared_backend`.

```powershell
.\deploy\oracle\deploy-oracle.ps1 -PublicUrl "https://snicksnack.mrcheng.se/"
```

DNS-namnet i `-PublicUrl` måste peka mot Oracle-servern för att HTTPS och mikrofonåtkomst ska fungera i webbläsaren.
