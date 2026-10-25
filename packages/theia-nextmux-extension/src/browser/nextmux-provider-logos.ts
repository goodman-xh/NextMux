import type { OfficialProviderId } from '@nextmux/model-runtime';
import alibabaCloudLogo from './style/provider-logos/alibabacloud.svg';
import anthropicLogo from './style/provider-logos/anthropic.svg';
import azureAiLogo from './style/provider-logos/azureai.svg';
import baiduCloudLogo from './style/provider-logos/baiducloud.svg';
import bedrockLogo from './style/provider-logos/bedrock.svg';
import cohereLogo from './style/provider-logos/cohere.svg';
import deepSeekLogo from './style/provider-logos/deepseek.svg';
import geminiLogo from './style/provider-logos/gemini.svg';
import minimaxLogo from './style/provider-logos/minimax.svg';
import mistralLogo from './style/provider-logos/mistral.svg';
import moonshotLogo from './style/provider-logos/moonshot.svg';
import openAiLogo from './style/provider-logos/openai.svg';
import openRouterLogo from './style/provider-logos/openrouter.svg';
import tencentCloudLogo from './style/provider-logos/tencentcloud.svg';
import vertexAiLogo from './style/provider-logos/vertexai.svg';
import volcEngineLogo from './style/provider-logos/volcengine.svg';
import xAiLogo from './style/provider-logos/xai.svg';
import zhipuLogo from './style/provider-logos/zhipu.svg';

export interface OfficialProviderLogoAsset {
    readonly src: string;
    /** Monochrome assets are recoloured for contrast; full-colour marks remain untouched. */
    readonly monochrome: boolean;
}

/** Every official provider shown in the direct-API grid has one bundled brand mark. */
export const OFFICIAL_PROVIDER_LOGOS: Readonly<Partial<Record<OfficialProviderId, OfficialProviderLogoAsset>>> = Object.freeze({
    openai: { src: openAiLogo, monochrome: true },
    anthropic: { src: anthropicLogo, monochrome: true },
    gemini: { src: geminiLogo, monochrome: false },
    xai: { src: xAiLogo, monochrome: true },
    mistral: { src: mistralLogo, monochrome: false },
    cohere: { src: cohereLogo, monochrome: false },
    openrouter: { src: openRouterLogo, monochrome: false },
    deepseek: { src: deepSeekLogo, monochrome: false },
    qwen: { src: alibabaCloudLogo, monochrome: true },
    zhipu: { src: zhipuLogo, monochrome: false },
    moonshot: { src: moonshotLogo, monochrome: true },
    minimax: { src: minimaxLogo, monochrome: false },
    doubao: { src: volcEngineLogo, monochrome: true },
    ernie: { src: baiduCloudLogo, monochrome: true },
    hunyuan: { src: tencentCloudLogo, monochrome: true },
    azure_openai: { src: azureAiLogo, monochrome: true },
    vertex: { src: vertexAiLogo, monochrome: true },
    bedrock: { src: bedrockLogo, monochrome: true }
});

export function officialProviderLogoAsset(providerId: OfficialProviderId): OfficialProviderLogoAsset | undefined {
    return OFFICIAL_PROVIDER_LOGOS[providerId];
}
