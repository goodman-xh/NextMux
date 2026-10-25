import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

// The actual native input functions run with HID posting and cursor restoration replaced at compile time.
// This harness never calls pointer()/keys(), AX APIs, NSApplication, or the native helper's main function.
const source = fileURLToPath(new URL('../native/display/NextMuxDisplayHelper.m', import.meta.url));
const harness = String.raw`
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
static NSMutableArray<NSDictionary *> *events;
static NSMutableArray<NSString *> *unicodePayloads;
static int keyboardCreates, mouseCreates, failKeyboardAt, failMouseAt;
static BOOL warped;
static CGPoint warpedPoint;
static CGPoint currentCursor = { 400, 300 };
static pid_t frontPid;
static CGEventRef NXTestEventCreate(CGEventSourceRef source) {
    CGEventRef event = CGEventCreate(source);
    if (event) CGEventSetLocation(event, currentCursor);
    return event;
}
static void NXTestPost(CGEventTapLocation tap, CGEventRef event) {
    CGPoint point = CGEventGetLocation(event);
    CGEventType type = CGEventGetType(event);
    if (type == kCGEventLeftMouseDown || type == kCGEventLeftMouseUp || type == kCGEventRightMouseDown
        || type == kCGEventRightMouseUp || type == kCGEventLeftMouseDragged || type == kCGEventScrollWheel) currentCursor = point;
    [events addObject:@{ @"type": @(CGEventGetType(event)), @"code": @(CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode)),
        @"flags": @(CGEventGetFlags(event)), @"x": @(point.x), @"y": @(point.y) }];
}
static CGEventRef NXTestKeyboard(CGEventSourceRef source, CGKeyCode code, bool down) {
    if (++keyboardCreates == failKeyboardAt) return NULL;
    return CGEventCreateKeyboardEvent(source, code, down);
}
static CGEventRef NXTestMouse(CGEventSourceRef source, CGEventType type, CGPoint point, CGMouseButton button) {
    if (++mouseCreates == failMouseAt) return NULL;
    return CGEventCreateMouseEvent(source, type, point, button);
}
static CGError NXTestWarp(CGPoint point) { warped = YES; warpedPoint = point; currentCursor = point; return kCGErrorSuccess; }
static CGError NXTestAssociate(bool connected) { return kCGErrorSuccess; }
static CGError NXTestShow(CGDirectDisplayID display) { return kCGErrorSuccess; }
static void NXTestUnicode(CGEventRef event, UniCharCount length, const UniChar *characters) {
    CGEventKeyboardSetUnicodeString(event, length, characters);
    UniChar actual[8]; UniCharCount count = 0;
    CGEventKeyboardGetUnicodeString(event, 8, &count, actual);
    [unicodePayloads addObject:[NSString stringWithCharacters:actual length:count]];
}
@interface NXTestPrevious : NSObject
@property (nonatomic) pid_t processIdentifier;
@property (nonatomic) BOOL restored;
- (BOOL)activateWithOptions:(NSApplicationActivationOptions)options;
@end
@implementation NXTestPrevious
- (BOOL)activateWithOptions:(NSApplicationActivationOptions)options { self.restored = YES; return YES; }
@end
@interface NXTestWorkspace : NSWorkspace
@end
@implementation NXTestWorkspace
+ (NSWorkspace *)sharedWorkspace { static NXTestWorkspace *workspace; if (!workspace) workspace = [NXTestWorkspace new]; return workspace; }
- (NSRunningApplication *)frontmostApplication { NXTestPrevious *app = [NXTestPrevious new]; app.processIdentifier = frontPid; return (NSRunningApplication *)(id)app; }
@end
#define CGEventCreate NXTestEventCreate
static void (^afterBackgroundPost)(void);
static void NXTestPostToPid(pid_t pid,CGEventRef event) {
    CGPoint saved=currentCursor; NXTestPost(kCGHIDEventTap,event); currentCursor=saved;
    if(pid!=77) abort();
    if(afterBackgroundPost)afterBackgroundPost();
}
#define CGEventPostToPid NXTestPostToPid
#define CGEventPost NXTestPost
#define CGEventCreateKeyboardEvent NXTestKeyboard
#define CGEventCreateMouseEvent NXTestMouse
#define CGWarpMouseCursorPosition NXTestWarp
#define CGAssociateMouseAndMouseCursorPosition NXTestAssociate
#define CGDisplayShowCursor NXTestShow
#define CGEventKeyboardSetUnicodeString NXTestUnicode
#define NSWorkspace NXTestWorkspace
#define main NextMuxUnusedHelperMain
#include SOURCE_FILE
#undef main
static void require(BOOL condition, NSString *message) { if (!condition) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); } }
static CGEventType typeAt(NSUInteger index) { return [events[index][@"type"] unsignedIntValue]; }
static int codeAt(NSUInteger index) { return [events[index][@"code"] intValue]; }
static CGEventFlags flagsAt(NSUInteger index) { return [events[index][@"flags"] unsignedLongLongValue]; }
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        events = [NSMutableArray array];
        unicodePayloads = [NSMutableArray array];
        inputSessions = [NSMutableDictionary dictionary];
        NSString *test = argc > 1 ? [NSString stringWithUTF8String:argv[1]] : @"";
        NXInputSession *session = newInputSession(@{});
        if ([test isEqualToString:@"cancel-ack"]) {
            inputSessions[@"n:1"]=session;
            __block BOOL released=NO;
            dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT,0), ^{
                while(!session.cancelled)[NSThread sleepForTimeInterval:0.001];
                [NSThread sleepForTimeInterval:0.02];
                @synchronized(inputSessions) { released=YES;[inputSessions removeObjectForKey:@"n:1"]; }
            });
            require([releaseInputs(@{@"targetId":@1})[@"ok"] boolValue] && released,@"cancellation acknowledgement must wait for release");
        } else if ([test isEqualToString:@"background-chord"] || [test isEqualToString:@"background-cancel"]) {
            session.background=YES;session.targetPid=77;session.targetWindow=99;
            if([test isEqual:@"background-cancel"])afterBackgroundPost=^{if(events.count==3)session.cancelled=YES;};
            NSDictionary *result=performInputAction(session, ^{ return axBackgroundKeys(@{@"keys":@[@"rightctrl",@"a",@"b"],@"holdMs":@40},session); });
            require([test isEqual:@"background-cancel"] ? [result[@"error"] isEqual:@"input_cancelled"] : [result[@"ok"] boolValue],@"background chord terminal state");
            require(events.count==6 && !session.held.count && !warped,@"background releases every key without physical cursor cleanup");
            NSArray *order=@[@62,@0,@11,@11,@0,@62];
            for(NSUInteger i=0;i<6;i++)require(codeAt(i)==[order[i] intValue],@"background reverse release order");
            require(flagsAt(5)==0 && currentCursor.x==400 && currentCursor.y==300,@"modifier and cursor remain clean");
        } else if ([test isEqualToString:@"modifiers"]) {
            NSArray *names = @[ @"ctrl", @"alt", @"shift", @"cmd" ];
            NSArray *expected = @[ @59, @58, @56, @55 ];
            for (NSUInteger index = 0; index < names.count; index++) {
                NSArray *codes = requestedKeyCodes(@{ @"key": names[index] });
                require([codes isEqualToArray:@[ expected[index] ]], @"modifier keycode");
                CGKeyCode code = [codes[0] unsignedShortValue];
                NSDictionary *result = performInputAction(session, ^{ pressKey(session, code, NULL, 0); return @{ @"ok": @YES }; });
                require([result[@"ok"] boolValue], @"modifier result");
                NSUInteger down = index * 2;
                require(typeAt(down) == kCGEventFlagsChanged && typeAt(down + 1) == kCGEventFlagsChanged, @"modifier uses flagsChanged twice");
                require(codeAt(down) == code && codeAt(down + 1) == code, @"matching modifier up keycode");
                require(flagsAt(down) == modifierForCode(code) && flagsAt(down + 1) == 0, @"modifier flags cleared");
            }
        } else if ([test isEqualToString:@"multi-key"]) {
            NSArray *codes = requestedKeyCodes(@{ @"keys": @[ @"left", @"alt", @"z", @"ctrl" ] });
            NSDictionary *result = performInputAction(session, ^{ for (NSNumber *code in codes) pressKey(session, code.unsignedShortValue, NULL, 0); return @{ @"ok": @YES }; });
            require([result[@"ok"] boolValue] && events.count == 8 && !session.held.count, @"all keys released");
            NSArray *order = @[ @123, @58, @6, @59, @59, @6, @58, @123 ];
            for (NSUInteger index = 0; index < order.count; index++) require(codeAt(index) == [order[index] intValue], @"reverse release order");
            require(flagsAt(3) == (kCGEventFlagMaskAlternate | kCGEventFlagMaskControl), @"combined flags");
            require(flagsAt(4) == kCGEventFlagMaskAlternate && flagsAt(6) == 0 && flagsAt(7) == 0, @"flags unwind with keys");
        } else if ([test isEqualToString:@"text-unicode"]) {
            NSDictionary *result = performInputAction(session, ^{ typeInputText(session, @"A!a中😀\n\t"); return @{ @"ok": @YES }; });
            require([result[@"ok"] boolValue] && !session.held.count, @"text releases all physical keys");
            require([unicodePayloads isEqualToArray:@[ @"A", @"A", @"!", @"!", @"a", @"a", @"中", @"中", @"😀", @"😀" ]], @"literal ASCII CJK and complete surrogate pairs survive native CGEvent payloads");
            require(codeAt(1) == 0 && codeAt(5) == 18 && codeAt(8) == 0, @"printable text retains physical US keycodes");
            require((flagsAt(1) & kCGEventFlagMaskShift) && (flagsAt(5) & kCGEventFlagMaskShift), @"uppercase and punctuation retain physical shift");
            require(typeAt(events.count - 4) == kCGEventKeyDown && codeAt(events.count - 4) == 36, @"newline remains Return key");
            require(typeAt(events.count - 2) == kCGEventKeyDown && codeAt(events.count - 2) == 48, @"tab remains Tab key");
        } else if ([test isEqualToString:@"window-coordinates"]) {
            CGRect frame = CGRectMake(-1800, -900, 800, 600);
            CGPoint origin = windowPoint(frame, CGPointMake(0, 0));
            CGPoint middle = windowPoint(frame, CGPointMake(.25, .5));
            CGPoint edge = windowPoint(frame, CGPointMake(1, 1));
            require(origin.x == -1800 && origin.y == -900, @"negative display origin retained");
            require(middle.x == -1600 && middle.y == -600, @"window fractions independent of screenshot resolution");
            require(edge.x == -1001 && edge.y == -301 && CGRectContainsPoint(frame, edge), @"right and bottom stay inside window");
            frame = CGRectMake(400, -300, 1600, 1200);
            middle = windowPoint(frame, CGPointMake(.25, .5));
            require(middle.x == 800 && middle.y == 300, @"moved resized window uses new frame");
            frame = CGRectMake(-10, -20, 1, 1);
            edge = windowPoint(frame, CGPointMake(1, 1));
            require(edge.x == -10 && edge.y == -20 && CGRectContainsPoint(frame, edge), @"single point window endpoints coincide");
            CGPoint parsed;
            require(ratioPoint(@{ @"x": @0, @"y": @1 }, &parsed), @"normalized endpoint accepted");
            require(!ratioPoint(@{ @"x": @(-.01), @"y": @0 }, &parsed) && !ratioPoint(@{ @"x": @0, @"y": @1.01 }, &parsed), @"outside fractions rejected");
            require(!ratioPoint(@{ @"x": @(NAN), @"y": @0 }, &parsed) && !ratioPoint(@{ @"x": @0, @"y": @(INFINITY) }, &parsed), @"non-finite fractions rejected");
            require(events.count == 0, @"coordinate math does not post input");
        } else if ([test isEqualToString:@"right-click"]) {
            NSDictionary *result = performInputAction(session, ^{ pressMouse(session, CGPointMake(20, 30), kCGMouseButtonRight, 1); return @{ @"ok": @YES }; });
            require([result[@"ok"] boolValue] && events.count == 2, @"right click pair");
            require(typeAt(0) == kCGEventRightMouseDown && typeAt(1) == kCGEventRightMouseUp, @"right button event types");
        } else if ([test isEqualToString:@"drag"]) {
            NSTimeInterval start = NSProcessInfo.processInfo.systemUptime;
            NSDictionary *result = performInputAction(session, ^{ dragMouse(session, CGPointMake(20, 30), CGPointMake(120, 230), 65); return @{ @"ok": @YES }; });
            require([result[@"ok"] boolValue] && events.count >= 3, @"drag result");
            require(NSProcessInfo.processInfo.systemUptime - start >= .065, @"drag hold duration");
            require(typeAt(0) == kCGEventLeftMouseDown && typeAt(events.count - 1) == kCGEventLeftMouseUp, @"drag down/up pair");
            double previous = 20;
            for (NSUInteger index = 1; index + 1 < events.count; index++) {
                require(typeAt(index) == kCGEventLeftMouseDragged, @"drag intermediate events");
                double x = [events[index][@"x"] doubleValue];
                require(x >= previous && x <= 120, @"drag interpolation"); previous = x;
            }
            require([events.lastObject[@"x"] doubleValue] == 120 && [events.lastObject[@"y"] doubleValue] == 230, @"release at endpoint");
        } else if ([test isEqualToString:@"keyboard-allocation"]) {
            failKeyboardAt = 3;
            NSDictionary *result = performInputAction(session, ^{ pressKey(session, 59, NULL, 0); pressKey(session, 6, NULL, 0); return @{ @"ok": @YES }; });
            require([result[@"error"] isEqualToString:@"input_event_failed"], @"allocation error reported");
            require(events.count == 2 && typeAt(1) == kCGEventFlagsChanged && flagsAt(1) == 0 && !session.held.count, @"preallocated modifier release survives allocation failure");
        } else if ([test isEqualToString:@"drag-allocation"]) {
            failMouseAt = 4;
            NSDictionary *result = performInputAction(session, ^{ dragMouse(session, CGPointMake(20, 30), CGPointMake(120, 230), 2000); return @{ @"ok": @YES }; });
            require([result[@"error"] isEqualToString:@"input_event_failed"], @"drag allocation error reported");
            require(events.count == 3 && typeAt(0) == kCGEventLeftMouseDown && typeAt(1) == kCGEventLeftMouseDragged && typeAt(2) == kCGEventLeftMouseUp, @"drag failure releases mouse");
            require([events[2][@"x"] isEqual:events[1][@"x"]] && [events[2][@"y"] isEqual:events[1][@"y"]] && !session.held.count, @"mouse releases at last delivered point");
        } else if ([test isEqualToString:@"deadline"]) {
            NXTestPrevious *previous = [NXTestPrevious new]; previous.processIdentifier = 10;
            session.previous = (NSRunningApplication *)(id)previous; session.targetPid = 11;
            session.cursor = CGPointMake(9, 7); session.restoreEnvironment = YES; session.hasInputEnvironment = YES; frontPid = 11;
            NSDictionary *result = performInputAction(session, ^{
                pressKey(session, 59, NULL, 0); pressMouse(session, CGPointMake(20, 30), kCGMouseButtonLeft, 1);
                session.deadline = NSProcessInfo.processInfo.systemUptime + .015;
                waitInput(session, 100); return @{ @"ok": @YES };
            });
            require([result[@"error"] isEqualToString:@"input_timeout"], @"deadline error reported");
            require(events.count == 4 && typeAt(2) == kCGEventLeftMouseUp && typeAt(3) == kCGEventFlagsChanged && flagsAt(3) == 0, @"deadline releases mouse and modifier");
            require(!session.held.count && !activeInput && warped && warpedPoint.x == 9 && warpedPoint.y == 7 && previous.restored, @"deadline restores input environment");
        } else if ([test isEqualToString:@"user-moved-cursor"]) {
            session.cursor = CGPointMake(9, 7); session.restoreEnvironment = YES; session.hasInputEnvironment = YES;
            NSDictionary *result = performInputAction(session, ^{
                pressMouse(session, CGPointMake(20, 30), kCGMouseButtonLeft, 1);
                currentCursor = CGPointMake(700, 500);
                return @{ @"ok": @YES };
            });
            require([result[@"ok"] boolValue] && !warped, @"user cursor move is not undone");
            require(events.count == 2 && [events.lastObject[@"x"] doubleValue] == 700 && [events.lastObject[@"y"] doubleValue] == 500, @"button release preserves user cursor instead of jumping back");
            require(currentCursor.x == 700 && currentCursor.y == 500 && !session.held.count, @"mouse release still happens");
        } else if ([test isEqualToString:@"user-switched-app"]) {
            NXTestPrevious *previous = [NXTestPrevious new]; previous.processIdentifier = 10;
            session.previous = (NSRunningApplication *)(id)previous; session.targetPid = 11;
            session.restoreEnvironment = YES; session.hasInputEnvironment = YES; frontPid = 12;
            NSDictionary *result = performInputAction(session, ^{ pressKey(session, 6, NULL, 0); return @{ @"ok": @YES }; });
            require([result[@"ok"] boolValue] && !previous.restored && !warped, @"user-selected frontmost application and cursor stay unchanged");
            require(events.count == 2 && typeAt(1) == kCGEventKeyUp, @"key is released despite app switch");
        } else if ([test isEqualToString:@"keyboard-preserves-cursor"]) {
            NXTestPrevious *previous = [NXTestPrevious new]; previous.processIdentifier = 10;
            session.previous = (NSRunningApplication *)(id)previous; session.targetPid = 11; frontPid = 11;
            session.cursor = CGPointMake(9, 7); session.restoreEnvironment = YES; session.hasInputEnvironment = YES;
            NSDictionary *result = performInputAction(session, ^{
                pressKey(session, 6, NULL, 0); currentCursor = CGPointMake(700, 500); return @{ @"ok": @YES };
            });
            require([result[@"ok"] boolValue] && !warped && previous.restored, @"keyboard cleanup restores owned app but never warps a cursor it did not move");
            require(currentCursor.x == 700 && currentCursor.y == 500, @"concurrent cursor move survives keyboard input");
        } else if ([test isEqualToString:@"cancel"]) {
            NXInputSession *other = newInputSession(@{});
            inputSessions[inputIdentifier(@1)] = session; inputSessions[inputIdentifier(@2)] = other;
            NSDictionary *result = performInputAction(session, ^{
                pressKey(session, 6, NULL, 0); cancelInput(@2); require(!session.cancelled && other.cancelled, @"cancel scoped to request id");
                cancelInput(@1); waitInput(session, 0); return @{ @"ok": @YES };
            });
            require([result[@"error"] isEqualToString:@"input_cancelled"] && events.count == 2 && typeAt(1) == kCGEventKeyUp, @"cancel releases input");
        } else if ([test isEqualToString:@"recovery"]) {
            NSDictionary *request = @{ @"targetId": @1, @"recovery": @YES, @"input": @{ @"op": @"keys", @"keys": @[ @"ctrl", @"z" ] } };
            inputSessions[inputIdentifier(@2)] = session;
            require([releaseInputs(request)[@"error"] isEqualToString:@"input_recovery_busy"] && !events.count, @"recovery never touches newer input");
            [inputSessions removeAllObjects];
            require([releaseInputs(request)[@"ok"] boolValue] && events.count == 2, @"crash recovery releases potential held keys");
            require(typeAt(0) == kCGEventKeyUp && codeAt(0) == 6 && typeAt(1) == kCGEventFlagsChanged && codeAt(1) == 59 && flagsAt(1) == 0, @"recovery posts only up events");
            require([releaseInputs(@{ @"targetId": @1 })[@"ok"] boolValue] && events.count == 2, @"ordinary stale release is harmless");
        } else if ([test isEqualToString:@"validation"]) {
            require(inputDuration(@{}, @"holdMs", 50, 0, 3000) == 50 && inputDuration(@{ @"holdMs": @0 }, @"holdMs", 50, 0, 3000) == 0, @"hold default and zero");
            require(inputDuration(@{}, @"durationMs", 300, 50, 2000) == 300, @"drag default");
            NSArray *invalid = @[ @{ @"key": @"z", @"keys": @[ @"x" ] }, @{ @"keys": @[] }, @{ @"keys": @[ @"a", @"b", @"c", @"d", @"e" ] } ];
            for (NSDictionary *request in invalid) {
                BOOL rejected = NO; @try { requestedKeyCodes(request); } @catch (NSException *error) { rejected = YES; }
                require(rejected, @"invalid keyboard shape rejected");
            }
            BOOL rejected = NO; @try { inputDuration(@{ @"durationMs": @49 }, @"durationMs", 300, 50, 2000); } @catch (NSException *error) { rejected = YES; }
            require(rejected && !events.count, @"invalid drag duration rejected before input");
        } else require(NO, @"unknown test");
        puts("ok");
    }
    return 0;
}
`;

