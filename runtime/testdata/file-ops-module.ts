// Test module — exercises file read/write/list/delete via the I/O bridge.
// Called by integration tests.
export async function init(core: any) {
  await core.fileWrite("./sandbox/demo.txt", "hello from module");

  const listing = await core.fileList("./sandbox");
  const names = Array.isArray(listing.entries)
    ? listing.entries.map((entry: { name: string }) => entry.name).join(",")
    : "";

  const readResp = await core.fileRead("./sandbox/demo.txt");
  await core.fileDelete("./sandbox/demo.txt");

  let deleted = "no";
  try {
    await core.fileRead("./sandbox/demo.txt");
  } catch {
    deleted = "yes";
  }

  await core.storeSet("file-mod", "listing", names);
  await core.storeSet("file-mod", "content", readResp.content);
  await core.storeSet("file-mod", "deleted", deleted);
}
