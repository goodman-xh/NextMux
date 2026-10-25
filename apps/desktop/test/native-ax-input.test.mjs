import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
const source = fileURLToPath(new URL('../native/display/NextMuxAXInput.h', import.meta.url));
// Executes the production semantic dispatcher against a fake AX tree. All AX
// RPCs are replaced, so this suite cannot interact with an application or TCC.
const harness = String.raw`
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
@interface NXInputSession : NSObject
@property BOOL cancelled;
@property NSMutableArray *held;
@end
@implementation NXInputSession
@end
@interface Element : NSObject
@property NSMutableDictionary *attributes;
@property NSArray *actions;
@property NSArray *writable;
@property int pid;
@property CGRect frame;
@end
@implementation Element
@end
static Element *root, *app;
static NSMutableArray *writes, *posted;
static AXError actionError;
static Element *make(CGRect frame) { Element *e=[Element new];e.pid=7;e.frame=frame;e.attributes=[NSMutableDictionary dictionary];e.actions=@[];e.writable=@[];return e; }
static AXUIElementRef ref(Element *element) { return (__bridge AXUIElementRef)element; }
static AXError readAX(AXUIElementRef e, CFStringRef a, CFTypeRef *out) {
    id value=((__bridge Element *)e).attributes[(__bridge NSString *)a];
    if (!value) return kAXErrorAttributeUnsupported;
    *out=CFRetain((__bridge CFTypeRef)value);return kAXErrorSuccess;
}
static AXError writableAX(AXUIElementRef e, CFStringRef a, Boolean *out) { *out=[((__bridge Element *)e).writable containsObject:(__bridge NSString *)a];return kAXErrorSuccess; }
static AXError actionsAX(AXUIElementRef e, CFArrayRef *out) { *out=(CFArrayRef)CFRetain((__bridge CFTypeRef)((__bridge Element *)e).actions);return kAXErrorSuccess; }
static AXError pidAX(AXUIElementRef e, pid_t *pid) { *pid=((__bridge Element *)e).pid;return kAXErrorSuccess; }
static AXError writeAX(AXUIElementRef e, CFStringRef a, CFTypeRef value) { [writes addObject:@[(__bridge id)e,(__bridge id)a,(__bridge id)value]];return actionError; }
static AXError performAX(AXUIElementRef e, CFStringRef a) { [writes addObject:@[(__bridge id)e,(__bridge id)a]];return actionError; }
static AXUIElementRef appAX(pid_t pid) { return (AXUIElementRef)CFRetain((__bridge CFTypeRef)app); }
static AXUIElementRef copyWindow(pid_t pid, CGWindowID wid) { return pid==7 && wid==9 ? (AXUIElementRef)CFRetain((__bridge CFTypeRef)root):NULL; }
static BOOL frameOf(AXUIElementRef e, CGRect *frame) { *frame=((__bridge Element *)e).frame;return YES; }
static BOOL ratioPoint(NSDictionary *r, CGPoint *p) { double x=[r[@"x"] doubleValue],y=[r[@"y"] doubleValue];if(!r[@"x"]||!r[@"y"]||x<0||x>1||y<0||y>1)return NO;*p=CGPointMake(x,y);return YES; }
static void inputFailure(NSString *code) { @throw [NSException exceptionWithName:@"test" reason:code userInfo:nil]; }
static void checkInput(NXInputSession *s) { if(s.cancelled)inputFailure(@"cancelled"); }
static bool trusted(void) {return true;}
static void postToPidAX(pid_t pid, CGEventRef event) { if (event) [posted addObject:@[@(pid), @(CGEventGetType(event))]]; }
// Fake event transport for the semantic policy harness; real release-stack tests live in native-display-input.
static void postInputEvent(NXInputSession *s, CGEventRef event) { checkInput(s); postToPidAX(7,event); }
static void holdEvents(NXInputSession *s, CGEventRef down, CGEventRef up, CGEventFlags modifier) {
    if(!s.held)s.held=[NSMutableArray array]; [s.held addObject:(__bridge_transfer id)up]; postInputEvent(s,down); CFRelease(down);
}
static void releaseLastInput(NXInputSession *s) { postToPidAX(7,(__bridge CGEventRef)s.held.lastObject); [s.held removeLastObject]; }
static void waitInput(NXInputSession *s,double ms) { checkInput(s); }
static double inputDuration(NSDictionary *r,NSString *key,double fallback,double min,double max) { return r[key]?[r[key] doubleValue]:fallback; }
static CGPoint windowPoint(CGRect f,CGPoint p) { return CGPointMake(f.origin.x+MIN(p.x*f.size.width,f.size.width-1),f.origin.y+MIN(p.y*f.size.height,f.size.height-1)); }
#define AXUIElementCopyAttributeValue readAX
#define AXUIElementIsAttributeSettable writableAX
#define AXUIElementCopyActionNames actionsAX
#define AXUIElementGetPid pidAX
#define AXUIElementSetAttributeValue writeAX
#define AXUIElementPerformAction performAX
#define AXUIElementCreateApplication appAX
#define AXIsProcessTrusted trusted
#define CGEventPostToPid postToPidAX
#define AX_INPUT_SLEEP(sec) ((void)0)
#include SOURCE_FILE
static void require(BOOL ok, NSString *why) {if(!ok){fprintf(stderr,"%s\n",why.UTF8String);exit(1);}}
int main(int argc,const char **argv) {@autoreleasepool {
    NSString *test=[NSString stringWithUTF8String:argv[1]];
    root=make(CGRectMake(0,0,800,600));app=make(CGRectZero);writes=[NSMutableArray array];posted=[NSMutableArray array];
    Element *control=make(CGRectMake(100,100,200,100));control.attributes[@"AXParent"]=root;
    Element *label=make(CGRectMake(120,120,100,50));label.attributes[@"AXParent"]=control;
    root.attributes[@"AXChildren"]=@[control];control.attributes[@"AXChildren"]=@[label];
    app.attributes[@"AXFocusedWindow"]=root;
    NXInputSession *session=[NXInputSession new];
    NSMutableDictionary *r=[@{@"op":@"pointer",@"delivery":@"semantic",@"scope":@"c",@"pid":@7,@"windowId":@9,@"kind":@"click",@"x":@0.2,@"y":@0.25} mutableCopy];
    if([test isEqual:@"press"]) {
        control.actions=@[@"AXPress"];
        require([semanticInput(r,session)[@"ok"] boolValue] && writes.count==1 && writes[0][0]==control,@"leaf label resolves exact nearest button");
    } else if([test isEqual:@"text"]) {
        control.writable=@[@"AXSelectedText"];
        require([semanticInput(r,session)[@"effect"] isEqual:@"text_target_selected"] && !writes.count,@"target selection does not focus app");
        r[@"op"]=@"keys";r[@"text"]=@"中😀";
        require([semanticInput(r,session)[@"ok"] boolValue] && writes.count==1 && writes[0][0]==control && [writes[0][1] isEqual:@"AXSelectedText"] && [writes[0][2] isEqual:@"中😀"],@"inserts exact text into selected field");
        r[@"scope"]=@"other";
        require(![semanticInput(r,session)[@"ok"] boolValue] && writes.count==1,@"another conversation cannot inherit selected field");
    } else if([test isEqual:@"fallback"]) {
        control.attributes[@"AXRole"]=@"AXTextArea";
        require([semanticInput(r,session)[@"ok"] boolValue] && posted.count==3 && [posted[0][0] isEqual:@7],@"non-AX click falls back to CGEventPostToPid");
        [posted removeAllObjects];
        r[@"op"]=@"keys";r[@"text"]=@"赞";
        require([semanticInput(r,session)[@"ok"] boolValue] && posted.count==2 && [posted[0][0] isEqual:@7],@"non-AXSelectedText editable falls back to CGEventPostToPid unicode");
        [posted removeAllObjects];
        [r removeObjectForKey:@"text"];r[@"key"]=@"z";
        require([semanticInput(r,session)[@"ok"] boolValue] && posted.count==2 && [posted[0][0] isEqual:@7],@"shortcut key blurs editable and posts key to pid");
    } else if([test isEqual:@"unsupported"]) {
        r[@"kind"]=@"scroll";r[@"direction"]=@"down";r[@"amount"]=@2;
        require([semanticInput(r,session)[@"ok"] boolValue] && posted.count==1,@"scroll posts only to the target pid");
        [posted removeAllObjects];r[@"op"]=@"keys";r[@"key"]=@"a";r[@"holdMs"]=@50;
        require([semanticInput(r,session)[@"ok"] boolValue] && posted.count==2,@"holds dispatch and release");
        [posted removeAllObjects]; r[@"delivery"]=@"foreground";
        require(![semanticInput(r,session)[@"ok"] boolValue] && !posted.count,@"delivery cannot reopen physical route");
    } else if([test isEqual:@"foreign"]) {
        control.actions=@[@"AXPress"];control.pid=22;label.pid=22;
        require(![semanticInput(r,session)[@"ok"] boolValue] && !writes.count && !posted.count,@"foreign-process descendants rejected");
    } else if([test isEqual:@"ambiguous"]) {
        Element *other=make(label.frame);other.attributes[@"AXParent"]=control;control.attributes[@"AXChildren"]=@[label,other];
        BOOL thrown=NO;@try{semanticInput(r,session);}@catch(NSException *e){thrown=[e.reason isEqual:@"background_target_ambiguous"];}
        require(thrown && !writes.count && !posted.count,@"overlapping peers are not guessed");
    } else if([test isEqual:@"unknown"]) {
        control.actions=@[@"AXPress"];actionError=kAXErrorCannotComplete;
        require([semanticInput(r,session)[@"error"] isEqual:@"computer_ax_action_unconfirmed"] && writes.count==1,@"unknown completion neither retried nor success");
    } else if([test isEqual:@"cancel"]) {
        session.cancelled=YES;BOOL thrown=NO;@try{semanticInput(r,session);}@catch(NSException *e){thrown=YES;}
        require(thrown && !writes.count && !posted.count,@"cancel before AX mutation");
    } else if([test isEqual:@"bounded"]) {
        NSMutableArray *children=[NSMutableArray array];for(int i=0;i<2001;i++)[children addObject:control];root.attributes[@"AXChildren"]=children;
        BOOL thrown=NO;@try{semanticInput(r,session);}@catch(NSException *e){thrown=[e.reason isEqual:@"background_target_limit"];}
        require(thrown && !writes.count && !posted.count,@"oversized AX tree bounded before mutation");
    } else require(NO,@"unknown test");
    puts("ok");return 0;
}}
`;
describe('native window-scoped AX policy (no UI, no global events)', { skip: process.platform !== 'darwin' }, () => {
  let directory, executable;
  before(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'nextmux-ax-test-')); executable = path.join(directory, 'test');
    const file = path.join(directory, 'test.m'); writeFileSync(file, harness.replace('SOURCE_FILE', JSON.stringify(source)));
    execFileSync('xcrun', ['clang', '-fobjc-arc', '-O0', '-Wall', '-Werror', '-Wno-unused-function', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ApplicationServices', file, '-o', executable], { encoding: 'utf8', timeout: 60000 });
  });
  after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  for (const name of ['press', 'text', 'fallback', 'unsupported', 'foreign', 'ambiguous', 'unknown', 'cancel', 'bounded'])
    it(name, () => assert.equal(execFileSync(executable, [name], { encoding: 'utf8', timeout: 5000 }).trim(), 'ok'));
});
