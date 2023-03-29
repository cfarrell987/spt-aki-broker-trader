using Aki.Common.Http;
using BepInEx;
using BrokerPatch;
using System.Runtime.CompilerServices;

namespace BrokerTraderPlugin
{
    [BepInPlugin(PluginInfo.PLUGIN_GUID, PluginInfo.PLUGIN_NAME, PluginInfo.PLUGIN_VERSION)]
    public class Plugin : BaseUnityPlugin
    {
        private void Awake()
        {
            // Plugin startup logic
            Logger.LogInfo($"Plugin {PluginInfo.PLUGIN_GUID} is loaded!");
            // Initialize PriceManager as early as possible, to let it collect data it needs from the server.
            RuntimeHelpers.RunClassConstructor(typeof(PriceManager).TypeHandle);
            new PatchMerchantsList().Enable(); // Should be first to pull trader list and some other data into PriceManage.
            new PatchTraderAssortmentController().Enable(); // Send client item data to server when user presses "DEAL!".
            new PatchTraderDealScreen().Enable(); // Selling money equivalent(total sell profit) patch.
            new PatchGetUserItemPrice().Enable(); // Individual item price display.
        }
    }
}
