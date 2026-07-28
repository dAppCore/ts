import { ApiProperty } from "@danet/swagger/decorators";

export class HashDTO {
  @ApiProperty()
  input!: string;
}
