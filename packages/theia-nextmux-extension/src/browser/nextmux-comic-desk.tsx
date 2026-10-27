import * as React from '@theia/core/shared/react';
import type { DesktopComicCharacterLibraryEntry } from '../common/nextmux-platform-protocol';
import { ImeTextarea } from './nextmux-ime-field';
import { comicChatText } from './nextmux-comic-chat-text';
import { comicShotFieldText } from './nextmux-comic-studio-text';
import type { NextMuxDesktopLocale } from './nextmux-locale';
import { AfterLocaleAndKey, totalCopy } from './nextmux-copy-fallback';

/**
 * 制作台 — the guided production desk over the comic studio (the project list and the top bar stay
 * visible): 剧本 → 画布 → 剪辑 (画布 replaced 选角 and 拍摄; their views below remain for desks opened mid-shoot).
 *
 *   剧本  the story itself (剧本, or the next chapters as 续集) with the AI 改编 settings; the widget passes it in.
 *   选角  review before anything is filmed: the character cards (a card-draw carousel, each flips over when its
 *         portrait arrives), under them one look prompt per character, and under those one script per episode.
 *         Nothing starts by itself: portraits on 生成形象 / 生成全部形象, filming after 开始拍摄 is confirmed.
 *   拍摄  the same episode carousel; each episode shows its clips as a stacked deck (fanned out on
 *         click) above its script. The desk follows the episode being filmed.
 *   剪辑  the cut editor (the widget passes it in), so all four steps share this window, its step
 *         bar, its close button and its footer.
 *
 * Everything here is presentation; the widget owns the state and runs the jobs.
 */
/** 选角 and 拍摄 were replaced by 画布; a desk stored with either opens on the canvas. */
export type DeskStep = 'scripts' | 'canvas' | 'cast' | 'shoot' | 'edit';

export interface DeskClip {
    readonly shotId: string;
    readonly title: string;
    readonly seconds: number;
    readonly prompt: string;
    /** Exact prompt sent to an English-only video model, retained for inspection. */
    readonly generatedPrompt?: string;
    readonly state: 'waiting' | 'queued' | 'picture' | 'video' | 'done' | 'failed';
    readonly outdated?: boolean;
    readonly video?: string;
    readonly poster?: string;
    readonly error?: string;
    /** The clip's spoken lines with their times in the clip, shown the way the export burns them in (bottom, small, no speaker names). */
    readonly cues?: readonly DeskCue[];
}

export interface DeskCue { readonly start: number; readonly end: number; readonly text: string }

export interface DeskEpisode {
    readonly number: number;
    readonly title: string;
    readonly script: string;
    readonly clips: readonly DeskClip[];
    /** Shots are being written for this episode. */
    readonly splitting?: boolean;
}

export interface DeskCard {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly look: string;
    readonly picture?: string;
    readonly state: 'waiting' | 'drawing' | 'ready' | 'failed';
    readonly fromLibrary?: boolean;
    readonly error?: string;
    /** The look prompt was changed after the portrait was drawn. */
    readonly outdated?: boolean;
    /** The AI is rewriting its look prompt. */
    readonly rewriting?: boolean;
    /** Several cards of one person (another age, a transformation): which look this is, of how many. */
    readonly variant?: { readonly index: number; readonly total: number };
}

/** A question over the desk (overwrite or continue, a length far from the settings, start filming). */
export interface DeskConfirm {
    readonly title: string;
    readonly body: string;
    /** What the confirmed work is expected to cost, under the question. */
    readonly cost?: DeskConfirmCost;
    readonly actions: readonly { readonly label: string; readonly tone?: 'primary' | 'danger'; readonly onClick: () => void }[];
}

/** One row per kind of paid step (with its count), the total, and the balance it is checked against. */
export interface DeskConfirmCost {
    readonly rows: readonly { readonly label: string; readonly detail?: string; readonly amount: string }[];
    readonly total?: { readonly label: string; readonly amount: string };
    readonly balance?: { readonly label: string; readonly amount: string };
    /** Set when the balance does not cover the total: the shortfall, said plainly. */
    readonly short?: string;
    readonly note?: string;
}

type Key = 'title' | 'source' | 'scripts' | 'canvas' | 'cast' | 'shoot' | 'edit' | 'shotList' | 'adapting' | 'episode' | 'episodeTitle' | 'chars' | 'regenerate' | 'toCast'
    | 'castLead' | 'countdownCast' | 'countdownShoot' | 'startNow' | 'stop' | 'stopped' | 'start' | 'redraw' | 'upload' | 'library' | 'libraryEmpty'
    | 'drawing' | 'waiting' | 'failed' | 'fromLibrary' | 'back' | 'toShoot' | 'plan' | 'splitting' | 'splitHint' | 'splitFailed' | 'retry' | 'failedClips' | 'retryFailed' | 'zoom' | 'closeZoom' | 'frameFailed' | 'clipStopped' | 'crowdCap' | 'generating'
    | 'pause' | 'resume' | 'paused' | 'progress' | 'toEditor' | 'minimize' | 'clips' | 'noClips' | 'clipPrompt' | 'regenerateClip' | 'applyScript'
    | 'outdated' | 'queued' | 'picture' | 'video' | 'done' | 'previous' | 'next' | 'noImageModel' | 'seconds' | 'deckHint' | 'collapse' | 'noCharacters' | 'notWritten' | 'tabClip' | 'tabEpisode' | 'filming' | 'finished'
    | DeskReviewKey;

/** 选角 review, 剧本 source and the confirmations (round 25). */
export type DeskReviewKey = 'reviewLead' | 'looksTitle' | 'episodesTitle' | 'rewriteLook' | 'drawOne' | 'drawAll' | 'stopAll' | 'rewriting' | 'rewriteEpisode'
    | 'shootConfirmTitle' | 'shootConfirm' | 'shootConfirmOk' | 'cancel' | 'sameCharacter' | 'lookPlaceholder' | 'scriptTab' | 'sequelTab' | 'scriptPlaceholder'
    | 'sequelPlaceholder' | 'adapt' | 'adaptSequel' | 'stopAdapt' | 'overwriteTitle' | 'overwriteBody' | 'overwrite' | 'appendAsSequel' | 'mismatchTitle'
    | 'mismatchExpand' | 'mismatchCondense' | 'continueAdapt' | 'adjustSettings' | 'stylePanel' | 'lookChanged' | 'noLook' | 'episodeChars' | 'pictureTitle' | 'canvasLocked';

