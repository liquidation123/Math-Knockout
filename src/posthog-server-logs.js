let posthogServerLogger = { emit() {} };

const token = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
const isDevelopment = process.env.NODE_ENV === "development";
const missingConfiguration = (variable) => {
  if (isDevelopment) {
    throw new Error(`${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`);
  }
};

if (!token) {
  missingConfiguration("POSTHOG_PROJECT_TOKEN");
} else if (!host) {
  missingConfiguration("POSTHOG_HOST");
} else {
  const [{ NodeSDK }, { OTLPLogExporter }, { BatchLogRecordProcessor }, { resourceFromAttributes }, { logs }] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-logs-otlp-http"),
    import("@opentelemetry/sdk-logs"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/api-logs"),
  ]);
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": "out-mathed-websocket" }),
    logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter({
      url: new URL("/i/v1/logs", host).toString(),
      headers: { Authorization: `Bearer ${token}` },
    }))],
  });
  sdk.start();
  posthogServerLogger = logs.getLogger("out-mathed-posthog");
}

export { posthogServerLogger };
