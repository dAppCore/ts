import { ApiProperty } from "@danet/swagger/decorators";

export interface UserINIObject {
  parse(str: string): object;

  stringify(obj: object): string;
}

// internal ini variable object, its what is used for vars
export interface INIVariableObject {
  [name: string]: number | string | boolean | null;
}

// internal INI object, its what parseFunc() parses to.
export interface INIObject {
  [section: string]: INIVariableObject;
}

export class INIObjectParseJSONDTO {
  @ApiProperty()
  data!: string;
}
