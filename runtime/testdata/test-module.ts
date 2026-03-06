// Test module — writes to store via I/O bridge to prove Workers work.
// Called by integration tests.
export async function init(core: any) {
  await core.storeSet("test-module", "init", "ok");
}