describe('native display input event ownership (no HID)', { skip: process.platform !== 'darwin' }, () => {
  let directory;
  let executable;
  before(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'nextmux-native-input-test-'));
    const file = path.join(directory, 'input-test.m');
    executable = path.join(directory, 'input-test');
    writeFileSync(file, harness.replace('SOURCE_FILE', JSON.stringify(source)));
    execFileSync('xcrun', ['clang', '-fobjc-arc', '-O0', '-Wall', '-Werror', '-Wno-unused-parameter',
      '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-framework', 'CoreGraphics', '-framework', 'CoreAudio',
      // As scripts/build-native-display.mjs links it: plugin frames and text recognition.
      '-weak_framework', 'ScreenCaptureKit', '-framework', 'Vision', '-framework', 'CoreVideo',
      file, '-o', executable], { encoding: 'utf8', timeout: 90_000 });
  });
  after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  for (const name of ['cancel-ack', 'background-chord', 'background-cancel', 'modifiers', 'multi-key', 'text-unicode', 'window-coordinates', 'right-click', 'drag', 'keyboard-allocation', 'drag-allocation', 'deadline', 'user-moved-cursor', 'user-switched-app', 'keyboard-preserves-cursor', 'cancel', 'recovery', 'validation']) {
    it(name, () => assert.equal(execFileSync(executable, [name], { encoding: 'utf8', timeout: 10_000 }).trim(), 'ok'));
  }
});
