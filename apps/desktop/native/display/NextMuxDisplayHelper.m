// NextMux display helper (macOS).
//
// Hosts the app windows the AI works in on a virtual display that is not one of the user's screens, so those
// windows are seen only in the conversation's tab (streamed by NextMux) and never cover the user's desktop.
// The AI keeps controlling them in the background (the computer driver posts input to the window itself).
//
// CGVirtualDisplay is private CoreGraphics API (macOS 11+). The declarations below follow DeskPad
// (github.com/Stengo/DeskPad, MIT) and Chromium's virtual display test utility; _AXUIElementGetWindow maps an
// accessibility window to its CGWindowID the way window managers such as yabai and AeroSpace do.
//
// Sound: the tab's sound switch is off by default. "mute" silences an app (and its helper processes) with a Core
// Audio process tap whose mute behaviour is "muted" (macOS 14.2+); the tap only exists while this process runs,
// so the app's sound always comes back when NextMux quits.
//
// Input: pointer/keys use window-scoped AX actions and process-targeted CG events.
// Unsupported actions are rejected before any global event or activation. The
// legacy event-release machinery remains for draining/recovering earlier input.
//
// Following an app: windows the tab's app opens later (a chat popped out into its own window, a game a launcher
// starts) belong in tabs too. "watch" names the apps shown in tabs; the helper then reports each new window of those
// apps, their child processes and apps launched from them ({"type":"window"}), and when such a window closes.
//
// Protocol: one JSON object per line. On start the helper prints {"type":"ready"}; then it answers
// {"id","op":"park"|"unpark"|"mute"|"shield"|"pointer"|"keys"|"watch"|"status"} requests on stdin ("unpark" with "activate" also raises the window,
// which works for any window, parked or not). The display is created on the first "park" and lives only as long as this
// process: when NextMux quits or the pipe closes, macOS moves any window still on it back to a real screen.
#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Vision/Vision.h>
#include <libproc.h>
#include <os/lock.h>
#include <signal.h>

@class CGVirtualDisplay;
@interface CGVirtualDisplayDescriptor : NSObject
@property (retain, nonatomic) dispatch_queue_t queue;
@property (retain, nonatomic) NSString *name;
@property (nonatomic) unsigned int maxPixelsHigh;
@property (nonatomic) unsigned int maxPixelsWide;
@property (nonatomic) CGSize sizeInMillimeters;
@property (nonatomic) unsigned int serialNum;
@property (nonatomic) unsigned int productID;
@property (nonatomic) unsigned int vendorID;
@property (copy, nonatomic) void (^terminationHandler)(id, CGVirtualDisplay *);
@end
@interface CGVirtualDisplayMode : NSObject
- (instancetype)initWithWidth:(NSUInteger)width height:(NSUInteger)height refreshRate:(double)refreshRate;
@end
@interface CGVirtualDisplaySettings : NSObject
@property (retain, nonatomic) NSArray *modes;
@property (nonatomic) unsigned int hiDPI;
@end
@interface CGVirtualDisplay : NSObject
@property (readonly, nonatomic) CGDirectDisplayID displayID;
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@end
extern AXError _AXUIElementGetWindow(AXUIElementRef element, CGWindowID *identifier);

static CGVirtualDisplay *display;
static NSMutableDictionary<NSString *, NSValue *> *originalFrames;
static unsigned int displayWidth = 1920, displayHeight = 1200;

static void emit(NSDictionary *message) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
    if (!data) return;
    // Frames and text recognition reply from their own queue; one line at a time.
    @synchronized (NSFileHandle.class) {
        fwrite(data.bytes, 1, data.length, stdout);
        fputc('\n', stdout);
        fflush(stdout);
    }
}

// Every event this helper posts (the AI's and a plugin's input) carries this mark, so the keyboard-and-mouse lock
// below never stops NextMux's own input.
static const int64_t NMXEventMark = 0x4E4D5831;
static void postEvent(CGEventRef event) {
    CGEventSetIntegerValueField(event, kCGEventSourceUserData, NMXEventMark);
    CGEventPost(kCGHIDEventTap, event);
}

// Keyboard-and-mouse lock ("shield"): a tab's window shown on the desktop while the tab's 键鼠 switch is off takes
// no clicks, drags, scrolls or typing from the user; the AI keeps control. An event tap on its own thread (so a
// long AI input on the main queue never delays the user's input elsewhere) drops only those events: clicks whose
// window is locked, and keys for a locked app unless Command is held (app switching, quitting and the system's
// shortcuts always work). NextMux's own marked events pass. The tap goes away with the lock or this process.
static NSSet<NSNumber *> *shieldWindows, *shieldPids;
static os_unfair_lock shieldLock = OS_UNFAIR_LOCK_INIT;
static CFMachPortRef shieldTap;
static CFRunLoopRef shieldLoop;
static BOOL droppingMouse;
static double lastBlockedAt;

static void reportBlocked(int64_t windowId, int64_t pid) {
    double now = NSProcessInfo.processInfo.systemUptime;
    if (now - lastBlockedAt < 1.5) return;
    lastBlockedAt = now;
    emit(@{ @"type": @"input-blocked", @"windowId": @(windowId), @"pid": @(pid) });
}

static CGEventRef shieldCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *info) {
    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
        if (shieldTap) CGEventTapEnable(shieldTap, true);
        return event;
    }
    if (CGEventGetIntegerValueField(event, kCGEventSourceUserData) == NMXEventMark) return event;
    os_unfair_lock_lock(&shieldLock);
    NSSet<NSNumber *> *windows = shieldWindows, *pids = shieldPids;
    os_unfair_lock_unlock(&shieldLock);
    int64_t pid = CGEventGetIntegerValueField(event, kCGEventTargetUnixProcessID);
    switch (type) {
        case kCGEventLeftMouseDown: case kCGEventRightMouseDown: case kCGEventOtherMouseDown: {
            int64_t windowId = CGEventGetIntegerValueField(event, kCGMouseEventWindowUnderMousePointer);
            droppingMouse = windowId > 0 && [windows containsObject:@(windowId)];
            if (!droppingMouse) return event;
            reportBlocked(windowId, pid);
            return NULL;
        }
        case kCGEventLeftMouseDragged: case kCGEventRightMouseDragged: case kCGEventOtherMouseDragged:
            return droppingMouse ? NULL : event;
        case kCGEventLeftMouseUp: case kCGEventRightMouseUp: case kCGEventOtherMouseUp:
            if (!droppingMouse) return event;
            droppingMouse = NO;
            return NULL;
        case kCGEventScrollWheel: {
            int64_t windowId = CGEventGetIntegerValueField(event, kCGMouseEventWindowUnderMousePointer);
            return windowId > 0 && [windows containsObject:@(windowId)] ? NULL : event;
        }
        case kCGEventKeyDown: case kCGEventKeyUp:
            if (pid <= 0 || ![pids containsObject:@(pid)] || (CGEventGetFlags(event) & kCGEventFlagMaskCommand)) return event;
            if (type == kCGEventKeyDown) reportBlocked(0, pid);
            return NULL;
        default:
            return event;
    }
}

static BOOL startShield(void) {
    if (shieldTap) return YES;
    __block BOOL started = NO;
    dispatch_semaphore_t ready = dispatch_semaphore_create(0);
    [NSThread detachNewThreadWithBlock:^{
        CGEventMask mask = CGEventMaskBit(kCGEventLeftMouseDown) | CGEventMaskBit(kCGEventLeftMouseUp) | CGEventMaskBit(kCGEventLeftMouseDragged)
            | CGEventMaskBit(kCGEventRightMouseDown) | CGEventMaskBit(kCGEventRightMouseUp) | CGEventMaskBit(kCGEventRightMouseDragged)
            | CGEventMaskBit(kCGEventOtherMouseDown) | CGEventMaskBit(kCGEventOtherMouseUp) | CGEventMaskBit(kCGEventOtherMouseDragged)
            | CGEventMaskBit(kCGEventScrollWheel) | CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp);
        CFMachPortRef tap = CGEventTapCreate(kCGAnnotatedSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionDefault, mask, shieldCallback, NULL);
        if (!tap) { dispatch_semaphore_signal(ready); return; }
        CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(NULL, tap, 0);
        CFRunLoopRef loop = CFRunLoopGetCurrent();
        CFRunLoopAddSource(loop, source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
        shieldLoop = loop;
        shieldTap = tap;
        started = YES;
        dispatch_semaphore_signal(ready);
        CFRunLoopRun();
        CGEventTapEnable(tap, false);
        CFRunLoopRemoveSource(loop, source, kCFRunLoopCommonModes);
        CFRelease(source);
        CFMachPortInvalidate(tap);
        CFRelease(tap);
    }];
    dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2 * NSEC_PER_SEC)));
    return started;
}

static void stopShield(void) {
    CFRunLoopRef loop = shieldLoop;
    if (!shieldTap || !loop) return;
    CGEventTapEnable(shieldTap, false);
    shieldTap = NULL;
    shieldLoop = NULL;
    droppingMouse = NO;
    CFRunLoopStop(loop);
}

static NSSet<NSNumber *> *positiveNumbers(id value) {
    NSMutableSet<NSNumber *> *set = [NSMutableSet set];
    if (![value isKindOfClass:NSArray.class] || [value count] > 512) return set;
    for (id item in value) if ([item isKindOfClass:NSNumber.class] && [item longLongValue] > 0) [set addObject:@([item longLongValue])];
    return set;
}

static NSDictionary *shield(NSDictionary *request) {
    NSSet<NSNumber *> *windows = positiveNumbers(request[@"windows"]), *pids = positiveNumbers(request[@"pids"]);
    os_unfair_lock_lock(&shieldLock);
    shieldWindows = windows;
    shieldPids = pids;
    os_unfair_lock_unlock(&shieldLock);
    if (!windows.count && !pids.count) { stopShield(); return @{ @"ok": @YES, @"active": @NO }; }
    if (!AXIsProcessTrusted() || !startShield()) return @{ @"ok": @NO, @"error": @"shield_permission_required" };
    return @{ @"ok": @YES, @"active": @YES };
}

