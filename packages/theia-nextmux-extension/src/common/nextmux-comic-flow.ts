/**
 * The guided comic flow: settings → episode scripts → character portraits → video clips → editor.
 *
 * How faces stay the same (the usual practice for AI series): each character gets one locked portrait
 * first. A video model that keeps faces from several pictures (reference-to-video) receives the
 * portraits of everyone on screen; any other model gets a first frame drawn from those portraits by
 * the image model. Shots with nobody on screen go straight from text to video.
 */

/**
 * A front-facing reference portrait: the character alone on pure white, even light, the whole costume in view.
 * White rather than transparent: many image and video models turn transparency into black.
 */
export function comicPortraitPrompt(character: { readonly name: string; readonly appearance: string; readonly description?: string }, styleBible: string): string {
    const look = character.appearance.replace(/\s+/g, ' ').trim().slice(0, 2_000);
    const style = styleBible.replace(/\s+/g, ' ').trim().slice(0, 1_500);
    return [
        `Character reference portrait of ${character.name}${character.description ? ` (${character.description.replace(/\s+/g, ' ').slice(0, 200)})` : ''}.`,
        look ? `Appearance and costume: ${look}.` : '',
        'Draw only this character and nothing else: no scenery, no furniture, no other people, no text, captions or watermark.',
        // A full-body casting photo unless the user asked for less (半身 / 头像 / close-up …).
        /半身|头像|胸像|大头|特写|upper[- ]body|waist[- ]up|bust|headshot|close[- ]?up|portrait only/i.test(look)
            ? 'One person, facing the camera, framed as the description asks, neutral expression, relaxed pose.'
            : 'One person, standing, facing the camera, full body from head to toe with the feet visible, neutral expression, relaxed pose, arms at the sides, the full costume visible.',
        'Their everyday look, like a casting photo: dry, neatly kept hair and clothes, no rain, dirt or wounds, empty hands (worn accessories stay; nothing held).',
        'Hair exactly as described: the same length, colour and style (long hair stays long and down unless the description ties it up).',
        'Isolated on a plain pure-white background like a cut-out, soft even lighting, sharp focus on the face.',
        style ? `Visual style: ${style}` : ''
    ].filter(Boolean).join('\n');
}

/** The clip length to ask for: the shortest the model makes that still covers the shot. */
export function clipSecondsFor(seconds: number, clipSeconds: readonly number[]): number {
    const wanted = Math.max(1, Math.ceil(seconds));
    const sorted = [...clipSeconds].filter(value => value > 0).sort((left, right) => left - right);
    return sorted.length ? sorted.find(value => value >= wanted) ?? sorted[sorted.length - 1] : wanted;
}

/**
 * How character portraits map onto a model's reference slots: one portrait per slot, never several people in one
 * picture. Image and video models read a picture of several people as one look (or copy it as a collage, twins
 * and split screens included), so a cast larger than the slots is not stitched: the opening frame is drawn in
 * rounds instead (comicCastRounds). Callers must reject overflow before choosing direct references.
 */
export function comicReferenceLayout<T>(items: readonly T[], slots: number): T[][] {
    return items.slice(0, Math.max(1, Math.floor(slots))).map(item => [item]);
}

/** Reference pictures one image request may carry (the platform gateway takes up to four). */
export const COMIC_IMAGE_REFERENCE_SLOTS = 4;

/** Each round reserves one slot for the scene or the previously composed frame. */
export function comicCastRounds<T>(portraits: readonly T[], hasPlate: boolean, maxImageReferences = 3): readonly (readonly T[])[] {
    const slots = Math.floor(maxImageReferences);
    if (!Number.isFinite(slots) || slots <= 1) return [];
    const rounds: T[][] = [];
    let index = 0;
    do {
        const capacity = slots - (rounds.length > 0 || hasPlate ? 1 : 0);
        rounds.push(portraits.slice(index, index + capacity));
        index += capacity;
    } while (index < portraits.length);
    return rounds;
}

