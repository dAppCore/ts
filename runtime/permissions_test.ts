function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("RuntimePermissions_IoFortress_Bad", async () => {
  const allowedDir = await Deno.makeTempDir();
  const blockedDir = await Deno.makeTempDir();
  const scriptPath = `${allowedDir}/permission-check.ts`;
  const allowedRead = `${allowedDir}/allowed.txt`;
  const blockedRead = `${blockedDir}/blocked.txt`;
  const blockedWrite = `${blockedDir}/blocked-write.txt`;

  await Deno.writeTextFile(allowedRead, "inside");
  await Deno.writeTextFile(blockedRead, "outside");

  const code = `
    const result = { allowed: "", readDenied: "", writeDenied: "" };
    result.allowed = await Deno.readTextFile(${JSON.stringify(allowedRead)});
    try {
      await Deno.readTextFile(${JSON.stringify(blockedRead)});
    } catch (error) {
      result.readDenied = \`\${error.name}: \${error.message}\`;
    }
    try {
      await Deno.writeTextFile(${JSON.stringify(blockedWrite)}, "nope");
    } catch (error) {
      result.writeDenied = \`\${error.name}: \${error.message}\`;
    }
    console.log(JSON.stringify(result));
  `;
  await Deno.writeTextFile(scriptPath, code);

  try {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${allowedDir}`,
        `--allow-write=${allowedDir}`,
        scriptPath,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    assert(
      output.success,
      `restricted subprocess should exit successfully: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );

    const result = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      allowed: string;
      readDenied: string;
      writeDenied: string;
    };

    assert(result.allowed === "inside", "allowed path should remain readable");
    assert(
      isPermissionError(result.readDenied),
      "reads outside the fortress should be denied",
    );
    assert(
      isPermissionError(result.writeDenied),
      "writes outside the fortress should be denied",
    );
  } finally {
    await Deno.remove(allowedDir, { recursive: true });
    await Deno.remove(blockedDir, { recursive: true });
  }
});

function isPermissionError(message: string): boolean {
  return message.includes("PermissionDenied") || message.includes("NotCapable");
}
