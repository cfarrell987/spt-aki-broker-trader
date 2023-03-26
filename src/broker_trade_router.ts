import { IGetBodyResponseData } from "@spt-aki/models/eft/httpResponse/IGetBodyResponseData";
import { DynamicRouterModService } from "@spt-aki/services/mod/dynamicRouter/DynamicRouterModService"
import { JsonUtil } from "@spt-aki/utils/JsonUtil";
import { DependencyContainer } from "tsyringe"
import { BrokerPriceManager } from "./broker_price_manager"

import modInfo from "../package.json";
import { VerboseLogger } from "./verbose_logger";
import { HttpResponseUtil } from "@spt-aki/utils/HttpResponseUtil";

export class BrokerTraderRouter
{
    private static container: DependencyContainer;
    private static router: DynamicRouterModService;
    private static http: HttpResponseUtil;
    private static jsonUtil: JsonUtil;

    private static logPrefix = `[${modInfo.name} ${modInfo.version}]`;

    public static registerRouter(container: DependencyContainer): void
    {
        this.container = container;
        this.router = container.resolve<DynamicRouterModService>(DynamicRouterModService.name);
        this.jsonUtil = container.resolve<JsonUtil>(JsonUtil.name);
        this.http = container.resolve<HttpResponseUtil>(HttpResponseUtil.name);

        const logger = new VerboseLogger(container);
        
        logger.explicitInfo(`${this.logPrefix} Registering BrokerTraderRouter...`)
        this.router.registerDynamicRouter(
            "BrokerTraderRouter",
            [
                {
                    url: "/broker-trader/supported-trader-ids",
                    action: (url, info, sessionId, output) =>
                    {
                        return this.respondSupportedTraderIds();
                    }
                },
                {
                    url: "/broker-trader/item-ragfair-price-table",
                    action: (url, info, sessionId, output) =>
                    {
                        return this.respondItemRagfairPriceTable();
                    }
                }
            ],
            "broker-trader"
        )
    }

    private static respondSupportedTraderIds(): string
    {
        return this.http.noBody(Object.values(BrokerPriceManager.instance.supportedTraders));
    }
    
    private static respondItemRagfairPriceTable(): string
    {
        return this.http.noBody(BrokerPriceManager.instance.itemRagfairPriceTable);
    }
}