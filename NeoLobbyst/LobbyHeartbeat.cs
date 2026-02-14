using System;
using MelonLoader;
using NeoLobbyst;
using Steamworks;
using UnityEngine;

namespace NeoLobbyst
{
    public class LobbyHeartbeat : MonoBehaviour
    {
        private static LobbyHeartbeat _instance;

        private CSteamID _lobbyId;
        private float _interval = 10f;
        private float _nextTime;

        public static void StartHeartbeat(CSteamID lobbyId)
        {
            if (lobbyId == CSteamID.Nil)
            {
                return;
            }

            if (_instance == null)
            {
                GameObject go = new GameObject(nameof(LobbyHeartbeat));
                UnityEngine.Object.DontDestroyOnLoad(go);
                _instance = go.AddComponent<LobbyHeartbeat>();
            }

            _instance._lobbyId = lobbyId;
            _instance._nextTime = Time.unscaledTime + _instance._interval;
            MelonLogger.Msg("LobbyHeartbeat: started for lobbyId=" + lobbyId + ", first heartbeat in " + _instance._interval + "s");
        }

        public static void StopHeartbeat()
        {
            if (_instance == null)
            {
                return;
            }
            MelonLogger.Msg("LobbyHeartbeat.StopHeartbeat: clearing lobbyId (was " + _instance._lobbyId + ")");
            _instance._lobbyId = CSteamID.Nil;
        }

        private void Update()
        {
            if (_lobbyId == CSteamID.Nil)
                // should remove the lobby form api?
                return;

            if (Time.unscaledTime < _nextTime)
                return;

            _nextTime = Time.unscaledTime + _interval;

            int playerCount = SteamMatchmaking.GetNumLobbyMembers(_lobbyId);
            MelonLogger.Msg("LobbyHeartbeat.Update: sending heartbeat lobbyId=" + _lobbyId + " playerCount=" + playerCount);
            SendHeartbeat(_lobbyId, playerCount);
        }

        private static async void SendHeartbeat(CSteamID lobbyId, int playerCount)
        {
            string lobbyIdStr = lobbyId.ToString();
            try
            {
                await LobbyAPI.SendHeartbeatAsync(lobbyIdStr, playerCount);
            }
            catch (Exception ex)
            {
                MelonLogger.Error("LobbyAPI.SendHeartbeatAsync failed: " + ex.Message);
                MelonLogger.Error("LobbyHeartbeat.SendHeartbeat exception: " + ex.ToString());
            }
        }
    }
}

