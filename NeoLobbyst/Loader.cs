using HarmonyLib;
using MelonLoader;
using NeoLobbyst;

[assembly: MelonInfo(typeof(NeoLobbyst.Loader), "NeoLobbyst", "0.1.0", "NeoMimicry")]
[assembly: MelonGame("ReLUGames", "MIMESIS")]

namespace NeoLobbyst
{
    public class Loader : MelonMod
    {
        private HarmonyLib.Harmony? _harmony;

        public override void OnInitializeMelon()
        {
            _harmony = new HarmonyLib.Harmony("NeoLobbyst");
            _harmony.PatchAll();
        }

        public override void OnSceneWasLoaded(int buildIndex, string sceneName)
        {
            //TestingGUI.Instance();
        }
    }
}

