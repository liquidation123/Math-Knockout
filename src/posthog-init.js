const posthog = window.posthog = window.posthog || [];
posthog._i = posthog._i || [];
const methods = [
  "capture", "captureException", "identify", "reset", "getFeatureFlag", "isFeatureEnabled",
  "onFeatureFlags", "get_distinct_id", "get_session_id",
];

for (const method of methods) {
  if (!posthog[method]) posthog[method] = (...args) => posthog.push([method, ...args]);
}
posthog.init = (token, options) => posthog._i.push([token, options, "posthog"]);

const isDevelopment = ["localhost", "127.0.0.1"].includes(location.hostname);
const missingConfiguration = (variable) => {
  if (isDevelopment) {
    throw new Error(`${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`);
  }
};

const config = await fetch("/posthog-config.json")
  .then((response) => response.ok ? response.json() : {})
  .catch(() => ({}));
if (!config.projectToken) {
  missingConfiguration("POSTHOG_PROJECT_TOKEN");
} else if (!config.host) {
  missingConfiguration("POSTHOG_HOST");
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
      environment: isDevelopment ? "development" : "production",
    },
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
  });
}
