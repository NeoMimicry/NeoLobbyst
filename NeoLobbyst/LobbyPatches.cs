using System;
using HarmonyLib;
using MelonLoader;
using NeoLobbyst;
using MimicAPI.GameAPI;
using Steamworks;

namespace NeoLobbyst
{
    [HarmonyPatch(typeof(SteamInviteDispatcher))]
    internal static class LobbyPatches
    {
        [HarmonyPostfix]
        [HarmonyPatch("OnLobbyCreated")]
        private static void OnLobbyCreatedPostfix(SteamInviteDispatcher __instance)
        {
            CSteamID lobbyId = __instance.joinedLobbyID;
            if (lobbyId == CSteamID.Nil)
            {
                return;
            }
            MelonLogger.Msg("OnLobbyCreatedPostfix: lobbyId=" + lobbyId);

            string publicValue = SteamMatchmaking.GetLobbyData(lobbyId, SteamInviteDispatcher.IS_PUBLIC_KEY);
            bool isPublic = publicValue == "true";
            MelonLogger.Msg("OnLobbyCreatedPostfix: PublicRoom=" + publicValue + ", isPublic=" + isPublic);

            string lobbyName = SteamMatchmaking.GetLobbyData(lobbyId, SteamInviteDispatcher.LOBBY_NAME_KEY);
            string region = SteamMatchmaking.GetLobbyData(lobbyId, SteamInviteDispatcher.LOCALE_KEY);
            string version = SteamMatchmaking.GetLobbyData(lobbyId, SteamInviteDispatcher.VERSION_KEY);

            int cycle;
            int.TryParse(SteamMatchmaking.GetLobbyData(lobbyId, SteamInviteDispatcher.CYCLE_KEY), out cycle);

            int repairStatus;
            int.TryParse(SteamMatchmaking.GetLobbyData(lobbyId, SteamInviteDispatcher.REPAIR_STATUS_KEY), out repairStatus);

            int playerCount = SteamMatchmaking.GetNumLobbyMembers(lobbyId);
            int maxPlayers = 4;

            string hostName = string.Empty;
            Hub.PersistentData? pdata = CoreAPI.GetPersistentData();
            if (pdata != null)
                hostName = pdata.MyNickName;
            if (string.IsNullOrEmpty(hostName))
                hostName = SteamFriends.GetPersonaName();
            if (string.IsNullOrEmpty(hostName))
                hostName = "Host";

            OpenGameInfo info = new OpenGameInfo
            {
                LobbyId = lobbyId.ToString(),
                LobbyName = string.IsNullOrEmpty(lobbyName) ? "Lobby " + lobbyId : lobbyName,
                HostName = hostName,
                Region = string.IsNullOrEmpty(region) ? string.Empty : region,
                PlayerCount = playerCount,
                MaxPlayers = maxPlayers,
                Cycle = cycle,
                RepairStatus = repairStatus,
                IsPublic = isPublic,
                IsPasswordProtected = false,
                Version = version ?? string.Empty
            };

            MelonLogger.Msg("Registering lobby and starting heartbeat: " + info.LobbyName);
            RegisterLobby(info);
            LobbyHeartbeat.StartHeartbeat(lobbyId);
        }

        private static async void RegisterLobby(OpenGameInfo info)
        {
            try
            {
                await LobbyAPI.RegisterLobbyAsync(info, string.Empty);
                MelonLogger.Msg("RegisterLobby: success for lobbyId=" + info.LobbyId);
            }
            catch (Exception ex)
            {
                MelonLogger.Error("LobbyAPI.RegisterLobbyAsync failed: " + ex.Message);
                MelonLogger.Error("RegisterLobby exception: " + ex.ToString());
            }
        }

        [HarmonyPrefix]
        [HarmonyPatch("LeaveLobby")]
        private static void LeaveLobbyPrefix(SteamInviteDispatcher __instance)
        {
            CSteamID lobbyId = __instance.joinedLobbyID;
            if (lobbyId == CSteamID.Nil)
            {
                return;
            }
            MelonLogger.Msg("LeaveLobbyPrefix: stopping heartbeat and removing lobbyId=" + lobbyId);
            LobbyHeartbeat.StopHeartbeat();
            RemoveLobby(lobbyId);
        }

        private static async void RemoveLobby(CSteamID lobbyId)
        {
            try
            {
                await LobbyAPI.RemoveLobbyAsync(lobbyId.ToString());
            }
            catch (Exception ex)
            {
                MelonLogger.Error("LobbyAPI.RemoveLobbyAsync failed: " + ex.Message);
            }
        }
    }
}

