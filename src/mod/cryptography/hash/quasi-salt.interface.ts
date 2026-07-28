import { ApiProperty } from "@danet/swagger/decorators";

export class QuasiSaltHashDTO {
  @ApiProperty()
  input: string;
}

export class QuasiSaltHashVerifyDTO {
  @ApiProperty()
  input: string;
  @ApiProperty()
  hash: string;
}