static NSDictionary *rectJSON(CGRect rect) {
    return @{ @"x": @(rect.origin.x), @"y": @(rect.origin.y), @"width": @(rect.size.width), @"height": @(rect.size.height) };
}

static BOOL online(CGDirectDisplayID target) {
    CGDirectDisplayID ids[32]; uint32_t count = 0;
    if (CGGetOnlineDisplayList(32, ids, &count) != kCGErrorSuccess) return NO;
    for (uint32_t index = 0; index < count; index++) if (ids[index] == target) return YES;
    return NO;
}

// Put the virtual display diagonally past the bottom-right corner of the user's screens: it touches them only at
// one point, so the pointer practically never wanders onto it and no real screen moves.
static void placeAwayFromUser(CGDirectDisplayID target) {
    CGDirectDisplayID ids[32]; uint32_t count = 0;
    if (CGGetActiveDisplayList(32, ids, &count) != kCGErrorSuccess) return;
    CGDirectDisplayID corner = 0; double best = -INFINITY;
    for (uint32_t index = 0; index < count; index++) {
        if (ids[index] == target) continue;
        CGRect bounds = CGDisplayBounds(ids[index]);
        double score = CGRectGetMaxX(bounds) + CGRectGetMaxY(bounds);
        if (score > best) { best = score; corner = ids[index]; }
    }
    if (!corner) return;
    CGRect anchor = CGDisplayBounds(corner);
    CGDisplayConfigRef config;
    if (CGBeginDisplayConfiguration(&config) != kCGErrorSuccess) return;
    CGConfigureDisplayOrigin(config, target, (int32_t)CGRectGetMaxX(anchor), (int32_t)CGRectGetMaxY(anchor));
    if (CGCompleteDisplayConfiguration(config, kCGConfigureForSession) != kCGErrorSuccess) CGCancelDisplayConfiguration(config);
}

static AXUIElementRef copyWindow(pid_t pid, CGWindowID windowId) {
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    CFArrayRef windows = NULL;
    AXUIElementRef found = NULL;
    if (AXUIElementCopyAttributeValue(application, kAXWindowsAttribute, (CFTypeRef *)&windows) == kAXErrorSuccess && windows) {
        for (CFIndex index = 0; index < CFArrayGetCount(windows) && !found; index++) {
            AXUIElementRef candidate = (AXUIElementRef)CFArrayGetValueAtIndex(windows, index);
            CGWindowID identifier = 0;
            if (_AXUIElementGetWindow(candidate, &identifier) == kAXErrorSuccess && identifier == windowId) found = (AXUIElementRef)CFRetain(candidate);
        }
        CFRelease(windows);
    }
    CFRelease(application);
    return found;
}

static BOOL frameOf(AXUIElementRef window, CGRect *frame) {
    CFTypeRef position = NULL, size = NULL;
    BOOL ok = AXUIElementCopyAttributeValue(window, kAXPositionAttribute, &position) == kAXErrorSuccess
        && AXUIElementCopyAttributeValue(window, kAXSizeAttribute, &size) == kAXErrorSuccess
        && position && size && CFGetTypeID(position) == AXValueGetTypeID() && CFGetTypeID(size) == AXValueGetTypeID()
        && AXValueGetType(position) == kAXValueCGPointType && AXValueGetType(size) == kAXValueCGSizeType
        && AXValueGetValue(position, kAXValueCGPointType, &frame->origin) && AXValueGetValue(size, kAXValueCGSizeType, &frame->size);
    if (position) CFRelease(position);
    if (size) CFRelease(size);
    return ok;
}

static void setFrame(AXUIElementRef window, CGRect frame, BOOL resize) {
    AXValueRef position = AXValueCreate(kAXValueCGPointType, &frame.origin);
    AXUIElementSetAttributeValue(window, kAXPositionAttribute, position);
    CFRelease(position);
    if (!resize) return;
    AXValueRef size = AXValueCreate(kAXValueCGSizeType, &frame.size);
    AXUIElementSetAttributeValue(window, kAXSizeAttribute, size);
    CFRelease(size);
    // Some apps apply the position only once the new size is in place.
    position = AXValueCreate(kAXValueCGPointType, &frame.origin);
    AXUIElementSetAttributeValue(window, kAXPositionAttribute, position);
    CFRelease(position);
}

static CGRect mainVisibleFrame(void) {
    NSScreen *screen = NSScreen.screens.firstObject;
    CGFloat mainHeight = screen.frame.size.height;
    NSRect visible = screen.visibleFrame;
    // AppKit counts from the bottom-left of the main screen; accessibility from its top-left.
    return CGRectMake(visible.origin.x, mainHeight - visible.origin.y - visible.size.height, visible.size.width, visible.size.height);
}

// Created on the first window to park, so a NextMux that only mirrors windows never adds a display.
static NSString *ensureDisplay(void) {
    if (display) return nil;
    if (!NSClassFromString(@"CGVirtualDisplay")) return @"unsupported_system";
    CGVirtualDisplayDescriptor *descriptor = [[NSClassFromString(@"CGVirtualDisplayDescriptor") alloc] init];
    descriptor.queue = dispatch_get_main_queue();
    descriptor.name = @"NextMux";
    descriptor.maxPixelsWide = displayWidth;
    descriptor.maxPixelsHigh = displayHeight;
    // About 24 inches at this size; only the pixel size matters to the windows placed here.
    descriptor.sizeInMillimeters = CGSizeMake(displayWidth * 0.2766, displayHeight * 0.2766);
    descriptor.productID = 0x4e4d;
    descriptor.vendorID = 0x4e58;
    descriptor.serialNum = 1;
    descriptor.terminationHandler = ^(id _unused, CGVirtualDisplay *_display) { emit(@{ @"type": @"ended" }); exit(0); };
    CGVirtualDisplay *created = [[NSClassFromString(@"CGVirtualDisplay") alloc] initWithDescriptor:descriptor];
    CGVirtualDisplaySettings *settings = [[NSClassFromString(@"CGVirtualDisplaySettings") alloc] init];
    // 1×: macOS offers a virtual display no Retina mode this large (its Retina modes stop at 960 points wide).
    settings.hiDPI = 0;
    settings.modes = @[ [[NSClassFromString(@"CGVirtualDisplayMode") alloc] initWithWidth:displayWidth height:displayHeight refreshRate:60] ];
    if (!created || !created.displayID || ![created applySettings:settings]) return @"display_failed";
    for (int attempt = 0; attempt < 50 && !online(created.displayID); attempt++) [NSThread sleepForTimeInterval:0.1];
    if (!online(created.displayID)) return @"display_offline";
    placeAwayFromUser(created.displayID);
    display = created;
    return nil;
}

// ---- Sound -------------------------------------------------------------------------------------------------

// Muted app → the tap that silences it and the Core Audio processes that tap covers.
static NSMutableDictionary<NSNumber *, NSNumber *> *muteTaps;
static NSMutableDictionary<NSNumber *, NSArray<NSNumber *> *> *mutedProcesses;
static BOOL listeningForProcesses;

static pid_t parentOf(pid_t pid) {
    struct proc_bsdinfo info;
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) == sizeof(info) ? (pid_t)info.pbi_ppid : 0;
}

// The app's own audio clients: its process, its child processes (Chromium and Electron apps play sound from a
// helper), and processes whose bundle id extends the app's.
static NSArray<NSNumber *> *audioProcessesOf(pid_t app) {
    AudioObjectPropertyAddress listAddress = { kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &listAddress, 0, NULL, &size) != noErr || !size) return @[];
    NSMutableData *data = [NSMutableData dataWithLength:size];
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &listAddress, 0, NULL, &size, data.mutableBytes) != noErr) return @[];
    NSString *bundle = [NSRunningApplication runningApplicationWithProcessIdentifier:app].bundleIdentifier;
    NSMutableArray<NSNumber *> *result = [NSMutableArray array];
    const AudioObjectID *objects = data.bytes;
    for (UInt32 index = 0; index < size / sizeof(AudioObjectID); index++) {
        pid_t pid = 0; UInt32 pidSize = sizeof(pid);
        AudioObjectPropertyAddress pidAddress = { kAudioProcessPropertyPID, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
        if (AudioObjectGetPropertyData(objects[index], &pidAddress, 0, NULL, &pidSize, &pid) != noErr || pid <= 0) continue;
        BOOL mine = pid == app || parentOf(pid) == app;
        if (!mine && bundle.length) {
            CFStringRef processBundle = NULL; UInt32 bundleSize = sizeof(processBundle);
            AudioObjectPropertyAddress bundleAddress = { kAudioProcessPropertyBundleID, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
            if (AudioObjectGetPropertyData(objects[index], &bundleAddress, 0, NULL, &bundleSize, &processBundle) == noErr && processBundle) {
                NSString *identifier = (__bridge NSString *)processBundle;
                mine = [identifier isEqualToString:bundle] || [identifier hasPrefix:[bundle stringByAppendingString:@"."]];
                CFRelease(processBundle);
            }
        }
        if (mine) [result addObject:@(objects[index])];
    }
    return [result sortedArrayUsingSelector:@selector(compare:)];
}

static void dropTap(NSNumber *app) {
    NSNumber *tap = muteTaps[app];
    if (tap) { if (@available(macOS 14.2, *)) AudioHardwareDestroyProcessTap(tap.unsignedIntValue); }
    [muteTaps removeObjectForKey:app];
    [mutedProcesses removeObjectForKey:app];
}

// (Re)build the tap of one muted app from its current audio clients. An app that has not opened audio yet has
// none; it is muted as soon as it does (see the process-list listener below).
static OSStatus tapApp(NSNumber *app) {
    if (@available(macOS 14.2, *)) {
        NSArray<NSNumber *> *processes = audioProcessesOf(app.intValue);
        if ([processes isEqualToArray:mutedProcesses[app] ?: @[]] && (muteTaps[app] || !processes.count)) return noErr;
        dropTap(app);
        mutedProcesses[app] = processes;
        if (!processes.count) return noErr;
        CATapDescription *description = [[CATapDescription alloc] initStereoMixdownOfProcesses:processes];
        description.name = @"NextMux";
        description.privateTap = YES;
        description.muteBehavior = CATapMuted;
        AudioObjectID tap = kAudioObjectUnknown;
        OSStatus status = AudioHardwareCreateProcessTap(description, &tap);
        if (status == noErr && tap != kAudioObjectUnknown) muteTaps[app] = @(tap);
        return status;
    }
    return kAudioHardwareUnsupportedOperationError;
}

static void listenForAudioProcesses(void) {
    if (listeningForProcesses) return;
    listeningForProcesses = YES;
    AudioObjectPropertyAddress listAddress = { kAudioHardwarePropertyProcessObjectList, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    AudioObjectAddPropertyListenerBlock(kAudioObjectSystemObject, &listAddress, dispatch_get_main_queue(), ^(UInt32 count, const AudioObjectPropertyAddress *addresses) {
        for (NSNumber *app in mutedProcesses.allKeys) tapApp(app);
    });
}

static NSDictionary *mute(NSDictionary *request) {
    NSNumber *pidValue = [request[@"pid"] isKindOfClass:NSNumber.class] ? request[@"pid"] : nil;
    if (!pidValue || pidValue.intValue <= 0) return @{ @"ok": @NO, @"error": @"window_required" };
    if (@available(macOS 14.2, *)) {
        NSNumber *app = @(pidValue.intValue);
        if (![request[@"muted"] boolValue]) { dropTap(app); return @{ @"ok": @YES, @"muted": @NO }; }
        listenForAudioProcesses();
        [mutedProcesses removeObjectForKey:app];
        OSStatus status = tapApp(app);
        if (status != noErr) { dropTap(app); return @{ @"ok": @NO, @"error": @"sound_permission_required", @"status": @(status) }; }
        return @{ @"ok": @YES, @"muted": @YES, @"processes": @(mutedProcesses[app].count) };
    }
    return @{ @"ok": @NO, @"error": @"sound_unsupported" };
}

// ---- The user's mouse ----------------------------------------------------------------------------------------

static CGRect windowBounds(CGWindowID windowId) {
    const void *ids[1] = { (const void *)(uintptr_t)windowId };
    CFArrayRef idList = CFArrayCreate(NULL, ids, 1, NULL);
    NSArray *list = CFBridgingRelease(CGWindowListCreateDescriptionFromArray(idList));
    CFRelease(idList);
    CGRect frame = CGRectNull;
    NSDictionary *bounds = [list.firstObject isKindOfClass:NSDictionary.class] ? list.firstObject[(id)kCGWindowBounds] : nil;
    if (bounds) CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)bounds, &frame);
    return frame;
}

