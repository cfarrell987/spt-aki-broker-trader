using Aki.Common.Http;
using BepInEx;
using BrokerPatch;
using BrokerTraderPlugin.Reflections;
using System;
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
            try
            {
                // Initialize PriceManager as early as possible, to let it collect data it needs from the server.
                RuntimeHelpers.RunClassConstructor(typeof(PriceManager).TypeHandle);
                if (PriceManager.ModConfig.UseClientPlugin)
                {
                    RuntimeHelpers.RunClassConstructor(typeof(CurrencyHelper).TypeHandle);
                    new PatchMerchantsList().Enable(); // Should be first to pull trader list and some other data into PriceManager.
                    if (PriceManager.ModConfig.UseRagfair)
                    {
                        new PatchRefreshRagfairOnTraderScreenShow().Enable(); // Refresh ragfair prices before opening Broker trader screen
                    }
                    new PatchSendDataOnDealButtonPress().Enable(); // Send client item data to server when user presses "DEAL!".
                    new PatchEquivalentSum().Enable(); // Selling money equivalent(total sell profit) patch.
                    new PatchGetUserItemPrice().Enable(); // Individual item price display.
                }
            }
            catch (Exception ex)
            {
                Logger.LogError($"Error! {PluginInfo.PLUGIN_GUID} threw an exception while loading, perhaps due to version incompatibility. Exception message: {ex.Message}");
                throw ex;
            }
        }
    }
}
