import { ApiProperty } from "@danet/swagger/decorators";
import {ConfigObjectGetDTO} from "../object/object.interface.ts";

export class ConfigFileRenderDTO {
  @ApiProperty()
  file!: string;
  @ApiProperty()
  model!: any;
}

export class ConfigFileRenderAndLoadDTO {
  @ApiProperty()
  file!: string;
  @ApiProperty()
  model!: ConfigObjectGetDTO;
}

export class ConfigFileRenderStringDTO {
  @ApiProperty()
  template!: string;
  @ApiProperty()
  model!: any;
}

export class ConfigFileLoadDTO {
  @ApiProperty()
  filename!: string;
}
