using System;
using System.Collections.Generic;
using MelonLoader;
using NeoLobbyst;
using Steamworks;
using UnityEngine;

namespace NeoLobbyst
{
    public class TestingGUI : MonoBehaviour
    {
        private static TestingGUI _instance;
        private static bool _visible;

        private Rect _windowRect = new Rect(20, 20, 260, 220);
        private Vector2 _scroll;
        private readonly List<OpenGameInfo> _lobbies = new List<OpenGameInfo>();

        private CallResult<LobbyMatchList_t> _lobbyMatchList;
        private bool _isRefreshing;

        public static void Instance()
        {
            if (_instance != null)
                return;

            GameObject go = new GameObject(nameof(TestingGUI));
            UnityEngine.Object.DontDestroyOnLoad(go);
            _instance = go.AddComponent<TestingGUI>();
        }

        public static void ToggleFromMenu()
        {
            Instance();
            _visible = !_visible;
        }

        private void Start()
        {
            _lobbyMatchList = CallResult<LobbyMatchList_t>.Create(OnLobbyMatchListReceived);
        }

        private void OnGUI()
        {
            if (!_visible)
                return;

            _windowRect = GUI.Window(982374, _windowRect, DrawWindow, "w gui");
        }

        private void DrawWindow(int id) // doing a gui for now
        {
            GUILayout.BeginVertical();

            GUILayout.BeginHorizontal();
            if (GUILayout.Button(_isRefreshing ? "..." : "R", GUILayout.Width(30)))
            {
                if (!_isRefreshing)
                    RefreshLobbies();
            }
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("X", GUILayout.Width(30)))
            {
                _visible = false;
            }
            GUILayout.EndHorizontal();

            GUILayout.Space(4);

            _scroll = GUILayout.BeginScrollView(_scroll);

            if (_lobbies.Count == 0)
            {
                GUILayout.Label("No rooms");
            }
            else
            {
                foreach (OpenGameInfo lobby in _lobbies)
                {
                    GUILayout.BeginHorizontal();
                    GUILayout.BeginVertical();
                    GUILayout.Label(lobby.LobbyName, GUILayout.MaxWidth(160));
                    GUILayout.Label(lobby.PlayerCount + "/" + lobby.MaxPlayers, GUILayout.MaxWidth(80));
                    GUILayout.EndVertical();
                    if (GUILayout.Button("Join", GUILayout.Width(50)))
                    {
                        TryJoinLobby(lobby);
                    }
                    GUILayout.EndHorizontal();
                }
            }

            GUILayout.EndScrollView();

            GUILayout.EndVertical();

            GUI.DragWindow();
        }

        private async void RefreshLobbies()
        {
            _isRefreshing = true;
            _lobbies.Clear();

            try
            {
                IReadOnlyList<OpenGameInfo> list = await LobbyAPI.GetLobbiesAsync();
                _lobbies.AddRange(list);
            }
            catch (Exception ex)
            {
                MelonLogger.Error("Failed to fetch lobbies from registry: " + ex.Message);
            }

            try
            {
                SteamMatchmaking.AddRequestLobbyListFilterSlotsAvailable(1);
                SteamMatchmaking.AddRequestLobbyListDistanceFilter(ELobbyDistanceFilter.k_ELobbyDistanceFilterClose);
                SteamMatchmaking.AddRequestLobbyListResultCountFilter(50);

                SteamAPICall_t call = SteamMatchmaking.RequestLobbyList();
                _lobbyMatchList.Set(call, OnLobbyMatchListReceived);
            }
            catch (Exception ex)
            {
                MelonLogger.Error("Failed to request Steam lobby list: " + ex.Message);
                _isRefreshing = false;
            }
        }

        private void OnLobbyMatchListReceived(LobbyMatchList_t result, bool ioFailure) // steam lobbys too
        {
            _isRefreshing = false;

            if (ioFailure)
                return;

            int count = (int)result.m_nLobbiesMatching;
            for (int i = 0; i < count; i++)
            {
                CSteamID lobbyId = SteamMatchmaking.GetLobbyByIndex(i);
                string idString = lobbyId.ToString();

                bool exists = false;
                for (int j = 0; j < _lobbies.Count; j++)
                {
                    if (_lobbies[j].LobbyId == idString)
                    {
                        exists = true;
                        break;
                    }
                }
                if (exists)
                    continue;

                int playerCount = SteamMatchmaking.GetNumLobbyMembers(lobbyId);
                int maxPlayers = 4;

                string lobbyName = SteamMatchmaking.GetLobbyData(lobbyId, "LobbyName");
                string hostName = SteamFriends.GetFriendPersonaName(SteamMatchmaking.GetLobbyOwner(lobbyId));
                string region = SteamMatchmaking.GetLobbyData(lobbyId, "Locale");

                OpenGameInfo info = new OpenGameInfo
                {
                    LobbyId = idString,
                    LobbyName = string.IsNullOrEmpty(lobbyName) ? "Lobby " + lobbyId : lobbyName,
                    HostName = string.IsNullOrEmpty(hostName) ? "Host" : hostName,
                    Region = string.IsNullOrEmpty(region) ? string.Empty : region,
                    PlayerCount = playerCount,
                    MaxPlayers = maxPlayers,
                    Cycle = 0,
                    RepairStatus = 0,
                    IsPublic = true,
                    IsPasswordProtected = false,
                    Version = string.Empty
                };

                _lobbies.Add(info);
            }
        }

        private void TryJoinLobby(OpenGameInfo lobby) // does not work for right now and i dont know why
        {
            if (string.IsNullOrEmpty(lobby.LobbyId))
                return;

            SteamInviteDispatcher dispatcher = UnityEngine.Object.FindObjectOfType<SteamInviteDispatcher>();
            if (dispatcher != null)
            {
                dispatcher.RequestPublicJoinLobby(lobby.LobbyId, delegate
                {
                    dispatcher.JoinFriendWithMatchKeyProcess(lobby.LobbyId);
                });
                _visible = false;
                return;
            }

            ulong lobbyId;
            if (!ulong.TryParse(lobby.LobbyId, out lobbyId))
                return;

            CSteamID steamLobbyId = new CSteamID(lobbyId);
            if (!steamLobbyId.IsValid())
                return;

            SteamMatchmaking.JoinLobby(steamLobbyId);
            _visible = false;
        }
    }
}

