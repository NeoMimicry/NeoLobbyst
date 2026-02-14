using System;
using HarmonyLib;

namespace NeoLobbyst
{
    [HarmonyPatch(typeof(UIPrefab_MainMenu), "Awake")]
    internal static class MainMenuPatch
    {
        private static void Postfix(UIPrefab_MainMenu __instance)
        {
            __instance.OnJoinButtonPublic = _ =>
            {
                TestingGUI.ToggleFromMenu();
            };
        }
    }
}

