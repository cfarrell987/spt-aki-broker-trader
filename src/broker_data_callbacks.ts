import { DataCallbacks } from "@spt-aki/callbacks/DataCallbacks";
import { HideoutController } from "@spt-aki/controllers/HideoutController";
import { RagfairController } from "@spt-aki/controllers/RagfairController";
import { IEmptyRequestData } from "@spt-aki/models/eft/common/IEmptyRequestData";
import { IGetItemPricesResponse } from "@spt-aki/models/eft/game/IGetItemPricesResponse";
import { IGetBodyResponseData } from "@spt-aki/models/eft/httpResponse/IGetBodyResponseData";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { HttpResponseUtil } from "@spt-aki/utils/HttpResponseUtil";
import { inject, injectable } from "tsyringe";

@injectable()
export class BrokerDataCallbacks extends DataCallbacks 
{
    constructor(
    @inject("HttpResponseUtil") httpResponse: HttpResponseUtil,
        @inject("DatabaseServer") databaseServer: DatabaseServer, 
        @inject("RagfairController") ragfairController: RagfairController, 
        @inject("HideoutController") hideoutController: HideoutController
    )
    {
        super(httpResponse, databaseServer, ragfairController, hideoutController);
    }

    public override getItemPrices(url: string, info: IEmptyRequestData, sessionID: string): IGetBodyResponseData<IGetItemPricesResponse> 
    {
        const result = super.getItemPrices(url, info, sessionID);
        console.log("[URL DUMP]");
        console.log(JSON.stringify(url));
        console.log("[INFO DUMP]");
        console.log(JSON.stringify(info));
        console.log("[SESSION_ID DUMP]");
        console.log(JSON.stringify(sessionID));

        // result returns an IGetBodyResponseData object(actually a string?) which has a function(?)
        // with parameter "data" of generic type and returns a value of the same generic type?
        // i'm confused by this but converting to string even though it's kind of a string and then parsing works, so whatever.
        const parsedResult = JSON.parse(result.toString()) as IGetBodyResponseData<IGetItemPricesResponse>;
        // if (prices == undefined) return result;
        for (const item in parsedResult["data"]["prices"])
        {
            parsedResult["data"]["prices"][item] = 100
            // parsedResult().prices;
        }
        console.log("[PARSED DUMP]");
        console.log(parsedResult);
        const stringifiedResult = JSON.stringify(parsedResult);
        return stringifiedResult as unknown as IGetBodyResponseData<IGetItemPricesResponse> ;
        // console.log("[RESULT DUMP]");
        // console.log(JSON.stringify(parsedResult))
        // return result;
    }


}