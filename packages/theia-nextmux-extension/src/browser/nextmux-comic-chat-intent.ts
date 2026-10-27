/**
 * Whether a message sent in a media mode (图片 / 视频 / 音乐 / 配音) is conversation rather than a description of what
 * to make. "1", "你好", "?" or "怎么用" used to start a paid video (round 33); chat products that generate media (ChatGPT,
 * 即梦) answer those in words and offer a generation once the user says what they want. A reference picture with a
 * short instruction ("动起来") is a real request, so it is never diverted.
 */
const GREETING = /^(?:你好|您好|嗨|哈喽|在吗|在不在|谢谢|多谢|好的|好|嗯|嗯嗯|哦|收到|ok|okay|hi|hello|hey|thanks|thank you|thx|yes|no|yep|nope|こんにちは|ありがとう|はい|いいえ|안녕|안녕하세요|고마워|감사합니다|네|아니요|hola|gracias|bonjour|merci|hallo|danke|olá|obrigad[oa]|привет|спасибо|مرحبا|شكرا|नमस्ते|धन्यवाद)$/i;
const ASKS_ABOUT_TOOL = /^(?:(?:你|您)?(?:能|可以|会)(?:做|干)?(?:什么|啥)|怎么用|如何使用|怎么(?:生成|做)|帮助|help|what can you do|how (?:do i|to) use(?: this)?|what is this)[？?！!。.]*$/i;

export function comicChatLooksConversational(prompt: string, hasReferences: boolean): boolean {
    if (hasReferences) return false;
    const text = prompt.trim().toLowerCase();
    const letters = text.replace(/[\s\p{P}\p{S}]/gu, '');
    if (!letters) return true;
    if (/^\d+$/.test(letters)) return true;
    if ([...letters].length < 2) return true;
    const bare = text.replace(/[\s。．.!！?？~～、,，]+$/u, '');
    return GREETING.test(bare) || ASKS_ABOUT_TOOL.test(text);
}
