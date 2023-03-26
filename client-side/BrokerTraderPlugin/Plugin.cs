using BepInEx;
using PricePatch;
namespace BrokerTraderPlugin
{
    [BepInPlugin(PluginInfo.PLUGIN_GUID, PluginInfo.PLUGIN_NAME, PluginInfo.PLUGIN_VERSION)]
    public class Plugin : BaseUnityPlugin
    {
        private void Awake()
        {
            // Plugin startup logic
            Logger.LogInfo($"Plugin {PluginInfo.PLUGIN_GUID} is loaded!");
            new PatchMerchantsList().Enable(); // Should be first to pull trader data and let PriceManager initialize.
            new PatchGetUserItemPrice().Enable(); // Where the price actually gets applied.

        }
    }
}
