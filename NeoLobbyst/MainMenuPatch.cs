using System;
using HarmonyLib;
using MelonLoader;
using System.Reflection;
using UnityEngine;
using UnityEngine.EventSystems;

namespace NeoLobbyst
{
    [HarmonyPatch(typeof(MainMenu), "Start")]
    internal static class MainMenuStartPatch
    {
        private static void Postfix(MainMenu __instance)
        {
            try
            {
                var uimanProp = typeof(MainMenu).GetProperty("uiman", BindingFlags.NonPublic | BindingFlags.Instance);
                if (uimanProp == null) return;

                var uiman = uimanProp.GetValue(__instance) as UIManager;
                if (uiman == null) return;

                var ui_mainmenuField = typeof(MainMenu).GetField("ui_mainmenu", BindingFlags.NonPublic | BindingFlags.Instance);
                if (ui_mainmenuField == null) return;

                var ui_mainmenu = ui_mainmenuField.GetValue(__instance) as UIPrefab_MainMenu;
                if (ui_mainmenu == null) return;

                ui_mainmenu.OnJoinButtonPublic = delegate(string _)
                {
                    try
                    {
                        EventSystem current = EventSystem.current;
                        if (current != null)
                        {
                            current.SetSelectedGameObject(null);
                        }

                        NeoLobbyUI.Show();
                        MelonLogger.Msg("[NeoLobbyst] Opened lobby browser");
                    }
                    catch (Exception ex)
                    {
                        MelonLogger.Error($"[NeoLobbyst] Error opening lobby browser: {ex.Message}");
                    }
                };

                MelonLogger.Msg("[NeoLobbyst] MainMenu patched successfully");
            }
            catch (Exception ex)
            {
                MelonLogger.Warning($"[NeoLobbyst] Could not patch MainMenu: {ex.Message}");
            }
        }
    }
}