// ---- Owned input sessions -------------------------------------------------------------------------------------

// Every down event owns a preallocated matching up event. Even an allocation failure in the next step can
// therefore release everything already pressed without allocating another event. Only the main queue posts
// events; the stdin thread may mark one specific queued/running session cancelled while a hold is in progress.
@interface NXHeldInput : NSObject
@property (nonatomic, assign) CGEventRef releaseEvent;
@property (nonatomic) CGEventFlags modifier;
@end
@implementation NXHeldInput
- (void)dealloc { if (_releaseEvent) CFRelease(_releaseEvent); }
@end

@interface NXInputSession : NSObject
@property BOOL background;
@property CGWindowID targetWindow;
@property (atomic) BOOL cancelled;
@property (nonatomic) NSTimeInterval deadline;
@property (nonatomic) CGEventFlags flags;
@property (nonatomic, strong) NSMutableArray<NXHeldInput *> *held;
@property (nonatomic, strong) NSRunningApplication *previous;
@property (nonatomic) CGPoint cursor;
@property (nonatomic) CGPoint postedPointer;
@property (nonatomic) BOOL hasPostedPointer;
@property (nonatomic) BOOL hasInputEnvironment;
@property (nonatomic) BOOL restoreEnvironment;
@property (nonatomic) pid_t targetPid;
@end
@implementation NXInputSession
@end

static NSMutableDictionary<NSString *, NXInputSession *> *inputSessions;
static NXInputSession *activeInput;
static volatile sig_atomic_t inputStopping;

static NSString *inputIdentifier(id value) {
    if ([value isKindOfClass:NSString.class]) return [@"s:" stringByAppendingString:value];
    if ([value isKindOfClass:NSNumber.class]) return [@"n:" stringByAppendingString:[value stringValue]];
    return nil;
}

static void cancelInput(id targetId) {
    NSString *target = inputIdentifier(targetId);
    @synchronized (inputSessions) { if (target) inputSessions[target].cancelled = YES; }
}

static NXInputSession *newInputSession(NSDictionary *request) {
    NXInputSession *session = [NXInputSession new];
    session.held = [NSMutableArray array];
    id value = request[@"deadlineMs"];
    double remaining = value ? ([value isKindOfClass:NSNumber.class] ? [value doubleValue] / 1000.0 - NSDate.date.timeIntervalSince1970 : 0) : 60;
    session.deadline = NSProcessInfo.processInfo.systemUptime + (isfinite(remaining) ? MAX(0, MIN(60, remaining)) : 0);
    return session;
}

static void inputFailure(NSString *code) {
    @throw [NSException exceptionWithName:@"NextMuxInputError" reason:code userInfo:nil];
}

static void checkInput(NXInputSession *session) {
    if (inputStopping || session.cancelled) inputFailure(@"input_cancelled");
    if (NSProcessInfo.processInfo.systemUptime >= session.deadline) inputFailure(@"input_timeout");
}

static void waitInput(NXInputSession *session, double milliseconds) {
    NSTimeInterval until = NSProcessInfo.processInfo.systemUptime + milliseconds / 1000.0;
    for (;;) {
        checkInput(session);
        double remaining = until - NSProcessInfo.processInfo.systemUptime;
        if (remaining <= 0) return;
        [NSThread sleepForTimeInterval:MIN(0.016, remaining)];
    }
}

static void postInputEvent(NXInputSession *session, CGEventRef event) {
    if (session.background) {
        CGEventSetIntegerValueField(event, kCGEventSourceUserData, 0x4E4D5558LL);
        CGEventSetIntegerValueField(event, (CGEventField)91, session.targetWindow);
        CGEventSetIntegerValueField(event, (CGEventField)92, session.targetWindow);
        CGEventPostToPid(session.targetPid, event);
        return;
    }
    CGEventType type = CGEventGetType(event);
    if (type == kCGEventLeftMouseDown || type == kCGEventLeftMouseUp || type == kCGEventRightMouseDown
        || type == kCGEventRightMouseUp || type == kCGEventLeftMouseDragged || type == kCGEventScrollWheel) {
        session.postedPointer = CGEventGetLocation(event);
        session.hasPostedPointer = YES;
    }
    postEvent(event);
}

static void releaseLastInput(NXInputSession *session) {
    NXHeldInput *held = session.held.lastObject;
    if (!held) return;
    session.flags = 0;
    for (NXHeldInput *other in session.held) if (other != held) session.flags |= other.modifier;
    CGEventSetFlags(held.releaseEvent, session.flags);
    postInputEvent(session, held.releaseEvent);
    [session.held removeLastObject];
}

static CGPoint lastValidUserCursor;
static BOOL hasValidUserCursor;

static BOOL pointOnVirtualDisplay(CGPoint point) {
    return display && online(display.displayID) && CGRectContainsPoint(CGDisplayBounds(display.displayID), point);
}

static CGPoint safeUserCursorFallback(void) {
    if (hasValidUserCursor && !pointOnVirtualDisplay(lastValidUserCursor)) return lastValidUserCursor;
    CGRect mainBounds = CGDisplayBounds(CGMainDisplayID());
    return CGPointMake(CGRectGetMidX(mainBounds), CGRectGetMidY(mainBounds));
}

static void recordUserCursorIfPhysical(CGPoint point) {
    if (!pointOnVirtualDisplay(point)) {
        lastValidUserCursor = point;
        hasValidUserCursor = YES;
    }
}

static void __attribute__((unused)) rescueCursorFromVirtualDisplay(void) {
    if (!display || activeInput) return;
    CGEventRef current = CGEventCreate(NULL);
    if (!current) return;
    CGPoint location = CGEventGetLocation(current);
    CFRelease(current);
    if (pointOnVirtualDisplay(location)) {
        CGWarpMouseCursorPosition(safeUserCursorFallback());
        CGAssociateMouseAndMouseCursorPosition(true);
        CGDisplayShowCursor(CGMainDisplayID());
    } else {
        recordUserCursorIfPhysical(location);
    }
}

static void cleanupInput(NXInputSession *session) {
    if (!session) return;
    if (session.background) {
        while (session.held.count) releaseLastInput(session);
        return;
    }
    // Capture before releasing buttons: an up event at the old gesture point can itself move the cursor.
    CGEventRef current = CGEventCreate(NULL);
    BOOL hasCursor = current != NULL;
    CGPoint nowPoint = current ? CGEventGetLocation(current) : CGPointZero;
    if (current) CFRelease(current);
    BOOL onVirtual = hasCursor && pointOnVirtualDisplay(nowPoint);
    BOOL ownsPointer = hasCursor && session.hasPostedPointer
        && fabs(nowPoint.x - session.postedPointer.x) <= 1 && fabs(nowPoint.y - session.postedPointer.y) <= 1;
    BOOL restoreCursor = onVirtual || (session.restoreEnvironment && ownsPointer);
    if (hasCursor && !ownsPointer && !onVirtual) {
        for (NXHeldInput *held in session.held) {
            CGEventType type = CGEventGetType(held.releaseEvent);
            if (type == kCGEventLeftMouseUp || type == kCGEventRightMouseUp)
                CGEventSetLocation(held.releaseEvent, nowPoint);
        }
    }
    @try {
        while (session.held.count) releaseLastInput(session);
    } @finally {
        @try {
            if (restoreCursor) {
                CGPoint target = !session.hasInputEnvironment || pointOnVirtualDisplay(session.cursor) ? safeUserCursorFallback() : session.cursor;
                CGWarpMouseCursorPosition(target);
                CGAssociateMouseAndMouseCursorPosition(true);
                CGDisplayShowCursor(CGMainDisplayID());
            } else if (hasCursor) recordUserCursorIfPhysical(nowPoint);
        } @finally {
            // A user who switched apps during the gesture owns the new frontmost app.
            if (session.restoreEnvironment && session.previous && session.previous.processIdentifier != session.targetPid
                && NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == session.targetPid)
                [session.previous activateWithOptions:0];
            session.restoreEnvironment = NO;
        }
    }
}

