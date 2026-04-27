export async function init(core: {
  storeSet(group: string, key: string, value: string): Promise<unknown>;
}) {
  await core.storeSet("module-isolation", "ipc", "hello-through-ipc");
}
