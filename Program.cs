using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
var rooms = new RoomRegistry();
var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
{
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseWebSockets();

app.Map("/ws", async context =>
{
    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    var connection = new ClientConnection(Guid.NewGuid().ToString("N"), socket);

    try
    {
        await ReceiveLoopAsync(connection, rooms, jsonOptions, context.RequestAborted);
    }
    finally
    {
        await rooms.LeaveAsync(connection, jsonOptions, context.RequestAborted);
    }
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/api/open-rooms", () => Results.Ok(rooms.GetOpenRooms()));

app.Run();

static async Task ReceiveLoopAsync(
    ClientConnection connection,
    RoomRegistry rooms,
    JsonSerializerOptions jsonOptions,
    CancellationToken cancellationToken)
{
    var buffer = new byte[8 * 1024];

    try
    {
        while (connection.Socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var payload = new MemoryStream();
            WebSocketReceiveResult result;

            do
            {
                result = await connection.Socket.ReceiveAsync(buffer, cancellationToken);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    return;
                }

                payload.Write(buffer, 0, result.Count);
            }
            while (!result.EndOfMessage);

            if (result.MessageType != WebSocketMessageType.Text)
            {
                await SocketSender.SendAsync(connection, "error", "Endast JSON-textmeddelanden stöds.", jsonOptions, cancellationToken);
                continue;
            }

            payload.Position = 0;

            ClientMessage? message;
            try
            {
                message = await JsonSerializer.DeserializeAsync<ClientMessage>(payload, jsonOptions, cancellationToken);
            }
            catch (JsonException)
            {
                await SocketSender.SendAsync(connection, "error", "Ogiltig JSON.", jsonOptions, cancellationToken);
                continue;
            }

            if (message is null || string.IsNullOrWhiteSpace(message.Type))
            {
                await SocketSender.SendAsync(connection, "error", "Meddelandet saknar type.", jsonOptions, cancellationToken);
                continue;
            }

            switch (message.Type)
            {
                case "join-room":
                    await rooms.JoinAsync(connection, message.RoomCode, message.Password, jsonOptions, cancellationToken);
                    break;

                case "offer":
                case "answer":
                case "ice-candidate":
                    await rooms.ForwardToPeerAsync(connection, message, jsonOptions, cancellationToken);
                    break;

                case "leave-room":
                    await rooms.LeaveAsync(connection, jsonOptions, cancellationToken);
                    break;

                default:
                    await SocketSender.SendAsync(connection, "error", $"Okänd meddelandetyp: {message.Type}", jsonOptions, cancellationToken);
                    break;
            }
        }
    }
    catch (WebSocketException)
    {
        // Browsers and test clients can disappear without a close handshake.
    }
    catch (OperationCanceledException)
    {
    }
}

sealed class RoomRegistry
{
    private const int MaxParticipants = 8;
    private readonly ConcurrentDictionary<string, Room> _rooms = new(StringComparer.OrdinalIgnoreCase);

    public async Task JoinAsync(
        ClientConnection connection,
        string? roomCode,
        string? password,
        JsonSerializerOptions jsonOptions,
        CancellationToken cancellationToken)
    {
        var normalizedRoomCode = NormalizeRoomCode(roomCode);
        var normalizedPassword = NormalizePassword(password);

        if (normalizedRoomCode is null)
        {
            await SocketSender.SendAsync(connection, "error", "Ange en giltig rumskod.", jsonOptions, cancellationToken);
            return;
        }

        if (connection.RoomCode is not null)
        {
            await LeaveAsync(connection, jsonOptions, cancellationToken);
        }

        var room = _rooms.GetOrAdd(normalizedRoomCode, code => new Room(code, normalizedPassword));
        List<ClientConnection> existingPeers = [];
        var joined = false;
        var participantCount = 0;
        var passwordRejected = false;

        lock (room.SyncRoot)
        {
            room.RemoveClosedConnections();

            if (!room.PasswordMatches(normalizedPassword))
            {
                passwordRejected = true;
            }
            else if (room.Participants.Count < MaxParticipants)
            {
                existingPeers = room.Participants.ToList();
                room.Participants.Add(connection);
                connection.RoomCode = normalizedRoomCode;
                joined = true;
                participantCount = room.Participants.Count;
            }
        }

        if (passwordRejected)
        {
            await SocketSender.SendAsync(connection, "error", "Fel lösenord för rummet.", jsonOptions, cancellationToken);
            return;
        }

        if (!joined)
        {
            await SocketSender.SendAsync(connection, "error", $"Rummet är fullt. Max {MaxParticipants} deltagare kan vara anslutna.", jsonOptions, cancellationToken);
            return;
        }

        await SocketSender.SendAsync(
            connection,
            new ServerMessage(
                Type: "joined-room",
                RoomCode: normalizedRoomCode,
                ParticipantCount: participantCount,
                PeerId: connection.Id,
                Peers: existingPeers.Select(peer => new PeerInfo(peer.Id)).ToArray()),
            jsonOptions,
            cancellationToken);

        foreach (var peer in existingPeers)
        {
            await SocketSender.SendAsync(
                peer,
                new ServerMessage(Type: "peer-joined", PeerId: connection.Id, ParticipantCount: participantCount),
                jsonOptions,
                cancellationToken);
        }
    }

    public IReadOnlyList<OpenRoom> GetOpenRooms()
    {
        var openRooms = new List<OpenRoom>();

        foreach (var room in _rooms.Values.OrderBy(room => room.Code))
        {
            lock (room.SyncRoot)
            {
                room.RemoveClosedConnections();

                if (!room.HasPassword && room.Participants.Count is > 0 && room.Participants.Count < MaxParticipants)
                {
                    openRooms.Add(new OpenRoom(room.Code, room.Code, room.Participants.Count));
                }
            }
        }

        return openRooms;
    }

    public async Task ForwardToPeerAsync(
        ClientConnection connection,
        ClientMessage message,
        JsonSerializerOptions jsonOptions,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(message.PeerId))
        {
            await SocketSender.SendAsync(connection, "error", "Meddelandet saknar mottagare.", jsonOptions, cancellationToken);
            return;
        }

        var peer = FindPeer(connection, message.PeerId);

        if (peer is null)
        {
            await SocketSender.SendAsync(connection, "error", "Ingen deltagare att signalera till ännu.", jsonOptions, cancellationToken);
            return;
        }

        await SocketSender.SendAsync(
            peer,
            new ServerMessage(
                Type: message.Type,
                PeerId: connection.Id,
                Sdp: message.Sdp,
                Candidate: message.Candidate,
                SdpMid: message.SdpMid,
                SdpMLineIndex: message.SdpMLineIndex),
            jsonOptions,
            cancellationToken);
    }

    public async Task LeaveAsync(
        ClientConnection connection,
        JsonSerializerOptions jsonOptions,
        CancellationToken cancellationToken)
    {
        var roomCode = connection.RoomCode;

        if (roomCode is null || !_rooms.TryGetValue(roomCode, out var room))
        {
            return;
        }

        List<ClientConnection> peers = [];
        var participantCount = 0;
        var removeRoom = false;

        lock (room.SyncRoot)
        {
            if (room.Participants.Remove(connection))
            {
                peers = room.Participants.ToList();
            }

            connection.RoomCode = null;
            room.RemoveClosedConnections();
            participantCount = room.Participants.Count;
            removeRoom = room.Participants.Count == 0;
        }

        if (removeRoom)
        {
            _rooms.TryRemove(roomCode, out _);
        }

        foreach (var peer in peers)
        {
            await SocketSender.SendAsync(
                peer,
                new ServerMessage(Type: "leave-room", PeerId: connection.Id, ParticipantCount: participantCount),
                jsonOptions,
                cancellationToken);
        }
    }

    private ClientConnection? FindPeer(ClientConnection connection, string peerId)
    {
        var roomCode = connection.RoomCode;

        if (roomCode is null || !_rooms.TryGetValue(roomCode, out var room))
        {
            return null;
        }

        lock (room.SyncRoot)
        {
            return room.Participants.FirstOrDefault(participant => participant.Id == peerId && participant.Id != connection.Id);
        }
    }

    private static string? NormalizeRoomCode(string? roomCode)
    {
        var normalized = roomCode?.Trim().ToUpperInvariant();

        if (string.IsNullOrWhiteSpace(normalized) || normalized.Length > 32)
        {
            return null;
        }

        return normalized;
    }

    private static string? NormalizePassword(string? password)
    {
        var normalized = password?.Trim();

        if (string.IsNullOrEmpty(normalized))
        {
            return null;
        }

        return normalized.Length > 128 ? normalized[..128] : normalized;
    }
}

sealed class Room(string code, string? password)
{
    public string Code { get; } = code;
    public string? Password { get; } = password;
    public bool HasPassword => Password is not null;
    public object SyncRoot { get; } = new();
    public List<ClientConnection> Participants { get; } = [];

    public bool PasswordMatches(string? password)
    {
        return Password is null || string.Equals(Password, password, StringComparison.Ordinal);
    }

    public void RemoveClosedConnections()
    {
        Participants.RemoveAll(participant => participant.Socket.State is WebSocketState.Closed or WebSocketState.Aborted);
    }
}

sealed class ClientConnection(string id, WebSocket socket)
{
    public string Id { get; } = id;
    public WebSocket Socket { get; } = socket;
    public SemaphoreSlim SendLock { get; } = new(1, 1);
    public string? RoomCode { get; set; }
}

static class SocketSender
{
    public static Task SendAsync(
        ClientConnection connection,
        string type,
        string message,
        JsonSerializerOptions jsonOptions,
        CancellationToken cancellationToken)
    {
        return SendAsync(connection, new ServerMessage(Type: type, Message: message), jsonOptions, cancellationToken);
    }

    public static async Task SendAsync(
        ClientConnection connection,
        ServerMessage message,
        JsonSerializerOptions jsonOptions,
        CancellationToken cancellationToken)
    {
        if (connection.Socket.State != WebSocketState.Open)
        {
            return;
        }

        var json = JsonSerializer.Serialize(message, jsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);

        await connection.SendLock.WaitAsync(cancellationToken);
        try
        {
            if (connection.Socket.State == WebSocketState.Open)
            {
                await connection.Socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
            }
        }
        finally
        {
            connection.SendLock.Release();
        }
    }
}

sealed record ClientMessage(
    string Type,
    string? RoomCode = null,
    string? Password = null,
    string? PeerId = null,
    string? Sdp = null,
    string? Candidate = null,
    string? SdpMid = null,
    int? SdpMLineIndex = null);

sealed record OpenRoom(string RoomCode, string Name, int ParticipantCount);

sealed record PeerInfo(string PeerId);

sealed record ServerMessage(
    string Type,
    string? Message = null,
    string? RoomCode = null,
    int? ParticipantCount = null,
    string? PeerId = null,
    IReadOnlyList<PeerInfo>? Peers = null,
    string? Sdp = null,
    string? Candidate = null,
    string? SdpMid = null,
    int? SdpMLineIndex = null);