// A skill plugin running a game in the foreground keeps it in front between its many inputs ("keepFront"):
// nothing is handed back after each one, so the game does not flicker behind the previous app.
static BOOL keepFrontRequested(NSDictionary *request) {
    return [request[@"keepFront"] isKindOfClass:NSNumber.class] && [request[@"keepFront"] boolValue];
}

static void rememberInputEnvironment(NXInputSession *session, pid_t pid, BOOL keepFront) {
    checkInput(session);
    CGEventRef current = CGEventCreate(NULL);
    if (!current) inputFailure(@"input_event_failed");
    CGPoint currentPoint = CGEventGetLocation(current);
    CFRelease(current);
    recordUserCursorIfPhysical(currentPoint);
    session.cursor = pointOnVirtualDisplay(currentPoint) ? safeUserCursorFallback() : currentPoint;
    session.previous = NSWorkspace.sharedWorkspace.frontmostApplication;
    session.targetPid = pid;
    session.hasInputEnvironment = YES;
    session.restoreEnvironment = !keepFront;
}

static NXHeldInput *holdEvents(NXInputSession *session, CGEventRef down, CGEventRef up, CGEventFlags modifier) {
    if (!down || !up) {
        if (down) CFRelease(down);
        if (up) CFRelease(up);
        inputFailure(@"input_event_failed");
    }
    NXHeldInput *held = [NXHeldInput new];
    held.releaseEvent = up;
    held.modifier = modifier;
    @try {
        checkInput(session);
        session.flags |= modifier;
        CGEventSetFlags(down, session.flags);
        [session.held addObject:held];
        postInputEvent(session, down);
    } @finally {
        CFRelease(down);
    }
    return held;
}

static BOOL onVirtualDisplay(CGRect frame);
static void touchRoot(pid_t pid);

static BOOL ratioPoint(id value, CGPoint *point) {
    if (![value isKindOfClass:NSDictionary.class]) return NO;
    id x = value[@"x"], y = value[@"y"];
    if (![x isKindOfClass:NSNumber.class] || ![y isKindOfClass:NSNumber.class]) return NO;
    double fx = [x doubleValue], fy = [y doubleValue];
    if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return NO;
    *point = CGPointMake(fx, fy);
    return YES;
}

// Fractions are relative to the visible window, independent of thumbnail scale
// and display origin. A fraction of one means the last point inside the window,
// not the first point in its neighbour (CGRect's maximum edges are exclusive).
static CGPoint windowPoint(CGRect frame, CGPoint fraction) {
    return CGPointMake(frame.origin.x + MIN(fraction.x * frame.size.width, MAX(0, frame.size.width - 1)),
        frame.origin.y + MIN(fraction.y * frame.size.height, MAX(0, frame.size.height - 1)));
}

static double inputDuration(NSDictionary *request, NSString *name, double fallback, double minimum, double maximum) {
    id value = request[name];
    if (!value) return fallback;
    if (![value isKindOfClass:NSNumber.class] || !isfinite([value doubleValue]) || [value doubleValue] < minimum || [value doubleValue] > maximum)
        inputFailure(@"computer_input_invalid");
    return [value doubleValue];
}

static NXHeldInput *pressMouse(NXInputSession *session, CGPoint point, CGMouseButton button, int count) {
    BOOL right = button == kCGMouseButtonRight;
    CGEventRef down = CGEventCreateMouseEvent(NULL, right ? kCGEventRightMouseDown : kCGEventLeftMouseDown, point, button);
    CGEventRef up = CGEventCreateMouseEvent(NULL, right ? kCGEventRightMouseUp : kCGEventLeftMouseUp, point, button);
    if (down) CGEventSetIntegerValueField(down, kCGMouseEventClickState, count);
    if (up) CGEventSetIntegerValueField(up, kCGMouseEventClickState, count);
    return holdEvents(session, down, up, 0);
}

static void dragMouse(NXInputSession *session, CGPoint point, CGPoint finish, double duration) {
    NXHeldInput *held = pressMouse(session, point, kCGMouseButtonLeft, 1);
    NSTimeInterval start = NSProcessInfo.processInfo.systemUptime;
    for (;;) {
        double remaining = duration - (NSProcessInfo.processInfo.systemUptime - start) * 1000;
        waitInput(session, MAX(0, MIN(16, remaining)));
        double progress = MIN(1, (NSProcessInfo.processInfo.systemUptime - start) * 1000 / duration);
        CGPoint step = CGPointMake(point.x + (finish.x - point.x) * progress, point.y + (finish.y - point.y) * progress);
        CGEventRef event = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDragged, step, kCGMouseButtonLeft);
        if (!event) inputFailure(@"input_event_failed");
        @try {
            checkInput(session);
            CGEventSetLocation(held.releaseEvent, step);
            postInputEvent(session, event);
        } @finally { CFRelease(event); }
        if (progress >= 1) break;
    }
    releaseLastInput(session);
}

static NSDictionary * __attribute__((unused)) legacyPointer(NSDictionary *request, NXInputSession *session) {
    NSNumber *pidValue = [request[@"pid"] isKindOfClass:NSNumber.class] ? request[@"pid"] : nil;
    NSNumber *windowValue = [request[@"windowId"] isKindOfClass:NSNumber.class] ? request[@"windowId"] : nil;
    NSString *kind = [request[@"kind"] isKindOfClass:NSString.class] ? request[@"kind"] : @"";
    if (![@[ @"click", @"doubleClick", @"scroll", @"drag" ] containsObject:kind]) return @{ @"ok": @NO, @"error": @"computer_input_invalid" };
    BOOL drag = [kind isEqualToString:@"drag"];
    CGPoint from, to;
    if (!pidValue || !windowValue || pidValue.intValue <= 0 || !ratioPoint(drag ? request[@"from"] : request, &from)
        || (drag && !ratioPoint(request[@"to"], &to))) return @{ @"ok": @NO, @"error": @"computer_input_invalid" };
    NSString *button = request[@"button"] ?: @"left";
    if (![@[ @"left", @"right" ] containsObject:button] || (drag && ![button isEqualToString:@"left"])) return @{ @"ok": @NO, @"error": @"computer_input_invalid" };
    double duration = drag ? inputDuration(request, @"durationMs", 300, 50, 2000) : 0;
    if (!AXIsProcessTrusted()) return @{ @"ok": @NO, @"error": @"permission_required" };
    CGRect frame = windowBounds(windowValue.unsignedIntValue);
    if (CGRectIsNull(frame) || frame.size.width <= 0 || frame.size.height <= 0) return @{ @"ok": @NO, @"error": @"window_not_found" };
    rememberInputEnvironment(session, pidValue.intValue, keepFrontRequested(request));
    touchRoot(pidValue.intValue);
    NSRunningApplication *target = [NSRunningApplication runningApplicationWithProcessIdentifier:pidValue.intValue];
    if (!target || target.terminated) return @{ @"ok": @NO, @"error": @"window_not_found" };
    // A window on the user's screen or parked alongside other conversations' windows on the virtual display may be covered: raise it before posting input.
    AXUIElementRef window = copyWindow(pidValue.intValue, windowValue.unsignedIntValue);
    if (window) {
        AXUIElementSetAttributeValue(window, kAXMainAttribute, kCFBooleanTrue);
        AXUIElementPerformAction(window, kAXRaiseAction);
        CFRelease(window);
    }
    checkInput(session);
    if (![kind isEqualToString:@"scroll"] && !target.active) { [target activateWithOptions:0]; waitInput(session, 20); }
    // Activation or raising can move/resize a window; resolve the live frame
    // after that settles, immediately before posting the gesture.
    frame = windowBounds(windowValue.unsignedIntValue);
    if (CGRectIsNull(frame) || frame.size.width <= 0 || frame.size.height <= 0) return @{ @"ok": @NO, @"error": @"window_not_found" };
    CGPoint point = windowPoint(frame, from);
    if ([kind isEqualToString:@"scroll"]) {
        NSString *direction = [request[@"direction"] isKindOfClass:NSString.class] ? request[@"direction"] : @"down";
        if (![@[ @"up", @"down", @"left", @"right" ] containsObject:direction]) return @{ @"ok": @NO, @"error": @"computer_input_invalid" };
        int amount = MAX(1, MIN(10, [request[@"amount"] intValue] ?: 3));
        int vertical = [direction isEqualToString:@"up"] ? amount : [direction isEqualToString:@"down"] ? -amount : 0;
        int horizontal = [direction isEqualToString:@"left"] ? amount : [direction isEqualToString:@"right"] ? -amount : 0;
        CGEventRef scroll = CGEventCreateScrollWheelEvent2(NULL, kCGScrollEventUnitLine, 2, vertical, horizontal, 0);
        if (!scroll) inputFailure(@"input_event_failed");
        @try {
            checkInput(session);
            CGWarpMouseCursorPosition(point);
            CGEventSetLocation(scroll, point);
            postInputEvent(session, scroll);
        } @finally { CFRelease(scroll); }
        waitInput(session, 8);
    } else {
        if (drag) {
            CGPoint finish = windowPoint(frame, to);
            dragMouse(session, point, finish, duration);
        } else {
            pressMouse(session, point, [button isEqualToString:@"right"] ? kCGMouseButtonRight : kCGMouseButtonLeft,
                [kind isEqualToString:@"doubleClick"] ? 2 : 1);
            waitInput(session, 6);
            releaseLastInput(session);
        }
        waitInput(session, 6);
    }
    return @{ @"ok": @YES };
}

// ---- Keyboard -------------------------------------------------------------------------------------------------