const TEXT: Record<string, Record<Key, string>> = {
    'zh-CN': {
        source: '原文', shotList: '镜头表', title: '制作台', scripts: '剧本', cast: '选角', shoot: '拍摄', edit: '剪辑', adapting: 'AI 正在改编…', episode: '第 {n} 集', episodeTitle: '本集标题', chars: '{n} 字',
        regenerate: '重新改编', toCast: '下一步：画布', canvas: '画布', castLead: '一人一张定妆照，视频里的长相、脸型和身材都以它为准。年龄、变身这类长期变化会单独成卡；受伤、换装这类临时状态写在镜头描述里。',
        countdownCast: '{n} 秒后开始生成人物形象', countdownShoot: '{n} 秒后开始拍摄', startNow: '立即开始', stop: '停止', stopped: '已停止：可以先给角色换成人物库里的人物，再开始。', start: '开始',
        redraw: '重抽', upload: '上传', library: '从人物库选择', libraryEmpty: '人物库为空', drawing: '正在绘制…', waiting: '等待绘制', failed: '绘制失败', fromLibrary: '来自人物库',
        back: '上一步', toShoot: '开始拍摄', plan: '{clips} 段 · 约 {seconds} 秒 · {model}', splitting: '正在把剧本拆成镜头…', splitFailed: '拆分镜头失败：{error}', retry: '重试', failedClips: "{n} 段拍摄失败", retryFailed: "全部重拍", zoom: "放大查看", closeZoom: "关闭", frameFailed: "开场画面没有生成：", clipStopped: "已停止，点“重拍”继续", crowdCap: "“{shot}”里有 {n} 个人物，一个镜头最多画入 8 个，其余的没有放进画面。可以把这个镜头拆成两个。", generating: "{n} 项生成中", splitHint: 'AI 在给每段安排景别、运镜和时长，每集通常要一两分钟。可以先检查角色形象；第一集拆完就开始拍摄倒计时，后面的集边拍边拆。',
        pause: '暂停', resume: '继续', paused: '已暂停，已提交的片段会继续完成', progress: '{done}/{total} 段', toEditor: '进入剪辑', minimize: '后台运行',
        clips: '{n} 段视频', noClips: '还没有开拍', clipPrompt: '这一段的画面描述', regenerateClip: '重拍这一段', applyScript: '按修改重拍本集',
        outdated: '旧形象', queued: '排队中', picture: '绘制首帧', video: '拍摄中', done: '完成', previous: '上一集', next: '下一集',
        noImageModel: '没有可用的图片模型，无法绘制人物形象。', seconds: '{n} 秒', deckHint: '点开查看每一段', collapse: '收起', noCharacters: '这部作品没有需要固定形象的角色。', notWritten: 'AI 回复了，但没有把结果写进工程，请重试。', tabClip: '这一段', tabEpisode: '本集剧本', filming: '拍摄中…', finished: '拍摄完成：{n} 段视频已放进时间线',
        reviewLead: '先检查改编结果：人物形象和每集剧本都可以直接修改，或让 AI 重写。确认后再生成人物形象，这一步不会拍视频。', looksTitle: '人物形象提示词', episodesTitle: '每集剧本',
        rewriteLook: 'AI 重写', drawOne: '生成形象', drawAll: '生成全部形象',
        stopAll: '停止生成', rewriting: 'AI 正在重写…', rewriteEpisode: '重新改编本集',
        shootConfirmTitle: '开始拍摄？', shootConfirm: '开始拍摄前，请确认已经看过每一集的剧本和人物形象。拍摄会按集生成视频并计费；改过的剧集会先重新拆分镜头。', shootConfirmOk: '已检查，开始拍摄',
        cancel: '取消', sameCharacter: '同一人物 · 形象 {n}/{total}', lookPlaceholder: '年龄、脸型、身材、发型、服装和配饰……',
        pictureTitle: '画面与模型', canvasLocked: '已经开始拍摄，画面比例和帧率不能再改。',
        scriptTab: '剧本', sequelTab: '续集', scriptPlaceholder: '粘贴小说或剧本全文。改编时会按右侧的集数和每集时长来浓缩或扩写。',
        sequelPlaceholder: '粘贴接下来的章节，改编成第 {next} 集起的后续剧情。', adapt: '开始改编', adaptSequel: '改编续集',
        stopAdapt: '停止改编', overwriteTitle: '已有改编好的剧集', overwriteBody: '当前项目已有第 {range} 集的剧情。要覆盖重新改编全部剧集，还是把这次的文字改编成第 {next} 集起的后续剧情？',
        overwrite: '覆盖重新改编', appendAsSequel: '作为后续集数', mismatchTitle: '剧情长度与设置严重不符',
        mismatchExpand: '原文约 {units}，照原样拍约 {source} 秒；你设置的是 {episodes} 集 × {seconds} 秒 = {target} 秒。AI 需要扩写到约 {factor} 倍，会加入较多原文没有写出的铺垫和细节。是否继续改编？', mismatchCondense: '原文约 {units}，照原样拍约 {source} 秒；你设置的是 {episodes} 集 × {seconds} 秒 = {target} 秒。AI 需要浓缩到约 {percent}%，很多情节会被删减。是否继续改编？', continueAdapt: '继续改编',
        adjustSettings: '调整集数和时长', stylePanel: '统一视觉设定', lookChanged: '描述已修改，可以重新生成形象',
        noLook: '还没有形象描述', episodeChars: '{n} 字'
    },
    'zh-TW': {
        source: '原文', shotList: '鏡頭表', title: '製作台', scripts: '劇本', cast: '選角', shoot: '拍攝', edit: '剪輯', adapting: 'AI 正在改編…', episode: '第 {n} 集', episodeTitle: '本集標題', chars: '{n} 字',
        regenerate: '重新改編', toCast: '下一步：畫布', canvas: '畫布', castLead: '一人一張定妝照，影片裡的長相、臉型和身材都以它為準。年齡、變身這類長期變化會單獨成卡；受傷、換裝這類臨時狀態寫在鏡頭描述裡。',
        countdownCast: '{n} 秒後開始生成人物形象', countdownShoot: '{n} 秒後開始拍攝', startNow: '立即開始', stop: '停止', stopped: '已停止：可以先把角色換成人物庫裡的人物，再開始。', start: '開始',
        redraw: '重抽', upload: '上傳', library: '從人物庫選擇', libraryEmpty: '人物庫為空', drawing: '正在繪製…', waiting: '等待繪製', failed: '繪製失敗', fromLibrary: '來自人物庫',
        back: '上一步', toShoot: '開始拍攝', plan: '{clips} 段 · 約 {seconds} 秒 · {model}', splitting: '正在把劇本拆成鏡頭…', splitFailed: '拆分鏡頭失敗：{error}', retry: '重試', failedClips: "{n} 段拍攝失敗", retryFailed: "全部重拍", zoom: "放大檢視", closeZoom: "關閉", frameFailed: "開場畫面沒有生成：", clipStopped: "已停止，點「重拍」繼續", crowdCap: "「{shot}」裡有 {n} 個人物，一個鏡頭最多畫入 8 個，其餘的沒有放進畫面。可以把這個鏡頭拆成兩個。", generating: "{n} 項生成中", splitHint: 'AI 在為每段安排景別、運鏡和時長，每集通常要一兩分鐘。可以先檢查角色形象；第一集拆完就開始拍攝倒數，後面的集邊拍邊拆。',
        pause: '暫停', resume: '繼續', paused: '已暫停，已送出的片段會繼續完成', progress: '{done}/{total} 段', toEditor: '進入剪輯', minimize: '背景執行',
        clips: '{n} 段影片', noClips: '還沒有開拍', clipPrompt: '這一段的畫面描述', regenerateClip: '重拍這一段', applyScript: '按修改重拍本集',
        outdated: '舊形象', queued: '排隊中', picture: '繪製首幀', video: '拍攝中', done: '完成', previous: '上一集', next: '下一集',
        noImageModel: '沒有可用的圖片模型，無法繪製人物形象。', seconds: '{n} 秒', deckHint: '點開查看每一段', collapse: '收起', noCharacters: '這部作品沒有需要固定形象的角色。', notWritten: 'AI 回覆了，但沒有把結果寫進專案，請重試。', tabClip: '這一段', tabEpisode: '本集劇本', filming: '拍攝中…', finished: '拍攝完成：{n} 段影片已放進時間軸',
        reviewLead: '先檢查改編結果：人物形象和每集劇本都可以直接修改，或讓 AI 重寫。確認後再生成人物形象，這一步不會拍影片。', looksTitle: '人物形象提示詞', episodesTitle: '每集劇本',
        rewriteLook: 'AI 重寫', drawOne: '產生形象', drawAll: '產生全部形象',
        stopAll: '停止產生', rewriting: 'AI 正在重寫…', rewriteEpisode: '重新改編本集',
        shootConfirmTitle: '開始拍攝？', shootConfirm: '開始拍攝前，請確認已經看過每一集的劇本和人物形象。拍攝會按集產生影片並計費；改過的劇集會先重新拆分鏡頭。', shootConfirmOk: '已檢查，開始拍攝',
        cancel: '取消', sameCharacter: '同一人物 · 形象 {n}/{total}', lookPlaceholder: '年齡、臉型、身材、髮型、服裝和配飾……',
        pictureTitle: '畫面與模型', canvasLocked: '已經開始拍攝，畫面比例和影格率不能再改。',
        scriptTab: '劇本', sequelTab: '續集', scriptPlaceholder: '貼上小說或劇本全文。改編時會按右側的集數和每集時長來濃縮或擴寫。',
        sequelPlaceholder: '貼上接下來的章節，改編成第 {next} 集起的後續劇情。', adapt: '開始改編', adaptSequel: '改編續集',
        stopAdapt: '停止改編', overwriteTitle: '已有改編好的劇集', overwriteBody: '目前專案已有第 {range} 集的劇情。要覆蓋重新改編全部劇集，還是把這次的文字改編成第 {next} 集起的後續劇情？',
        overwrite: '覆蓋重新改編', appendAsSequel: '作為後續集數', mismatchTitle: '劇情長度與設定嚴重不符',
        mismatchExpand: '原文約 {units}，照原樣拍約 {source} 秒；你設定的是 {episodes} 集 × {seconds} 秒 = {target} 秒。AI 需要擴寫到約 {factor} 倍，會加入較多原文沒有寫出的鋪陳和細節。是否繼續改編？', mismatchCondense: '原文約 {units}，照原樣拍約 {source} 秒；你設定的是 {episodes} 集 × {seconds} 秒 = {target} 秒。AI 需要濃縮到約 {percent}%，很多情節會被刪減。是否繼續改編？', continueAdapt: '繼續改編',
        adjustSettings: '調整集數和時長', stylePanel: '統一視覺設定', lookChanged: '描述已修改，可以重新產生形象',
        noLook: '還沒有形象描述', episodeChars: '{n} 字'
    },
    en: {
        source: 'Source', shotList: 'Shot list', title: 'Production desk', scripts: 'Script', cast: 'Casting', shoot: 'Filming', edit: 'Editing', adapting: 'The AI is adapting…', episode: 'Episode {n}', episodeTitle: 'Episode title', chars: '{n} characters',
        regenerate: 'Adapt again', toCast: 'Next: canvas', canvas: 'Canvas', castLead: "One portrait per character fixes their face and build in every clip. Lasting changes (as a child, transformed) get their own card; passing states (dirty, hurt, masked, a change of clothes) go in each clip's description.",
        countdownCast: 'Portraits start in {n} s', countdownShoot: 'Filming starts in {n} s', startNow: 'Start now', stop: 'Stop', stopped: 'Stopped: you can give roles characters from your library first, then start.', start: 'Start',
        redraw: 'Redraw', upload: 'Upload', library: 'Pick from Characters', libraryEmpty: 'No saved characters yet', drawing: 'Drawing…', waiting: 'Waiting', failed: 'Failed', fromLibrary: 'From the library',
        back: 'Back', toShoot: 'Start filming', plan: '{clips} clips · about {seconds} s · {model}', splitting: 'Splitting the scripts into shots…', splitFailed: 'Could not split into shots: {error}', retry: 'Retry', failedClips: "{n} clips failed", retryFailed: "Film them again", zoom: "View larger", closeZoom: "Close", frameFailed: "Opening frame failed: ", clipStopped: "Stopped — choose Retake to continue", crowdCap: "“{shot}” has {n} people; a shot draws at most 8, so the others were left out. Split it into two shots to include everyone.", generating: "{n} generating", splitHint: 'The AI is planning framing, camera moves and length for every clip; an episode usually takes a minute or two. Check the portraits meanwhile: filming counts down as soon as episode 1 is split, and later episodes are split while it films.',
        pause: 'Pause', resume: 'Resume', paused: 'Paused; clips already sent will still finish', progress: '{done}/{total} clips', toEditor: 'Open editor', minimize: 'Run in background',
        clips: '{n} clips', noClips: 'Not filmed yet', clipPrompt: 'What this clip shows', regenerateClip: 'Film this clip again', applyScript: 'Film this episode again with the changes',
        outdated: 'Old look', queued: 'Queued', picture: 'First frame', video: 'Filming', done: 'Done', previous: 'Previous episode', next: 'Next episode',
        noImageModel: 'No image model is available for portraits.', seconds: '{n} s', deckHint: 'Open to see each clip', collapse: 'Collapse', noCharacters: 'This work has no characters that need a fixed look.', notWritten: 'The AI replied but did not write the result into the project. Please try again.', tabClip: 'This clip', tabEpisode: 'Episode script', filming: 'Filming…', finished: 'Filming done: {n} clips are on the timeline',
        reviewLead: 'Check the adaptation first: each character’s look and each episode’s script. Edit them directly or let the AI rewrite them. Then create the portraits — nothing is filmed at this step.', looksTitle: 'Character looks', episodesTitle: 'Episode scripts',
        rewriteLook: 'AI rewrite', drawOne: 'Create portrait', drawAll: 'Create all portraits',
        stopAll: 'Stop', rewriting: 'The AI is rewriting…', rewriteEpisode: 'Adapt this episode again',
        shootConfirmTitle: 'Start filming?', shootConfirm: 'Before filming, make sure you have read every episode’s script and checked the characters. Filming makes and bills the videos episode by episode; edited episodes are split into shots again first.', shootConfirmOk: 'Checked — start filming',
        cancel: 'Cancel', sameCharacter: 'Same person · look {n}/{total}', lookPlaceholder: 'Age, face, build, hair, costume and accessories…',
        pictureTitle: 'Picture and models', canvasLocked: 'Filming has started, so the aspect ratio and frame rate can no longer change.',
        scriptTab: 'Script', sequelTab: 'Sequel', scriptPlaceholder: 'Paste the whole novel or script. The adaptation condenses or expands it to the episodes and episode length on the right.',
        sequelPlaceholder: 'Paste the next chapters to adapt them into the story from episode {next} on.', adapt: 'Adapt', adaptSequel: 'Adapt sequel',
        stopAdapt: 'Stop adapting', overwriteTitle: 'Episodes already adapted', overwriteBody: 'This project already has episode(s) {range}. Rewrite every episode from scratch, or adapt this text into the story from episode {next} on?',
        overwrite: 'Rewrite all', appendAsSequel: 'Continue as new episodes', mismatchTitle: 'The story length is far from the settings',
        mismatchExpand: 'The source is about {units}, about {source} s told as written; you set {episodes} × {seconds} s = {target} s. The AI would have to expand it about {factor}×, adding a lot the text doesn’t say. Adapt anyway?', mismatchCondense: 'The source is about {units}, about {source} s told as written; you set {episodes} × {seconds} s = {target} s. The AI would have to condense it to about {percent}%, cutting much of the plot. Adapt anyway?', continueAdapt: 'Adapt anyway',
        adjustSettings: 'Change episodes and length', stylePanel: 'Series look', lookChanged: 'The description changed; create the portrait again',
        noLook: 'No look description yet', episodeChars: '{n} characters'
    },
    ja: {
        source: '原作', shotList: 'ショット一覧', title: '制作デスク', scripts: '脚本', cast: 'キャスティング', shoot: '撮影', edit: '編集', adapting: 'AI が脚色中…', episode: '第 {n} 話', episodeTitle: 'この話のタイトル', chars: '{n} 文字',
        regenerate: 'もう一度脚色', toCast: '次へ：キャンバス', canvas: 'キャンバス', castLead: '各キャラクターの顔と体格は、この1枚の立ち絵に合わせます。子ども時代や変身など長く続く変化は別のカードに、汚れ・けが・覆面・着替えなど一時的な状態は各カットの描写に書きます。',
        countdownCast: '{n} 秒後に立ち絵の生成を開始', countdownShoot: '{n} 秒後に撮影を開始', startNow: '今すぐ開始', stop: '停止', stopped: '停止中：先にライブラリのキャラクターを役に割り当ててから開始できます。', start: '開始',
        redraw: '引き直す', upload: 'アップロード', library: 'ライブラリ', libraryEmpty: 'ライブラリは空です', drawing: '描画中…', waiting: '待機中', failed: '失敗', fromLibrary: 'ライブラリから',
        back: '戻る', toShoot: '撮影開始', plan: '{clips} 本 · 約 {seconds} 秒 · {model}', splitting: '脚本をショットに分割中…', splitFailed: 'ショットに分割できません：{error}', retry: '再試行', failedClips: "{n} 本の撮影に失敗", retryFailed: "まとめて撮り直す", zoom: "拡大して見る", closeZoom: "閉じる", frameFailed: "オープニングの画が作れませんでした：", clipStopped: "停止しました。「撮り直す」で続けます", crowdCap: "「{shot}」には {n} 人登場しますが、1 カットに描けるのは最大 8 人のため、残りは入っていません。カットを 2 つに分けてください。", generating: "{n} 件を生成中", splitHint: 'AI が各カットの画角・カメラワーク・長さを決めています。1話につき1〜2分ほどです。その間に立ち絵を確認できます。第1話が終わると撮影のカウントダウンが始まり、続きの話は撮影と並行して分割します。',
        pause: '一時停止', resume: '再開', paused: '一時停止中。送信済みのクリップは完了します', progress: '{done}/{total} 本', toEditor: '編集へ', minimize: 'バックグラウンドで実行',
        clips: '動画 {n} 本', noClips: 'まだ撮影していません', clipPrompt: 'このクリップの内容', regenerateClip: 'このクリップを撮り直す', applyScript: '変更どおりこの話を撮り直す',
        outdated: '古い見た目', queued: '待機中', picture: '最初のフレーム', video: '撮影中', done: '完了', previous: '前の話', next: '次の話',
        noImageModel: '立ち絵に使える画像モデルがありません。', seconds: '{n} 秒', deckHint: '開いて各クリップを見る', collapse: '閉じる', noCharacters: '固定の見た目が必要なキャラクターはいません。', notWritten: 'AI は返答しましたが、結果をプロジェクトに書き込みませんでした。もう一度お試しください。', tabClip: 'このクリップ', tabEpisode: 'この話の脚本', filming: '撮影中…', finished: '撮影完了：{n} 本の動画をタイムラインに配置しました',
        reviewLead: 'まず脚色結果を確認してください：各キャラクターの見た目と各話の脚本。そのまま編集するか AI に書き直させ、確認してから立ち絵を作ります。この段階では動画は撮りません。', looksTitle: 'キャラクターの見た目', episodesTitle: '各話の脚本',
        rewriteLook: 'AI で書き直す', drawOne: '立ち絵を作る', drawAll: 'すべての立ち絵を作る',
        stopAll: '停止', rewriting: 'AI が書き直しています…', rewriteEpisode: 'この話を脚色し直す',
        shootConfirmTitle: '撮影を始めますか？', shootConfirm: '撮影前に、各話の脚本とキャラクターを確認したかご確認ください。撮影では話ごとに動画を作り、料金がかかります。編集した話は先にショットを分け直します。', shootConfirmOk: '確認済み、撮影開始',
        cancel: 'キャンセル', sameCharacter: '同一人物 · 見た目 {n}/{total}', lookPlaceholder: '年齢、顔、体格、髪型、衣装、アクセサリー…',
        pictureTitle: '画面とモデル', canvasLocked: '撮影を始めたため、画面比率とフレームレートは変更できません。',
        scriptTab: '脚本', sequelTab: '続編', scriptPlaceholder: '小説または脚本の全文を貼り付けてください。右の話数と1話の長さに合わせて圧縮または拡張します。',
        sequelPlaceholder: '続きの章を貼り付けると、第 {next} 話からの続きとして脚色します。', adapt: '脚色を始める', adaptSequel: '続編を脚色',
        stopAdapt: '脚色を停止', overwriteTitle: '脚色済みの話があります', overwriteBody: 'このプロジェクトには第 {range} 話があります。すべて上書きして脚色し直しますか？それとも今回の文章を第 {next} 話からの続きにしますか？',
        overwrite: '上書きして脚色し直す', appendAsSequel: '続きの話にする', mismatchTitle: '物語の長さが設定と大きく違います',
        mismatchExpand: '原文は約 {units}、そのまま撮ると約 {source} 秒です。設定は {episodes} 話 × {seconds} 秒 = {target} 秒。AI は約 {factor} 倍に拡張する必要があり、原文にない描写が多く加わります。脚色を続けますか？', mismatchCondense: '原文は約 {units}、そのまま撮ると約 {source} 秒です。設定は {episodes} 話 × {seconds} 秒 = {target} 秒。AI は約 {percent}% に圧縮する必要があり、多くの筋が削られます。脚色を続けますか？', continueAdapt: '続ける',
        adjustSettings: '話数と長さを変える', stylePanel: '作品全体の見た目', lookChanged: '説明が変わりました。立ち絵を作り直せます',
        noLook: '見た目の説明がまだありません', episodeChars: '{n} 文字'
    },
    ko: {
        source: '원문', shotList: '샷 목록', title: '제작 데스크', scripts: '대본', cast: '캐스팅', shoot: '촬영', edit: '편집', adapting: 'AI가 각색 중…', episode: '{n}화', episodeTitle: '이번 화 제목', chars: '{n}자',
        regenerate: '다시 각색', toCast: '다음: 캔버스', canvas: '캔버스', castLead: '캐릭터마다 한 장의 프로필로 모든 영상의 얼굴과 체형을 맞춥니다. 어린 시절·변신 같은 오래가는 변화는 별도 카드로, 먼지·부상·가면·옷 갈아입기 같은 일시적 상태는 각 컷 설명에 씁니다.',
        countdownCast: '{n}초 후 인물 이미지 생성', countdownShoot: '{n}초 후 촬영 시작', startNow: '지금 시작', stop: '멈춤', stopped: '멈춤: 먼저 라이브러리 인물을 역할에 지정한 뒤 시작할 수 있습니다.', start: '시작',
        redraw: '다시 뽑기', upload: '업로드', library: '라이브러리', libraryEmpty: '라이브러리가 비어 있습니다', drawing: '그리는 중…', waiting: '대기 중', failed: '실패', fromLibrary: '라이브러리에서',
        back: '이전', toShoot: '촬영 시작', plan: '{clips}개 · 약 {seconds}초 · {model}', splitting: '대본을 컷으로 나누는 중…', splitFailed: '컷으로 나누지 못했습니다: {error}', retry: '다시 시도', failedClips: "{n}개 촬영 실패", retryFailed: "모두 다시 촬영", zoom: "크게 보기", closeZoom: "닫기", frameFailed: "시작 화면을 만들지 못했습니다: ", clipStopped: "중지됨 — 다시 촬영을 눌러 계속합니다", crowdCap: "“{shot}”에 {n}명이 나오지만 한 컷에는 최대 8명까지 그려져 나머지는 빠졌습니다. 컷을 둘로 나누세요.", generating: "{n}개 생성 중", splitHint: 'AI가 컷마다 구도·카메라 움직임·길이를 정하고 있습니다. 한 화에 보통 1~2분 걸립니다. 그동안 캐릭터 이미지를 확인하세요. 1화가 나뉘면 촬영 카운트다운이 시작되고, 다음 화는 촬영하는 동안 나눕니다.',
        pause: '일시정지', resume: '계속', paused: '일시정지됨. 이미 보낸 클립은 계속 완료됩니다', progress: '{done}/{total}개', toEditor: '편집으로', minimize: '백그라운드 실행',
        clips: '영상 {n}개', noClips: '아직 촬영 전', clipPrompt: '이 클립의 화면 설명', regenerateClip: '이 클립 다시 촬영', applyScript: '수정대로 이 화 다시 촬영',
        outdated: '이전 외모', queued: '대기 중', picture: '첫 프레임', video: '촬영 중', done: '완료', previous: '이전 화', next: '다음 화',
        noImageModel: '인물 이미지에 쓸 이미지 모델이 없습니다.', seconds: '{n}초', deckHint: '열어서 클립 보기', collapse: '접기', noCharacters: '고정된 외모가 필요한 인물이 없습니다.', notWritten: 'AI가 답했지만 결과를 프로젝트에 쓰지 않았습니다. 다시 시도해 주세요.', tabClip: '이 클립', tabEpisode: '이번 화 대본', filming: '촬영 중…', finished: '촬영 완료: 영상 {n}개를 타임라인에 넣었습니다',
        reviewLead: '먼저 각색 결과를 확인하세요: 인물마다 외모 설명, 회차마다 대본. 바로 고치거나 AI에게 다시 쓰게 할 수 있습니다. 확인한 뒤 인물 이미지를 만듭니다. 이 단계에서는 영상을 찍지 않습니다.', looksTitle: '인물 외모 프롬프트', episodesTitle: '회차별 대본',
        rewriteLook: 'AI 다시 쓰기', drawOne: '이미지 만들기', drawAll: '모든 인물 이미지 만들기',
        stopAll: '중지', rewriting: 'AI가 다시 쓰는 중…', rewriteEpisode: '이 회차 다시 각색',
        shootConfirmTitle: '촬영을 시작할까요?', shootConfirm: '촬영 전에 모든 회차의 대본과 인물을 확인했는지 확인하세요. 촬영은 회차마다 영상을 만들고 요금이 청구됩니다. 고친 회차는 먼저 컷을 다시 나눕니다.', shootConfirmOk: '확인했어요, 촬영 시작',
        cancel: '취소', sameCharacter: '같은 인물 · 모습 {n}/{total}', lookPlaceholder: '나이, 얼굴형, 체형, 헤어스타일, 의상과 장신구…',
        pictureTitle: '화면과 모델', canvasLocked: '촬영을 시작해서 화면 비율과 프레임 레이트는 더 바꿀 수 없습니다.',
        scriptTab: '대본', sequelTab: '속편', scriptPlaceholder: '소설이나 대본 전문을 붙여 넣으세요. 오른쪽의 회차 수와 회차 길이에 맞춰 줄이거나 늘립니다.',
        sequelPlaceholder: '다음 장을 붙여 넣으면 {next}화부터 이어지는 이야기로 각색합니다.', adapt: '각색 시작', adaptSequel: '속편 각색',
        stopAdapt: '각색 중지', overwriteTitle: '이미 각색한 회차가 있습니다', overwriteBody: '이 프로젝트에는 {range}화가 있습니다. 모든 회차를 덮어써서 다시 각색할까요, 아니면 이번 글을 {next}화부터 이어지는 이야기로 각색할까요?',
        overwrite: '덮어쓰고 다시 각색', appendAsSequel: '다음 회차로 추가', mismatchTitle: '이야기 길이가 설정과 크게 다릅니다',
        mismatchExpand: '원문은 약 {units}, 그대로 찍으면 약 {source}초입니다. 설정은 {episodes}화 × {seconds}초 = {target}초입니다. AI가 약 {factor}배로 늘려야 해서 원문에 없는 내용이 많이 들어갑니다. 계속 각색할까요?', mismatchCondense: '원문은 약 {units}, 그대로 찍으면 약 {source}초입니다. 설정은 {episodes}화 × {seconds}초 = {target}초입니다. AI가 약 {percent}%로 줄여야 해서 많은 줄거리가 빠집니다. 계속 각색할까요?', continueAdapt: '계속 각색',
        adjustSettings: '회차 수와 길이 바꾸기', stylePanel: '작품 전체 룩', lookChanged: '설명이 바뀌었습니다. 이미지를 다시 만들 수 있습니다',
        noLook: '아직 외모 설명이 없습니다', episodeChars: '{n}자'
    },
    es: {
        source: 'Original', shotList: 'Lista de planos', title: 'Mesa de producción', scripts: 'Guion', cast: 'Reparto', shoot: 'Rodaje', edit: 'Edición', adapting: 'La IA está adaptando…', episode: 'Episodio {n}', episodeTitle: 'Título del episodio', chars: '{n} caracteres',
        regenerate: 'Adaptar de nuevo', toCast: 'Siguiente: lienzo', canvas: 'Lienzo', castLead: 'Un retrato por personaje fija su cara y su físico en todos los clips. Los cambios duraderos (de niño, transformado) tienen su propia tarjeta; los estados pasajeros (sucio, herido, enmascarado, otra ropa) van en la descripción de cada clip.',
        countdownCast: 'Los retratos empiezan en {n} s', countdownShoot: 'El rodaje empieza en {n} s', startNow: 'Empezar ya', stop: 'Detener', stopped: 'Detenido: puedes asignar primero personajes de tu biblioteca y luego empezar.', start: 'Empezar',
        redraw: 'Repetir', upload: 'Subir', library: 'Biblioteca', libraryEmpty: 'La biblioteca está vacía', drawing: 'Dibujando…', waiting: 'En espera', failed: 'Error', fromLibrary: 'De la biblioteca',
        back: 'Atrás', toShoot: 'Empezar rodaje', plan: '{clips} clips · unos {seconds} s · {model}', splitting: 'Dividiendo los guiones en planos…', splitFailed: 'No se pudo dividir en planos: {error}', retry: 'Reintentar', failedClips: "{n} clips fallaron", retryFailed: "Rodarlos de nuevo", zoom: "Ver más grande", closeZoom: "Cerrar", frameFailed: "No se pudo crear el fotograma inicial: ", clipStopped: "Detenido: elige Volver a grabar para continuar", crowdCap: "«{shot}» tiene {n} personas; un plano dibuja como máximo 8, así que el resto quedó fuera. Divídelo en dos planos.", generating: "{n} generándose", splitHint: 'La IA está planificando encuadre, movimiento de cámara y duración de cada clip; un episodio suele tardar uno o dos minutos. Revisa los retratos mientras tanto: el rodaje empieza en cuanto el episodio 1 está dividido y los siguientes se dividen mientras se rueda.',
        pause: 'Pausar', resume: 'Continuar', paused: 'En pausa; los clips ya enviados terminarán', progress: '{done}/{total} clips', toEditor: 'Ir a edición', minimize: 'Seguir en segundo plano',
        clips: '{n} clips', noClips: 'Aún sin rodar', clipPrompt: 'Qué muestra este clip', regenerateClip: 'Volver a rodar este clip', applyScript: 'Volver a rodar el episodio con los cambios',
        outdated: 'Aspecto anterior', queued: 'En cola', picture: 'Primer fotograma', video: 'Rodando', done: 'Listo', previous: 'Episodio anterior', next: 'Episodio siguiente',
        noImageModel: 'No hay un modelo de imagen para los retratos.', seconds: '{n} s', deckHint: 'Ábrelo para ver cada clip', collapse: 'Cerrar', noCharacters: 'Esta obra no tiene personajes que necesiten un aspecto fijo.', notWritten: 'La IA respondió pero no escribió el resultado en el proyecto. Inténtalo de nuevo.', tabClip: 'Este clip', tabEpisode: 'Guion del episodio', filming: 'Rodando…', finished: 'Rodaje terminado: {n} clips en la línea de tiempo',
        reviewLead: 'Revisa primero la adaptación: el aspecto de cada personaje y el guion de cada episodio. Edítalos o pide a la IA que los reescriba. Después crea los retratos; en este paso no se graba vídeo.', looksTitle: 'Aspecto de los personajes', episodesTitle: 'Guiones por episodio',
        rewriteLook: 'Reescribir con IA', drawOne: 'Crear retrato', drawAll: 'Crear todos los retratos',
        stopAll: 'Detener', rewriting: 'La IA está reescribiendo…', rewriteEpisode: 'Adaptar de nuevo este episodio',
        shootConfirmTitle: '¿Empezar el rodaje?', shootConfirm: 'Antes de rodar, confirma que has leído el guion de cada episodio y revisado los personajes. El rodaje crea y cobra los vídeos episodio a episodio; los episodios editados se vuelven a dividir en planos primero.', shootConfirmOk: 'Revisado, empezar a rodar',
        cancel: 'Cancelar', sameCharacter: 'Mismo personaje · aspecto {n}/{total}', lookPlaceholder: 'Edad, rostro, complexión, peinado, vestuario y accesorios…',
        pictureTitle: 'Imagen y modelos', canvasLocked: 'El rodaje ya empezó, así que la relación de aspecto y la frecuencia de fotogramas ya no pueden cambiar.',
        scriptTab: 'Guion', sequelTab: 'Continuación', scriptPlaceholder: 'Pega la novela o el guion completo. La adaptación lo condensa o amplía según los episodios y la duración de la derecha.',
        sequelPlaceholder: 'Pega los siguientes capítulos para adaptarlos como continuación desde el episodio {next}.', adapt: 'Adaptar', adaptSequel: 'Adaptar continuación',
        stopAdapt: 'Detener la adaptación', overwriteTitle: 'Ya hay episodios adaptados', overwriteBody: 'Este proyecto ya tiene los episodios {range}. ¿Reescribir todos los episodios o adaptar este texto como continuación desde el episodio {next}?',
        overwrite: 'Reescribir todo', appendAsSequel: 'Continuar como episodios nuevos', mismatchTitle: 'La longitud de la historia no encaja con los ajustes',
        mismatchExpand: 'El original tiene unos {units}, unos {source} s contado tal cual; has puesto {episodes} × {seconds} s = {target} s. La IA tendría que ampliarlo unas {factor} veces y añadir mucho que el texto no dice. ¿Adaptar igualmente?', mismatchCondense: 'El original tiene unos {units}, unos {source} s contado tal cual; has puesto {episodes} × {seconds} s = {target} s. La IA tendría que condensarlo a un {percent}% y recortar gran parte de la trama. ¿Adaptar igualmente?', continueAdapt: 'Adaptar igualmente',
        adjustSettings: 'Cambiar episodios y duración', stylePanel: 'Estilo de la serie', lookChanged: 'La descripción cambió; vuelve a crear el retrato',
        noLook: 'Aún sin descripción de aspecto', episodeChars: '{n} caracteres'
    },
    fr: {
        source: 'Texte source', shotList: 'Liste des plans', title: 'Table de production', scripts: 'Scénario', cast: 'Casting', shoot: 'Tournage', edit: 'Montage', adapting: 'L’IA adapte…', episode: 'Épisode {n}', episodeTitle: 'Titre de l’épisode', chars: '{n} caractères',
        regenerate: 'Adapter à nouveau', toCast: 'Suivant : canevas', canvas: 'Canevas', castLead: 'Un portrait par personnage fixe son visage et sa silhouette dans chaque clip. Les changements durables (enfant, transformé) ont leur propre carte ; les états passagers (sale, blessé, masqué, autre tenue) vont dans la description de chaque clip.',
        countdownCast: 'Portraits dans {n} s', countdownShoot: 'Tournage dans {n} s', startNow: 'Démarrer', stop: 'Arrêter', stopped: 'Arrêté : attribuez d’abord des personnages de votre bibliothèque, puis démarrez.', start: 'Démarrer',
        redraw: 'Retirer', upload: 'Importer', library: 'Bibliothèque', libraryEmpty: 'La bibliothèque est vide', drawing: 'Dessin…', waiting: 'En attente', failed: 'Échec', fromLibrary: 'De la bibliothèque',
        back: 'Retour', toShoot: 'Lancer le tournage', plan: '{clips} clips · environ {seconds} s · {model}', splitting: 'Découpage des scénarios en plans…', splitFailed: 'Découpage impossible : {error}', retry: 'Réessayer', failedClips: "{n} clips ont échoué", retryFailed: "Les retourner", zoom: "Agrandir", closeZoom: "Fermer", frameFailed: "Image d’ouverture non créée : ", clipStopped: "Arrêté — choisissez Refaire pour continuer", crowdCap: "« {shot} » compte {n} personnages ; un plan en dessine 8 au plus, les autres ont été laissés de côté. Divisez-le en deux plans.", generating: "{n} en cours", splitHint: "L'IA prépare le cadrage, les mouvements de caméra et la durée de chaque clip ; un épisode prend en général une à deux minutes. Vérifiez les portraits en attendant : le tournage démarre dès que l'épisode 1 est découpé, les suivants sont découpés pendant le tournage.",
        pause: 'Pause', resume: 'Reprendre', paused: 'En pause ; les clips déjà envoyés se terminent', progress: '{done}/{total} clips', toEditor: 'Passer au montage', minimize: 'Continuer en arrière-plan',
        clips: '{n} clips', noClips: 'Pas encore tourné', clipPrompt: 'Ce que montre ce clip', regenerateClip: 'Retourner ce clip', applyScript: 'Retourner l’épisode avec les changements',
        outdated: 'Ancien look', queued: 'En file', picture: 'Première image', video: 'Tournage', done: 'Prêt', previous: 'Épisode précédent', next: 'Épisode suivant',
        noImageModel: 'Aucun modèle d’image disponible pour les portraits.', seconds: '{n} s', deckHint: 'Ouvrir pour voir chaque clip', collapse: 'Replier', noCharacters: 'Aucun personnage n’a besoin d’une apparence fixe.', notWritten: 'L’IA a répondu sans écrire le résultat dans le projet. Réessayez.', tabClip: 'Ce clip', tabEpisode: 'Scénario de l’épisode', filming: 'Tournage…', finished: 'Tournage terminé : {n} clips sur la timeline',
        reviewLead: 'Vérifiez d’abord l’adaptation : l’apparence de chaque personnage et le scénario de chaque épisode. Modifiez-les ou demandez à l’IA de les réécrire, puis créez les portraits. Rien n’est tourné à cette étape.', looksTitle: 'Apparence des personnages', episodesTitle: 'Scénarios des épisodes',
        rewriteLook: 'Réécrire avec l’IA', drawOne: 'Créer le portrait', drawAll: 'Créer tous les portraits',
        stopAll: 'Arrêter', rewriting: 'L’IA réécrit…', rewriteEpisode: 'Réadapter cet épisode',
        shootConfirmTitle: 'Lancer le tournage ?', shootConfirm: 'Avant de tourner, vérifiez que vous avez lu le scénario de chaque épisode et contrôlé les personnages. Le tournage crée et facture les vidéos épisode par épisode ; les épisodes modifiés sont d’abord redécoupés en plans.', shootConfirmOk: 'Vérifié, lancer le tournage',
        cancel: 'Annuler', sameCharacter: 'Même personnage · apparence {n}/{total}', lookPlaceholder: 'Âge, visage, silhouette, coiffure, costume et accessoires…',
        pictureTitle: 'Image et modèles', canvasLocked: 'Le tournage a commencé : le format et la fréquence d’images ne peuvent plus changer.',
        scriptTab: 'Scénario', sequelTab: 'Suite', scriptPlaceholder: 'Collez le roman ou le scénario complet. L’adaptation le condense ou le développe selon le nombre d’épisodes et leur durée à droite.',
        sequelPlaceholder: 'Collez les chapitres suivants pour les adapter en suite à partir de l’épisode {next}.', adapt: 'Adapter', adaptSequel: 'Adapter la suite',
        stopAdapt: 'Arrêter l’adaptation', overwriteTitle: 'Des épisodes sont déjà adaptés', overwriteBody: 'Ce projet a déjà les épisodes {range}. Réécrire tous les épisodes, ou adapter ce texte en suite à partir de l’épisode {next} ?',
        overwrite: 'Tout réécrire', appendAsSequel: 'Continuer en nouveaux épisodes', mismatchTitle: 'La longueur de l’histoire est très loin des réglages',
        mismatchExpand: 'Le texte fait environ {units}, soit environ {source} s tel quel ; vous avez choisi {episodes} × {seconds} s = {target} s. L’IA devrait le développer environ {factor} fois et ajouter beaucoup de choses absentes du texte. Adapter quand même ?', mismatchCondense: 'Le texte fait environ {units}, soit environ {source} s tel quel ; vous avez choisi {episodes} × {seconds} s = {target} s. L’IA devrait le condenser à environ {percent} % et couper une grande partie de l’intrigue. Adapter quand même ?', continueAdapt: 'Adapter quand même',
        adjustSettings: 'Changer les épisodes et la durée', stylePanel: 'Style de la série', lookChanged: 'La description a changé ; recréez le portrait',
        noLook: 'Pas encore de description', episodeChars: '{n} caractères'
    },
    de: {
        source: 'Vorlage', shotList: 'Shotliste', title: 'Produktionstisch', scripts: 'Drehbuch', cast: 'Casting', shoot: 'Dreh', edit: 'Schnitt', adapting: 'Die KI adaptiert…', episode: 'Folge {n}', episodeTitle: 'Titel der Folge', chars: '{n} Zeichen',
        regenerate: 'Neu adaptieren', toCast: 'Weiter: Leinwand', canvas: 'Leinwand', castLead: 'Ein Porträt pro Figur legt Gesicht und Statur in jedem Clip fest. Dauerhafte Veränderungen (als Kind, verwandelt) bekommen eine eigene Karte; vorübergehende Zustände (schmutzig, verletzt, maskiert, andere Kleidung) stehen in der Beschreibung des jeweiligen Clips.',
        countdownCast: 'Porträts starten in {n} s', countdownShoot: 'Dreh startet in {n} s', startNow: 'Jetzt starten', stop: 'Stopp', stopped: 'Angehalten: Rollen zuerst Figuren aus der Bibliothek zuweisen, dann starten.', start: 'Starten',
        redraw: 'Neu ziehen', upload: 'Hochladen', library: 'Bibliothek', libraryEmpty: 'Die Bibliothek ist leer', drawing: 'Wird gezeichnet…', waiting: 'Wartet', failed: 'Fehler', fromLibrary: 'Aus der Bibliothek',
        back: 'Zurück', toShoot: 'Dreh starten', plan: '{clips} Clips · etwa {seconds} s · {model}', splitting: 'Drehbücher werden in Shots zerlegt…', splitFailed: 'Zerlegung fehlgeschlagen: {error}', retry: 'Erneut', failedClips: "{n} Clips fehlgeschlagen", retryFailed: "Alle neu drehen", zoom: "Größer anzeigen", closeZoom: "Schließen", frameFailed: "Startbild fehlgeschlagen: ", clipStopped: "Angehalten – „Neu aufnehmen“ wählen, um fortzufahren", crowdCap: "„{shot}“ hat {n} Personen; eine Einstellung zeigt höchstens 8, die übrigen fehlen. Teile sie in zwei Einstellungen.", generating: "{n} werden erstellt", splitHint: 'Die KI plant Einstellung, Kamerabewegung und Länge jedes Clips; eine Folge dauert meist ein bis zwei Minuten. Prüfen Sie derweil die Porträts: Der Dreh beginnt, sobald Folge 1 zerlegt ist, die weiteren Folgen werden während des Drehs zerlegt.',
        pause: 'Pause', resume: 'Fortsetzen', paused: 'Pausiert; bereits gesendete Clips werden fertig', progress: '{done}/{total} Clips', toEditor: 'Zum Schnitt', minimize: 'Im Hintergrund',
        clips: '{n} Clips', noClips: 'Noch nicht gedreht', clipPrompt: 'Was dieser Clip zeigt', regenerateClip: 'Clip neu drehen', applyScript: 'Folge mit Änderungen neu drehen',
        outdated: 'Altes Aussehen', queued: 'Wartet', picture: 'Erstes Bild', video: 'Dreh läuft', done: 'Fertig', previous: 'Vorige Folge', next: 'Nächste Folge',
        noImageModel: 'Kein Bildmodell für Porträts verfügbar.', seconds: '{n} s', deckHint: 'Öffnen, um jeden Clip zu sehen', collapse: 'Einklappen', noCharacters: 'Keine Figur braucht ein festes Aussehen.', notWritten: 'Die KI hat geantwortet, das Ergebnis aber nicht ins Projekt geschrieben. Bitte erneut versuchen.', tabClip: 'Dieser Clip', tabEpisode: 'Drehbuch der Folge', filming: 'Wird gedreht…', finished: 'Dreh fertig: {n} Clips liegen auf der Timeline',
        reviewLead: 'Prüfe zuerst die Adaption: das Aussehen jeder Figur und das Drehbuch jeder Folge. Bearbeite sie direkt oder lass die KI sie neu schreiben. Danach entstehen die Porträts – in diesem Schritt wird nichts gedreht.', looksTitle: 'Aussehen der Figuren', episodesTitle: 'Drehbücher der Folgen',
        rewriteLook: 'Mit KI neu schreiben', drawOne: 'Porträt erstellen', drawAll: 'Alle Porträts erstellen',
        stopAll: 'Stoppen', rewriting: 'Die KI schreibt neu…', rewriteEpisode: 'Diese Folge neu adaptieren',
        shootConfirmTitle: 'Dreh starten?', shootConfirm: 'Bitte bestätige vor dem Dreh, dass du das Drehbuch jeder Folge gelesen und die Figuren geprüft hast. Der Dreh erstellt und berechnet die Videos Folge für Folge; bearbeitete Folgen werden vorher neu in Einstellungen aufgeteilt.', shootConfirmOk: 'Geprüft – Dreh starten',
        cancel: 'Abbrechen', sameCharacter: 'Dieselbe Figur · Aussehen {n}/{total}', lookPlaceholder: 'Alter, Gesicht, Statur, Frisur, Kostüm und Accessoires…',
        pictureTitle: 'Bild und Modelle', canvasLocked: 'Der Dreh hat begonnen, daher lassen sich Seitenverhältnis und Bildrate nicht mehr ändern.',
        scriptTab: 'Drehbuch', sequelTab: 'Fortsetzung', scriptPlaceholder: 'Füge den ganzen Roman oder das Drehbuch ein. Die Adaption kürzt oder erweitert ihn passend zu Folgenzahl und Folgenlänge rechts.',
        sequelPlaceholder: 'Füge die nächsten Kapitel ein, um sie ab Folge {next} als Fortsetzung zu adaptieren.', adapt: 'Adaptieren', adaptSequel: 'Fortsetzung adaptieren',
        stopAdapt: 'Adaption stoppen', overwriteTitle: 'Es gibt schon adaptierte Folgen', overwriteBody: 'Dieses Projekt hat schon Folge(n) {range}. Alle Folgen neu schreiben oder diesen Text ab Folge {next} als Fortsetzung adaptieren?',
        overwrite: 'Alles neu schreiben', appendAsSequel: 'Als neue Folgen fortsetzen', mismatchTitle: 'Die Länge der Geschichte passt kaum zu den Einstellungen',
        mismatchExpand: 'Der Text hat etwa {units}, erzählt wie geschrieben etwa {source} s; eingestellt sind {episodes} × {seconds} s = {target} s. Die KI müsste ihn etwa {factor}-fach erweitern und vieles hinzufügen, was nicht im Text steht. Trotzdem adaptieren?', mismatchCondense: 'Der Text hat etwa {units}, erzählt wie geschrieben etwa {source} s; eingestellt sind {episodes} × {seconds} s = {target} s. Die KI müsste ihn auf etwa {percent} % kürzen und viel Handlung streichen. Trotzdem adaptieren?', continueAdapt: 'Trotzdem adaptieren',
        adjustSettings: 'Folgen und Länge ändern', stylePanel: 'Look der Serie', lookChanged: 'Die Beschreibung wurde geändert; Porträt neu erstellen',
        noLook: 'Noch keine Beschreibung', episodeChars: '{n} Zeichen'
    },
    'pt-BR': {
        source: 'Original', shotList: 'Lista de planos', title: 'Mesa de produção', scripts: 'Roteiro', cast: 'Elenco', shoot: 'Filmagem', edit: 'Edição', adapting: 'A IA está adaptando…', episode: 'Episódio {n}', episodeTitle: 'Título do episódio', chars: '{n} caracteres',
        regenerate: 'Adaptar de novo', toCast: 'Próximo: tela', canvas: 'Tela', castLead: 'Um retrato por personagem fixa o rosto e o físico em todos os clipes. Mudanças duradouras (quando criança, transformado) ganham um cartão próprio; estados passageiros (sujo, ferido, mascarado, outra roupa) vão na descrição de cada clipe.',
        countdownCast: 'Retratos começam em {n} s', countdownShoot: 'Filmagem começa em {n} s', startNow: 'Começar agora', stop: 'Parar', stopped: 'Parado: escolha primeiro personagens da biblioteca e depois comece.', start: 'Começar',
        redraw: 'Sortear de novo', upload: 'Enviar', library: 'Biblioteca', libraryEmpty: 'A biblioteca está vazia', drawing: 'Desenhando…', waiting: 'Aguardando', failed: 'Falhou', fromLibrary: 'Da biblioteca',
        back: 'Voltar', toShoot: 'Começar filmagem', plan: '{clips} clipes · cerca de {seconds} s · {model}', splitting: 'Dividindo os roteiros em planos…', splitFailed: 'Não foi possível dividir em planos: {error}', retry: 'Tentar de novo', failedClips: "{n} clipes falharam", retryFailed: "Filmar de novo", zoom: "Ver maior", closeZoom: "Fechar", frameFailed: "Quadro inicial não foi criado: ", clipStopped: "Parado — escolha Refazer para continuar", crowdCap: "“{shot}” tem {n} pessoas; um plano desenha no máximo 8, então as outras ficaram de fora. Divida-o em dois planos.", generating: "{n} gerando", splitHint: 'A IA está planejando enquadramento, movimento de câmera e duração de cada clipe; um episódio costuma levar um ou dois minutos. Confira os retratos enquanto isso: a filmagem começa assim que o episódio 1 é dividido, e os seguintes são divididos durante a filmagem.',
        pause: 'Pausar', resume: 'Continuar', paused: 'Pausado; clipes já enviados vão terminar', progress: '{done}/{total} clipes', toEditor: 'Ir para edição', minimize: 'Segundo plano',
        clips: '{n} clipes', noClips: 'Ainda não filmado', clipPrompt: 'O que este clipe mostra', regenerateClip: 'Refilmar este clipe', applyScript: 'Refilmar o episódio com as mudanças',
        outdated: 'Visual antigo', queued: 'Na fila', picture: 'Primeiro quadro', video: 'Filmando', done: 'Pronto', previous: 'Episódio anterior', next: 'Próximo episódio',
        noImageModel: 'Nenhum modelo de imagem disponível para os retratos.', seconds: '{n} s', deckHint: 'Abra para ver cada clipe', collapse: 'Recolher', noCharacters: 'Nenhum personagem precisa de aparência fixa.', notWritten: 'A IA respondeu, mas não gravou o resultado no projeto. Tente de novo.', tabClip: 'Este clipe', tabEpisode: 'Roteiro do episódio', filming: 'Filmando…', finished: 'Filmagem concluída: {n} clipes na linha do tempo',
        reviewLead: 'Confira primeiro a adaptação: a aparência de cada personagem e o roteiro de cada episódio. Edite direto ou peça para a IA reescrever. Depois crie os retratos — nada é filmado nesta etapa.', looksTitle: 'Aparência dos personagens', episodesTitle: 'Roteiros dos episódios',
        rewriteLook: 'Reescrever com IA', drawOne: 'Criar retrato', drawAll: 'Criar todos os retratos',
        stopAll: 'Parar', rewriting: 'A IA está reescrevendo…', rewriteEpisode: 'Adaptar este episódio de novo',
        shootConfirmTitle: 'Começar a filmar?', shootConfirm: 'Antes de filmar, confirme que leu o roteiro de cada episódio e conferiu os personagens. A filmagem cria e cobra os vídeos episódio por episódio; episódios editados são divididos em cenas de novo antes.', shootConfirmOk: 'Conferido, começar a filmar',
        cancel: 'Cancelar', sameCharacter: 'Mesmo personagem · aparência {n}/{total}', lookPlaceholder: 'Idade, rosto, porte, cabelo, figurino e acessórios…',
        pictureTitle: 'Imagem e modelos', canvasLocked: 'As filmagens já começaram, então a proporção e a taxa de quadros não podem mais mudar.',
        scriptTab: 'Roteiro', sequelTab: 'Continuação', scriptPlaceholder: 'Cole o romance ou o roteiro completo. A adaptação condensa ou amplia conforme o número de episódios e a duração à direita.',
        sequelPlaceholder: 'Cole os próximos capítulos para adaptá-los como continuação a partir do episódio {next}.', adapt: 'Adaptar', adaptSequel: 'Adaptar continuação',
        stopAdapt: 'Parar adaptação', overwriteTitle: 'Já existem episódios adaptados', overwriteBody: 'Este projeto já tem o(s) episódio(s) {range}. Reescrever todos os episódios, ou adaptar este texto como continuação a partir do episódio {next}?',
        overwrite: 'Reescrever tudo', appendAsSequel: 'Continuar como novos episódios', mismatchTitle: 'O tamanho da história está muito longe das configurações',
        mismatchExpand: 'O original tem cerca de {units}, cerca de {source} s contado como está; você definiu {episodes} × {seconds} s = {target} s. A IA teria de ampliar cerca de {factor} vezes, acrescentando muito que o texto não diz. Adaptar mesmo assim?', mismatchCondense: 'O original tem cerca de {units}, cerca de {source} s contado como está; você definiu {episodes} × {seconds} s = {target} s. A IA teria de condensar para cerca de {percent}%, cortando boa parte da trama. Adaptar mesmo assim?', continueAdapt: 'Adaptar mesmo assim',
        adjustSettings: 'Mudar episódios e duração', stylePanel: 'Visual da série', lookChanged: 'A descrição mudou; crie o retrato de novo',
        noLook: 'Ainda sem descrição de aparência', episodeChars: '{n} caracteres'
    },
    ru: {
        source: 'Исходник', shotList: 'Список кадров', title: 'Производственный стол', scripts: 'Сценарий', cast: 'Кастинг', shoot: 'Съёмка', edit: 'Монтаж', adapting: 'ИИ адаптирует…', episode: 'Серия {n}', episodeTitle: 'Название серии', chars: '{n} знаков',
        regenerate: 'Адаптировать заново', toCast: 'Далее: холст', canvas: 'Холст', castLead: 'Один портрет на персонажа задаёт его лицо и телосложение во всех клипах. Долгие перемены (в детстве, после превращения) получают отдельную карточку; временные состояния (грязь, рана, маска, другая одежда) описываются в каждом клипе.',
        countdownCast: 'Портреты через {n} с', countdownShoot: 'Съёмка через {n} с', startNow: 'Начать сейчас', stop: 'Стоп', stopped: 'Остановлено: сначала назначьте ролям персонажей из библиотеки, затем начните.', start: 'Начать',
        redraw: 'Перетянуть', upload: 'Загрузить', library: 'Библиотека', libraryEmpty: 'Библиотека пуста', drawing: 'Рисуется…', waiting: 'Ожидание', failed: 'Ошибка', fromLibrary: 'Из библиотеки',
        back: 'Назад', toShoot: 'Начать съёмку', plan: '{clips} клипов · около {seconds} с · {model}', splitting: 'Сценарии делятся на кадры…', splitFailed: 'Не удалось разделить на кадры: {error}', retry: 'Повторить', failedClips: "Не удалось снять клипов: {n}", retryFailed: "Снять заново", zoom: "Увеличить", closeZoom: "Закрыть", frameFailed: "Не удалось создать первый кадр: ", clipStopped: "Остановлено — нажмите «Переснять», чтобы продолжить", crowdCap: "В «{shot}» {n} персонажей; в кадр помещается не больше 8, остальные не попали. Разделите кадр на два.", generating: "Создаётся: {n}", splitHint: 'ИИ подбирает план, движение камеры и длину каждого клипа; на серию обычно уходит одна-две минуты. Пока можно проверить портреты: съёмка начнётся, как только разделена первая серия, остальные делятся во время съёмки.',
        pause: 'Пауза', resume: 'Продолжить', paused: 'Пауза; уже отправленные клипы будут завершены', progress: '{done}/{total} клипов', toEditor: 'К монтажу', minimize: 'В фоне',
        clips: '{n} клипов', noClips: 'Ещё не снято', clipPrompt: 'Что показывает клип', regenerateClip: 'Переснять клип', applyScript: 'Переснять серию с правками',
        outdated: 'Старый облик', queued: 'В очереди', picture: 'Первый кадр', video: 'Съёмка', done: 'Готово', previous: 'Предыдущая серия', next: 'Следующая серия',
        noImageModel: 'Нет модели изображений для портретов.', seconds: '{n} с', deckHint: 'Откройте, чтобы увидеть клипы', collapse: 'Свернуть', noCharacters: 'Нет персонажей, которым нужна фиксированная внешность.', notWritten: 'ИИ ответил, но не записал результат в проект. Попробуйте ещё раз.', tabClip: 'Этот клип', tabEpisode: 'Сценарий серии', filming: 'Съёмка…', finished: 'Съёмка завершена: {n} клипов на таймлайне',
        reviewLead: 'Сначала проверьте адаптацию: внешность каждого персонажа и сценарий каждой серии. Правьте их сами или попросите ИИ переписать. Потом создайте портреты — на этом шаге видео не снимается.', looksTitle: 'Внешность персонажей', episodesTitle: 'Сценарии серий',
        rewriteLook: 'Переписать с ИИ', drawOne: 'Создать портрет', drawAll: 'Создать все портреты',
        stopAll: 'Остановить', rewriting: 'ИИ переписывает…', rewriteEpisode: 'Адаптировать серию заново',
        shootConfirmTitle: 'Начать съёмку?', shootConfirm: 'Перед съёмкой убедитесь, что прочитали сценарий каждой серии и проверили персонажей. Съёмка создаёт видео по сериям и оплачивается; изменённые серии сначала заново делятся на кадры.', shootConfirmOk: 'Проверено, начать съёмку',
        cancel: 'Отмена', sameCharacter: 'Тот же персонаж · облик {n}/{total}', lookPlaceholder: 'Возраст, лицо, телосложение, причёска, костюм и аксессуары…',
        pictureTitle: 'Кадр и модели', canvasLocked: 'Съёмка уже началась, поэтому соотношение сторон и частоту кадров изменить нельзя.',
        scriptTab: 'Сценарий', sequelTab: 'Продолжение', scriptPlaceholder: 'Вставьте весь роман или сценарий. Адаптация сократит или расширит его под число серий и длительность справа.',
        sequelPlaceholder: 'Вставьте следующие главы, чтобы адаптировать их как продолжение с серии {next}.', adapt: 'Адаптировать', adaptSequel: 'Адаптировать продолжение',
        stopAdapt: 'Остановить адаптацию', overwriteTitle: 'Уже есть адаптированные серии', overwriteBody: 'В проекте уже есть серии {range}. Переписать все серии заново или адаптировать этот текст как продолжение с серии {next}?',
        overwrite: 'Переписать всё', appendAsSequel: 'Добавить как новые серии', mismatchTitle: 'Длина истории сильно расходится с настройками',
        mismatchExpand: 'В оригинале около {units}, это примерно {source} с, если снимать как написано; вы задали {episodes} × {seconds} с = {target} с. ИИ придётся расширить текст примерно в {factor} раза и добавить много того, чего в нём нет. Всё равно адаптировать?', mismatchCondense: 'В оригинале около {units}, это примерно {source} с, если снимать как написано; вы задали {episodes} × {seconds} с = {target} с. ИИ придётся сократить текст примерно до {percent}% и выбросить многое из сюжета. Всё равно адаптировать?', continueAdapt: 'Всё равно адаптировать',
        adjustSettings: 'Изменить серии и длительность', stylePanel: 'Стиль сериала', lookChanged: 'Описание изменилось — создайте портрет заново',
        noLook: 'Описания внешности пока нет', episodeChars: '{n} знаков'
    },
    ar: {
        source: 'النص الأصلي', shotList: 'قائمة اللقطات', title: 'منضدة الإنتاج', scripts: 'النص', cast: 'اختيار الممثلين', shoot: 'التصوير', edit: 'المونتاج', adapting: 'الذكاء الاصطناعي يقتبس…', episode: 'الحلقة {n}', episodeTitle: 'عنوان الحلقة', chars: '{n} حرفًا',
        regenerate: 'اقتباس من جديد', toCast: 'التالي: اللوحة', canvas: 'اللوحة', castLead: 'صورة واحدة لكل شخصية تثبّت وجهها وقوامها في كل المقاطع. التغيّرات الدائمة (في الطفولة، بعد التحوّل) تأخذ بطاقة خاصة؛ والحالات العابرة (متّسخ، مصاب، مقنّع، ملابس أخرى) تُكتب في وصف كل مقطع.',
        countdownCast: 'تبدأ صور الشخصيات بعد {n} ث', countdownShoot: 'يبدأ التصوير بعد {n} ث', startNow: 'ابدأ الآن', stop: 'إيقاف', stopped: 'متوقف: عيّن أولًا شخصيات من مكتبتك للأدوار ثم ابدأ.', start: 'ابدأ',
        redraw: 'سحب جديد', upload: 'رفع', library: 'المكتبة', libraryEmpty: 'المكتبة فارغة', drawing: 'جارٍ الرسم…', waiting: 'بالانتظار', failed: 'فشل', fromLibrary: 'من المكتبة',
        back: 'رجوع', toShoot: 'ابدأ التصوير', plan: '{clips} مقاطع · نحو {seconds} ث · {model}', splitting: 'تقسيم النصوص إلى لقطات…', splitFailed: 'تعذر التقسيم: {error}', retry: 'إعادة', failedClips: "فشل تصوير {n} مقاطع", retryFailed: "إعادة تصويرها", zoom: "عرض أكبر", closeZoom: "إغلاق", frameFailed: "تعذّر إنشاء الإطار الافتتاحي: ", clipStopped: "توقّف — اختر إعادة التصوير للمتابعة", crowdCap: "في «{shot}» {n} أشخاص؛ لا تُرسم في اللقطة أكثر من 8، فلم يدخل الباقون. قسّمها إلى لقطتين.", generating: "{n} قيد الإنشاء", splitHint: 'يخطط الذكاء الاصطناعي لزاوية اللقطة وحركة الكاميرا ومدة كل مقطع؛ تستغرق الحلقة عادة دقيقة أو دقيقتين. راجع الصور في الأثناء: يبدأ التصوير بمجرد تقسيم الحلقة الأولى، وتُقسَّم الحلقات التالية أثناء التصوير.',
        pause: 'إيقاف مؤقت', resume: 'متابعة', paused: 'متوقف مؤقتًا؛ ستكتمل المقاطع المرسلة', progress: '{done}/{total} مقاطع', toEditor: 'إلى المونتاج', minimize: 'في الخلفية',
        clips: '{n} مقاطع', noClips: 'لم يُصوَّر بعد', clipPrompt: 'ما يعرضه هذا المقطع', regenerateClip: 'إعادة تصوير المقطع', applyScript: 'إعادة تصوير الحلقة بالتعديلات',
        outdated: 'مظهر قديم', queued: 'في الانتظار', picture: 'الإطار الأول', video: 'جارٍ التصوير', done: 'تم', previous: 'الحلقة السابقة', next: 'الحلقة التالية',
        noImageModel: 'لا يوجد نموذج صور متاح لصور الشخصيات.', seconds: '{n} ث', deckHint: 'افتح لرؤية كل مقطع', collapse: 'طي', noCharacters: 'لا توجد شخصيات تحتاج مظهرًا ثابتًا.', notWritten: 'ردّ الذكاء الاصطناعي لكنه لم يكتب النتيجة في المشروع. حاول مرة أخرى.', tabClip: 'هذا المقطع', tabEpisode: 'نص الحلقة', filming: 'جارٍ التصوير…', finished: 'اكتمل التصوير: {n} مقاطع على الخط الزمني',
        reviewLead: 'راجع التحويل أولًا: مظهر كل شخصية وسيناريو كل حلقة. عدّلها مباشرة أو دع الذكاء الاصطناعي يعيد كتابتها، ثم أنشئ الصور الشخصية. لا يُصوَّر أي فيديو في هذه الخطوة.', looksTitle: 'مظهر الشخصيات', episodesTitle: 'سيناريوهات الحلقات',
        rewriteLook: 'إعادة كتابة بالذكاء الاصطناعي', drawOne: 'إنشاء الصورة', drawAll: 'إنشاء كل الصور',
        stopAll: 'إيقاف', rewriting: 'يعيد الذكاء الاصطناعي الكتابة…', rewriteEpisode: 'إعادة تحويل هذه الحلقة',
        shootConfirmTitle: 'بدء التصوير؟', shootConfirm: 'قبل التصوير تأكد أنك قرأت سيناريو كل حلقة وراجعت الشخصيات. التصوير يُنشئ الفيديوهات حلقة بحلقة ويُحتسب عليها؛ الحلقات المعدّلة تُقسَّم إلى لقطات من جديد أولًا.', shootConfirmOk: 'راجعت، ابدأ التصوير',
        cancel: 'إلغاء', sameCharacter: 'الشخصية نفسها · المظهر {n}/{total}', lookPlaceholder: 'العمر والوجه والبنية وتسريحة الشعر والملابس والإكسسوارات…',
        pictureTitle: 'الصورة والنماذج', canvasLocked: 'بدأ التصوير، لذا لا يمكن تغيير نسبة العرض ومعدل الإطارات بعد الآن.',
        scriptTab: 'السيناريو', sequelTab: 'التتمة', scriptPlaceholder: 'الصق الرواية أو السيناريو كاملًا. يختصره التحويل أو يوسّعه بحسب عدد الحلقات ومدتها على اليمين.',
        sequelPlaceholder: 'الصق الفصول التالية لتحويلها إلى تتمة تبدأ من الحلقة {next}.', adapt: 'بدء التحويل', adaptSequel: 'تحويل التتمة',
        stopAdapt: 'إيقاف التحويل', overwriteTitle: 'توجد حلقات محوّلة بالفعل', overwriteBody: 'في هذا المشروع الحلقات {range}. هل تعيد كتابة كل الحلقات، أم تحوّل هذا النص إلى تتمة تبدأ من الحلقة {next}؟',
        overwrite: 'إعادة كتابة الكل', appendAsSequel: 'المتابعة كحلقات جديدة', mismatchTitle: 'طول القصة بعيد جدًا عن الإعدادات',
        mismatchExpand: 'النص الأصلي نحو {units}، أي نحو {source} ث إذا صُوّر كما هو؛ واخترت {episodes} × {seconds} ث = {target} ث. سيحتاج الذكاء الاصطناعي إلى توسيعه نحو {factor} مرات وإضافة الكثير مما لا يقوله النص. هل تتابع التحويل؟', mismatchCondense: 'النص الأصلي نحو {units}، أي نحو {source} ث إذا صُوّر كما هو؛ واخترت {episodes} × {seconds} ث = {target} ث. سيحتاج الذكاء الاصطناعي إلى اختصاره إلى نحو {percent}% وحذف جزء كبير من الأحداث. هل تتابع التحويل؟', continueAdapt: 'متابعة التحويل',
        adjustSettings: 'تغيير عدد الحلقات والمدة', stylePanel: 'مظهر المسلسل', lookChanged: 'تغيّر الوصف؛ أنشئ الصورة من جديد',
        noLook: 'لا يوجد وصف للمظهر بعد', episodeChars: '{n} حرف'
    },
    hi: {
        source: 'मूल पाठ', shotList: 'शॉट सूची', title: 'प्रोडक्शन डेस्क', scripts: 'पटकथा', cast: 'कास्टिंग', shoot: 'शूटिंग', edit: 'एडिटिंग', adapting: 'AI रूपांतरण कर रहा है…', episode: 'एपिसोड {n}', episodeTitle: 'एपिसोड का नाम', chars: '{n} अक्षर',
        regenerate: 'फिर से रूपांतरण', toCast: 'आगे: कैनवास', canvas: 'कैनवास', castLead: 'हर किरदार की एक तस्वीर हर क्लिप में उसका चेहरा और कद-काठी तय करती है। लंबे बदलाव (बचपन, रूपांतरण) का अलग कार्ड बनता है; अस्थायी हालत (धूल, चोट, नक़ाब, दूसरे कपड़े) हर क्लिप के विवरण में लिखी जाती है।',
        countdownCast: '{n} से. में किरदार तस्वीरें शुरू', countdownShoot: '{n} से. में शूटिंग शुरू', startNow: 'अभी शुरू करें', stop: 'रोकें', stopped: 'रुका है: पहले भूमिकाओं को लाइब्रेरी के किरदार दें, फिर शुरू करें।', start: 'शुरू करें',
        redraw: 'फिर से बनाएँ', upload: 'अपलोड', library: 'लाइब्रेरी', libraryEmpty: 'लाइब्रेरी ख़ाली है', drawing: 'बन रहा है…', waiting: 'इंतज़ार', failed: 'विफल', fromLibrary: 'लाइब्रेरी से',
        back: 'पीछे', toShoot: 'शूटिंग शुरू करें', plan: '{clips} क्लिप · लगभग {seconds} से. · {model}', splitting: 'पटकथा शॉट्स में बँट रही है…', splitFailed: 'शॉट्स में नहीं बँट सका: {error}', retry: 'फिर कोशिश करें', failedClips: "{n} क्लिप नहीं बन सकीं", retryFailed: "सब फिर से शूट करें", zoom: "बड़ा देखें", closeZoom: "बंद करें", frameFailed: "शुरुआती फ़्रेम नहीं बना: ", clipStopped: "रुका हुआ — जारी रखने के लिए फिर से शूट करें चुनें", crowdCap: "“{shot}” में {n} लोग हैं; एक शॉट में अधिकतम 8 बनते हैं, बाकी छूट गए। इसे दो शॉट में बाँटें।", generating: "{n} बन रहे हैं", splitHint: 'AI हर क्लिप का फ़्रेम, कैमरा मूवमेंट और लंबाई तय कर रहा है; एक एपिसोड में आमतौर पर एक-दो मिनट लगते हैं। तब तक तस्वीरें देख लें: पहला एपिसोड बँटते ही शूटिंग शुरू हो जाएगी, बाकी एपिसोड शूटिंग के साथ-साथ बँटेंगे।',
        pause: 'रोकें', resume: 'जारी रखें', paused: 'रुका है; भेजी गई क्लिप पूरी होंगी', progress: '{done}/{total} क्लिप', toEditor: 'एडिटिंग पर जाएँ', minimize: 'पीछे चलाएँ',
        clips: '{n} क्लिप', noClips: 'अभी शूट नहीं हुआ', clipPrompt: 'यह क्लिप क्या दिखाती है', regenerateClip: 'यह क्लिप फिर शूट करें', applyScript: 'बदलाव के साथ एपिसोड फिर शूट करें',
        outdated: 'पुराना रूप', queued: 'कतार में', picture: 'पहला फ़्रेम', video: 'शूट हो रहा है', done: 'तैयार', previous: 'पिछला एपिसोड', next: 'अगला एपिसोड',
        noImageModel: 'किरदार तस्वीरों के लिए कोई इमेज मॉडल नहीं है।', seconds: '{n} से.', deckHint: 'हर क्लिप देखने के लिए खोलें', collapse: 'समेटें', noCharacters: 'किसी किरदार को तय रूप की ज़रूरत नहीं है।', notWritten: 'AI ने जवाब दिया, पर नतीजा प्रोजेक्ट में नहीं लिखा। फिर कोशिश करें।', tabClip: 'यह क्लिप', tabEpisode: 'एपिसोड की पटकथा', filming: 'शूट हो रहा है…', finished: 'शूटिंग पूरी: {n} क्लिप टाइमलाइन पर हैं',
        reviewLead: 'पहले रूपांतरण जाँचें: हर पात्र का रूप और हर एपिसोड की स्क्रिप्ट। सीधे बदलें या AI से दोबारा लिखवाएँ। फिर पोर्ट्रेट बनाएँ — इस चरण में कोई वीडियो नहीं बनता।', looksTitle: 'पात्रों का रूप', episodesTitle: 'एपिसोड स्क्रिप्ट',
        rewriteLook: 'AI से दोबारा लिखें', drawOne: 'पोर्ट्रेट बनाएँ', drawAll: 'सभी पोर्ट्रेट बनाएँ',
        stopAll: 'रोकें', rewriting: 'AI दोबारा लिख रहा है…', rewriteEpisode: 'यह एपिसोड फिर से रूपांतरित करें',
        shootConfirmTitle: 'शूटिंग शुरू करें?', shootConfirm: 'शूटिंग से पहले पक्का करें कि आपने हर एपिसोड की स्क्रिप्ट पढ़ी है और पात्र जाँचे हैं। शूटिंग एपिसोड दर एपिसोड वीडियो बनाती है और शुल्क लगता है; बदले गए एपिसोड पहले फिर से शॉट्स में बाँटे जाते हैं।', shootConfirmOk: 'जाँच लिया, शूटिंग शुरू करें',
        cancel: 'रद्द करें', sameCharacter: 'वही पात्र · रूप {n}/{total}', lookPlaceholder: 'उम्र, चेहरा, कद-काठी, बाल, पोशाक और एक्सेसरी…',
        pictureTitle: 'चित्र और मॉडल', canvasLocked: 'शूटिंग शुरू हो चुकी है, इसलिए आस्पेक्ट रेशियो और फ़्रेम रेट अब नहीं बदले जा सकते।',
        scriptTab: 'स्क्रिप्ट', sequelTab: 'सीक्वल', scriptPlaceholder: 'पूरा उपन्यास या स्क्रिप्ट चिपकाएँ। रूपांतरण दाईं ओर दिए एपिसोड और अवधि के हिसाब से इसे छोटा या बड़ा करता है।',
        sequelPlaceholder: 'अगले अध्याय चिपकाएँ, ताकि वे एपिसोड {next} से आगे की कहानी बनें।', adapt: 'रूपांतरण शुरू करें', adaptSequel: 'सीक्वल रूपांतरित करें',
        stopAdapt: 'रूपांतरण रोकें', overwriteTitle: 'एपिसोड पहले से रूपांतरित हैं', overwriteBody: 'इस प्रोजेक्ट में पहले से एपिसोड {range} हैं। सभी एपिसोड फिर से लिखें, या यह पाठ एपिसोड {next} से आगे की कहानी के रूप में रूपांतरित करें?',
        overwrite: 'सब दोबारा लिखें', appendAsSequel: 'नए एपिसोड के रूप में जोड़ें', mismatchTitle: 'कहानी की लंबाई सेटिंग से बहुत अलग है',
        mismatchExpand: 'मूल पाठ लगभग {units} है, जैसा है वैसा फ़िल्माने पर लगभग {source} सेकंड; आपने {episodes} × {seconds} सेकंड = {target} सेकंड चुना है। AI को इसे लगभग {factor} गुना बढ़ाना होगा और बहुत कुछ जोड़ना होगा जो पाठ में नहीं है। फिर भी रूपांतरित करें?', mismatchCondense: 'मूल पाठ लगभग {units} है, जैसा है वैसा फ़िल्माने पर लगभग {source} सेकंड; आपने {episodes} × {seconds} सेकंड = {target} सेकंड चुना है। AI को इसे लगभग {percent}% तक छोटा करना होगा और कहानी का बड़ा हिस्सा हटाना होगा। फिर भी रूपांतरित करें?', continueAdapt: 'फिर भी रूपांतरित करें',
        adjustSettings: 'एपिसोड और अवधि बदलें', stylePanel: 'सीरीज़ का लुक', lookChanged: 'विवरण बदल गया; पोर्ट्रेट फिर से बनाएँ',
        noLook: 'अभी रूप का विवरण नहीं', episodeChars: '{n} अक्षर'
    }
};

