import { CoreAccount } from "../../src/accounts/user.ts";
import { FileSystemService } from "src/mod/io/storage/client.service.ts";
import { QuasiSalt } from "src/mod/cryptography/hash/quasi-salt.ts";
import { OpenPGPService } from "src/mod/cryptography/openpgp/openpgp.ts";
import { assertEquals } from "../../deps-test.ts";

/**
 * Creates a OpenPGP user account relative to the running server
 * files should live in `$(pwd)/users/${QuasiSalt.hash("test")}.lthn.pub`
 * password for arnmoured OpenPGP files
 */
Deno.test("CoreAccount.create", async () => {
  const key: any = await CoreAccount.create("test", "test");
  await CoreAccount.create("test2", "test");

  assertEquals(
    FileSystemService.isFile(`users/${QuasiSalt.hash("test")}.lthn.pub`),
    true,
  );
  assertEquals(
    FileSystemService.isFile(`users/${QuasiSalt.hash("test")}.lthn.key`),
    true,
  );
  assertEquals(
    FileSystemService.isFile(`users/${QuasiSalt.hash("test")}.lthn.rev`),
    true,
  );
});

/**
 * Perform a login programmatically, the process is best described in the Rest test case
 */
Deno.test("CoreAccount.login - Good", async () => {
  if (!FileSystemService.isFile("users/server.lthn.pub")) {
    await OpenPGPService.createServerKeyPair();
  }

  const auth = await OpenPGPService.sign(
    `{"id":"${QuasiSalt.hash("test")}"}`,
    QuasiSalt.hash("test"),
    "test",
  );

  const encryptedTest = await OpenPGPService.encryptPGP(
    "server",
    auth,
  );

  assertEquals(
    await CoreAccount.login(encryptedTest),
    QuasiSalt.hash("test"),
  );
});

/**
 * this should fail from the message inside the encrypted payload being signed by the wrong key
 * than the hash requested
 */
Deno.test("CoreAccount.login - Bad Not signed by req user", async () => {
  if (!FileSystemService.isFile("users/server.lthn.pub")) {
    await OpenPGPService.createServerKeyPair();
  }

  const auth2 = await OpenPGPService.sign(
    `{"id":"${QuasiSalt.hash("test")}"}`,
    QuasiSalt.hash("test2"),
    "test",
  );

  const encryptedTest2 = await OpenPGPService.encryptPGP(
    "server",
    auth2,
  );

  assertEquals(await CoreAccount.login(encryptedTest2), false);
});

/**
 * fail because the system dosnt know this user
 */
Deno.test("CoreAccount.login - Bad Not known user", async () => {
  if (!FileSystemService.isFile("users/server.lthn.pub")) {
    await OpenPGPService.createServerKeyPair();
  }

  const auth2 = await OpenPGPService.sign(
    `{"id":"${QuasiSalt.hash("testwewew")}"}`,
    QuasiSalt.hash("test"),
    "test",
  );

  const encryptedTest2 = await OpenPGPService.encryptPGP(
    "server",
    auth2,
  );

  assertEquals(await CoreAccount.login(encryptedTest2), false);
});

/**
 * Clean up the test data (and test deleting)
 */
Deno.test("CoreAccount.delete", async () => {
  await CoreAccount.delete("test");
  await CoreAccount.delete("test2");

  assertEquals(
    FileSystemService.isFile(`users/${QuasiSalt.hash("test")}.lthn.pub`),
    false,
  );
  assertEquals(
    FileSystemService.isFile(`users/${QuasiSalt.hash("test")}.lthn.key`),
    false,
  );
  assertEquals(
    FileSystemService.isFile(`users/${QuasiSalt.hash("test")}.lthn.rev`),
    false,
  );
});