static CGKeyCode keyCode(NSString *name, BOOL *found) {
    static NSDictionary<NSString *, NSNumber *> *codes;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        codes = @{ @"a": @0, @"s": @1, @"d": @2, @"f": @3, @"h": @4, @"g": @5, @"z": @6, @"x": @7, @"c": @8, @"v": @9, @"b": @11, @"q": @12,
            @"w": @13, @"e": @14, @"r": @15, @"y": @16, @"t": @17, @"1": @18, @"2": @19, @"3": @20, @"4": @21, @"6": @22, @"5": @23, @"=": @24,
            @"9": @25, @"7": @26, @"-": @27, @"8": @28, @"0": @29, @"]": @30, @"o": @31, @"u": @32, @"[": @33, @"i": @34, @"p": @35,
            @"enter": @36, @"return": @36, @"l": @37, @"j": @38, @"'": @39, @"k": @40, @";": @41, @"\\": @42, @",": @43, @"/": @44, @"n": @45,
            @"m": @46, @".": @47, @"tab": @48, @"space": @49, @"`": @50, @"backspace": @51, @"escape": @53, @"esc": @53,
            @"cmd": @55, @"command": @55, @"meta": @55, @"shift": @56, @"alt": @58, @"option": @58, @"ctrl": @59, @"control": @59,
            @"f1": @122, @"f2": @120, @"f3": @99, @"f4": @118, @"f5": @96, @"f6": @97, @"f7": @98, @"f8": @100, @"f9": @101, @"f10": @109,
            @"f11": @103, @"f12": @111, @"home": @115, @"pageup": @116, @"delete": @117, @"end": @119, @"pagedown": @121,
            @"left": @123, @"right": @124, @"down": @125, @"up": @126 };
    });
    NSNumber *code = [name isKindOfClass:NSString.class] ? codes[name.lowercaseString] : nil;
    *found = code != nil;
    return (CGKeyCode)code.unsignedShortValue;
}

static CGEventFlags modifierForCode(CGKeyCode code) {
    switch (code) {
        case 55: return kCGEventFlagMaskCommand;
        case 56: return kCGEventFlagMaskShift;
        case 58: return kCGEventFlagMaskAlternate;
        case 59: return kCGEventFlagMaskControl;
        default: return 0;
    }
}

static void pressKey(NXInputSession *session, CGKeyCode code, const UniChar *characters, UniCharCount length) {
    CGEventFlags modifier = modifierForCode(code);
    CGEventRef down = CGEventCreateKeyboardEvent(NULL, code, YES), up = CGEventCreateKeyboardEvent(NULL, code, NO);
    if (down && up) {
        if (modifier) { CGEventSetType(down, kCGEventFlagsChanged); CGEventSetType(up, kCGEventFlagsChanged); }
        if (length) { CGEventKeyboardSetUnicodeString(down, length, characters); CGEventKeyboardSetUnicodeString(up, length, characters); }
    }
    holdEvents(session, down, up, modifier);
}