export const COMIC_DESK_LOCALES = Object.keys(TEXT);

function uncheckedDeskText(locale: string, key: Key, values: Record<string, string | number> = {}): string {
    const table = TEXT[locale] || TEXT[locale.split('-')[0]] || TEXT.en;
    return (table[key] || TEXT.en[key]).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}

/** Position of carousel item `index` around the focused one: slide, shrink and tilt the neighbours. */
function carouselStyle(index: number, focus: number): React.CSSProperties {
    const offset = index - focus;
    const distance = Math.abs(offset);
    return {
        transform: `translateX(calc(-50% + ${offset * 58}%)) scale(${Math.max(0.62, 1 - distance * 0.16)}) rotateY(${Math.max(-24, Math.min(24, -offset * 12))}deg)`,
        opacity: distance > 2 ? 0 : 1 - distance * 0.28,
        zIndex: 10 - distance,
        pointerEvents: distance > 2 ? 'none' : 'auto'
    };
}

export interface ComicDeskProps {
    readonly locale: string;
    readonly projectTitle: string;
    readonly step: DeskStep;
    readonly reachable: ReadonlySet<DeskStep>;
    readonly adapting: boolean;
    /** What the adaptation is doing now (the agent's latest step). */
    readonly adaptProgress?: string;
    /** Optional reasoning/thinking trace from the active adaptation, storyboard split, or rewrite run. */
    readonly thinking?: string;
    readonly thinkingStreaming?: boolean;
    readonly thinkingDurationMs?: number;
    readonly episodes: readonly DeskEpisode[];
    readonly focusEpisode: number;
    /** The clip card in the middle while filming (index within the focused episode). */
    readonly focusClip: number;
    readonly cards: readonly DeskCard[];
    readonly focusCard: number;
    readonly library: readonly DesktopComicCharacterLibraryEntry[];
    readonly countdown?: { readonly seconds: number; readonly target: 'cast' | 'shoot' };
    readonly stopped: boolean;
    readonly shooting: boolean;
    readonly paused: boolean;
    readonly splitting: boolean;
    readonly splitError?: string;
    /** Which episode is being split (1-based, of all) and for how long, for the waiting note. */
    readonly splitProgress?: { readonly episode: number; readonly episodes: number; readonly seconds: number };
    readonly plan?: { readonly clips: number; readonly seconds: number; readonly model: string };
    readonly noImageModel?: boolean;
    readonly canShoot: boolean;
    readonly error?: string;
    /** A way out of the error, such as adding funds when the balance stopped filming. */
    readonly errorAction?: { readonly label: string; readonly onClick: () => void };
    readonly onStep: (step: DeskStep) => void;
    readonly onFocusEpisode: (index: number) => void;
    readonly onFocusClip: (index: number) => void;
    readonly onFocusCard: (index: number) => void;
    readonly onScriptChange: (number: number, script: string) => void;
    readonly onRegenerateScripts: () => void;
    readonly onScriptsNext: () => void;
    readonly onStartNow: () => void;
    readonly onStop: () => void;
    readonly onBind: (characterId: string, bundleId: string) => void;
    readonly onUpload: (characterId: string) => void;
    readonly onRedraw: (characterId: string) => void;
    readonly onRetrySplit: () => void;
    readonly onShoot: () => void;
    readonly onPause: () => void;
    readonly onResume: () => void;
    readonly onRegenerateClip: (shotId: string, prompt: string) => void;
    readonly onReshootEpisode: (number: number) => void;
    /** Film again every clip whose last try failed. */
    readonly onRetryFailed: () => void;
    /** 剧本: the story (剧本 / 续集) with the AI 改编 settings, and its footer — both rendered by the widget. */
    readonly scriptsView?: React.ReactNode;
    readonly scriptsFooter?: React.ReactNode;
    /** A question over the desk. */
    readonly confirm?: DeskConfirm;
    /** 选角 review: portraits being drawn (生成全部形象 or one card); the episode whose script the AI is rewriting. */
    readonly portraitsRunning?: boolean;
    readonly rewritingEpisode?: number;
    readonly onLookCommit?: (characterId: string, look: string) => void;
    readonly onRewriteLook?: (characterId: string) => void;
    readonly onStopRewrite?: () => void;
    readonly onDrawAll?: () => void;
    readonly onStopDraw?: () => void;
    readonly onScriptCommit?: (number: number) => void;
    readonly onRewriteEpisode?: (number: number) => void;
    /** 画布: the canvas (the widget renders it), the footer's note and 进入剪辑. */
    readonly canvasView?: React.ReactNode;
    readonly canvasNote?: React.ReactNode;
    readonly toEditorLabel?: string;
    readonly toEditorDisabled?: boolean;
    readonly onToEditor?: () => void;
    /** 剪辑: the cut editor and its command bar, the footer's summary and the export button. */
    readonly editor?: React.ReactNode;
    readonly editSummary?: string;
    readonly exportLabel?: string;
    readonly exportDisabled?: boolean;
    readonly onExport?: () => void;
    readonly onMinimize: () => void;
}

