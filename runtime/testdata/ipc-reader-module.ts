export async function init(core: {
  storeGet(
    group: string,
    key: string,
  ): Promise<{ value?: string; found?: boolean }>;
  storeSet(group: string, key: string, value: string): Promise<unknown>;
}) {
  const response = await core.storeGet("module-isolation", "ipc") as {
    value?: string;
    found?: boolean;
  };
  await core.storeSet(
    "module-isolation",
    "ipc-observed",
    response.found ? response.value ?? "" : "missing",
  );
}
