import { assertEquals, expect, superoak } from "../../deps-test.ts";

import { OpenPGPService } from "src/mod/cryptography/openpgp/openpgp.ts";
import { QuasiSalt } from "src/mod/cryptography/hash/quasi-salt.ts";
import { CoreAccount } from "../../src/accounts/user.ts";
import { FileSystemService } from "src/mod/io/storage/client.service.ts";
import { AppController } from "../../src/app.controller.ts";

const AppControl = new AppController()
const app = AppControl.app

if (!FileSystemService.isFile("users/server.lthn.pub")) {
  await OpenPGPService.createServerKeyPair();
}

Deno.test("POST /auth/login -- good", async () => {
  const request = await superoak(app);

  // make user OpenPGP keys for user test with password test
  await CoreAccount.create("test", "test");
  // create signed message to send to the server
  const auth = await OpenPGPService.sign(
    `{"id":"${QuasiSalt.hash("test")}"}`,
    QuasiSalt.hash("test"),
    "test",
  );

  // use the server public key to encrypt the message
  const encryptedTest = await OpenPGPService.encryptPGP(
    "server",
    auth,
  );

  // test auth works without a REST interface
  assertEquals(
    await CoreAccount.login(encryptedTest),
    QuasiSalt.hash("test"),
  );

  // test auth works with a REST interface
  await request.post("/auth/login")
    .set("Content-Type", "application/json")
    .send(`{"payload": "${btoa(encryptedTest)}"}`)
    .expect(200)
    .set("Accept", "application/json")
    .then(async (response1: any) => {
      // decompress the response
      const reply = atob(JSON.parse(response1.text)['result'])
      // decrypt the reply with the initial user private key
      const token = JSON.parse(await OpenPGPService.decryptPGP(QuasiSalt.hash("test"), reply, 'test'))
      // test the access_token is returned
      expect(token).toHaveProperty("access_token");
      // test the refresh_token is returned
      expect(token).toHaveProperty("refresh_token");
    })
});


Deno.test("POST /auth/login -- bad", async () => {
  const request = await superoak(app);
  await CoreAccount.create("test", "test");

  // create signed message using the wrong private key for the requested user
  const auth = await OpenPGPService.sign(
    `{"id":"${QuasiSalt.hash("testwewew")}"}`,
    QuasiSalt.hash("test"),
    "test",
  );

  // use the server public key to encrypt the message
  const encryptedTest = await OpenPGPService.encryptPGP(
    "server",
    auth,
  );

  // test auth fails without a REST interface
  assertEquals(
    await CoreAccount.login(encryptedTest),
    false,
  );

  // test auth fails with a REST interface
  await request.post("/auth/login")
    .set("Content-Type", "application/json")
    .send(`{"payload": "${btoa(encryptedTest)}"}`)
    .expect(401)
    .set("Accept", "application/json")
    .expect(`{"result":false}`);
});

