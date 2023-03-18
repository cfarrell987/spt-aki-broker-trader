import { DependencyContainer } from "tsyringe";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";

import modConfig from "../config/config.json";

/**
 * An upscaled logger which has optional and explicit logging funcions.
 * Optional functions output a message based on the "verbose" value in config.json:
 * 
 * { 
 *      "logger": {
 *          "verbose":true/false
 *      } 
 * }
 * 
 * Version 230309
 */
class VerboseLogger 
{
    private logger: ILogger;
    private verbose: boolean;
    constructor(container: DependencyContainer) 
    {
        this.logger = container.resolve<ILogger>("WinstonLogger");
        this.verbose = modConfig.logger.verbose;
    }

    private format(...args: any[]): string 
    {
        let buffer = args[0];
        const matches = buffer.match(/%\d+[s]/g);
        if (matches != null && args.length > 1) 
        {
            const spaces = matches.map((e: string) => e.match(/\d+/).pop());

            for (let index = 1; index < args.length; ++index) 
            {
                const argument = (typeof args[index] === "string") ? args[index] : args[index].toString();
                const space = spaces[index - 1];
                let newString = argument;

                if (space > argument.length) 
                {
                    newString += " ".repeat(space - argument.length);
                }

                buffer = buffer.replace(/%\d+[s]/, newString);
            }
        }
        return buffer;
    }

    public log(args: string | any[], color: string, backgroundColor?: string): void 
    {
        if (this.verbose) 
        {
            if (Array.isArray(args))
                this.logger.log(this.format(...args), color, backgroundColor);
            else
                this.logger.log(args, color, backgroundColor);
        }
    }

    public info(...args: any[]): void 
    {
        if (this.verbose) 
        {
            this.logger.info(this.format(...args));
        }
    }

    public warning(...args: any[]): void 
    {
        if (this.verbose) 
        {
            this.logger.warning(this.format(...args));
        }
    }

    public error(...args: any[]): void 
    {
        if (this.verbose) 
        {
            this.logger.error(this.format(...args));
        }
    }

    public success(...args: any[]): void 
    {
        if (this.verbose) 
        {
            this.logger.success(this.format(...args));
        }
    }

    public explicitLog(args: string | any[], color: string, backgroundColor?: string): void 
    {
        if (Array.isArray(args))
            this.logger.log(this.format(...args), color, backgroundColor);
        else
            this.logger.log(args, color, backgroundColor);
    }

    public explicitInfo(...args: any[]): void 
    {
        this.logger.info(this.format(...args));
    }

    public explicitWarning(...args: any[]): void 
    {
        this.logger.warning(this.format(...args));
    }

    public explicitError(...args: any[]): void 
    {
        this.logger.error(this.format(...args));
    }

    public explicitSuccess(...args: any[]): void 
    {
        this.logger.success(this.format(...args));
    }

}

export { VerboseLogger };