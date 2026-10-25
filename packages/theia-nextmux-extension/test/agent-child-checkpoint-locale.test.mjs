import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCurrentSource} from './helpers/current-source-loader.mjs';
const semantic=loadCurrentSource(new URL('../../agent-runtime/src/semantic-messages.ts',import.meta.url));
const {runtimeFinalText}=loadCurrentSource(new URL('../src/browser/nextmux-agent-outcome-locale.ts',import.meta.url),{'@nextmux/agent-runtime/semantic-messages':semantic});
const {agentChildText}=loadCurrentSource(new URL('../src/browser/nextmux-agent-child-locale.ts',import.meta.url));
const locales=['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt-BR','ru','ar','hi'];
const checkpointWords=[/checkpoint/i,/检查点/,/檢查點/,/チェックポイント/,/체크포인트/,/punto de control/,/point de contrôle/,/Prüfpunkt/,/checkpoint/,/контрольную точку/,/نقطة التحقق/,/चेकपॉइंट/];
const retainedWords=[/retained/,/已保留/,/已保留/,/保持/,/보존/,/conservan/,/conservés/,/erhalten/,/preservados/,/сохранены/,/الاحتفاظ/,/सुरक्षित/];
const blockedClaims=/automatic retry is blocked|禁止自动重试|禁止自動重試|自動再試行は無効|자동 재시도는 차단|se bloqueó|est bloquée|Wiederholungsversuch blockiert|foi bloqueada|повтор заблокирован|تمت إعاقة|पुनःप्रयास अवरुद्ध/i;
const message={origin:'runtime',stopReason:'checkpoint_persistence_failed'};

test('checkpoint persistence pause is localized in all 12 languages without claiming a retry gate',()=>{
 for(let i=0;i<locales.length;i++){
  const locale=locales[i],text=runtimeFinalText(locale,{finalMessage:message,finalText:semantic.canonicalRuntimeFinal(message)});
  assert.match(text,checkpointWords[i],locale);assert.match(text,retainedWords[i],locale);assert.doesNotMatch(text,blockedClaims,locale);
  assert.equal(runtimeFinalText(locale,{stopReason:message.stopReason}),text);assert.equal(runtimeFinalText(locale,{stopReason:message.stopReason,finalText:semantic.canonicalRuntimeFinal(message)}),text);
  if(locale!=='en')assert.notEqual(text,runtimeFinalText('en',{finalMessage:message}));
 }
});

test('manual review receipts advise checking the result without asserting automatic enforcement',()=>{
 for(const locale of locales){const text=agentChildText(locale,'manualReview');assert.ok(text.trim());assert.doesNotMatch(text,blockedClaims,locale);if(locale!=='en')assert.notEqual(text,agentChildText('en','manualReview'));}
 assert.match(agentChildText('zh-CN','manualReview'),/建议先核对结果/);assert.match(agentChildText('en','manualReview'),/Review.*avoid/);
});

test('localized checkpoint advice preserves original result, accounting and model-authored prose',()=>{
 const result={status:'paused',finalMessage:message,finalText:semantic.canonicalRuntimeFinal(message),usage:{inputTokens:17,outputTokens:4},usageKnown:false,recoveryStatus:'unknown',receipt:{retrySafe:false}};const before=structuredClone(result);
 assert.match(runtimeFinalText('zh-CN',result),/用量已保留/);assert.deepEqual(result,before);
 assert.equal(runtimeFinalText('zh-CN',{stopReason:message.stopReason,finalText:'Original model-authored result, preserved verbatim.'}),undefined);
});