/** How many rounds a picture covers: the last round whose people it was drawn with. */
export function comicCastRoundsDone<T>(rounds: readonly (readonly T[])[], sent: readonly T[]): number {
    let done = 0;
    rounds.forEach((round, index) => { if (round.some(item => sent.includes(item))) done = index + 1; });
    return done;
}

/** A later round: picture 1 is the frame so far, kept as it is; the next pictures are the people to add. */
export function comicAddCastCaption(names: readonly string[], chinese = false): string {
    if (chinese) {
        const who = names.map((name, index) => `参考图${index + 2}（[Image ${index + 2}]）是${name}`).join('；');
        return `参考图1（[Image 1]）是这个镜头目前的开场画面：保持它的构图、场景、光线和画面里已有的人物完全不变。`
            + `把以下人物自然地加入这个画面：${who}。每个人的脸、五官、发型、身材和服装都与其参考图一致，画风与画面一致；除此之外不要做任何改动。`;
    }
    const who = names.map((name, index) => `reference image ${index + 2} ([Image ${index + 2}]) is ${name}`).join('; ');
    return 'Reference image 1 ([Image 1]) is this shot\'s opening frame so far: keep its framing, setting, light and the people already in it exactly as they are. '
        + `Add these people into that frame, naturally placed: ${who}. Each keeps the face, features, hairstyle, build and clothes of their reference picture, `
        + 'in the frame\'s art style; change nothing else.';
}

/** The sentence that tells the video model which reference picture shows whom. */
export function comicReferenceCaption(layout: readonly (readonly string[])[], chinese = false): string {
    if (!layout.length) return '';
    if (chinese) {
        const parts = layout.map((names, index) => names.length === 1
            ? `参考图${index + 1}（[Image ${index + 1}]）是${names[0]}`
            : `参考图${index + 1}（[Image ${index + 1}]）从左到右依次是${names.join('、')}`);
        return `人物参考：${parts.join('；')}。每个人的脸、五官、发型和身材都与其参考图完全一致；服装也保持一致，除非镜头描述改变了它；`
            + '描述里的临时状态（脏污、伤口、面罩、换装）叠加在同一个人身上。整个镜头使用与参考图相同的画风。';
    }
    const parts = layout.map((names, index) => names.length === 1
        ? `reference image ${index + 1} ([Image ${index + 1}]) is ${names[0]}`
        : `reference image ${index + 1} ([Image ${index + 1}]) shows, from left to right, ${names.join(', ')}`);
    // The picture fixes who someone is; a passing state the shot describes (dirt, a wound, a mask, other clothes) goes on top.
    return `Characters: ${parts.join('; ')}. Keep each person's face, facial features, hairstyle and build exactly as in their reference picture, `
        + `and their costume too unless the shot description below changes it; a passing state it describes (dirt, a wound, a mask, other clothes) applies on top of the same person. `
        + 'Render the whole shot in the same art style as the reference pictures.';
}

export type ComicGender = 'female' | 'male';

/** A character's gender from their role, voice and look notes, so a video model knows whose voice a line is. */
export function comicCharacterGender(character: { readonly description?: string; readonly voice?: string; readonly appearance?: string }): ComicGender | undefined {
    for (const text of [character.description, character.voice, character.appearance]) {
        if (!text) continue;
        const female = /女|她|姑娘|少女|母亲|妈妈|奶奶|外婆|姐|妹|妻|夫人|小姐|\b(?:woman|women|female|girl|lady|mother|she|her|wife|sister|daughter|grandmother)\b/i.test(text);
        const male = /男|他|少年|小伙|父亲|爸爸|爷爷|外公|哥|弟|丈夫|先生|\b(?:man|men|male|boy|gentleman|father|he|his|husband|brother|son|grandfather)\b/i.test(text);
        if (female !== male) return female ? 'female' : 'male';
    }
    return undefined;
}

