import { crypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { Injectable } from "@danet/core";
@Injectable()
export class QuasiSaltService {
  constructor() {}

  /**
   * Holds the defult mapping swaps
   * @private
   */
  private _keyMap = {
    "o": "0",
    "l": "1",
    "e": "3",
    "a": "4",
    "s": "z",
    "t": "7",
    "0": "o",
    "1": "l",
    "3": "e",
    "4": "a",
    "7": "t",
  };

  /**
   * Sets the key map.
   * @param keyMap
   */
  setKeyMap(keyMap: any): void {
    this._keyMap = keyMap;
  }

  /**
   * Gets the key map.
   * @returns {any}
   */
  getKeyMap(): any {
    return this._keyMap;
  }

  hash(input: string): string {
    const hash = crypto.subtle.digestSync(
      "SHA-256",
      new TextEncoder().encode(input + this.createSalt(input)),
    );
    return encodeHex(hash);
  }

  /**
   * Creates a quasi-salt from a string.
   * @param input The input string.
   */
  createSalt(input: string): string {
    if (!input) {
      return "";
    }

    let i: number = input.length;
    let salt: string[] = [];
    while (i--) {
      const char: string = input[i];
      salt.push(this._keyMap[char] !== undefined ? this._keyMap[char] : char);
    }

    return salt.join("");
  }

  verify(input: string, hash: string): boolean {
    return this.hash(input) === hash;
  }

}
