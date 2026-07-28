import { ReturnedType } from "@danet/swagger/decorators";
import { Body, Controller, Post } from "@danet/core";
import { Tag } from "@danet/swagger/decorators"
import {OpenPGPService} from "./openpgp.service.ts";
import {
  OpenPGPCreateKeyPairDTO,
  OpenPGPDecryptBYIDDTO,
  OpenPGPEncryptBYIDDTO, OpenPGPGetPublicKeyDTO,
  OpenPGPKeyPairDTO, OpenPGPSignBYIDDTO, OpenPGPVerifyBYIDDTO
} from "./openpgp.interface.ts";
@Tag("Cryptography")
@Controller("crypto/openpgp")
export class OpenPGPController {

  constructor(private openpgp: OpenPGPService) {}

  @Post("generate-key-pair")
  @ReturnedType(OpenPGPKeyPairDTO)
  async generateKeyPair(@Body() body: OpenPGPCreateKeyPairDTO): Promise<OpenPGPKeyPairDTO> {
    const keys = await this.openpgp.createKeyPair(body.name, body.passphrase);

    return {
      publicKey: keys.publicKey.toString(),
      privateKey: keys.privateKey.toString(),
      revocationCertificate: keys.revocationCertificate
    }
  }

  @Post("encrypt")
  @ReturnedType(String)
  async encrypt(@Body() body: OpenPGPEncryptBYIDDTO): Promise<string> {
    let passphrase = undefined;
    if(body.passphrase){
      passphrase = body.passphrase;
    }
    return await this.openpgp.encryptPGP(body.id, body.message, passphrase);
  }

  @Post("decrypt")
  @ReturnedType(String)
  async decrypt(@Body() body: OpenPGPDecryptBYIDDTO): Promise<string> {
    let signedBy = undefined;
    if(body.signedBy){
      signedBy = body.signedBy;
    }
    return await this.openpgp.decryptPGP(body.id, body.message, body.passphrase, signedBy);
  }

  @Post("sign")
  @ReturnedType(String)
  async sign(@Body() body: OpenPGPSignBYIDDTO): Promise<string> {
    return await this.openpgp.sign(body.message, body.id, body.passphrase);
  }

  @Post("verify")
  @ReturnedType(Boolean)
  async verify(@Body() body: OpenPGPVerifyBYIDDTO): Promise<boolean> {
    return await this.openpgp.verify(body.message, body.id);
  }

  @Post("get-public-key")
  @ReturnedType(String)
  async getPublicKey(@Body() body: OpenPGPGetPublicKeyDTO): Promise<string> {
    return (await this.openpgp.getPublicKey(body.id)).armor().toString()
  }
}
