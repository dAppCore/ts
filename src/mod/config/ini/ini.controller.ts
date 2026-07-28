
import { Body, Controller, Post } from "@danet/core";
import { Tag } from "@danet/swagger/decorators";
import {IniService} from "./ini.service.ts";
import {INIObjectParseJSONDTO} from "./ini.interface.ts";

@Tag("Config")
@Controller("config/ini")
export class IniController {

  constructor(private iniService: IniService) {}

  /**
   * Parse an ini string and return a json object
   * @param {INIObjectParseJSONDTO} body
   * @returns {INIObject}
   */
  @Post("parseJSON")
  public parse(@Body() body: INIObjectParseJSONDTO) {
    return this.iniService.parse(body.data)
  }

}
