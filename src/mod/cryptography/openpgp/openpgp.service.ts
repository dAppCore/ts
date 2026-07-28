import * as openpgp from "openpgp";
import * as path from "@std/path";
import { Injectable } from "@danet/core";
import {ModIoFsLocalService} from "../../io/fs/local/service.ts";
import {QuasiSaltService} from "../hash/quasi-salt.service.ts";

/**
 * OpenPGP Service
 *
 * @export
 * @class OpenPGPService
 */
@Injectable()
export class OpenPGPService {

  constructor(private fileService: ModIoFsLocalService, private quasi: QuasiSaltService) {
  }

  /**
   * @param {string} id
   * @param {string} data
   * @param {string} passphrase
   * @returns {Promise<string>}
   */
  async encryptPGP(
    id: string,
    data: string,
    passphrase?: string
  ): Promise<string> {
    const key = await this.getPublicKey(id);
    let signingKey = undefined;
    if (passphrase) {
      signingKey = await this.getPrivateKey(id, passphrase);
    }
    // Armoured output over a non-stream message is a string; the WebStream
    // arm of the union only applies to streamed input, which this is not.
    return await openpgp.encrypt({
      message: await openpgp.createMessage({
        text: data
      }),
      encryptionKeys: key,
      signingKeys: signingKey
    }) as string;
  }

  /**
   * @param {string} id
   * @param {string} message
   * @param {string} passphrase
   * @param signedBy
   * @returns {Promise<string>}
   */
  async decryptPGP(
    id: string,
    message: string,
    passphrase: string,
    signedBy?: string
  ): Promise<string> {
    if (!id) {
      throw new Error("No id provided");
    }
    if (!message) {
      throw new Error("No message to decrypt");
    }

    if (!passphrase) {
      throw new Error("No passphrase provided");
    }
    const privateKey = await this.getPrivateKey(id, passphrase);

    let options: any = {
      message: await this.readMessage(message),
      decryptionKeys: privateKey
    };
    if (signedBy) {
      options["verificationKeys"] = await this.getPublicKey(id);
    }

    const data: any = await openpgp.decrypt(options);

    try {
      if (
        signedBy && data["signatures"].length > 0 &&
        data["signatures"][0].verified
      ) {
        await data["signatures"][0].verified;
      }
    } catch (e) {
      throw new Error("Signature could not be verified: " + String(e));
    }

    return data["data"];
  }

  /**
   * @param {string} id
   * @param {string} passphrase
   * @returns {Promise<string>}
   */
  async getPrivateKey(id: string, passphrase: string) {
    if (!id) {
      throw new Error("No id provided");
    }

    if (!passphrase) {
      throw new Error("No passphrase provided");
    }

    const privateKey = this.fileService.read(`users/${id}.lthn.key`);

    if (!privateKey || privateKey.length === 0) {
      throw new Error(`Failed to load private key id: ${id}`);
    }

    return await openpgp.decryptKey({
      privateKey: await openpgp.readPrivateKey({ armoredKey: privateKey }),
      passphrase
    }) as openpgp.PrivateKey;
  }

  /**
   * @param {string} id
   * @returns {Promise<openpgp.PublicKey>}
   */
  async getPublicKey(id: string) {
    if (!id) {
      throw new Error("No id provided");
    }
    const publicKey = this.fileService.read(`users/${id}.lthn.pub`);

    if (!publicKey || publicKey.length === 0) {
      throw new Error(`Failed to load public key id: ${id}`);
    }

    return await openpgp.readKey({
      armoredKey: publicKey
    }) as openpgp.PublicKey;
  }

  /**
   * @param {string} data
   * @returns {Promise<any>}
   */
  async readMessage(data: string) {
    return await openpgp.readMessage({
      armoredMessage: data
    }) as openpgp.Message<string>;
  }

  async readSignedMessage(data: string) {
    return await openpgp.readCleartextMessage({
      cleartextMessage: data
    }) as openpgp.CleartextMessage;
  }

  /**
   * Creates an Armoured OpenPGP key for the username protected with the password supplied
   *
   * @param username
   * @param password
   * @returns {Promise<any>}
   */
  public async createKeyPair(username: string, password: string) {
    return await openpgp.generateKey({
      type: "rsa", // Type of the key, defaults to ECC
      rsaBits: 4096,
      userIDs: [{ name: username }], // you can pass multiple user IDs
      passphrase: password, // protects the private key
      format: "armored" // output key format, defaults to 'armored' (other options: 'binary' or 'object')
    });
  }

  /**
   * @param {string} id
   * @param {string} passphrase
   * @returns {Promise<string>}
   */
  public async createServerKeyPair() {
    const { privateKey, publicKey, revocationCertificate }: any =
      await this.createKeyPair(
        "server",
        this.quasi.hash(path.join(Deno.cwd(), "users", "server.lthn.pub"))
      );

    this.fileService.write(`users/server.lthn.pub`, publicKey);

    this.fileService.write(`users/server.lthn.rev`, revocationCertificate);

    this.fileService.write(`users/server.lthn.key`, privateKey);
  }

  /**
   * @param {string} id
   * @param {string} passphrase
   * @returns {Promise<string>}
   */
  async createUserKeyPair(username: string, password: string) {
    const usernameHash = this.quasi.hash(username);
    const { privateKey, publicKey, revocationCertificate }: any =
      await this.createKeyPair(usernameHash, password);

    this.fileService.write(`users/${usernameHash}.lthn.pub`, publicKey);

    this.fileService.write(
      `users/${usernameHash}.lthn.rev`,
      revocationCertificate
    );

    this.fileService.write(`users/${usernameHash}.lthn.key`, privateKey);
  }

  async sign(data: string, privateKey: string, passphrase: string) {
    const options: any = {
      message: await openpgp.createCleartextMessage({ text: data }),
      signingKeys: await this.getPrivateKey(privateKey, passphrase)
    };

    // Armoured output over a cleartext message is a string; the WebStream arm
    // of openpgp's union only applies to streamed input, which this is not.
    return await openpgp.sign(options) as string;
  }

  async verify(data: any, publicKey: string) {
    const options: any = {
      message: data,
      verificationKeys: await this.getPublicKey(publicKey)
    };

    const verificationResult: any = await openpgp.verify(options);

    const { verified, keyID } = verificationResult.signatures[0];
    try {
      await verified; // throws on invalid signature
      //console.log('Signed by key id ' + keyID.toHex());
      return keyID.toHex();
    } catch (e) {
      return false;
    }
  }
}