// Returns the physical US-layout key for text; Unicode-only characters use keycode zero with a Unicode payload.
static CGKeyCode textKeyCode(unichar character, BOOL *found, BOOL *shift) {
    static NSString *const shifted = @"~!@#$%^&*()_+{}|:\"<>?";
    static NSString *const unshifted = @"`1234567890-=[]\\;',./";
    NSString *name = nil;
    *shift = NO;
    if (character == ' ') name = @"space";
    else if (character == '\n' || character == '\r') name = @"enter";
    else if (character == '\t') name = @"tab";
    else if (character >= 'A' && character <= 'Z') { name = [NSString stringWithFormat:@"%c", character + 32]; *shift = YES; }
    else if ((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9')) name = [NSString stringWithFormat:@"%c", character];
    else {
        NSRange at = [shifted rangeOfString:[NSString stringWithCharacters:&character length:1]];
        if (at.location != NSNotFound) { unichar base = [unshifted characterAtIndex:at.location]; name = [NSString stringWithCharacters:&base length:1]; *shift = YES; }
        else if ([unshifted rangeOfString:[NSString stringWithCharacters:&character length:1]].location != NSNotFound) name = [NSString stringWithCharacters:&character length:1];
    }
    return keyCode(name, found);
}

static NSArray<NSNumber *> *requestedKeyCodes(NSDictionary *request) {
    id text = request[@"text"], key = request[@"key"], keys = request[@"keys"], modifiers = request[@"modifiers"];
    if ((text != nil) + (key != nil) + (keys != nil) != 1 || (modifiers && ![modifiers isKindOfClass:NSArray.class])) inputFailure(@"computer_input_invalid");
    if (text && (![text isKindOfClass:NSString.class] || ![text length] || [text length] > 2000 || [modifiers count])) inputFailure(@"computer_input_invalid");
    if (key && (![key isKindOfClass:NSString.class] || ![key length])) inputFailure(@"computer_input_invalid");
    if (keys && (![keys isKindOfClass:NSArray.class] || [keys count] < 1 || [keys count] > 4)) inputFailure(@"computer_input_invalid");
    if ([modifiers count] > 4) inputFailure(@"computer_input_invalid");
    NSMutableArray<NSNumber *> *codes = [NSMutableArray array];
    for (id name in modifiers ?: @[]) {
        BOOL found = NO;
        CGKeyCode code = keyCode(name, &found);
        if (!found || !modifierForCode(code)) inputFailure(@"modifier_unknown");
        if (![codes containsObject:@(code)]) [codes addObject:@(code)];
    }
    for (id name in keys ?: (key ? @[ key ] : @[])) {
        BOOL found = NO;
        CGKeyCode code = keyCode(name, &found);
        if (!found) inputFailure(@"key_unknown");
        if (![codes containsObject:@(code)]) [codes addObject:@(code)];
    }
    return codes;
}

static void typeInputText(NXInputSession *session, NSString *text) {
    for (NSUInteger index = 0; index < text.length; index++) {
        checkInput(session);
        unichar character = [text characterAtIndex:index];
        BOOL found = NO, shift = NO;
        CGKeyCode code = textKeyCode(character, &found, &shift);
        if (shift) pressKey(session, 56, NULL, 0);
        UniChar characters[2] = { character, 0 };
        UniCharCount length = 1;
        if (!found && CFStringIsSurrogateHighCharacter(character) && index + 1 < text.length && CFStringIsSurrogateLowCharacter([text characterAtIndex:index + 1]))
            characters[length++] = [text characterAtIndex:++index];
        // Keep physical keycodes for apps that consume them, but give text
        // consumers the requested characters even on non-US keyboard layouts.
        // Return and Tab remain control-key events, not inserted text payloads.
        BOOL control = character == '\n' || character == '\r' || character == '\t';
        pressKey(session, code, control ? NULL : characters, control ? 0 : length);
        waitInput(session, 3);
        releaseLastInput(session);
        if (shift) releaseLastInput(session);
        waitInput(session, 4);
    }
}

static NSDictionary * __attribute__((unused)) legacyKeys(NSDictionary *request, NXInputSession *session) {
    NSArray<NSNumber *> *codes = requestedKeyCodes(request);
    double hold = inputDuration(request, @"holdMs", 50, 0, 3000);
    NSNumber *pidValue = [request[@"pid"] isKindOfClass:NSNumber.class] ? request[@"pid"] : nil;
    NSNumber *windowValue = [request[@"windowId"] isKindOfClass:NSNumber.class] ? request[@"windowId"] : nil;
    if (!pidValue || !windowValue || pidValue.intValue <= 0) return @{ @"ok": @NO, @"error": @"computer_input_invalid" };
    if (!AXIsProcessTrusted()) return @{ @"ok": @NO, @"error": @"permission_required" };
    CGRect frame = windowBounds(windowValue.unsignedIntValue);
    if (CGRectIsNull(frame)) return @{ @"ok": @NO, @"error": @"window_not_found" };
    NSRunningApplication *target = [NSRunningApplication runningApplicationWithProcessIdentifier:pidValue.intValue];
    if (!target || target.terminated) return @{ @"ok": @NO, @"error": @"window_not_found" };
    rememberInputEnvironment(session, pidValue.intValue, keepFrontRequested(request));
    touchRoot(pidValue.intValue);
    AXUIElementRef window = copyWindow(pidValue.intValue, windowValue.unsignedIntValue);
    if (window) {
        AXUIElementSetAttributeValue(window, kAXMainAttribute, kCFBooleanTrue);
        AXUIElementPerformAction(window, kAXRaiseAction);
        CFRelease(window);
    }
    checkInput(session);
    if (!target.active) { [target activateWithOptions:0]; waitInput(session, 24); }
    NSString *text = request[@"text"];
    if (text.length) {
        typeInputText(session, text);
    } else {
        for (NSNumber *code in codes) pressKey(session, code.unsignedShortValue, NULL, 0);
        waitInput(session, hold);
        while (session.held.count) releaseLastInput(session);
    }
    waitInput(session, 8);
    return @{ @"ok": @YES };
}

#include "NextMuxAXInput.h"

static NSDictionary *performInputAction(NXInputSession *session, NSDictionary *(^action)(void)) {
    if (!session.background) activeInput = session;
    @try {
        checkInput(session);
        return action();
    } @catch (NSException *error) {
        return @{ @"ok": @NO, @"error": [error.name isEqualToString:@"NextMuxInputError"] ? error.reason : @"input_failed" };
    } @finally {
        @try { cleanupInput(session); } @finally {
            if (!session.background) activeInput = nil;
        }
    }
}

static NSDictionary *performInput(NSDictionary *request) {
    NSString *identifier = inputIdentifier(request[@"id"]);
    NXInputSession *session;
    @synchronized (inputSessions) { session = identifier ? inputSessions[identifier] : nil; }
    if (!session) session = newInputSession(request);
    session.background = YES;
    session.targetPid = [request[@"pid"] intValue];
    session.targetWindow = [request[@"windowId"] unsignedIntValue];
    @try {
        return performInputAction(session, ^{ return semanticInput(request, session); });
    } @finally {
        @synchronized (inputSessions) { if (identifier && inputSessions[identifier] == session) [inputSessions removeObjectForKey:identifier]; }
    }
}

// A replacement helper can recover from a crashed helper by posting only up events for the failed request.
// The parent must do this before allowing another input. Never recover over any queued/active request here.
static NSDictionary *releaseInputs(NSDictionary *request) {
    if (![request[@"recovery"] boolValue]) {
        NSString *identifier = inputIdentifier(request[@"targetId"]);
        cancelInput(request[@"targetId"]);
        // Window input runs on independent queues. A cancel acknowledgement must follow its finally releases.
        double deadline = NSProcessInfo.processInfo.systemUptime + 3.5;
        for (;;) {
            @synchronized (inputSessions) { if (!identifier || !inputSessions[identifier]) return @{ @"ok": @YES, @"released": @YES }; }
            if (NSProcessInfo.processInfo.systemUptime >= deadline) return @{ @"ok": @NO, @"error": @"input_cleanup_failed" };
            [NSThread sleepForTimeInterval:0.005];
        }
    }
    @synchronized (inputSessions) {
        if (activeInput || inputSessions.count) return @{ @"ok": @NO, @"error": @"input_recovery_busy" };
    }
    NSDictionary *input = [request[@"input"] isKindOfClass:NSDictionary.class] ? request[@"input"] : nil;
    if (!input) return @{ @"ok": @NO, @"error": @"computer_input_invalid" };
    if ([input[@"delivery"] isEqual:@"semantic"]) return @{ @"ok": @YES, @"released": @YES };
    NXInputSession *session = newInputSession(@{});
    @try {
        if ([input[@"op"] isEqualToString:@"keys"]) {
            NSMutableOrderedSet<NSNumber *> *codes = [NSMutableOrderedSet orderedSetWithArray:requestedKeyCodes(input)];
            NSString *text = input[@"text"];
            for (NSUInteger index = 0; index < text.length; index++) {
                BOOL found = NO, shift = NO;
                CGKeyCode code = textKeyCode([text characterAtIndex:index], &found, &shift);
                if (shift) [codes addObject:@56];
                [codes addObject:@(code)];
            }
            for (NSNumber *value in codes) {
                CGKeyCode code = value.unsignedShortValue;
                NXHeldInput *held = [NXHeldInput new];
                held.releaseEvent = CGEventCreateKeyboardEvent(NULL, code, NO);
                if (!held.releaseEvent) inputFailure(@"input_event_failed");
                held.modifier = modifierForCode(code);
                session.flags |= held.modifier;
                if (held.modifier) CGEventSetType(held.releaseEvent, kCGEventFlagsChanged);
                [session.held addObject:held];
            }
        } else if ([input[@"op"] isEqualToString:@"pointer"]) {
            if (![input[@"kind"] isEqualToString:@"scroll"]) {
                NSString *button = input[@"button"] ?: @"left";
                if (![@[ @"left", @"right" ] containsObject:button]) inputFailure(@"computer_input_invalid");
                CGEventRef current = CGEventCreate(NULL);
                if (!current) inputFailure(@"input_event_failed");
                CGPoint point = CGEventGetLocation(current);
                CFRelease(current);
                BOOL right = [button isEqualToString:@"right"];
                NXHeldInput *held = [NXHeldInput new];
                held.releaseEvent = CGEventCreateMouseEvent(NULL, right ? kCGEventRightMouseUp : kCGEventLeftMouseUp, point, right ? kCGMouseButtonRight : kCGMouseButtonLeft);
                if (!held.releaseEvent) inputFailure(@"input_event_failed");
                [session.held addObject:held];
            }
        } else inputFailure(@"computer_input_invalid");
        return @{ @"ok": @YES, @"released": @YES, @"recovered": @YES };
    } @catch (NSException *error) {
        return @{ @"ok": @NO, @"error": [error.name isEqualToString:@"NextMuxInputError"] ? error.reason : @"input_failed" };
    } @finally { cleanupInput(session); }
}

static void stopInputSignal(int signal) { inputStopping = 1; }
static void cleanupAtExit(void) {
    cleanupInput(activeInput);
    for (NSNumber *app in [muteTaps.allKeys copy]) dropTap(app);
}

// ---- Following a tab's app ----------------------------------------------------------------------------------

// Root app (pid) → when the tab last acted on it (clicks, keys): an app launched soon after is the root's (a game
// started from a launcher's Play button).
static NSMutableDictionary<NSNumber *, NSDate *> *watchRoots;
static NSMutableDictionary<NSNumber *, NSNumber *> *launchedBy;   // launched app pid → root pid
static NSMutableSet<NSNumber *> *knownWindows;                    // windows seen already (reported or older)
static NSMutableDictionary<NSNumber *, NSNumber *> *followed;     // reported window → its owner pid
static NSTimer *watchTimer;
static id launchObserver;
static const NSTimeInterval LAUNCH_ADOPT_SECONDS = 60;

static void touchRoot(pid_t pid) {
    NSNumber *root = @(pid);
    if (watchRoots[root]) watchRoots[root] = [NSDate date];
}

// pid → the watched app it belongs to: itself, a child process of it, an app whose bundle id extends its own, or an
// app launched from it.
static NSNumber *rootOf(pid_t pid, NSDictionary<NSString *, NSNumber *> *rootBundles) {
    pid_t current = pid;
    for (int depth = 0; depth < 24 && current > 1; depth++) {
        if (watchRoots[@(current)]) return @(current);
        if (launchedBy[@(current)]) return launchedBy[@(current)];
        current = parentOf(current);
    }
    NSString *bundle = [NSRunningApplication runningApplicationWithProcessIdentifier:pid].bundleIdentifier;
    for (NSString *prefix in rootBundles) if (bundle.length > prefix.length && [bundle hasPrefix:[prefix stringByAppendingString:@"."]]) return rootBundles[prefix];
    return nil;
}

static void scanWindows(BOOL report) {
    if (!watchRoots.count) return;
    NSMutableDictionary<NSString *, NSNumber *> *rootBundles = [NSMutableDictionary dictionary];
    for (NSNumber *root in watchRoots) {
        NSString *bundle = [NSRunningApplication runningApplicationWithProcessIdentifier:root.intValue].bundleIdentifier;
        if (bundle.length) rootBundles[bundle] = root;
    }
    NSArray *list = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionAll | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
    NSMutableSet<NSNumber *> *present = [NSMutableSet set];
    for (NSDictionary *info in list) {
        NSNumber *windowId = info[(id)kCGWindowNumber], *owner = info[(id)kCGWindowOwnerPID];
        if (!windowId || !owner) continue;
        [present addObject:windowId];
        if ([knownWindows containsObject:windowId] || [info[(id)kCGWindowLayer] intValue] != 0) continue;
        CGRect frame; CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &frame);
        // Menus, tooltips and half-built windows are small; the next scan sees the window once it has its size.
        if (frame.size.width < 160 || frame.size.height < 100 || ![info[(id)kCGWindowIsOnscreen] boolValue] || [info[(id)kCGWindowAlpha] doubleValue] <= 0) continue;
        NSNumber *root = rootOf(owner.intValue, rootBundles);
        if (!root) continue;
        [knownWindows addObject:windowId];
        if (!report) continue;
        followed[windowId] = owner;
        NSString *title = [info[(id)kCGWindowName] isKindOfClass:NSString.class] ? info[(id)kCGWindowName] : @"";
        NSString *app = [info[(id)kCGWindowOwnerName] isKindOfClass:NSString.class] ? info[(id)kCGWindowOwnerName] : @"";
        emit(@{ @"type": @"window", @"root": root, @"pid": owner, @"windowId": windowId, @"title": title, @"app": app });
    }
    for (NSNumber *windowId in followed.allKeys) {
        if ([present containsObject:windowId]) continue;
        emit(@{ @"type": @"window-closed", @"pid": followed[windowId], @"windowId": windowId });
        [followed removeObjectForKey:windowId];
        [knownWindows removeObject:windowId];
    }
}

static NSDictionary *watch(NSDictionary *request) {
    NSArray *roots = [request[@"roots"] isKindOfClass:NSArray.class] ? request[@"roots"] : @[];
    NSMutableDictionary<NSNumber *, NSDate *> *next = [NSMutableDictionary dictionary];
    for (id value in roots) if ([value isKindOfClass:NSNumber.class] && [value intValue] > 0) next[@([value intValue])] = watchRoots[@([value intValue])] ?: [NSDate distantPast];
    BOOL fresh = NO;
    for (NSNumber *root in next) if (!watchRoots[root]) fresh = YES;
    watchRoots = next;
    // Windows already open when an app starts being followed are not "new": only later ones are reported.
    if (fresh) scanWindows(NO);
    if (watchRoots.count && !watchTimer) {
        watchTimer = [NSTimer scheduledTimerWithTimeInterval:0.8 repeats:YES block:^(NSTimer *timer) { scanWindows(YES); }];
    } else if (!watchRoots.count && watchTimer) {
        [watchTimer invalidate]; watchTimer = nil;
        [knownWindows removeAllObjects]; [followed removeAllObjects]; [launchedBy removeAllObjects];
    }
    if (!launchObserver) {
        launchObserver = [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidLaunchApplicationNotification object:nil
            queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            NSRunningApplication *launched = note.userInfo[NSWorkspaceApplicationKey];
            if (!launched || watchRoots[@(launched.processIdentifier)]) return;
            // The most recently used root that was acted on within the last minute launched it.
            NSNumber *best = nil; NSDate *latest = [NSDate dateWithTimeIntervalSinceNow:-LAUNCH_ADOPT_SECONDS];
            for (NSNumber *root in watchRoots) if ([watchRoots[root] compare:latest] == NSOrderedDescending) { latest = watchRoots[root]; best = root; }
            if (best) launchedBy[@(launched.processIdentifier)] = best;
        }];
    }
    return @{ @"ok": @YES, @"roots": @(watchRoots.count) };
}

// ---- Windows on the virtual display ------------------------------------------------------------------------

static BOOL onVirtualDisplay(CGRect frame) {
    return display && CGRectContainsPoint(CGDisplayBounds(display.displayID), frame.origin);
}

