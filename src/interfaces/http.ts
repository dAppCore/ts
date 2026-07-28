import { ApiProperty, Optional } from "@danet/swagger/decorators";
import { HTTP_STATUS } from "./status-codes.ts";



export class ServerResponse {
    @ApiProperty({enum: [200,404], example: 200})
    status!: number;
    
    @ApiProperty()
    data!: string;

    @ApiProperty()
    @Optional()
    signature?: string;

    constructor(status: HTTP_STATUS, data: string) {
        this.status = status;
        this.data = data;
        this.signature = '';
    }
}

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
