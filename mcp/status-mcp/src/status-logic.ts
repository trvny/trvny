export type HealthVerdict = "ok" | "degraded" | "down";

interface FeedVerdictInput {
  pipelineOk: boolean;
  registryAvailable: boolean;
  inventoryAvailable: boolean;
  missing: number;
  tiny: number;
}

export function feedVerdict(input: FeedVerdictInput): HealthVerdict {
  if (!input.pipelineOk) return "down";
  if (!input.registryAvailable || !input.inventoryAvailable || input.missing > 0 || input.tiny > 0) return "degraded";
  return "ok";
}

interface AutkaVerdictInput {
  healthy: boolean;
  offersAvailable: boolean;
  sourcesAvailable: boolean;
  offers: number | null;
}

export function autkaVerdict(input: AutkaVerdictInput): HealthVerdict {
  if (!input.healthy) return "down";
  if (!input.offersAvailable || !input.sourcesAvailable || input.offers === 0) return "degraded";
  return "ok";
}