/** The whole desk; the widget renders it inside the comic studio. */
export function ComicDesk(props: ComicDeskProps): React.ReactElement {
    const t = (key: Key, values?: Record<string, string | number>) => deskText(props.locale, key, values);
    const steps: readonly DeskStep[] = ['canvas', 'edit'];
    const at = steps.indexOf(props.step);
    const clips = props.episodes.flatMap(episode => episode.clips);
    const done = clips.filter(clip => clip.state === 'done' && !clip.outdated).length;
    const [zoomed, setZoomed] = React.useState<Zoomed>();
    const failed = clips.filter(clip => clip.state === 'failed').length;
    const canvasOnly = props.step === 'canvas';
    const editing = props.step === 'edit';
    // The canvas is a workspace; its editors use native modal dialogs portalled to document.body.
    // Marking this ancestor as an ARIA modal hides those separate modal layers from accessibility.
    return <div className={`nmx-desk-backdrop${canvasOnly ? ' is-canvas' : editing ? ' is-edit' : ''}`} role={canvasOnly || editing ? 'region' : 'dialog'} aria-modal={canvasOnly || editing ? undefined : true} aria-label={canvasOnly ? t('canvas') : editing ? t('edit') : t('title')}>
        <section className={`nmx-desk is-${props.step}`}>
            {!editing && <header className='nmx-desk-header'>
                <div className='nmx-desk-title'>{!canvasOnly && <span>{t('title')}</span>}<strong data-nmx-literal>{props.projectTitle}</strong></div>
                {!canvasOnly && <ol className='nmx-desk-steps'>{steps.map((step, index) => {
                    const reachable = props.reachable.has(step);
                    return <li key={step} className={index < at ? 'is-done' : index === at ? 'is-current' : ''}>
                        <button disabled={!reachable || index === at} onClick={() => props.onStep(step)}>
                            <span>{index < at ? '✓' : index + 1}</span>{t(step)}</button></li>;
                })}</ol>}
                <div className='nmx-desk-actions'>
                    {(props.step === 'shoot' || props.step === 'canvas') && props.shooting && <span className='nmx-desk-progress' data-nmx-literal>{t('progress', { done, total: clips.length })}</span>}
                    {(props.step === 'shoot' || props.step === 'canvas') && props.shooting && (props.paused
                        ? <button className='nmx-primary-button' onClick={props.onResume}><i className='codicon codicon-debug-start'></i>{t('resume')}</button>
                        : <button onClick={props.onPause}><i className='codicon codicon-debug-pause'></i>{t('pause')}</button>)}
                    {canvasOnly && <button type='button' className='nmx-desk-enter-editor' disabled={props.toEditorDisabled} onClick={props.onToEditor}>
                        <i className='codicon codicon-edit' aria-hidden='true' />{props.toEditorLabel || t('toEditor')}</button>}
                    <button className='nmx-desk-close' onClick={props.onMinimize} title={t('minimize')} aria-label={t('minimize')}>×</button>
                </div>
            </header>}
            {props.countdown && !props.stopped && <div className='nmx-desk-countdown' role='status'>
                <span className='nmx-desk-ring' style={{ ['--nmx-left' as string]: String(props.countdown.seconds / 10) }} data-nmx-literal>{props.countdown.seconds}</span>
                <strong>{t(props.countdown.target === 'cast' ? 'countdownCast' : 'countdownShoot', { n: props.countdown.seconds })}</strong>
                <button className='nmx-primary-button' onClick={props.onStartNow}>{t('startNow')}</button>
                <button onClick={props.onStop}>{t('stop')}</button>
            </div>}
            {props.stopped && props.step === 'cast' && <div className='nmx-desk-countdown is-stopped' role='status'><strong>{t('stopped')}</strong>
                <button className='nmx-primary-button' onClick={props.onStartNow}>{t('start')}</button></div>}
            {props.paused && props.step === 'shoot' && <div className='nmx-desk-countdown is-stopped' role='status'><strong>{t('paused')}</strong></div>}
            {canvasOnly && (props.splitting || props.splitError) && <div className='nmx-desk-canvas-status' role={props.splitError ? 'alert' : 'status'}>
                {props.splitting ? <><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true' />{t('splitting')}</>
                    : <>{t('splitFailed', { error: props.splitError! })}<button type='button' className='nmx-link-button' onClick={props.onRetrySplit}>{t('retry')}</button></>}
            </div>}
            {Boolean(props.thinking?.trim()) && <DeskThinkingDisclosure
                locale={props.locale}
                thinking={props.thinking!}
                streaming={Boolean(props.thinkingStreaming ?? (props.adapting || props.splitting || props.rewritingEpisode !== undefined || props.cards.some(item => item.rewriting)))}
                durationMs={props.thinkingDurationMs}
                progress={props.adaptProgress}
            />}
            <div className='nmx-desk-stage'>
                {props.step === 'edit' ? <div className='nmx-desk-cut'>{props.editor}</div>
                    : props.step === 'canvas' ? props.canvasView
                    : props.step === 'cast' ? (props.onLookCommit ? <CastReview {...props} t={t} onZoom={setZoomed} /> : <CastCarousel {...props} t={t} onZoom={setZoomed} />)
                        : props.step === 'shoot' ? <ShootStage {...props} t={t} onZoom={setZoomed} />
                            : props.scriptsView ? <div className='nmx-desk-source'>{props.scriptsView}</div> : <EpisodeCarousel {...props} t={t} onZoom={setZoomed} />}
            </div>
            {props.error && <div className={`nmx-agent-inline-error nmx-desk-error${props.errorAction ? ' has-action' : ''}`} role='alert'>
                <span>{props.error}</span>
                {props.errorAction && <button type='button' className='nmx-desk-error-action' onClick={props.errorAction.onClick}>{props.errorAction.label}</button>}
            </div>}
            {!canvasOnly && !editing && <footer className='nmx-desk-footer'>
                {props.step === 'scripts' && props.scriptsFooter}
                {props.step === 'scripts' && !props.scriptsFooter && <>
                    <button disabled={props.adapting} onClick={props.onRegenerateScripts}>{t('regenerate')}</button>
                    <span className='nmx-desk-footer-note'>{props.adapting ? t('adapting') : ''}</span>
                    <button className='nmx-primary-button' disabled={props.adapting || !props.episodes.length || props.episodes.some(item => !item.script.trim())} onClick={props.onScriptsNext}>{t('toCast')}</button>
                </>}
                {props.step === 'cast' && <>
                    <button onClick={() => props.onStep('scripts')}>{t('back')}</button>
                    <span className='nmx-desk-footer-note'>
                        {props.splitting ? <span className='nmx-desk-wait' title={t('splitHint')}>
                            <span><i className='codicon codicon-loading codicon-modifier-spin'></i>{t('splitting')}
                                {props.splitProgress && <span className='nmx-desk-wait-time' data-nmx-literal>
                                    {props.splitProgress.episodes > 1 ? `${props.splitProgress.episode}/${props.splitProgress.episodes} · ` : ''}
                                    {Math.floor(props.splitProgress.seconds / 60)}:{String(props.splitProgress.seconds % 60).padStart(2, '0')}</span>}</span>
                            <small>{t('splitHint')}</small></span>
                            : props.splitError ? <>{t('splitFailed', { error: props.splitError })} <button className='nmx-link-button' onClick={props.onRetrySplit}>{t('retry')}</button></>
                                : props.plan ? t('plan', { clips: props.plan.clips, seconds: props.plan.seconds, model: props.plan.model }) : ''}
                    </span>
                    <button className='nmx-primary-button' disabled={!props.canShoot} onClick={props.onShoot}>{t('toShoot')}</button>
                </>}
                {props.step === 'shoot' && <>
                    <button onClick={() => props.onStep('cast')}>{t('back')}</button>
                    {/* A split that failed after “Start filming” shows here too, with its retry (audit A12-004). */}
                    <span className='nmx-desk-footer-note'>{props.splitError && !props.splitting ? <>{t('splitFailed', { error: props.splitError })} <button className='nmx-link-button' onClick={props.onRetrySplit}>{t('retry')}</button></>
                        : props.splitting && !props.shooting ? <span className='nmx-desk-wait' title={t('splitHint')}><span><i className='codicon codicon-loading codicon-modifier-spin'></i>{t('splitting')}</span></span>
                        : failed > 0 ? <>{t('failedClips', { n: failed })} <button className='nmx-link-button' onClick={props.onRetryFailed}>{t('retryFailed')}</button></>
                        : props.plan ? t('plan', { clips: props.plan.clips, seconds: props.plan.seconds, model: props.plan.model }) : ''}</span>
                    <button className='nmx-primary-button' disabled={!done} onClick={() => props.onStep('edit')}>{t('toEditor')}</button>
                </>}
            </footer>}
        </section>
        {zoomed && <Lightbox item={zoomed} close={t('closeZoom')} onClose={() => setZoomed(undefined)} />}
        {props.confirm && <ConfirmSheet confirm={props.confirm} />}
    </div>;
}

