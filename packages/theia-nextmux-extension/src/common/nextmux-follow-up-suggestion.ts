/**
 * "What you might ask next" in the empty message box (LobeChat #16), at no cost: when a reply ends by offering a next
 * step ("需要我帮你补充单元测试吗？", "Would you like me to add tests for it?"), that offer becomes the user's own
 * request ("请帮我补充单元测试", "Please add tests for it"). A reply that ends any other way suggests nothing.
 */

const CJK_LIMIT = 25;
const LATIN_LIMIT = 60;

function lastSentence(reply: string): string {
    const prose = reply.replace(/```[\s\S]*?(?:```|$)/g, '\n').replace(/<[^>\n]{1,80}>/g, ' ');
    const line = prose.split(/\n+/).map(item => item.trim()).filter(Boolean).at(-1) || '';
    const plain = line.replace(/^(?:>|[-*•+]|\d{1,2}[.)、])\s*/, '').replace(/[*_`~]+/g, '')
        .replace(/[\s\p{Extended_Pictographic}️]+$/u, '').trim();
    if (!plain || plain.length > 200) return '';
    return (plain.split(/(?<=[。！？!?])\s*/).filter(Boolean).at(-1) || plain).trim();
}

/** The user speaking: "your" becomes "my", the assistant's "you" the user's "me". */
function chineseAsUser(text: string): string {
    return text.replace(/[你您]们?的/g, '我的').replace(/[你您]/g, '我');
}

function englishAsUser(text: string): string {
    return text.replace(/\byours\b/gi, 'mine').replace(/\byour\b/gi, 'my').replace(/\byourself\b/gi, 'myself').replace(/\byou\b/gi, 'me');
}

const CHINESE_OFFERS: readonly RegExp[] = [
    // 需要我帮你补充单元测试吗？ / 要不要我继续优化性能？ / 是否需要我为您生成文档？
    /^(?:请问)?(?:你|您)?(?:是否|要不要|需不需要|需要|想让|希望)(?:我)(?<more>继续|接着|再)?(?:来)?(?:帮(?:你|您)|为(?:你|您)|给(?:你|您))?(?<task>.{2,40}?)(?:吗|么|呢)?[？?]$/,
    // 如果需要，我可以帮你补充文档。 / 需要的话我可以继续把它改成异步。
    /^(?:如果|若|要是)?(?:你|您)?(?:还)?(?:需要|想要|希望|愿意)(?:的话)?[，,、]?\s*我(?:也|还)?(?:可以|能|能够|会|随时可以)(?<more>继续|接着|再)?(?:帮(?:你|您)|为(?:你|您)|给(?:你|您))?(?<task>.{2,40}?)[。！!.~～]?$/,
    // 我可以帮你补充文档，需要吗？
    /^我(?:也|还)?(?:可以|能)(?<more>继续|接着|再)?(?:帮(?:你|您)|为(?:你|您)|给(?:你|您))?(?<task>.{2,40}?)[，,]\s*(?:需要吗|要吗|可以吗|好吗|如何|怎么样)[？?]?$/
];

const ENGLISH_OFFERS: readonly RegExp[] = [
    /^(?:would you like|do you want|want|should i|shall i|can i|may i)(?: me)?(?: to)?\s+(?<task>.{3,90}?)\?$/i,
    /^(?:let me know|tell me|just say) (?:if|whether) you(?:'d| would)? (?:like|want) me to\s+(?<task>.{3,90}?)[.!]?$/i,
    /^(?:if you(?:'d| would)? like|if you want|if needed|if helpful),?\s+i (?:can|could)\s+(?<task>.{3,90}?)[.!]?$/i,
    /^i (?:can|could) (?:also )?(?<task>.{3,90}?)(?: if you(?:'d| would)? like| if you want)[.!?]?$/i
];

/** "Anything else?" offers nothing in particular to ask for. */
const GENERIC_TASK = /^(?:做|处理|看看)?(?:别的|其他|其它|什么|更多)|^(?:(?:help|assist)(?: you| me)?(?: with)? )?(?:anything|something) else\b|^help(?: you| me)?$/i;

export function followUpSuggestion(reply: string): string {
    const sentence = lastSentence(String(reply || ''));
    if (!sentence) return '';
    for (const offer of CHINESE_OFFERS) {
        const match = offer.exec(sentence);
        const task = match?.groups?.task?.replace(/^一下/, '').replace(/[，,。.!！~～]+$/, '').trim();
        if (!task) continue;
        if (GENERIC_TASK.test(task)) return '';
        const request = `${match?.groups?.more ? '请继续' : '请帮我'}${chineseAsUser(task)}`;
        return request.length <= CJK_LIMIT ? request : '';
    }
    for (const offer of ENGLISH_OFFERS) {
        const task = offer.exec(sentence)?.groups?.task?.replace(/[.,;:!]+$/, '').trim();
        if (!task) continue;
        if (GENERIC_TASK.test(task)) return '';
        const request = `Please ${englishAsUser(task)}`;
        return request.length <= LATIN_LIMIT ? request : '';
    }
    return '';
}
