import { ApiProperty, Optional } from "@danet/swagger/decorators";

export class EncryptedRequestDTO {
  @ApiProperty()
  payload!: string;

  @ApiProperty()
  @Optional()
  signature?: string;
}

export class EncryptedResponseDTO {
  @ApiProperty()
  result!: string;

  @ApiProperty()
  @Optional()
  signature?: string;
}

export class DeleteAccountDTO {
  @ApiProperty()
  username!: string;

  @ApiProperty()
  password!: string;
}

export class CreateAccountDTO {
  @ApiProperty()
  username!: string;

  @ApiProperty()
  password!: string;
}

export class CreateAccountResponseDTO {
  @ApiProperty()
  userhash!: string;

  @ApiProperty()
  pubkey!: string;
}