/** Who says a line, as a video model can tell from the picture and the voice. */
export interface ComicLineSpeaker {
    readonly name: string;
    readonly gender?: ComicGender;
    /** Age and costume, to point at the right person when several are on screen. */
    readonly looks: string;
    readonly voice: string;
    /** In the picture (named in the shot's description); otherwise the line is heard off screen. */
    readonly onScreen: boolean;
}

/** A character's age and costume, short, from their look notes. */
export function comicSpeakerLooks(appearance: string): string {
    const age = /([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*岁|\b([0-9]{1,2})[- ]year[- ]old\b/i.exec(appearance)?.[0];
    const costume = /(?:服装|服饰|穿着|costume|outfit|wears?)[:：]?\s*([^；;。.\n]{2,40})/i.exec(appearance)?.[1]?.trim();
    return [age, costume].filter(Boolean).join('，');
}

/**
 * The lines of one shot for a video model that makes sound: in order, each tied to a visible person (by
 * gender, age and costume — a name alone means nothing to the model) and a voice, or marked as heard off
 * screen, so the right person speaks. Written in the language of the lines.
 */
export interface ComicDialoguePromptOptions {
    readonly promptLanguage?: 'en' | 'any';
    readonly chinese?: boolean;
    /** Story locale or an English language name; the actual lines always remain unchanged. */
    readonly storyLanguage?: string;
}

export function comicSpokenLanguage(text: string, language?: string): string {
    const names: Readonly<Record<string, string>> = { zh: 'Mandarin Chinese', 'zh-cn': 'Mandarin Chinese', 'zh-tw': 'Mandarin Chinese',
        en: 'English', ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', 'pt-br': 'Brazilian Portuguese',
        ru: 'Russian', ar: 'Arabic', hi: 'Hindi' };
    if (language) return names[language.toLowerCase()] || names[language.toLowerCase().split('-')[0]] || language;
    if (/[ぁ-ゟ゠-ヿ]/.test(text)) return 'Japanese';
    if (/[가-힣]/.test(text)) return 'Korean';
    if (/[㐀-鿿]/.test(text)) return 'Mandarin Chinese';
    if (/[؀-ۿ]/.test(text)) return 'Arabic';
    if (/[ऀ-ॿ]/.test(text)) return 'Hindi';
    if (/[Ѐ-ӿ]/.test(text)) return 'Russian';
    return 'English';
}

export function comicDialoguePrompt(lines: readonly { readonly speaker?: ComicLineSpeaker; readonly text: string; readonly tone?: string; readonly language?: string;
    /** When the line is spoken within the clip, in seconds: lines land on their beats, as a time-coded script does. */
    readonly seconds?: readonly [number, number] }[], options: ComicDialoguePromptOptions = {}): string {
    if (!lines.length) return '';
    const chinese = options.promptLanguage !== 'en' && (options.chinese ?? lines.some(line => /[㐀-鿿]/.test(line.text)));
    const half = (value: number): string => String(Math.round(value * 2) / 2);
    const described = lines.map((line, index) => {
        const speaker = line.speaker;
        const at = line.seconds && line.seconds[1] > line.seconds[0] ? `${half(line.seconds[0])}–${half(line.seconds[1])}${chinese ? ' 秒' : ' s'}` : '';
        const number = at ? `${index + 1}.（${at}）` : `${index + 1}. `;
        const spoken = `spoken in ${comicSpokenLanguage(line.text, line.language || options.storyLanguage)}`;
        const tone = line.tone ? `${chinese ? '语气' : 'tone'}: ${line.tone}` : '';
        if (!speaker) return chinese ? `${number}旁白（画外音，画面中没有人开口）：“${line.text}”${tone ? `（${tone}）` : ''}`
            : `${number}Narrator (voice-over; nobody on screen speaks): “${line.text}” (${spoken}${tone ? `; ${tone}` : ''})`;
        if (chinese) {
            const who = speaker.gender === 'female' ? '女人' : speaker.gender === 'male' ? '男人' : '人';
            const place = speaker.onScreen ? `画面中那个${who}${speaker.looks ? `（${speaker.looks}）` : ''}` : '画外的声音（此人不在画面中，画面里的人都不开口）';
            const voice = [speaker.gender === 'female' ? '女声' : speaker.gender === 'male' ? '男声' : '', speaker.voice].filter(Boolean).join('，');
            const pronoun = speaker.gender === 'female' ? '她' : speaker.gender === 'male' ? '他' : 'Ta';
            return `${number}${speaker.name}——${place}${voice ? `；嗓音：${voice}` : ''}。${pronoun}说：“${line.text}”${tone ? `（${tone}）` : ''}`;
        }
        const who = speaker.gender === 'female' ? 'woman' : speaker.gender === 'male' ? 'man' : 'person';
        const place = speaker.onScreen ? `the ${who} on screen${speaker.looks ? ` (${speaker.looks})` : ''}` : 'heard off screen (not in the picture; nobody on screen speaks)';
        const voice = [speaker.gender === 'female' ? 'female voice' : speaker.gender === 'male' ? 'male voice' : '', speaker.voice].filter(Boolean).join(', ');
        return `${number}${speaker.name} — ${place}${voice ? `; voice: ${voice}` : ''}. Says: “${line.text}” (${spoken}${tone ? `; ${tone}` : ''})`;
    });
    const people = new Set(lines.map(line => line.speaker?.name).filter(Boolean));
    return chinese
        ? ['对白（按顺序说出，口型与声音同步，吐字清晰）：', ...described,
            `只有正在说这句台词的人嘴唇在动，其他人安静倾听、不开口${people.size === 1 ? '；这个镜头里没有别人说话' : ''}。台词只用声音表现，不要把字幕烧进画面。`].join('\n')
        : ['Dialogue, spoken clearly in this order and lip-synced:', ...described,
            `Only the person saying a line moves their lips; everyone else stays silent and listens.${people.size === 1 ? ' Nobody else speaks in this shot.' : ''} The lines are only heard: do not burn subtitles into the picture.`].join('\n');
}

/**
 * The parts added to a shot's own description, in the story's language: its set (word for word in every shot of
 * the scene, continuing from the previous shot) with lines about other places kept off the picture, who is who,
 * and the style.
 */
export function comicShotContext(chinese: boolean, parts: { readonly place: string; readonly continuing: boolean; readonly identity: string; readonly style: string }): {
    readonly continuity: string; readonly identity: string; readonly style: string;
} {
    const continuity = !parts.place ? '' : chinese
        ? `场景 — ${parts.place}。整个镜头都发生在这里${parts.continuing ? '，紧接上一个镜头：布景、光线和天气不变，每个人都在上一镜结束时的位置' : ''}；台词里提到的别处或往事不会让画面切过去。`
        : `Setting — ${parts.place}. The whole shot takes place here${parts.continuing ? ', continuing straight on from the previous shot: same set, light and weather, everyone where the last shot left them' : ''}; lines that mention another place or time do not move the picture there.`;
    return {
        continuity,
        identity: parts.identity ? `${chinese ? '人物 —' : 'Characters —'} ${parts.identity}` : '',
        style: parts.style ? `${chinese ? '风格 —' : 'Style —'} ${parts.style}` : ''
    };
}

/** How a clip with sound should sound (after its dialogue). */
export function comicSoundLine(chinese: boolean, withLines: boolean): string {
    return chinese ? `声音：环境声和动作音效贴合画面${withLines ? '，音乐压低在对白之下' : ''}。`
        : `Sound: ambience and action effects match the picture${withLines ? '; music stays low under the dialogue' : ''}.`;
}
