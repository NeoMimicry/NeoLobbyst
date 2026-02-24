using MelonLoader;
using MelonLoader.Utils;
using Newtonsoft.Json;
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;

namespace NeoLobbyst
{
    public static class LobbyAPI
    {
        private static readonly HttpClient Client = new HttpClient();
        private const string BaseUrl = "http://localhost:3000";
        private const string BaseUrlLocal = "http://localhost:3000";
        
        private static string _apiKey;
        private static string _clientId;
        private static bool _initialized;
        private static readonly object InitLock = new object();
        private static readonly string CredentialsPath = Path.Combine(MelonEnvironment.UserDataDirectory, "neolobbyst_credentials.json");

        static LobbyAPI()
        {
            Client.Timeout = TimeSpan.FromSeconds(10);
        }

        private static void Initialized()
        {
            if (_initialized) return;
            
            lock (InitLock)
            {
                if (_initialized) return;
                
                try
                {
                    if (File.Exists(CredentialsPath))
                    {
                        string json = File.ReadAllText(CredentialsPath);
                        var creds = JsonConvert.DeserializeObject<Credentials>(json);
                        _apiKey = creds?.ApiKey;
                        _clientId = creds?.ClientId;
                        
                        if (!string.IsNullOrEmpty(_apiKey))
                        {
                            MelonLogger.Msg("Loaded existing API credentials");
                            _initialized = true;
                            return;
                        }
                    }
                    
                    MelonLogger.Msg("No credentials found, will register on first API call");
                }
                catch (Exception ex)
                {
                    MelonLogger.Error($"Failed to load credentials: {ex.Message}");
                }
                
                _initialized = true;
            }
        }

        private static async Task RegisteredAsync()
        {
            Initialized();
            
            if (!string.IsNullOrEmpty(_apiKey)) return;
            
            lock (InitLock)
            { 
                if (!string.IsNullOrEmpty(_apiKey)) return;
            }
            
            await RegisterClientAsync().ConfigureAwait(false);
        }

        private static async Task RegisterClientAsync()
        {
            try
            {
                MelonLogger.Msg("Registering new client with server...");
                string url = BaseUrl + "/api/auth/register";
                
                using var response = await Client.PostAsync(url, new StringContent("", Encoding.UTF8, "application/json")).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                
                string json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                var authResponse = JsonConvert.DeserializeObject<AuthResponse>(json);
                
                if (authResponse != null && authResponse.Ok)
                {
                    _apiKey = authResponse.ApiKey;
                    _clientId = authResponse.ClientId;
                    
                    var creds = new Credentials
                    {
                        ApiKey = _apiKey,
                        ClientId = _clientId,
                        Token = authResponse.Token
                    };
                    
                    string credsJson = JsonConvert.SerializeObject(creds, Formatting.Indented);
                    File.WriteAllText(CredentialsPath, credsJson);
                    
                    MelonLogger.Msg($"Successfully registered client: {_clientId}");
                }
            }
            catch (Exception ex)
            {
                MelonLogger.Error($"Failed to register client: {ex.Message}");
            }
        }

        private static void AddAuthHeaders(HttpRequestMessage request)
        {
            if (!string.IsNullOrEmpty(_apiKey))
            {
                request.Headers.Add("X-API-Key", _apiKey);
            }
        }

        public static async Task RegisterLobbyAsync(OpenGameInfo lobby, string password)
        {
            await RegisteredAsync().ConfigureAwait(false);
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
            
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            AddAuthHeaders(request);
            
            using HttpResponseMessage response = await Client.SendAsync(request).ConfigureAwait(false);
            
            if (!response.IsSuccessStatusCode)
            {
                string errorContent = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                MelonLogger.Error($"Failed to register lobby: {response.StatusCode} - {errorContent}");
            }
            
            response.EnsureSuccessStatusCode();
        }

        public static async Task SendHeartbeatAsync(string lobbyId, int playerCount)
        {
            await RegisteredAsync().ConfigureAwait(false);
            var body = new
            {
                playerCount
            };

            string json = JsonConvert.SerializeObject(body);
            string url = BaseUrl + "/api/lobbies/" + lobbyId + "/heartbeat";
            MelonLogger.Msg("LobbyAPI.SendHeartbeatAsync: POST " + url + " body=" + json);
            
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            AddAuthHeaders(request);
            
            using HttpResponseMessage response = await Client.SendAsync(request).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
        }

        public static async Task RemoveLobbyAsync(string lobbyId)
        {
            await RegisteredAsync().ConfigureAwait(false);
            var request = new HttpRequestMessage(HttpMethod.Delete, BaseUrl + "/api/lobbies/" + lobbyId);
            AddAuthHeaders(request);
            
            using HttpResponseMessage response = await Client.SendAsync(request).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
        }

        public static async Task<IReadOnlyList<OpenGameInfo>> GetLobbiesAsync()
        {
            await RegisteredAsync().ConfigureAwait(false);
            var request = new HttpRequestMessage(HttpMethod.Get, BaseUrl + "/api/lobbies");
            AddAuthHeaders(request);
            
            using HttpResponseMessage response = await Client.SendAsync(request).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            string json = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            LobbyListResponse wrapper = JsonConvert.DeserializeObject<LobbyListResponse>(json) ?? new LobbyListResponse();
            return wrapper.Lobbies ?? new List<OpenGameInfo>();
        }

        public static async Task<bool> CheckPasswordAsync(string lobbyId, string password)
        {
            await RegisteredAsync().ConfigureAwait(false);
            var body = new
            {
                password
            };

            string json = JsonConvert.SerializeObject(body);
            var request = new HttpRequestMessage(HttpMethod.Post, BaseUrl + "/api/lobbies/" + lobbyId + "/check-password")
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            AddAuthHeaders(request);
            
            using HttpResponseMessage response = await Client.SendAsync(request).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            string respJson = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

            PasswordCheckResponse data = JsonConvert.DeserializeObject<PasswordCheckResponse>(respJson) ?? new PasswordCheckResponse();
            return data.Valid;
        }

        private sealed class Credentials
        {
            [JsonProperty("clientId")]
            public string ClientId { get; set; }
            
            [JsonProperty("apiKey")]
            public string ApiKey { get; set; }
            
            [JsonProperty("token")]
            public string Token { get; set; }
        }

        private sealed class AuthResponse
        {
            [JsonProperty("ok")]
            public bool Ok { get; set; }
            
            [JsonProperty("clientId")]
            public string ClientId { get; set; }
            
            [JsonProperty("apiKey")]
            public string ApiKey { get; set; }
            
            [JsonProperty("token")]
            public string Token { get; set; }
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

