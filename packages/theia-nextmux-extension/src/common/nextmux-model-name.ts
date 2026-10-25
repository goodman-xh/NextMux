/**
 * One model, many spellings. Relays and providers write the same model as "video_wan_3.0",
 * "Wan 3.0", "wan3.0-t2v", "alibaba/wan-3.0-0826" or "kling_v3_pro"; every name-based rule
 * (sound, clip lengths, own-model kind) tries these forms, exact first. A name that still
 * matches nothing keeps working as the API reported it; only its usage cannot be priced.
 * The platform's registry resolver (apps/cloudflare-platform/src/model-name-resolver.js)
 * defines numbered author releases and branded media builds. Display grouping below
 * is not its tariff resolver: the task also groups dated GPT display entries.
 */
/** These authors use four-digit release numbers as part of a model identity. */
export function modelReleaseVariant(model: string): string | undefined {
    const name = model.toLowerCase().replace(/[\[【(（][^\]】)）]{0,24}[\]】)）]/g, ' ').trim().split('/').pop()!.replace(/[\s_]+/g, '-');
    if (!/^(?:deepseek|qwen|qwq|qvq|kimi|moonshot|glm|cogview|cogvideo|minimax|abab|hailuo|step|yi|baichuan|hunyuan|ernie|mistral|mixtral|codestral|pixtral|magistral|devstral|ministral|voxtral)/.test(name)) return undefined;
    return /(?:-|[a-z]|\.\d|[vr]\d(?:\.\d)?)(\d{4})(?=$|-(?:ca|cc|official|thinking|nothinking)$)/.exec(name)?.[1];
}

/** Explicit Claude family/version spelling, not a substring or an arbitrary dated model. */
export function claudeModelName(model: string): string | undefined {
    const name = model.toLowerCase().split('/').pop()!.replace(/[\s_]+/g, '-');
    const match = /^(?:claude-)?(opus|sonnet|haiku|fable)-?(\d{1,2})(?:[.-](\d{1,2}))?(?:[-@](\d{4}|20\d{2}-?\d{2}-?\d{2}))?$/.exec(name);
    if (!match) return undefined;
    return `claude-${match[1]}-${match[2]}${match[3] ? `.${match[3]}` : ''}`;
}

function modelNameSpelling(model: string): string {
    return model.replace(/[\[【(（][^\]】)）]{0,24}[\]】)）]/g, ' ').trim().toLowerCase()
        .replace(/^~/, '').replace(/^models\//, '').replace(/[\s_]+/g, '-')
        .replace(/(^|\/)(deepseek)(?=[vr]\d)/, '$1$2-');
}

/** Normalize the Claude version without erasing a named variant after it. */
function claudeModelSpelling(name: string): string | undefined {
    const base = claudeModelName(name);
    if (base) return base;
    const variant = /^((?:claude-)?(?:opus|sonnet|haiku|fable)-?\d{1,2}(?:[.-]\d{1,2})?)(-[a-z].*)$/.exec(name);
    return variant ? `${claudeModelName(variant[1])}${variant[2]}` : undefined;
}

function withoutSnapshot(name: string): string {
    // Match the resolver's author-release exception before interpreting MMDD.
    // A branded media relay also uses six-digit builds (doubao-…-250828).
    if (modelReleaseVariant(name) || /(?:^|-)v-\d+$/.test(name)) return name;
    const base = name.replace(/[-@](?:20\d{2}-?\d{2}-?\d{2}|\d{4})$/, '');
    return base !== name ? base : /^(?:doubao|volc|volcengine|ark)-/.test(name) ? name.replace(/-\d{4,6}$/, '') : name;
}

/**
 * Display grouping only: preserve author namespaces, variants and explicit versions.
 * The backend resolver's numbered-release exception also applies here; its OpenAI
 * tariff identities still retain dates. This key must never replace a request ID,
 * price identity or capability evidence (https://github.com/anomalyco/models.dev
 * likewise separates serving IDs from underlying model metadata).
 */
export function modelNameGroupKey(model: string): string {
    const spelling = modelNameSpelling(model);
    const slash = spelling.lastIndexOf('/');
    const namespace = spelling.slice(0, slash + 1), name = spelling.slice(slash + 1);
    const base = withoutSnapshot(name);
    return namespace + (claudeModelSpelling(base) || (modelReleaseVariant(base) ? base.replace(/([a-z]|\.\d|[vr]\d(?:\.\d)?)(\d{4})$/, '$1-$2') : base));
}

