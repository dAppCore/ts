import { crypto, DigestAlgorithm } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { Injectable } from "@danet/core";
@Injectable()
export class HashService {

  hash(input: string, algorithm: DigestAlgorithm = 'SHA-256'): string {
    const hash = crypto.subtle.digestSync(
      algorithm,
      new TextEncoder().encode(input),
    );
    return encodeHex(hash);
  }
}
