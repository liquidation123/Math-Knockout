// Queue events while PostHog's browser SDK loads, following its snippet protocol.
const posthog = window.posthog = window.posthog || [];
posthog.__SV = 1;
posthog._i = posthog._i || [];
for (const method of ["capture", "captureException", "identify", "reset", "getFeatureFlag", "isFeatureEnabled", "onFeatureFlags", "get_distinct_id", "get_session_id"]) {
  if (!posthog[method]) posthog[method] = (...args) => posthog.push([method, ...args]);
}
posthog.init = (token, options) => posthog._i.push([token, options, "posthog"]);

const config = await fetch("/posthog-config.json")
  .then((response) => response.ok ? response.json() : {})
  .catch(() => ({}));

// Analytics configuration must never prevent a game from starting.
if (!config.projectToken || !config.host) {
  console.warn("PostHog is disabled: configure POSTHOG_PROJECT_TOKEN and POSTHOG_HOST.");
} else {
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = config.host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js";
  document.head.append(script);
  posthog.init(config.projectToken, {
    api_host: config.host,
    defaults: "2026-05-30",
    logs: {
      serviceName: "out-mathed-web",
      environment: ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) ? "development" : "production",
    },
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
  });
}
