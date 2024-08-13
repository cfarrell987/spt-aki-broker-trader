using EFT.InventoryLogic;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace BrokerTraderPlugin.Reflections
{
    internal class TraderInfo : ReflectionBase
    {
        public TraderInfo(object instance)
        {
            ReflectedInstance = instance;
            ReflectedType = instance.GetType();
        }

        public bool CanBuyItem(Item item)
        {
            return InvokeMethod<bool>("CanBuyItem", [item], [typeof(Item)]);
        }

        public double ApplyPriceModifier(double basePrice)
        {
            return InvokeMethod<double>("ApplyPriceModifier", [basePrice], [typeof(double)]);
        }

        public bool Unlocked
        {
            get
            {
                return GetFieldValue<bool>("Unlocked");
            }
        }
    }
}
