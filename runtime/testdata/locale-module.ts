// Test module — exercises the locale bridge via the worker I/O surface.
export async function init(core: any) {
  const locale = await core.localeGet("en");
  await core.storeSet("locale-mod", "found", String(locale?.found ?? false));
  await core.storeSet("locale-mod", "content", locale?.content ?? "");
}
