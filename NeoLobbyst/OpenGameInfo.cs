using System;

namespace NeoLobbyst
{
    public sealed class OpenGameInfo
    {
        public string LobbyId { get; set; } = string.Empty;
        public string LobbyName { get; set; } = string.Empty;
        public string HostName { get; set; } = string.Empty;
        public string Region { get; set; } = string.Empty;
        public int PlayerCount { get; set; }
        public int MaxPlayers { get; set; }
        public int Cycle { get; set; }
        public int RepairStatus { get; set; }
        public bool IsPasswordProtected { get; set; }
        public bool IsPublic { get; set; }
        public string Version { get; set; } = string.Empty;
        public string Source { get; set; } = "steam";
    }
}

