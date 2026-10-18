let posthogServerLogger = { emit() {} };

const token = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;
if (token && host) {
  const [{ NodeSDK }, { OTLPLogExporter }, { BatchLogRecordProcessor }, { resourceFromAttributes }, { logs }] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-logs-otlp-http"),
    import("@opentelemetry/sdk-logs"),
    import("@opentelemetry/resources"),
    import("@opentelemetry/api-logs"),
  ]);
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": "out-mathed-websocket" }),
    logRecordProcessors: [new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: new URL("/i/v1/logs", host).toString(),
        headers: { Authorization: `Bearer ${token}` },
      }),
    })],
  });
  sdk.start();
  posthogServerLogger = logs.getLogger("out-mathed-posthog");
}

export { posthogServerLogger };
