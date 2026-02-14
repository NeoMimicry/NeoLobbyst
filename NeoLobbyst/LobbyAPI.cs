using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using MelonLoader;
using Newtonsoft.Json;

namespace NeoLobbyst
{
    public static class LobbyAPI
    {
        private static readonly HttpClient Client = new HttpClient();
        private const string BaseUrl = "https://wzrd-was-not.here";
        private const string BaseUrlLocal = "http://localhost:3000";

        public static async Task RegisterLobbyAsync(OpenGameInfo lobby, string password)
        {
            var body = new
            {
                lobbyId = lobby.LobbyId,
                hostName = lobby.HostName,
                region = lobby.Region,
                maxPlayers = lobby.MaxPlayers,
                hasPassword = !string.IsNullOrEmpty(password),
                version = lobby.Version,
                password
            };

            string json = JsonConvert.SerializeObject(body);
            string url = BaseUrl + "/api/lobbies";
            MelonLogger.Msg("LobbyAPI.RegisterLobbyAsync: POST " + url + " lobbyId=" + lobby.LobbyId);
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using HttpResponseMessage response = await Client.PostAsync(url, content).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
        }

        public static async Task SendHeartbeatAsync(string lobbyId, int playerCount)
        {
            var body = new
            {
                playerCount
            };

            string json = JsonConvert.SerializeObject(body);
            string url = BaseUrl + "/api/lobbies/" + lobbyId + "/heartbeat";
            MelonLogger.Msg("LobbyAPI.SendHeartbeatAsync: POST " + url + " body=" + json);
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using HttpResponseMessage response = await Client.PostAsync(url, content).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
        }

        public static async Task RemoveLobbyAsync(string lobbyId)
        {
            using HttpResponseMessage response = await Client.DeleteAsync(BaseUrl + "/api/lobbies/" + lobbyId).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
        }

        public static async Task<IReadOnlyList<OpenGameInfo>> GetLobbiesAsync()
        {
            using HttpResponseMessage response = await Client.GetAsync(BaseUrl + "/api/lobbies").ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            string json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            LobbyListResponse wrapper = JsonConvert.DeserializeObject<LobbyListResponse>(json) ?? new LobbyListResponse();
            return wrapper.Lobbies ?? new List<OpenGameInfo>();
        }

        public static async Task<bool> CheckPasswordAsync(string lobbyId, string password)
        {
            var body = new
            {
                password
            };

            string json = JsonConvert.SerializeObject(body);
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            using HttpResponseMessage response = await Client.PostAsync(BaseUrl + "/api/lobbies/" + lobbyId + "/check-password", content).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            string respJson = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            PasswordCheckResponse data = JsonConvert.DeserializeObject<PasswordCheckResponse>(respJson) ?? new PasswordCheckResponse();
            return data.Valid;
        }

        private sealed class LobbyListResponse
        {
            [JsonProperty("lobbies")]
            public List<OpenGameInfo> Lobbies { get; set; } = new List<OpenGameInfo>();
        }

        private sealed class PasswordCheckResponse
        {
            [JsonProperty("valid")]
            public bool Valid { get; set; }
        }
    }
}