/** Keep the selected entry when supplied, otherwise prefer a reported floating ID; never merge metadata. */
export function groupModelsByName<T>(models: readonly T[], name: (model: T) => string, preferred?: T): T[] {
    const groups = new Map<string, T>();
    const snapshot = (model: T): boolean => {
        const tail = modelNameSpelling(name(model)).split('/').pop()!;
        return withoutSnapshot(tail) !== tail;
    };
    for (const model of models) {
        const key = modelNameGroupKey(name(model)), previous = groups.get(key);
        if (!groups.has(key) || model === preferred || previous !== preferred && (snapshot(previous!) || !snapshot(model))) groups.set(key, model);
    }
    return [...groups.values()];
}

export function modelNameForms(model: string): string[] {
    const forms: string[] = [];
    const add = (value: string): void => {
        const form = value.trim().replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (form && !forms.includes(form)) forms.push(form);
    };
    const exact = model.trim().toLowerCase();
    if (!exact || exact.length > 300) return exact ? [exact] : [];
    add(exact);
    // Bracketed relay labels are not the name: "[官方]gpt-4o", "claude-sonnet-4-5(官转)", "【特价】…".
    const unlabelled = exact.replace(/[\[【(（][^\]】)）]{0,24}[\]】)）]/g, ' ').trim().replace(/\s+/g, '-');
    const tail = unlabelled.slice(unlabelled.lastIndexOf('/') + 1).replace(/[\s_:+|,;]+/g, '-');
    // Spaces, underscores and odd separators become hyphens: "video_wan_3.0" → "video-wan-3.0".
    add(tail);
    add(tail.replace(/^(deepseek)(?=[vr]\d)/, '$1-'));
    const claude = claudeModelSpelling(tail);
    if (claude) { add(claude); add(claude.replace(/(\d)\.(\d)/g, '$1-$2')); }
    // Split a glued release without also splitting "v4": Flash1017 → Flash-1017, v4.11017 → v4.1-1017.
    for (const form of [...forms]) if (modelReleaseVariant(form)) add(form.replace(/([a-z]|\.\d|[vr]\d(?:\.\d)?)(\d{4})$/, '$1-$2'));
    // A relay's kind prefix: "video-wan-3.0" → "wan-3.0".
    for (const form of [...forms]) add(form.replace(/^(?:video|image|img|vid|audio|music|tts|t2v|i2v)-(?=[a-z])/, ''));
    // A platform brand prefix ("doubao-seedream-…") and a relay route suffix ("-cc").
    // Thinking modes are distinct picker entries, not disposable route annotations.
    for (const form of [...forms]) add(form.replace(/^(?:doubao|volc|volcengine|ark)-(?=[a-z])/, ''));
    for (const form of [...forms]) add(form.replace(/(?:-(?:ca|cc|official|az|azure|aws|bedrock|vertex|gcp|vip))+$/, ''));
    // A version glued to the name, or split from it: "veo3.1" ↔ "veo-3.1".
    for (const form of [...forms]) { add(form.replace(/([a-z])(\d)/g, '$1-$2')); add(form.replace(/([a-z])-(\d)/g, '$1$2')); }
    // Only MMDD/full-date snapshots or known branded builds, not arbitrary 5–8 digit versions.
    for (const form of [...forms]) {
        const base = withoutSnapshot(form);
        add(base);
        if (base !== form) add(base.replace(/^(?:doubao|volc|volcengine|ark)-(?=[a-z])/, ''));
    }
    // Backend tier 3: short explicit versions use either dots or hyphens ("4-0" / "4.0").
    for (const form of [...forms]) {
        add(form.replace(/(^|[a-z-])(\d)-(\d)(?=$|[^0-9])/g, '$1$2.$3'));
        add(form.replace(/(\d)\.(\d)(?=$|[^0-9])/g, '$1-$2'));
    }
    // "3.0" ↔ "3", "v3" ↔ "3".
    for (const form of [...forms]) { add(form.replace(/(\d)\.0(?=$|[^0-9])/g, '$1')); add(form.replace(/(^|-)v(\d)/g, '$1$2')); }
    return forms.slice(0, 40);
}

export function modelNameMatches(model: string, pattern: RegExp): boolean {
    return modelNameForms(model).some(form => pattern.test(form));
}