/** Collapsible reasoning/thinking disclosure for the production desk (auto-expands while streaming, auto-collapses when complete, click to toggle). */
function DeskThinkingDisclosure(props: {
    readonly locale: string;
    readonly thinking: string;
    readonly streaming: boolean;
    readonly durationMs?: number;
    readonly progress?: string;
}): React.ReactElement {
    const [userOpen, setUserOpen] = React.useState<boolean | undefined>(undefined);
    const prevStreaming = React.useRef(props.streaming);
    React.useEffect(() => {
        if (prevStreaming.current && !props.streaming) {
            setUserOpen(false);
        } else if (!prevStreaming.current && props.streaming) {
            setUserOpen(undefined);
        }
        prevStreaming.current = props.streaming;
    }, [props.streaming]);
    const isOpen = userOpen ?? props.streaming;
    const locale = props.locale as NextMuxDesktopLocale;
    const durationLabel = typeof props.durationMs === 'number' && Number.isFinite(props.durationMs) && props.durationMs > 0
        ? comicChatText(locale, 'seconds', { n: (props.durationMs / 1_000).toFixed(1) })
        : '';
    const titleLabel = props.streaming
        ? (props.progress || comicChatText(locale, 'thinking'))
        : comicChatText(locale, 'thoughtProcess');
    return <details className={`nmx-comic-chat-thought nmx-desk-thinking ${props.streaming ? 'is-running' : ''}`} open={isOpen}>
        <summary className='nmx-comic-chat-thought-summary' onClick={event => { event.preventDefault(); setUserOpen(current => !(current ?? props.streaming)); }}>
            <i className={`codicon ${props.streaming ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`} aria-hidden='true' />
            <span data-nmx-literal={Boolean(props.streaming && props.progress) || undefined}>{titleLabel}</span>
            {durationLabel && <small data-nmx-literal>· {durationLabel}</small>}
            {/* One chevron turned by CSS when open, as in the chat's thinking block. */}
            <i className='codicon codicon-chevron-right nmx-comic-chat-thought-chevron' aria-hidden='true' />
        </summary>
        <div className='nmx-comic-chat-thought-body is-plain' data-nmx-literal>{props.thinking.trim()}</div>
    </details>;
}

