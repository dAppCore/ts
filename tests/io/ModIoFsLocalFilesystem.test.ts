
import { assertEquals } from "../../deps-test.ts";
import  * as path from "@std/path";
import { ModIoFsLocalService } from "../../src/mod/io/fs/local/service.ts";
const filesystem = new ModIoFsLocalService();
Deno.test('ClientService.path - "root" fs test', async () => {
  assertEquals(
      filesystem.path("/"),
    Deno.cwd(),
    "root path should be equal to current working directory",
  );
  assertEquals(
      filesystem.path("/users"),
    path.join(Deno.cwd(), "users"),
    "user path should be equal to current working directory",
  );
  assertEquals(
      filesystem.path("../etc"),
    path.join(Deno.cwd(), "etc"),
    "path escalated from current working directory",
  );
  assertEquals(
      filesystem.path("../../etc"),
    path.join(Deno.cwd(), "etc"),
    "path escalated from current working directory",
  );
  assertEquals(
      filesystem.path("mod.ts"),
    path.join(Deno.cwd(), "mod.ts"),
    "mod.ts should be in current working directory",
  );
});

Deno.test("ClientService.isDir", async () => {
  assertEquals(
      filesystem.isDir("/"),
    true,
    `${Deno.cwd()} is not a directory`,
  );
});

Deno.test("ClientService.isFile", async () => {
  assertEquals(
      filesystem.isFile("/LICENCE"),
    true,
    `Put the EUPL-1.2 licence back where you found it, ${
      path.join(Deno.cwd(), "LICENCE")
    } `,
  );
});

Deno.test("ClientService.write", async () => {
  const filePath = "test.txt";
  const fileContent = "Hello World";

  assertEquals(
      filesystem.write(filePath, fileContent),
    true,
    `File ${filePath} was not written`,
  );
});

Deno.test("ClientService.delete", async () => {
  assertEquals(filesystem.delete("test.txt"), true, "File not deleted");
});

Deno.test("ClientService.read", async () => {
  const filePath = "test.txt";
  const fileContent = "Hello World";

  assertEquals(filesystem.write(filePath, fileContent), true);

  assertEquals(
      filesystem.read(filePath),
    fileContent,
    `${filePath} should contain ${fileContent}`,
  );
});

Deno.test("ClientService.list", async () => {
  const files = filesystem.list("/");
  assertEquals(files.length > 0, true);

  files.forEach((file) => {
    assertEquals(
        filesystem.isFile(file) || filesystem.isDir(file),
      true,
      `${file} is not a file or directory`,
    );
  });
});

Deno.test("ClientService.ensureDir", async () => {
  assertEquals(
      filesystem.ensureDir("testing/testing"),
    true,
    "testing/testing should be created",
  );
  assertEquals(
      filesystem.isDir("testing/testing"),
    true,
    `${path.join(Deno.cwd(), "testing/testing")} is not a directory`,
  );
  assertEquals(
      filesystem.isFile("testing/testing"),
    false,
    "testing/testing should not be a storage",
  );
  assertEquals(
      filesystem.delete("testing"),
    true,
    "Could not delete testing",
  );
});