// Skill plugins read a tab's window many times a second: "frame" takes one picture of the window with
// ScreenCaptureKit (macOS 14+) and writes its raw 32-bit BGRA pixels to a file NextMux named in its private frames
// folder, so no image has to travel through this pipe. "ocr" reads text in parts of that file with Vision.
static BOOL framePathAllowed(id value) {
    return [value isKindOfClass:NSString.class] && [value hasPrefix:@"/"] && [value hasSuffix:@".bgra"]
        && [value rangeOfString:@"/nextmux-frames-"].location != NSNotFound && [value rangeOfString:@".."].location == NSNotFound;
}

static NSMutableDictionary<NSNumber *, id> *frameWindows;
static NSMutableDictionary<NSNumber *, NSNumber *> *frameWindowsAt;

static NSDictionary *captureFrame(NSDictionary *request) API_AVAILABLE(macos(14.0)) {
    NSNumber *windowValue = [request[@"windowId"] isKindOfClass:NSNumber.class] ? request[@"windowId"] : nil;
    NSString *path = request[@"path"];
    if (!windowValue || !framePathAllowed(path)) return @{ @"ok": @NO, @"error": @"frame_request_invalid" };
    double maxWidth = [request[@"maxWidth"] isKindOfClass:NSNumber.class] ? MAX(160, MIN(2048, [request[@"maxWidth"] doubleValue])) : 1024;
    CGWindowID windowId = windowValue.unsignedIntValue;
    __block SCWindow *window = nil;
    @synchronized (frameWindows) {
        // The shareable-content list is the slow part; a window found in the last five seconds is reused.
        NSNumber *at = frameWindowsAt[windowValue];
        if (at && NSProcessInfo.processInfo.systemUptime - at.doubleValue < 5) window = frameWindows[windowValue];
    }
    if (!window) {
        dispatch_semaphore_t listed = dispatch_semaphore_create(0);
        [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:NO completionHandler:^(SCShareableContent *content, NSError *error) {
            for (SCWindow *item in content.windows) if (item.windowID == windowId) { window = item; break; }
            dispatch_semaphore_signal(listed);
        }];
        if (dispatch_semaphore_wait(listed, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3 * NSEC_PER_SEC)))) return @{ @"ok": @NO, @"error": @"frame_timeout" };
        if (!window) return @{ @"ok": @NO, @"error": @"window_not_capturable" };
        @synchronized (frameWindows) { frameWindows[windowValue] = window; frameWindowsAt[windowValue] = @(NSProcessInfo.processInfo.systemUptime); }
    }
    SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:window];
    CGRect frame = window.frame;
    if (frame.size.width < 2 || frame.size.height < 2) return @{ @"ok": @NO, @"error": @"window_not_capturable" };
    double scale = MIN(1.0, maxWidth / frame.size.width) * MAX(1.0, filter.pointPixelScale);
    scale = MIN(scale, maxWidth / frame.size.width);
    size_t width = (size_t)MAX(1, round(frame.size.width * scale)), height = (size_t)MAX(1, round(frame.size.height * scale));
    SCStreamConfiguration *configuration = [SCStreamConfiguration new];
    configuration.width = width; configuration.height = height;
    configuration.showsCursor = NO;
    configuration.pixelFormat = kCVPixelFormatType_32BGRA;
    __block NSDictionary *result = @{ @"ok": @NO, @"error": @"frame_failed" };
    dispatch_semaphore_t captured = dispatch_semaphore_create(0);
    [SCScreenshotManager captureImageWithFilter:filter configuration:configuration completionHandler:^(CGImageRef image, NSError *error) {
        if (image) {
            size_t stride = width * 4;
            NSMutableData *pixels = [NSMutableData dataWithLength:stride * height];
            CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            CGContextRef context = CGBitmapContextCreate(pixels.mutableBytes, width, height, 8, stride, space,
                kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
            CGColorSpaceRelease(space);
            if (context) {
                CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
                CGContextRelease(context);
                if ([pixels writeToFile:path options:NSDataWritingAtomic error:nil]) result = @{ @"ok": @YES, @"width": @(width), @"height": @(height), @"stride": @(stride) };
            }
        } else if (error) {
            @synchronized (frameWindows) { [frameWindows removeObjectForKey:windowValue]; }
            result = @{ @"ok": @NO, @"error": error.code == -3801 ? @"capture_permission_required" : @"frame_failed" };
        }
        dispatch_semaphore_signal(captured);
    }];
    if (dispatch_semaphore_wait(captured, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3 * NSEC_PER_SEC)))) return @{ @"ok": @NO, @"error": @"frame_timeout" };
    return result;
}

static NSDictionary *recognizeText(NSDictionary *request) {
    NSString *path = request[@"path"];
    NSNumber *widthValue = request[@"width"], *heightValue = request[@"height"];
    NSArray *rects = request[@"rects"];
    if (!framePathAllowed(path) || ![widthValue isKindOfClass:NSNumber.class] || ![heightValue isKindOfClass:NSNumber.class]
        || ![rects isKindOfClass:NSArray.class] || rects.count < 1 || rects.count > 16) return @{ @"ok": @NO, @"error": @"ocr_request_invalid" };
    size_t width = widthValue.unsignedIntegerValue, height = heightValue.unsignedIntegerValue, stride = width * 4;
    NSData *pixels = [NSData dataWithContentsOfFile:path];
    if (!pixels || width < 1 || height < 1 || pixels.length < stride * height) return @{ @"ok": @NO, @"error": @"ocr_frame_missing" };
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)pixels);
    CGImageRef image = CGImageCreate(width, height, 8, 32, stride, space, kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little, provider, NULL, NO, kCGRenderingIntentDefault);
    CGDataProviderRelease(provider);
    CGColorSpaceRelease(space);
    if (!image) return @{ @"ok": @NO, @"error": @"ocr_frame_missing" };
    NSArray *languages = [request[@"languages"] isKindOfClass:NSArray.class] ? request[@"languages"] : @[ @"zh-Hans", @"en-US" ];
    NSMutableArray *texts = [NSMutableArray array];
    NSMutableArray *boxes = [NSMutableArray array];
    for (id rect in rects) {
        NSArray *box = [rect isKindOfClass:NSArray.class] && [rect count] == 4 ? rect : nil;
        if (!box) { [texts addObject:@""]; [boxes addObject:@[]]; continue; }
        double rx = [box[0] doubleValue], ry = [box[1] doubleValue], rw = [box[2] doubleValue], rh = [box[3] doubleValue];
        CGRect crop = CGRectMake(round(rx * width), round(ry * height),
            MAX(1, round(rw * width)), MAX(1, round(rh * height)));
        CGImageRef part = CGImageCreateWithImageInRect(image, crop);
        if (!part) { [texts addObject:@""]; [boxes addObject:@[]]; continue; }
        VNRecognizeTextRequest *recognize = [VNRecognizeTextRequest new];
        recognize.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        recognize.usesLanguageCorrection = NO;
        recognize.recognitionLanguages = languages;
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:part options:@{}];
        NSError *error = nil;
        NSMutableArray *lines = [NSMutableArray array];
        NSMutableArray *items = [NSMutableArray array];
        if ([handler performRequests:@[ recognize ] error:&error]) {
            for (VNRecognizedTextObservation *observation in recognize.results) {
                VNRecognizedText *best = [observation topCandidates:1].firstObject;
                if (best.string.length) {
                    [lines addObject:best.string];
                    CGRect ob = observation.boundingBox;
                    double cx = MIN(1.0, MAX(0.0, rx + CGRectGetMidX(ob) * rw));
                    double cy = MIN(1.0, MAX(0.0, ry + (1.0 - CGRectGetMidY(ob)) * rh));
                    [items addObject:@{
                        @"text": [best.string substringToIndex:MIN(200, best.string.length)],
                        @"x": @(round(cx * 10000.0) / 10000.0),
                        @"y": @(round(cy * 10000.0) / 10000.0)
                    }];
                }
            }
        }
        CGImageRelease(part);
        NSString *joined = [lines componentsJoinedByString:@" "];
        [texts addObject:[joined substringToIndex:MIN(500, joined.length)]];
        [boxes addObject:items];
    }
    CGImageRelease(image);
    return @{ @"ok": @YES, @"texts": texts, @"boxes": boxes };
}

// Quit an app the way ⌘Q does (it may ask to save first); never a forced kill, never NextMux or the system's own apps.
static NSDictionary *quitApp(NSDictionary *request) {
    NSNumber *pidValue = [request[@"pid"] isKindOfClass:NSNumber.class] ? request[@"pid"] : nil;
    if (!pidValue || pidValue.intValue <= 1) return @{ @"ok": @NO, @"error": @"pid_required" };
    pid_t pid = pidValue.intValue;
    if (pid == getpid() || pid == getppid()) return @{ @"ok": @NO, @"error": @"refused" };
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    if (!app || app.terminated) return @{ @"ok": @YES, @"quit": @NO, @"gone": @YES };
    NSString *bundle = app.bundleIdentifier.lowercaseString ?: @"";
    NSArray<NSString *> *system = @[ @"com.apple.finder", @"com.apple.dock", @"com.apple.systemuiserver", @"com.apple.loginwindow", @"com.apple.controlcenter" ];
    if ([system containsObject:bundle] || [bundle hasPrefix:@"com.nextmux"]) return @{ @"ok": @NO, @"error": @"refused" };
    return @{ @"ok": @YES, @"quit": @([app terminate]) };
}