/** A question over the desk; Escape takes the first (safe) action. */
function ConfirmSheet(props: { readonly confirm: DeskConfirm }): React.ReactElement {
    const box = React.useRef<HTMLElement>(null);
    React.useEffect(() => { box.current?.querySelector<HTMLButtonElement>('.nmx-primary-button, button')?.focus(); }, [props.confirm]);
    const { confirm } = props;
    return <div className='nmx-desk-confirm-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) confirm.actions[0]?.onClick(); }}>
        <section ref={box} className='nmx-desk-confirm' role='alertdialog' aria-modal='true' aria-label={confirm.title}
            onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); confirm.actions[0]?.onClick(); } }}>
            <h3>{confirm.title}</h3>
            {confirm.body && <p data-nmx-literal>{confirm.body}</p>}
            {confirm.cost && <ConfirmCost cost={confirm.cost} />}
            <footer>{confirm.actions.map(action => <button key={action.label} type='button'
                className={action.tone === 'primary' ? 'nmx-primary-button' : action.tone === 'danger' ? 'nmx-secondary-button is-danger' : 'nmx-secondary-button'}
                onClick={action.onClick}>{action.label}</button>)}</footer>
        </section>
    </div>;
}

/**
 * The cost summary of a confirmation: one row per step in a column that scrolls when there are many, amounts in one
 * aligned column, then the total and the balance that always stay in view, and a shortfall said in the danger color.
 */
