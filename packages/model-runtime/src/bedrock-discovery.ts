import { boundedSecret, OfficialModelError, validatedBaseUrl } from "./http.js";
import type { DiscoverOfficialModelsOptions, OfficialModelCatalogEntry } from "./discovery.js";

// AWS API-key region list, checked 2026-09-05. Unknown partitions/endpoints stay manual.
// https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-supported.html
const bearerRegions = new Set([
  "ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-south-1", "ap-south-2",
  "ap-southeast-1", "ap-southeast-2", "ca-central-1", "eu-central-1", "eu-central-2",
  "eu-north-1", "eu-south-1", "eu-south-2", "eu-west-1", "eu-west-2", "eu-west-3",
  "sa-east-1", "us-east-1", "us-gov-east-1", "us-gov-west-1", "us-west-2",
]);

function unsupported(): never {
  throw new OfficialModelError("DISCOVERY_UNSUPPORTED", "Bedrock discovery only supports official same-region endpoints and bearer credentials; use manual model configuration for other credentials or endpoints");
}

/** This is a regional control-plane GET, not Converse or a generic /models URL. */
export function bedrockCatalogRequest(
  options: DiscoverOfficialModelsOptions,
  environment: { readonly AWS_BEARER_TOKEN_BEDROCK?: string } = process.env,
): { readonly endpoint: URL; readonly apiKey: string } {
  let base: URL;
  try { base = validatedBaseUrl(options.baseUrl, false); } catch { return unsupported(); }
  const region = /^bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com$/.exec(base.hostname)?.[1];
  if (!region || !bearerRegions.has(region) || base.port || base.pathname !== "/"
    || options.protocol !== "openai_chat_completions"
    || options.providerSettings?.region !== undefined && options.providerSettings.region !== region) unsupported();
  const source = options.providerSettings?.credentialSource || "api_key";
  if (source !== "api_key" && source !== "environment") unsupported();
  // An empty API-key field never opts the user into environment/SSO/shared files.
  // The SDK's static SigV4 credentials are intentionally not read by this slice.
  const value = source === "environment" ? environment.AWS_BEARER_TOKEN_BEDROCK : options.apiKey;
  if (typeof value !== "string" || !value.trim()) {
    if (source === "environment") unsupported();
    throw new OfficialModelError("DISCOVERY_CREDENTIALS_MISSING", "The selected Bedrock bearer credentials are missing; manual model configuration is still available");
  }
  const apiKey = boundedSecret(value).trim();
  if (/\s/.test(apiKey)) throw new OfficialModelError("INVALID_API_KEY", "Invalid Bedrock bearer credentials");
  return { endpoint: new URL(`https://bedrock.${region}.amazonaws.com/foundation-models`), apiKey };
}

/** Listing a foundation ID proves neither Converse support nor account access.
 * Inference profiles/provisioned/custom model identifiers remain user supplied. */
export function parseBedrockModelCatalog(payload: unknown, maximum: number): readonly OfficialModelCatalogEntry[] {
  const values = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { modelSummaries?: unknown }).modelSummaries : undefined;
  if (!Array.isArray(values)) throw new OfficialModelError("INVALID_RESPONSE", "Invalid Bedrock foundation model catalog response");
  const models = new Map<string, OfficialModelCatalogEntry>();
  for (const value of values.slice(0, maximum * 2)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const { modelId, modelName } = value as { modelId?: unknown; modelName?: unknown };
    if (typeof modelId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(modelId)) continue;
    const label = typeof modelName === "string" && modelName.trim() && modelName.length <= 200
      && !/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(modelName) ? modelName.trim() : modelId;
    if (!models.has(modelId.toLowerCase())) models.set(modelId.toLowerCase(), {
      id: modelId, label, selectionMode: "catalog_only", interfaceSupport: "unknown", interfaceSupportSource: "models_endpoint",
    });
    if (models.size >= maximum) break;
  }
  if (values.length && !models.size) throw new OfficialModelError("INVALID_RESPONSE", "The Bedrock catalog returned no recognizable foundation model identifiers");
  return [...models.values()];
}