static NSDictionary *handle(NSDictionary *request) {
    NSString *op = [request[@"op"] isKindOfClass:NSString.class] ? request[@"op"] : @"";
    if ([op isEqualToString:@"mute"]) return mute(request);
    if ([op isEqualToString:@"shield"]) return shield(request);
    if ([op isEqualToString:@"pointer"] || [op isEqualToString:@"keys"]) return performInput(request);
    if ([op isEqualToString:@"releaseInputs"]) return releaseInputs(request);
    if ([op isEqualToString:@"watch"]) return watch(request);
    if ([op isEqualToString:@"quit"]) return quitApp(request);
    if ([op isEqualToString:@"touch"]) {
        NSNumber *pidValue = [request[@"pid"] isKindOfClass:NSNumber.class] ? request[@"pid"] : nil;
        if (pidValue) touchRoot(pidValue.intValue);
        return @{ @"ok": @YES };
    }
    if ([op isEqualToString:@"status"]) return display ? @{ @"ok": @YES, @"displayId": @(display.displayID), @"bounds": rectJSON(CGDisplayBounds(display.displayID)) } : @{ @"ok": @YES };
    NSNumber *pidValue = [request[@"pid"] isKindOfClass:NSNumber.class] ? request[@"pid"] : nil;
    NSNumber *windowValue = [request[@"windowId"] isKindOfClass:NSNumber.class] ? request[@"windowId"] : nil;
    if (!pidValue || !windowValue || pidValue.intValue <= 0) return @{ @"ok": @NO, @"error": @"window_required" };
    if (!AXIsProcessTrusted()) return @{ @"ok": @NO, @"error": @"permission_required" };
    AXUIElementRef window = copyWindow(pidValue.intValue, windowValue.unsignedIntValue);
    if (!window) return @{ @"ok": @NO, @"error": @"window_not_found" };
    NSString *key = [NSString stringWithFormat:@"%@:%@", pidValue, windowValue];
    CGRect current;
    NSDictionary *result = @{ @"ok": @NO, @"error": @"window_frame_unavailable" };
    if (frameOf(window, &current)) {
        NSString *failure = [op isEqualToString:@"park"] ? ensureDisplay() : nil;
        if (failure) {
            result = @{ @"ok": @NO, @"error": failure };
        } else if ([op isEqualToString:@"park"]) {
            CGRect bounds = CGDisplayBounds(display.displayID);
            if (!CGRectContainsPoint(bounds, current.origin)) originalFrames[key] = [NSValue valueWithRect:NSRectFromCGRect(current)];
            // Leave room for the display's own menu bar; shrink only what does not fit.
            CGRect target = CGRectMake(bounds.origin.x + 16, bounds.origin.y + 48, MIN(current.size.width, bounds.size.width - 32), MIN(current.size.height, bounds.size.height - 64));
            setFrame(window, target, !CGSizeEqualToSize(target.size, current.size));
            CGRect placed = current; frameOf(window, &placed);
            result = @{ @"ok": @(CGRectContainsPoint(bounds, placed.origin)), @"frame": rectJSON(placed), @"error": CGRectContainsPoint(bounds, placed.origin) ? [NSNull null] : @"window_not_moved" };
        } else if ([op isEqualToString:@"unpark"]) {
            // Only a window on the virtual display moves; one already on the user's screens stays where it is.
            if (onVirtualDisplay(current)) {
                NSValue *saved = originalFrames[key];
                CGRect visible = mainVisibleFrame();
                CGRect target = saved ? NSRectToCGRect(saved.rectValue) : CGRectMake(visible.origin.x + MAX(0, (visible.size.width - current.size.width) / 2),
                    visible.origin.y + MAX(0, (visible.size.height - current.size.height) / 2), MIN(current.size.width, visible.size.width), MIN(current.size.height, visible.size.height));
                // A saved spot on a screen that is gone would leave the window nowhere visible.
                BOOL onScreen = NO;
                CGFloat mainHeight = NSScreen.screens.firstObject.frame.size.height;
                for (NSScreen *screen in NSScreen.screens) {
                    CGRect frame = CGRectMake(screen.frame.origin.x, mainHeight - screen.frame.origin.y - screen.frame.size.height, screen.frame.size.width, screen.frame.size.height);
                    NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
                    if (number.unsignedIntValue != display.displayID && CGRectContainsPoint(frame, target.origin)) onScreen = YES;
                }
                if (!onScreen) target.origin = CGPointMake(visible.origin.x + 40, visible.origin.y + 40);
                setFrame(window, target, !CGSizeEqualToSize(target.size, current.size));
            }
            [originalFrames removeObjectForKey:key];
            if ([request[@"activate"] boolValue]) {
                AXUIElementPerformAction(window, kAXRaiseAction);
                [[NSRunningApplication runningApplicationWithProcessIdentifier:pidValue.intValue] activateWithOptions:0];
            }
            CGRect placed = current; frameOf(window, &placed);
            result = @{ @"ok": @YES, @"frame": rectJSON(placed) };
        } else {
            result = @{ @"ok": @NO, @"error": @"unknown_op" };
        }
    }
    CFRelease(window);
    return result;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        for (int index = 1; index + 1 < argc; index++) {
            if (!strcmp(argv[index], "--width")) displayWidth = (unsigned int)MAX(640, MIN(3840, atoi(argv[index + 1])));
            if (!strcmp(argv[index], "--height")) displayHeight = (unsigned int)MAX(480, MIN(2160, atoi(argv[index + 1])));
        }
        originalFrames = [NSMutableDictionary dictionary];
        muteTaps = [NSMutableDictionary dictionary];
        watchRoots = [NSMutableDictionary dictionary];
        launchedBy = [NSMutableDictionary dictionary];
        knownWindows = [NSMutableSet set];
        followed = [NSMutableDictionary dictionary];
        mutedProcesses = [NSMutableDictionary dictionary];
        inputSessions = [NSMutableDictionary dictionary];
        frameWindows = [NSMutableDictionary dictionary];
        frameWindowsAt = [NSMutableDictionary dictionary];
        signal(SIGTERM, stopInputSignal);
        signal(SIGINT, stopInputSignal);
        signal(SIGPIPE, SIG_IGN);
        atexit(cleanupAtExit);
        [NSTimer scheduledTimerWithTimeInterval:0.05 repeats:YES block:^(NSTimer *timer) {
            if (inputStopping) {
                @synchronized (inputSessions) { if (!inputSessions.count) exit(0); }
            }
            // Background tab input never owns or relocates the physical cursor.
        }];
        emit(@{ @"type": @"ready", @"accessibility": @(AXIsProcessTrusted()) });

        // Keep reading while the main queue holds a key: cancellation/EOF must be observable during the hold.
        // Replies are still serialized on the main queue, so cancellation is acknowledged only after cleanup.
        [NSThread detachNewThreadWithBlock:^{
            char *line = NULL; size_t capacity = 0; ssize_t length;
            while ((length = getline(&line, &capacity, stdin)) > 0) {
                if (length > 65536) continue;
                NSData *data = [NSData dataWithBytes:line length:(NSUInteger)length];
                id request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                if (![request isKindOfClass:NSDictionary.class]) continue;
                NSString *op = [request[@"op"] isKindOfClass:NSString.class] ? request[@"op"] : @"";
                NSString *identifier = inputIdentifier(request[@"id"]);
                if ([op isEqualToString:@"pointer"] || [op isEqualToString:@"keys"]) {
                    @synchronized (inputSessions) {
                        if (identifier && !inputSessions[identifier]) inputSessions[identifier] = newInputSession(request);
                    }
                } else if ([op isEqualToString:@"releaseInputs"]) {
                    cancelInput(request[@"targetId"]);
                }
                if ([op isEqualToString:@"pointer"] || [op isEqualToString:@"keys"]) {
                    static NSMutableDictionary *queues, *contexts;
                    if (!queues) { queues = [NSMutableDictionary dictionary]; contexts = [NSMutableDictionary dictionary]; }
                    NSString *key = [NSString stringWithFormat:@"%@:%@", request[@"pid"], request[@"windowId"]];
                    dispatch_queue_t queue = queues[key];
                    if (!queue) {
                        queue = dispatch_queue_create("app.nextmux.display.window-input", DISPATCH_QUEUE_SERIAL);
                        queues[key] = queue; contexts[key] = [NSMutableDictionary dictionary];
                    }
                    NSMutableDictionary *context = contexts[key];
                    dispatch_async(queue, ^{
                        @autoreleasepool {
                            NSThread.currentThread.threadDictionary[@"NextMuxInputState"] = context;
                            NSMutableDictionary *reply = [performInput(request) mutableCopy];
                            [NSThread.currentThread.threadDictionary removeObjectForKey:@"NextMuxInputState"];
                            if (request[@"id"]) reply[@"id"] = request[@"id"];
                            reply[@"type"] = @"reply"; emit(reply);
                        }
                    });
                    continue;
                }
                if ([op isEqualToString:@"frame"] || [op isEqualToString:@"ocr"]) {
                    // Pictures and text recognition must not hold up keys and clicks on the main queue.
                    static dispatch_queue_t pictures;
                    static dispatch_once_t once;
                    dispatch_once(&once, ^{ pictures = dispatch_queue_create("app.nextmux.display.frames", DISPATCH_QUEUE_SERIAL); });
                    dispatch_async(pictures, ^{
                        NSDictionary *result;
                        @try {
                            if ([op isEqualToString:@"ocr"]) result = recognizeText(request);
                            else if (@available(macOS 14.0, *)) result = captureFrame(request);
                            else result = @{ @"ok": @NO, @"error": @"frame_unsupported" };
                        }
                        @catch (NSException *error) { result = @{ @"ok": @NO, @"error": @"helper_request_failed" }; }
                        NSMutableDictionary *reply = [result mutableCopy];
                        if (request[@"id"]) reply[@"id"] = request[@"id"];
                        reply[@"type"] = @"reply";
                        emit(reply);
                    });
                    continue;
                }
                dispatch_async(dispatch_get_main_queue(), ^{
                    NSDictionary *result;
                    @try { result = inputStopping ? @{ @"ok": @NO, @"error": @"input_cancelled" } : handle(request); }
                    @catch (NSException *error) { result = @{ @"ok": @NO, @"error": @"helper_request_failed" }; }
                    NSMutableDictionary *reply = [result mutableCopy];
                    if (request[@"id"]) reply[@"id"] = request[@"id"];
                    reply[@"type"] = @"reply";
                    emit(reply);
                });
            }
            free(line);
            // NextMux went away: end the display; macOS returns its windows to a real screen.
            inputStopping = 1;
            for (;;) {
                @synchronized (inputSessions) { if (!inputSessions.count) break; }
                [NSThread sleepForTimeInterval:0.01];
            }
            dispatch_async(dispatch_get_main_queue(), ^{ exit(0); });
        }];
        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
