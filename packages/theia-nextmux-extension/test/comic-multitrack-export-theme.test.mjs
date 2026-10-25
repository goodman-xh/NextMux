import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pkg=fileURLToPath(new URL('../',import.meta.url)),src=join(pkg,'src/browser'),require=createRequire(join(pkg,'package.json'));
const desktop=createRequire(new URL('../../../apps/desktop/package.json',import.meta.url));
const platform=createRequire(new URL('../../../apps/cloudflare-platform/package.json',import.meta.url)),core=createRequire(require.resolve('@theia/core/package.json'));
const puppeteer=(await import(platform.resolve('puppeteer'))).default;

test('real editor export action keeps readable theme colors in enabled, hover, active, focus and disabled states', {timeout:60000}, async t=>{
  const {outputFiles}=await desktop('esbuild').build({stdin:{loader:'tsx',resolveDir:src,contents:`
import React from 'react';import{createRoot}from'react-dom/client';import{ComicMultitrack}from'./nextmux-comic-multitrack';
const root=createRoot(document.querySelector('main'));let disabled=false,exports=0;
const composition={schemaVersion:1,tracks:[{id:'video',title:'Video',kind:'video'}],clips:[]};
function render(){root.render(<ComicMultitrack composition={composition} assets={[]} mediaAssets={[]} fps={24} projectCanvas={{width:640,height:360}} locale='zh-CN' busy={false} importing={false} canUndo={false} canRedo={false} exportLabel='导出成片' exportDisabled={disabled} onCommit={async()=>true} onInsertAsset={()=>false} onImportFiles={()=>{}} actions={{pickFiles(){},undo(){},redo(){},exportVideo(){exports++;}}} player={{}}/>);}
window.qa={setDisabled(value){disabled=value;render();},get exports(){return exports;}};render();
`},bundle:true,write:false,platform:'browser',format:'iife',loader:{'.css':'empty'},alias:{react:core.resolve('react'),'react-dom/client':core.resolve('react-dom/client')}});
  // Load the actual application sheets in their shipping order, including the
  // late light-theme hover guard. Artificial purple fixture tokens missed this bug.
  const frontend=await readFile(join(src,'nextmux-frontend-module.ts'),'utf8');
  const styles=[...frontend.matchAll(/import ['"]\.\.\/\.\.\/src\/browser\/style\/([^'"]+\.css)['"]/g)].map(match=>match[1]);
  const css=(await Promise.all(styles.map(file=>readFile(join(src,'style',file),'utf8')))).join('\n');
  assert.ok(styles.includes('nextmux-comic-studio.css')&&styles.includes('nextmux-light-contrast.css'));
  const browser=await puppeteer.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();await page.setViewport({width:1280,height:850});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<div class="nmx-shell"><div class="nmx-comic-surface-v4"><main></main></div></div>');
  await page.addStyleTag({content:css});
  await page.addStyleTag({content:'html,body,.nmx-shell,.nmx-comic-surface-v4,main{height:100%;width:100%;margin:0;} .nmx-shell{display:block!important;} .nmx-comic-surface-v4,main{display:flex;min-height:0;min-width:0;}'});
  await page.addScriptTag({content:outputFiles[0].text});await page.waitForSelector('.nmx-mt-export');
  const output=process.env.NEXTMUX_THEME_SHOTS||'/tmp/nextmux-multitrack-export-theme';await mkdir(output,{recursive:true});
  const measurements=[];
  const inspect=()=>page.$eval('.nmx-mt-export',button=>{
    const css=getComputedStyle(button), parent=getComputedStyle(button.parentElement), canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const c=canvas.getContext('2d');
    const color=value=>{c.clearRect(0,0,1,1);c.fillStyle=value;c.fillRect(0,0,1,1);return[...c.getImageData(0,0,1,1).data];};
    const blend=(front,back,opacity=1)=>front.slice(0,3).map((v,i)=>v*front[3]/255*opacity+back[i]*(1-front[3]/255*opacity));
    const bg=blend(color(css.backgroundColor),color(parent.backgroundColor),Number(css.opacity));
    const fg=blend(color(css.color),bg,Number(css.opacity));
    const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const a=luminance(fg),b=luminance(bg),r=button.getBoundingClientRect();
    return {foreground:css.color,background:css.backgroundColor,opacity:css.opacity,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),accent:css.getPropertyValue('--nmx-accent').trim(),onAccent:css.getPropertyValue('--nmx-on-accent').trim(),focusVisible:button.matches(':focus-visible'),outline:css.outlineStyle,outlineWidth:css.outlineWidth,rect:{x:r.x,y:r.y,width:r.width,height:r.height},disabled:button.disabled};
  });
  for(const theme of ['dark','light']){
    await page.$eval('.nmx-shell',(node,value)=>node.className=`nmx-shell nmx-theme-${value}`,theme);
    await page.evaluate(()=>qa.setDisabled(false));await page.waitForFunction(()=>!document.querySelector('.nmx-mt-export').disabled);
    await page.mouse.move(0,0);await page.$eval('.nmx-mt-export',button=>button.blur());
    const normal=await inspect();assert.equal(normal.accent,theme==='dark'?'#ddd':'#333');
    for(const state of ['enabled','hover','active','focus','disabled']){
      await page.mouse.move(0,0);await page.$eval('.nmx-mt-export',button=>button.blur());
      if(state==='hover'||state==='active')await page.hover('.nmx-mt-export');
      if(state==='active')await page.mouse.down();
      if(state==='focus'){await page.keyboard.press('Tab');await page.focus('.nmx-mt-export');}
      if(state==='disabled'){await page.evaluate(()=>qa.setDisabled(true));await page.waitForFunction(()=>document.querySelector('.nmx-mt-export').disabled);await page.hover('.nmx-mt-export');}
      // Studio transitions last 120 ms; measure the final painted colors.
      await page.waitForFunction(()=>document.querySelector('.nmx-mt-export').getAnimations().every(a=>a.playState!=='running'));
      const value=await inspect();measurements.push({theme,state,...value});
      assert.ok(value.contrast>=4.5,`${theme}/${state} ${JSON.stringify(value)}`);
      assert.deepEqual(value.rect,normal.rect,`${theme}/${state} must not resize or move the button`);
      if(state==='focus'){assert.equal(value.focusVisible,true);assert.notEqual(value.outline,'none');assert.ok(parseFloat(value.outlineWidth)>=2);}
      if(state==='active')await page.mouse.up();
      if(state==='disabled'){const before=await page.evaluate(()=>qa.exports);await page.click('.nmx-mt-export');assert.equal(await page.evaluate(()=>qa.exports),before,'disabled action cannot export');}
      await page.screenshot({path:join(output,`${theme}-${state}.png`)});
    }
  }
  console.info(JSON.stringify(measurements));assert.deepEqual(errors,[]);
});
