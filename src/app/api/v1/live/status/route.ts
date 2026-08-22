import { runBtccDiagnostics } from "@/lib/btcc-diagnostics";
import { getLiveConfigurationStatus } from "@/lib/btcc-live";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = getLiveConfigurationStatus();
  const observedAt = new Date().toISOString();

  if (!configuration.ready) {
    return Response.json(
      { ...configuration, configured: false, operational: false, diagnostics: null, observedAt },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const diagnostics = await runBtccDiagnostics();
  const operational = diagnostics.category === "ok" && diagnostics.accountRead === "ok";
  const blockers = operational
    ? configuration.blockers
    : [...configuration.blockers, `Connector operational check failed: ${diagnostics.message}`];

  return Response.json(
    {
      ...configuration,
      ready: operational,
      adapterMode: operational ? configuration.adapterMode : "disabled",
      blockers,
      configured: true,
      operational,
      diagnostics: {
        category: diagnostics.category,
        message: diagnostics.message,
        observedAt: diagnostics.observedAt
      },
      observedAt
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