export function ConfirmCost({ cost }: { readonly cost: DeskConfirmCost }): React.ReactElement {
    const row = (key: string | number, label: string, amount: string, detail?: string, tone?: string): React.ReactElement =>
        <div key={key} className={`nmx-desk-confirm-cost-row${tone ? ` ${tone}` : ''}`}>
            <dt><span data-nmx-literal>{label}</span>{detail && <span className='nmx-desk-confirm-cost-detail' data-nmx-literal>{detail}</span>}</dt>
            <dd><bdi>{amount}</bdi></dd>
        </div>;
    return <div className={`nmx-desk-confirm-cost${cost.short ? ' is-short' : ''}`}>
        <dl className='nmx-desk-confirm-cost-rows'>{cost.rows.map((item, index) => row(index, item.label, item.amount, item.detail))}</dl>
        {(cost.total || cost.balance) && <dl className='nmx-desk-confirm-cost-sum'>
            {cost.total && row('total', cost.total.label, cost.total.amount, undefined, 'is-total')}
            {cost.balance && row('balance', cost.balance.label, cost.balance.amount, undefined, 'is-balance')}
        </dl>}
        {cost.short && <p className='nmx-desk-confirm-cost-short' role='status'><i className='codicon codicon-warning' aria-hidden='true'></i><span>{cost.short}</span></p>}
        {cost.note && <p className='nmx-desk-confirm-cost-note'>{cost.note}</p>}
    </div>;
}

/**
 * 选角 (review): the character cards, then one look prompt per character (edited in place, rewritten by the AI one
 * at a time, drawn one by one or all together, each stoppable), then one script per episode (edited, or adapted
 * again on its own). Nothing here films: 开始拍摄 asks first.
 */
function CastReview(props: Inner): React.ReactElement {
    const { t } = props;
    const [drafts, setDrafts] = React.useState<Record<string, string>>({});
    const looks = React.useRef<HTMLDivElement>(null);
    const focus = Math.min(props.focusCard, Math.max(0, props.cards.length - 1));
    React.useEffect(() => {
        looks.current?.querySelectorAll<HTMLElement>('.nmx-desk-look')[focus]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }, [focus]);
    const commit = (card: DeskCard): void => {
        const draft = drafts[card.id];
        if (draft === undefined) return;
        setDrafts(current => { const next = { ...current }; delete next[card.id]; return next; });
        if (draft.trim() !== card.look.trim()) props.onLookCommit?.(card.id, draft.trim());
    };
    const busyEpisode = props.rewritingEpisode !== undefined;
    return <div className='nmx-desk-review'>
        <div className='nmx-desk-review-bar'>
            <p className='nmx-desk-lead'>{t('reviewLead')}{props.noImageModel && <strong className='nmx-desk-review-warning'>{t('noImageModel')}</strong>}</p>
            {props.portraitsRunning
                ? <button type='button' onClick={props.onStopDraw}><i className='codicon codicon-debug-stop' aria-hidden='true'></i>{t('stopAll')}</button>
                : <button type='button' className='nmx-primary-button' disabled={props.noImageModel || !props.cards.length}
                    onClick={() => { for (const card of props.cards) commit(card); props.onDrawAll?.(); }}><i className='codicon codicon-sparkle' aria-hidden='true'></i>{t('drawAll')}</button>}
        </div>
        {!props.cards.length ? <div className='nmx-desk-empty is-inline'><span>{t('noCharacters')}</span></div>
                : <div className='nmx-desk-carousel is-cards is-review'>
                    {props.cards.map((item, index) => <article key={item.id} className={`nmx-desk-card is-${item.state} ${item.picture ? 'is-flipped' : ''} ${index === focus ? 'is-focus' : ''}`}
                        style={carouselStyle(index, focus)} onClick={() => { if (index !== focus) props.onFocusCard(index); }}>
                        <div className='nmx-desk-card-inner'>
                            <div className='nmx-desk-card-back'><i className={`codicon ${item.state === 'drawing' ? 'codicon-loading codicon-modifier-spin' : item.state === 'failed' ? 'codicon-warning' : 'codicon-person'}`}></i>
                                <strong data-nmx-literal>{item.name}</strong><small>{t(item.state === 'drawing' ? 'drawing' : item.state === 'failed' ? 'failed' : 'waiting')}</small></div>
                            <div className='nmx-desk-card-front'>{item.picture && <img src={item.picture} alt={item.name} />}<strong data-nmx-literal>{item.name}</strong>
                                {item.outdated && <em className='nmx-desk-card-flag'>{t('outdated')}</em>}
                                {item.picture && <ZoomButton label={props.t('zoom')} onClick={() => props.onZoom({ src: item.picture!, caption: item.name })} />}</div>
                        </div>
                    </article>)}
                    <Arrows index={focus} count={props.cards.length} onFocus={props.onFocusCard} previous={t('previous')} next={t('next')} />
                </div>}
        {props.cards.length > 0 && <section className='nmx-desk-row is-looks' aria-label={t('looksTitle')}>
            <header><strong>{t('looksTitle')}</strong><small>{t('castLead')}</small></header>
            <div className='nmx-desk-strip' ref={looks}>
                {props.cards.map((card, index) => {
                    const drawing = card.state === 'drawing';
                    const value = drafts[card.id] ?? card.look;
                    return <article key={card.id} className={`nmx-desk-look ${index === focus ? 'is-focus' : ''} is-${card.state}`}
                        onFocusCapture={() => { if (index !== focus) props.onFocusCard(index); }} onClick={() => { if (index !== focus) props.onFocusCard(index); }}>
                        <header>
                            <strong data-nmx-literal>{card.name}</strong>
                            {card.variant && <em>{t('sameCharacter', { n: card.variant.index, total: card.variant.total })}</em>}
                            {card.fromLibrary && <em>{t('fromLibrary')}</em>}
                            <small className={`nmx-desk-look-state is-${card.state}`}>{drawing ? t('drawing') : card.state === 'failed' ? t('failed') : card.picture ? t('done') : t('waiting')}</small>
                        </header>
                        {card.role && <p className='nmx-desk-look-role' data-nmx-literal>{card.role}</p>}
                        <ImeTextarea value={value} rows={6} placeholder={t('lookPlaceholder')} readOnly={card.rewriting || drawing} aria-label={`${t('looksTitle')} · ${card.name}`}
                            onChange={event => { const next = event.currentTarget.value; setDrafts(current => ({ ...current, [card.id]: next })); }}
                            onBlur={() => commit(card)} />
                        {card.outdated && !drawing && <small className='nmx-desk-look-note'>{t('lookChanged')}</small>}
                        {card.error && <small className='nmx-desk-clip-error' data-nmx-literal>{card.error}</small>}
                        <footer>
                            {card.rewriting
                                ? <button type='button' onClick={props.onStopRewrite}><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{t('stopAll')}</button>
                                : <button type='button' disabled={drawing || Boolean(props.cards.some(item => item.rewriting))} onClick={() => props.onRewriteLook?.(card.id)}>
                                    <i className='codicon codicon-sparkle' aria-hidden='true'></i>{t('rewriteLook')}</button>}
                            {drawing
                                ? <button type='button' onClick={props.onStopDraw}><i className='codicon codicon-debug-stop' aria-hidden='true'></i>{t('stopAll')}</button>
                                : <button type='button' className={!card.picture || card.outdated ? 'nmx-primary-button' : ''} disabled={props.noImageModel || card.rewriting || !value.trim()}
                                    onClick={() => { commit(card); props.onRedraw(card.id); }}><i className='codicon codicon-person' aria-hidden='true'></i>{card.picture ? t('redraw') : t('drawOne')}</button>}
                            <select aria-label={t('library')} value='' disabled={drawing || !props.library.length}
                                onChange={event => { const bundleId = event.currentTarget.value; if (bundleId) props.onBind(card.id, bundleId); }}>
                                <option value=''>{props.library.length ? t('library') : t('libraryEmpty')}</option>
                                {props.library.map(entry => <option key={entry.bundleId} value={entry.bundleId}>{entry.name}</option>)}
                            </select>
                            <button type='button' disabled={drawing} aria-label={t('upload')} title={t('upload')} onClick={() => props.onUpload(card.id)}><i className='codicon codicon-cloud-upload' aria-hidden='true'></i></button>
                        </footer>
                    </article>;
                })}
            </div>
        </section>}
        {props.episodes.length > 0 && <section className='nmx-desk-row is-episodes' aria-label={t('episodesTitle')}>
            <header><strong>{t('episodesTitle')}</strong></header>
            <div className='nmx-desk-strip'>
                {props.episodes.map(episode => {
                    const rewriting = props.rewritingEpisode === episode.number;
                    return <article key={episode.number} className={`nmx-desk-episode-box ${rewriting ? 'is-busy' : ''}`}>
                        <header><strong>{t('episode', { n: episode.number })}</strong><span data-nmx-literal>{episode.title}</span>
                            <small data-nmx-literal>{t('episodeChars', { n: episode.script.trim().length.toLocaleString() })}</small></header>
                        <ImeTextarea value={episode.script} rows={10} readOnly={rewriting || props.adapting} aria-label={`${t('episode', { n: episode.number })} · ${episode.title}`}
                            onChange={event => props.onScriptChange(episode.number, event.currentTarget.value)} onBlur={() => props.onScriptCommit?.(episode.number)} />
                        <footer>
                            {rewriting
                                ? <button type='button' onClick={props.onStopRewrite}><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{t('stopAll')}</button>
                                : <button type='button' disabled={busyEpisode || props.adapting} onClick={() => props.onRewriteEpisode?.(episode.number)}>
                                    <i className='codicon codicon-refresh' aria-hidden='true'></i>{t('rewriteEpisode')}</button>}
                            {episode.splitting && <small><i className='codicon codicon-loading codicon-modifier-spin' aria-hidden='true'></i>{t('splitting')}</small>}
                        </footer>
                    </article>;
                })}
            </div>
        </section>}
    </div>;
}

/** A picture opened large (the magnifier on a card; a clip uses its player's own full-screen button). */
interface Zoomed { readonly src: string; readonly caption: string }

type Inner = ComicDeskProps & { readonly t: (key: Key, values?: Record<string, string | number>) => string; readonly onZoom: (item: Zoomed) => void };

/**
 * A filmed clip. The focused card plays it with the player's own controls, and its lines are the player's own
 * subtitle track — at the bottom, small, and still there in full screen. The element stays the same while the
 * cards move on, so a clip watched full screen keeps playing when a newer clip finishes and takes the focus.
 */
function ClipPlayer(props: { readonly src: string; readonly cues?: readonly DeskCue[]; readonly active: boolean }): React.ReactElement {
    const video = React.useRef<HTMLVideoElement>(null);
    const [full, setFull] = React.useState(false);
    const playing = props.active || full;
    React.useEffect(() => {
        const element = video.current;
        if (!element) return;
        const change = () => setFull(document.fullscreenElement === element);
        element.addEventListener('fullscreenchange', change);
        return () => element.removeEventListener('fullscreenchange', change);
    }, []);
    React.useEffect(() => {
        const element = video.current;
        if (!element) return;
        if (playing) { element.muted = false; void element.play().catch(() => undefined); }
        else { element.pause(); element.muted = true; if (element.readyState >= 1) element.currentTime = Math.min(0.5, element.duration || 0.5); }
    }, [playing]);
    const cues = JSON.stringify(props.cues || []);
    React.useEffect(() => {
        const element = video.current;
        if (!element || !props.cues?.length || typeof VTTCue === 'undefined') return;
        const track = element.addTextTrack('subtitles', 'subtitles', document.documentElement.lang || 'zh');
        for (const cue of props.cues) track.addCue(new VTTCue(cue.start, Math.max(cue.end, cue.start + 0.5), cue.text));
        track.mode = 'showing';
        return () => { for (const cue of Array.from(track.cues || [])) track.removeCue(cue); track.mode = 'disabled'; };
    }, [props.src, cues]);
    return <video ref={video} src={props.src} controls={playing} controlsList='nodownload noplaybackrate noremoteplayback' disablePictureInPicture
        loop playsInline preload='metadata' muted={!playing} autoPlay={playing}
        onLoadedMetadata={event => { if (!playing) event.currentTarget.currentTime = Math.min(0.5, event.currentTarget.duration || 0.5); }} />;
}

