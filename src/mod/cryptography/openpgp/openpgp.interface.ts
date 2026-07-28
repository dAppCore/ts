import { ApiProperty, Optional } from "@danet/swagger/decorators";


export class OpenPGPCreateKeyPairDTO {
  @ApiProperty()
  passphrase!: string;
  @ApiProperty()
  name!: string;
}

export class OpenPGPKeyPairDTO {
  @ApiProperty()
  publicKey!: string;
  @ApiProperty()
  privateKey!: string;
  @ApiProperty()
  revocationCertificate!: string;
}

export class OpenPGPEncryptBYIDDTO {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  message!: string;
  @ApiProperty()
  @Optional()
  passphrase?: string;
}

export class OpenPGPDecryptBYIDDTO {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  message!: string;
  @ApiProperty()
  passphrase!: string;
  @ApiProperty()
  @Optional()
  signedBy?: string;
}

export class OpenPGPSignBYIDDTO {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  message!: string;
  @ApiProperty()
  passphrase!: string;
}
export class OpenPGPVerifyBYIDDTO {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  message!: string;
}
export class OpenPGPGetPublicKeyDTO {
  @ApiProperty()
  id!: string;
}
