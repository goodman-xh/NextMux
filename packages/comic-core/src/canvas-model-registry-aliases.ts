/**
 * Task 33p's reviewed identity links. These select a registry family, never grant transport capability.
 * Native/spec ids come from §22; qualified ids are exact OpenRouter/managed catalog ids; the three
 * video_* aliases are the owner's configured templates with an explicit model identity.
 * Unknown build suffixes, spelling variants and provider prefixes do not inherit these links.
 */
export const CANVAS_REGISTRY_ALIASES = {
  "seedance-2.5": [
    "seedance-2.5",
    "doubao-seedance-2-5-260628",
    "bytedance/seedance-2.5"
  ],
  "seedance-2.5-draft": [
    "seedance-2.5-draft",
    "doubao-seedance-2-5-260628-draft"
  ],
  "seedance-2.0": [
    "seedance-2.0",
    "neo-video-2-0",
    "bytedance/seedance-2.0"
  ],
  "seedance-2.0-fast": [
    "seedance-2.0-fast",
    "neo-video-2-0-fast",
    "bytedance/seedance-2.0-fast"
  ],
  "seedance-2.0-mini": [
    "seedance-2.0-mini",
    "doubao-seedance-2-0-mini-260615",
    "bytedance/seedance-2.0-mini"
  ],
  "minimax-h3": [
    "minimax-h3",
    "MiniMax-H3",
    "minimax/hailuo-3",
    "video_minimax_h3"
  ],
  "minimax-h3-max": [
    "minimax-h3-max",
    "MiniMax-H3-Max",
    "minimax/hailuo-3-max"
  ],
  "seedance-1.0-fast": [
    "seedance-1.0-fast",
    "doubao-seedance-1-0-pro-fast-251015"
  ],
  "seedance-1.0-pro": [
    "seedance-1.0-pro",
    "doubao-seedance-1-0-pro-250528"
  ],
  "kling-v3": [
    "kling-v3",
    "kwaivgi/kling-v3.0-pro",
    "kwaivgi/kling-v3.0-std",
    "video_omni"
  ],
  "kling-v2.6": [
    "kling-v2.6",
    "kling-v2-6"
  ],
  "kling-v2.5": [
    "kling-v2.5",
    "kling-v2-5"
  ],
  "kling-v2.1": [
    "kling-v2.1",
    "kling-v2-1"
  ],
  "vidu-q3-pro": [
    "vidu-q3-pro"
  ],
  "vidu-q2-pro": [
    "vidu-q2-pro"
  ],
  "wan-3.0": [
    "wan-3.0",
    "wan3.0-video",
    "alibaba/wan-3.0",
    "video_wan_3.0"
  ],
  "wan-2.7": [
    "wan-2.7",
    "wan2.7",
    "alibaba/wan-2.7"
  ],
  "hailuo-2.3": [
    "hailuo-2.3",
    "MiniMax-Hailuo-2.3",
    "minimax/hailuo-2.3"
  ],
  "happyhorse-1.0": [
    "happyhorse-1.0",
    "alibaba/happyhorse-1.0"
  ],
  "hailuo-2.3-fast": [
    "hailuo-2.3-fast",
    "MiniMax-Hailuo-2.3-Fast"
  ],
  "hailuo-02": [
    "hailuo-02",
    "MiniMax-Hailuo-02"
  ],
  "veo-3.1": [
    "veo-3.1",
    "veo-3.1-generate-001",
    "google/veo-3.1"
  ],
  "veo-3.1-fast": [
    "veo-3.1-fast",
    "veo-3.1-fast-generate-001",
    "google/veo-3.1-fast",
    "video_veo3.1_fast"
  ],
  "gpt-image-2.5-flare": [
    "gpt-image-2.5-flare",
    "openai/gpt-image-2.5-flare"
  ],
  "gpt-image-2.5-sunburst": [
    "gpt-image-2.5-sunburst",
    "openai/gpt-image-2.5-sunburst"
  ],
  "gpt-image-2": [
    "gpt-image-2",
    "openai/gpt-image-2"
  ],
  "gpt-image-2-official": [
    "gpt-image-2-official"
  ],
  "seedream-5.0-pro": [
    "seedream-5.0-pro",
    "doubao-seedream-5-0-pro-260628",
    "bytedance-seed/seedream-5-0-pro"
  ],
  "qwen-image-3.0-pro": [
    "qwen-image-3.0-pro",
    "qwen/qwen-image-3-pro"
  ],
  "seedream-5.0": [
    "seedream-5.0",
    "doubao-seedream-5-0-260128"
  ],
  "seedream-4.5": [
    "seedream-4.5",
    "doubao-seedream-4-5-251128",
    "bytedance-seed/seedream-4.5"
  ],
  "seedream-4.0": [
    "seedream-4.0",
    "doubao-seedream-4-0-250828"
  ],
  "gemini-3-pro-image": [
    "gemini-3-pro-image",
    "gemini-3-pro-image-preview",
    "google/gemini-3-pro-image",
    "google/gemini-3-pro-image-preview"
  ],
  "gemini-3.1-flash-image": [
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-image-preview",
    "google/gemini-3.1-flash-image",
    "google/gemini-3.1-flash-image-preview"
  ],
  "gemini-3.1-flash-lite-image": [
    "gemini-3.1-flash-lite-image",
    "google/gemini-3.1-flash-lite-image"
  ],
  "gemini-2.5-flash-image": [
    "gemini-2.5-flash-image",
    "google/gemini-2.5-flash-image"
  ],
  "wan-2.7-image-pro": [
    "wan-2.7-image-pro",
    "wan2.7-image-pro"
  ],
  "hunyuan-image-3.5": [
    "hunyuan-image-3.5",
    "hy-image-3.5-preview"
  ]
} as const;

