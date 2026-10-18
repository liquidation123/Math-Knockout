// Keep the version of the HTML that loaded this script, even during a restart.
let version = new URL(import.meta.url).searchParams.get("version");
setInterval(async () => {
  try {
    const response = await fetch("/__dev/version", { cache: "no-store" });
    if (!response.ok) return;
    if (await response.text() !== version) location.reload();
  } catch {
    // A server restart can briefly interrupt requests. Try again next second.
  }
}, 1000);