/** Bottom-right magnifier, shown while the pointer is over a picture. */
function ZoomButton(props: { readonly label: string; readonly onClick: () => void }): React.ReactElement {
    return <button type='button' className='nmx-zoom-button' aria-label={props.label} title={props.label}
        onClick={event => { event.stopPropagation(); props.onClick(); }}><i className='codicon codicon-zoom-in' aria-hidden='true'></i></button>;
}

function Lightbox(props: { readonly item: Zoomed; readonly close: string; readonly onClose: () => void }): React.ReactElement {
    const panel = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => { panel.current?.focus(); }, []);
    return <div ref={panel} tabIndex={-1} className='nmx-lightbox' role='dialog' aria-modal='true' aria-label={props.item.caption} onClick={props.onClose}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); props.onClose(); } }}>
        <figure onClick={event => event.stopPropagation()}>
            <img src={props.item.src} alt={props.item.caption} />
            <figcaption data-nmx-literal>{props.item.caption}</figcaption>
        </figure>
        <button type='button' className='nmx-lightbox-close' aria-label={props.close} onClick={props.onClose}>×</button>
    </div>;
}

function Arrows(props: { readonly index: number; readonly count: number; readonly onFocus: (index: number) => void; readonly previous: string; readonly next: string }): React.ReactElement {
    return <>
        <button className='nmx-desk-arrow is-left' aria-label={props.previous} disabled={props.index <= 0} onClick={() => props.onFocus(props.index - 1)}><i className='codicon codicon-chevron-left'></i></button>
        <button className='nmx-desk-arrow is-right' aria-label={props.next} disabled={props.index >= props.count - 1} onClick={() => props.onFocus(props.index + 1)}><i className='codicon codicon-chevron-right'></i></button>
        <div className='nmx-desk-dots'>{Array.from({ length: props.count }, (_, index) =>
            <button key={index} className={index === props.index ? 'is-current' : ''} aria-label={String(index + 1)} onClick={() => props.onFocus(index)}></button>)}</div>
    </>;
}

/** 剧本 and 拍摄: the episodes side by side, the focused one in the middle. */
function EpisodeCarousel(props: Inner): React.ReactElement {
    const { t } = props;
    if (!props.episodes.length) {
        return <div className='nmx-desk-empty'>{props.adapting ? <><i className='codicon codicon-loading codicon-modifier-spin'></i><strong>{t('adapting')}</strong>
            {props.adaptProgress && <small data-nmx-literal>{props.adaptProgress}</small>}</> : null}</div>;
    }
    const focus = Math.min(props.focusEpisode, props.episodes.length - 1);
    return <div className='nmx-desk-carousel is-episodes' onKeyDown={event => {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
        if (event.key === 'ArrowLeft' && focus > 0) props.onFocusEpisode(focus - 1);
        if (event.key === 'ArrowRight' && focus < props.episodes.length - 1) props.onFocusEpisode(focus + 1);
    }}>
        {props.episodes.map((episode, index) => <article key={episode.number} className={`nmx-desk-episode ${index === focus ? 'is-focus' : ''}`} style={carouselStyle(index, focus)}
            onClick={() => { if (index !== focus) props.onFocusEpisode(index); }}>
            <header><strong>{t('episode', { n: episode.number })}</strong><span data-nmx-literal>{episode.title}</span>
                <small data-nmx-literal>{t('chars', { n: episode.script.trim().length.toLocaleString() })}</small></header>
            <EpisodeScript {...props} episode={episode} focused={index === focus} />
        </article>)}
        <Arrows index={focus} count={props.episodes.length} onFocus={props.onFocusEpisode} previous={t('previous')} next={t('next')} />
    </div>;
}

/** The episode's script (剧本 step): typed into freely; the widget keeps the draft until “next”. */
function EpisodeScript(props: Inner & { readonly episode: DeskEpisode; readonly focused: boolean }): React.ReactElement {
    const { episode } = props;
    return <div className='nmx-desk-script'>
        <ImeTextarea value={episode.script} readOnly={!props.focused || props.adapting} rows={14}
            onChange={event => props.onScriptChange(episode.number, event.currentTarget.value)} />
    </div>;
}

/** 选角: character cards that flip over when their portrait arrives. */
function CastCarousel(props: Inner): React.ReactElement {
    const { t } = props;
    if (props.noImageModel) return <div className='nmx-desk-empty'><span>{t('noImageModel')}</span></div>;
    if (!props.cards.length) return <div className='nmx-desk-empty'><span>{t('noCharacters')}</span></div>;
    const focus = Math.min(props.focusCard, props.cards.length - 1);
    const card = props.cards[focus];
    return <div className='nmx-desk-cast'>
        <p className='nmx-desk-lead'>{t('castLead')}</p>
        <div className='nmx-desk-carousel is-cards'>
            {props.cards.map((item, index) => <article key={item.id} className={`nmx-desk-card is-${item.state} ${item.picture ? 'is-flipped' : ''} ${index === focus ? 'is-focus' : ''}`}
                style={carouselStyle(index, focus)} onClick={() => { if (index !== focus) props.onFocusCard(index); }}>
                <div className='nmx-desk-card-inner'>
                    <div className='nmx-desk-card-back'><i className={`codicon ${item.state === 'drawing' ? 'codicon-loading codicon-modifier-spin' : item.state === 'failed' ? 'codicon-warning' : 'codicon-person'}`}></i>
                        <strong data-nmx-literal>{item.name}</strong><small>{t(item.state === 'drawing' ? 'drawing' : item.state === 'failed' ? 'failed' : 'waiting')}</small></div>
                    <div className='nmx-desk-card-front'>{item.picture && <img src={item.picture} alt={item.name} />}<strong data-nmx-literal>{item.name}</strong>
                        {item.picture && <ZoomButton label={props.t('zoom')} onClick={() => props.onZoom({ src: item.picture!, caption: item.name })} />}</div>
                </div>
            </article>)}
            <Arrows index={focus} count={props.cards.length} onFocus={props.onFocusCard} previous={t('previous')} next={t('next')} />
        </div>
        <div className='nmx-desk-card-detail'>
            <div><strong data-nmx-literal>{card.name}</strong>{card.role && <small data-nmx-literal>{card.role}</small>}{card.fromLibrary && <em>{t('fromLibrary')}</em>}</div>
            {card.look && <p data-nmx-literal>{card.look}</p>}
            {card.error && <small className='nmx-desk-clip-error' data-nmx-literal>{card.error}</small>}
            <div className='nmx-desk-card-actions'>
                <button disabled={card.state === 'drawing' || props.noImageModel} onClick={() => props.onRedraw(card.id)}><i className='codicon codicon-refresh'></i>{t('redraw')}</button>
                <select aria-label={t('library')} value='' disabled={card.state === 'drawing' || !props.library.length}
                    onChange={event => { const bundleId = event.currentTarget.value; if (bundleId) props.onBind(card.id, bundleId); }}>
                    <option value=''>{props.library.length ? t('library') : t('libraryEmpty')}</option>
                    {props.library.map(entry => <option key={entry.bundleId} value={entry.bundleId}>{entry.name}</option>)}
                </select>
                <button disabled={card.state === 'drawing'} onClick={() => props.onUpload(card.id)}><i className='codicon codicon-cloud-upload'></i>{t('upload')}</button>
            </div>
        </div>
    </div>;
}

/** The clip's own description (what the user reads and edits): the text before the appended cast and style lines. */
export function clipOwnPrompt(prompt: string): string {
    const cut = prompt.search(/\n(?:Characters —|Style —|Setting —|人物 —|风格 —|场景 —)/);
    // Older adaptations ended every shot with a blanket "no text, subtitles, logos or watermark" line; the
    // request adds only what a shot needs (dialogue: no burned-in subtitles), so the blanket line is dropped.
    return (cut >= 0 ? prompt.slice(0, cut) : prompt)
        .replace(/(?:\d{1,2}:\d{1,2}\s*[，,]\s*)?画面[中里内]?(?:无|不要|没有)(?:任何)?(?:文字|字幕)[^。\n]*。?/g, '')
        .replace(/\s*\bNo (?:on-screen )?(?:text|captions|subtitles)\b[^.\n]*\.?/gi, '')
        .replace(/[ \t]+$/gm, '').trim();
}

/**
 * 拍摄: the focused episode's clips as cards (the same card as casting: a card back until the clip is
 * filmed, then it flips and plays), and one text box below — this clip's description or the episode's
 * script — with the matching action.
 */
function ShootStage(props: Inner): React.ReactElement {
    const { t } = props;
    const [tab, setTab] = React.useState<'clip' | 'episode'>('clip');
    const [drafts, setDrafts] = React.useState<Record<string, string>>({});
    const [scriptChanged, setScriptChanged] = React.useState<Record<number, boolean>>({});
    if (!props.episodes.length) return <div className='nmx-desk-empty'><span>{t('noClips')}</span></div>;
    const focusEpisode = Math.min(props.focusEpisode, props.episodes.length - 1);
    const episode = props.episodes[focusEpisode];
    const clips = episode.clips;
    const focus = Math.min(props.focusClip, Math.max(0, clips.length - 1));
    const clip = clips[focus];
    const stateLabel = (state: DeskClip['state']): string => t(state === 'failed' ? 'failed' : state === 'done' ? 'done' : state === 'picture' ? 'picture' : state === 'video' ? 'video' : state === 'queued' ? 'queued' : 'waiting');
    const draft = clip ? drafts[clip.shotId] ?? clipOwnPrompt(clip.prompt) : '';
    const busy = clip && (clip.state === 'queued' || clip.state === 'picture' || clip.state === 'video');
    return <div className='nmx-desk-shoot'>
        <div className='nmx-desk-episode-bar'>
            <button aria-label={t('previous')} disabled={focusEpisode <= 0} onClick={() => props.onFocusEpisode(focusEpisode - 1)}><i className='codicon codicon-chevron-left'></i></button>
            <strong>{t('episode', { n: episode.number })}</strong><span data-nmx-literal>{episode.title}</span>
            <small data-nmx-literal>{clips.filter(item => item.state === 'done').length}/{clips.length}</small>
            <button aria-label={t('next')} disabled={focusEpisode >= props.episodes.length - 1} onClick={() => props.onFocusEpisode(focusEpisode + 1)}><i className='codicon codicon-chevron-right'></i></button>
        </div>
        {!clips.length ? <div className='nmx-desk-empty'><span>{episode.splitting ? t('splitting') : t('noClips')}</span></div>
            : <div className='nmx-desk-carousel is-clips'>
                {clips.map((item, index) => <article key={item.shotId} className={`nmx-desk-card is-clip is-${item.state} ${item.video && item.state === 'done' ? 'is-flipped' : ''} ${index === focus ? 'is-focus' : ''}`}
                    style={carouselStyle(index, focus)} onClick={() => { if (index !== focus) props.onFocusClip(index); }}>
                    <div className='nmx-desk-card-inner'>
                        <div className='nmx-desk-card-back'>
                            <i className={`codicon ${item.state === 'video' || item.state === 'picture' ? 'codicon-loading codicon-modifier-spin' : item.state === 'failed' ? 'codicon-warning' : 'codicon-device-camera-video'}`}></i>
                            <strong data-nmx-literal>{String(index + 1).padStart(2, '0')} · {item.title}</strong><small>{stateLabel(item.state)} · {t('seconds', { n: item.seconds })}</small></div>
                        <div className='nmx-desk-card-front'>
                            {item.video && <ClipPlayer src={item.video} cues={item.cues} active={index === focus} />}
                            {item.outdated && <em className='nmx-desk-card-flag'>{t('outdated')}</em>}
                        </div>
                    </div>
                </article>)}
                <Arrows index={focus} count={clips.length} onFocus={props.onFocusClip} previous={t('previous')} next={t('next')} />
            </div>}
        {clips.length > 0 && <div className='nmx-desk-filmstrip' role='tablist' aria-label={t('clips', { n: clips.length })}>
            {clips.map((item, index) => <button key={item.shotId} type='button' role='tab' aria-selected={index === focus}
                className={`is-${item.state} ${index === focus ? 'is-focus' : ''} ${item.outdated ? 'is-outdated' : ''}`}
                title={`${String(index + 1).padStart(2, '0')} · ${item.title} · ${stateLabel(item.state)}`} onClick={() => props.onFocusClip(index)}>
                {item.poster ? <img src={item.poster} alt='' draggable={false} />
                    : item.video ? <video src={`${item.video}#t=0.5`} muted preload='metadata' playsInline tabIndex={-1} aria-hidden='true' />
                    : <i className={`codicon ${item.state === 'video' || item.state === 'picture' ? 'codicon-loading codicon-modifier-spin' : item.state === 'failed' ? 'codicon-warning' : 'codicon-device-camera-video'}`} aria-hidden='true'></i>}
                <span data-nmx-literal>{String(index + 1).padStart(2, '0')}</span>
                <em data-nmx-literal>{t('seconds', { n: item.seconds })}</em>
            </button>)}
        </div>}
        <div className='nmx-desk-editor'>
            <div className='nmx-desk-tabs' role='tablist'>
                <button role='tab' aria-selected={tab === 'clip'} className={tab === 'clip' ? 'is-current' : ''} disabled={!clip} onClick={() => setTab('clip')}>
                    {t('tabClip')}{clip ? ` · ${String(focus + 1).padStart(2, '0')}` : ''}</button>
                <button role='tab' aria-selected={tab === 'episode'} className={tab === 'episode' ? 'is-current' : ''} onClick={() => setTab('episode')}>{t('tabEpisode')}</button>
            </div>
            {tab === 'clip' && clip ? <>
                <ImeTextarea rows={4} value={draft} onChange={event => { const value = event.currentTarget.value; setDrafts(current => ({ ...current, [clip.shotId]: value })); }} />
                {clip.generatedPrompt && <details><summary>{comicShotFieldText(props.locale as NextMuxDesktopLocale, 'englishPrompt')}</summary>
                    <ImeTextarea rows={6} readOnly value={clip.generatedPrompt} aria-label={comicShotFieldText(props.locale as NextMuxDesktopLocale, 'englishPrompt')} data-nmx-literal />
                </details>}
                {clip.error && <small className='nmx-desk-clip-error' data-nmx-literal>{clip.error}</small>}
                <button className='nmx-primary-button' disabled={Boolean(busy)} onClick={() => props.onRegenerateClip(clip.shotId, draft)}>
                    <i className='codicon codicon-refresh'></i>{busy ? t('filming') : t('regenerateClip')}</button>
            </> : <>
                <ImeTextarea rows={5} value={episode.script} readOnly={props.adapting}
                    onChange={event => { props.onScriptChange(episode.number, event.currentTarget.value); setScriptChanged(current => ({ ...current, [episode.number]: true })); }} />
                <button className='nmx-primary-button' disabled={!scriptChanged[episode.number]} onClick={() => { setScriptChanged(current => ({ ...current, [episode.number]: false })); props.onReshootEpisode(episode.number); }}>
                    <i className='codicon codicon-refresh'></i>{t('applyScript')}</button>
            </>}
        </div>
    </div>;
}

/** Text lookups that never throw: an unknown key or language falls back (see nextmux-copy-fallback.ts). */
export function deskText(locale: Parameters<typeof uncheckedDeskText>[0], key: Parameters<typeof uncheckedDeskText>[1], ...rest: AfterLocaleAndKey<Parameters<typeof uncheckedDeskText>>): string {
    return totalCopy(locale, key, language => uncheckedDeskText(language, key, ...rest));
}