export interface CanvasRegistryAliasEntry {
  readonly familyId: string;
  readonly modelIds: readonly string[];
}

const familyByModelId = new Map<string, string>(
  Object.entries(CANVAS_REGISTRY_ALIASES).flatMap(([familyId, modelIds]) => modelIds.map(modelId => [modelId, familyId] as const))
);

/** Exact table lookup; do not guess a family from a name, substring, provider or date suffix. */
export function canvasRegistryFamilyId(modelId: string): string | undefined {
  return familyByModelId.get(modelId);
}

export function listCanvasRegistryAliases(familyId?: string): readonly CanvasRegistryAliasEntry[] {
  return Object.entries(CANVAS_REGISTRY_ALIASES)
    .filter(([id]) => familyId === undefined || id === familyId)
    .map(([id, modelIds]) => ({ familyId: id, modelIds: [...modelIds] }));
}

export interface CanvasRegistryExcludedModel {
  readonly modelId: string;
  readonly displayName: string;
  readonly kind: 'image' | 'video';
  readonly source: 'openrouter' | 'configured-template';
  readonly reason: string;
}

/** Media models observed in the route catalog but outside task 33p's fixed list. No registry entry is created. */
export const CANVAS_REGISTRY_NOT_IN_SPEC: readonly CanvasRegistryExcludedModel[] = [
  {
    "modelId": "inclusionai/ming-image-0.1-design-layer",
    "displayName": "inclusionAI: Ming Image 0.1 Design Layer",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4.1-flash",
    "displayName": "Recraft: Recraft V4.1 Flash",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "inclusionai/ming-image-0.1-design",
    "displayName": "inclusionAI: Ming Image 0.1 Design",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "black-forest-labs/flux-video-edit",
    "displayName": "Black Forest Labs: FLUX Video Edit",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "microsoft/mai-image-2.6",
    "displayName": "Microsoft AI: MAI-Image-2.6",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "microsoft/mai-image-2.6-flash",
    "displayName": "Microsoft AI: MAI-Image-2.6 Flash",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "alibaba/wan-3.0-prime",
    "displayName": "Alibaba: Wan 3.0 Prime",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "meta/muse-image",
    "displayName": "Meta: Muse Image",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4-styles-pro",
    "displayName": "Recraft: Recraft V4 Styles Pro",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4-styles-vector",
    "displayName": "Recraft: Recraft V4 Styles Vector",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4-styles-pro-vector",
    "displayName": "Recraft: Recraft V4 Styles Pro Vector",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4-styles",
    "displayName": "Recraft: Recraft V4 Styles",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "heygen/avatar-iv",
    "displayName": "HeyGen: Avatar IV",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "black-forest-labs/flux-video-upscale",
    "displayName": "Black Forest Labs: FLUX Video Upscale",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "bytedance-seed/seedream-5-0-lite",
    "displayName": "ByteDance Seed: Seedream 5.0 Lite",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "x-ai/grok-imagine-image-2.0",
    "displayName": "xAI: Grok Imagine Image 2.0",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "qwen/qwen-image-3",
    "displayName": "Qwen: Qwen Image 3",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "black-forest-labs/flux-3-video",
    "displayName": "Black Forest Labs: FLUX.3 Video",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "runway/aleph-2",
    "displayName": "Runway: Aleph 2.0",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "runway/gen-4.5",
    "displayName": "Runway: Gen-4.5",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "microsoft/mai-image-2.5-pro",
    "displayName": "Microsoft AI: MAI-Image-2.5 Pro",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "krea/krea-2-large",
    "displayName": "Krea: Krea 2 Large",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "krea/krea-2-medium",
    "displayName": "Krea: Krea 2 Medium",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "krea/krea-2-medium-turbo",
    "displayName": "Krea: Krea 2 Medium Turbo",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "x-ai/grok-imagine-video-1.5",
    "displayName": "SpaceXAI: Grok Imagine Video 1.5",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "openrouter/auto-beta",
    "displayName": "Auto Router (Beta)",
    "kind": "image",
    "source": "openrouter",
    "reason": "An automatic router is not a fixed spec model family."
  },
  {
    "modelId": "alibaba/happyhorse-1.1",
    "displayName": "Alibaba: HappyHorse 1.1",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "openai/gpt-image-1",
    "displayName": "OpenAI: GPT Image 1",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "openai/gpt-image-1-mini",
    "displayName": "OpenAI: GPT Image 1 Mini",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "sourceful/riverflow-v2.5-pro",
    "displayName": "Sourceful: Riverflow V2.5 Pro",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "sourceful/riverflow-v2.5-fast",
    "displayName": "Sourceful: Riverflow V2.5 Fast",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "microsoft/mai-image-2.5",
    "displayName": "Microsoft AI: MAI-Image-2.5",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "x-ai/grok-imagine-video",
    "displayName": "SpaceXAI: Grok Imagine Video",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "x-ai/grok-imagine-image-quality",
    "displayName": "SpaceXAI: Grok Imagine Image Quality",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4.1-pro-vector",
    "displayName": "Recraft: Recraft V4.1 Pro Vector",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4.1-vector",
    "displayName": "Recraft: Recraft V4.1 Vector",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4.1-utility-pro",
    "displayName": "Recraft: Recraft V4.1 Utility Pro",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4.1-utility",
    "displayName": "Recraft: Recraft V4.1 Utility",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4.1-pro",
    "displayName": "Recraft: Recraft V4.1 Pro",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4.1",
    "displayName": "Recraft: Recraft V4.1",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4-pro-vector",
    "displayName": "Recraft: Recraft V4 Pro Vector",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4-vector",
    "displayName": "Recraft: Recraft V4 Vector",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4-pro",
    "displayName": "Recraft: Recraft V4 Pro",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v4",
    "displayName": "Recraft: Recraft V4",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "recraft/recraft-v3",
    "displayName": "Recraft: Recraft V3",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "google/veo-3.1-lite",
    "displayName": "Google: Veo 3.1 Lite",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "openai/gpt-5.4-image-2",
    "displayName": "OpenAI: GPT-5.4 Image 2",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "kwaivgi/kling-video-o1",
    "displayName": "Kling: Video O1",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "alibaba/wan-2.6",
    "displayName": "Alibaba: Wan 2.6",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "bytedance/seedance-1-5-pro",
    "displayName": "ByteDance: Seedance 1.5 Pro",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "openai/sora-2-pro",
    "displayName": "OpenAI: Sora 2 Pro",
    "kind": "video",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "sourceful/riverflow-v2-pro",
    "displayName": "Sourceful: Riverflow V2 Pro",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "sourceful/riverflow-v2-fast",
    "displayName": "Sourceful: Riverflow V2 Fast",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "black-forest-labs/flux.2-klein-4b",
    "displayName": "Black Forest Labs: FLUX.2 Klein 4B",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "black-forest-labs/flux.2-max",
    "displayName": "Black Forest Labs: FLUX.2 Max",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "black-forest-labs/flux.2-flex",
    "displayName": "Black Forest Labs: FLUX.2 Flex",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "black-forest-labs/flux.2-pro",
    "displayName": "Black Forest Labs: FLUX.2 Pro",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "openai/gpt-5-image-mini",
    "displayName": "OpenAI: GPT-5 Image Mini",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "openai/gpt-5-image",
    "displayName": "OpenAI: GPT-5 Image",
    "kind": "image",
    "source": "openrouter",
    "reason": "Not present in the fixed §22 model list."
  },
  {
    "modelId": "openrouter/auto",
    "displayName": "Auto Router",
    "kind": "image",
    "source": "openrouter",
    "reason": "An automatic router is not a fixed spec model family."
  }
];
