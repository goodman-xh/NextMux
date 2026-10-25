// Window-scoped AX and process-targeted CG events; never activate or post into global HID.
static NSMutableDictionary *axInputState(NSString *name) {
    NSMutableDictionary *context = NSThread.currentThread.threadDictionary[@"NextMuxInputState"];
    if (!context) { context = [NSMutableDictionary dictionary]; NSThread.currentThread.threadDictionary[@"NextMuxInputState"] = context; }
    if (!context[name]) context[name] = [NSMutableDictionary dictionary];
    return context[name];
}
#define semanticTargets axInputState(@"targets")
#define semanticClickPoints axInputState(@"points")
#define axPreparedPids axInputState(@"prepared")
static id axRead(AXUIElementRef element, CFStringRef attribute) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess) return nil;
    return CFBridgingRelease(value);
}
static BOOL axSettable(AXUIElementRef element, CFStringRef attribute) {
    Boolean writable = false;
    return AXUIElementIsAttributeSettable(element, attribute, &writable) == kAXErrorSuccess && writable;
}
static BOOL axHasAction(AXUIElementRef element, CFStringRef action) {
    CFArrayRef names = NULL;
    BOOL supported = AXUIElementCopyActionNames(element, &names) == kAXErrorSuccess && names
        && CFArrayContainsValue(names, CFRangeMake(0, CFArrayGetCount(names)), action);
    if (names) CFRelease(names);
    return supported;
}
static BOOL axBelongsToWindow(AXUIElementRef element, AXUIElementRef window, pid_t pid) {
    pid_t actual = 0;
    if (AXUIElementGetPid(element, &actual) != kAXErrorSuccess || actual != pid) return NO;
    id at = (__bridge id)element;
    for (NSUInteger depth = 0; at && depth < 40; depth++) {
        if (CFEqual((__bridge CFTypeRef)at, window)) return YES;
        at = axRead((__bridge AXUIElementRef)at, kAXParentAttribute);
    }
    return NO;
}
static BOOL axIsEditableRole(NSString *role) {
    return !role || [@[ @"AXTextField", @"AXTextArea", @"AXSearchField", @"AXComboBox" ] containsObject:role];
}
static NSInteger axSemanticScore(AXUIElementRef element) {
    NSString *role = [axRead(element, kAXRoleAttribute) isKindOfClass:NSString.class] ? axRead(element, kAXRoleAttribute) : nil;
    BOOL pressable = axHasAction(element, kAXPressAction) || axHasAction(element, kAXShowMenuAction);
    if (!role && !pressable) return 0;
    if (pressable || (role && [@[ @"AXButton", @"AXLink", @"AXTextField", @"AXTextArea", @"AXSearchField", @"AXComboBox", @"AXCheckBox", @"AXRadioButton", @"AXPopUpButton", @"AXMenuItem" ] containsObject:role])) return 3;
    if (role && [@[ @"AXStaticText", @"AXImage" ] containsObject:role]) return 2;
    if (role && ![@[ @"AXGroup", @"AXGenericElement", @"AXUnknown" ] containsObject:role]) return 1;
    return 0;
}
#ifndef AX_INPUT_SLEEP
#define AX_INPUT_SLEEP(sec) [NSThread sleepForTimeInterval:(sec)]
#endif
static CGKeyCode axKeyCode(NSString *name, BOOL *found) {
    static NSDictionary<NSString *, NSNumber *> *codes;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        codes = @{ @"a": @0, @"s": @1, @"d": @2, @"f": @3, @"h": @4, @"g": @5, @"z": @6, @"x": @7, @"c": @8, @"v": @9, @"b": @11, @"q": @12,
            @"w": @13, @"e": @14, @"r": @15, @"y": @16, @"t": @17, @"1": @18, @"2": @19, @"3": @20, @"4": @21, @"6": @22, @"5": @23, @"=": @24,
            @"9": @25, @"7": @26, @"-": @27, @"8": @28, @"0": @29, @"]": @30, @"o": @31, @"u": @32, @"[": @33, @"i": @34, @"p": @35,
            @"enter": @36, @"return": @36, @"l": @37, @"j": @38, @"'": @39, @"k": @40, @";": @41, @"\\": @42, @",": @43, @"/": @44, @"n": @45,
            @"m": @46, @".": @47, @"tab": @48, @"space": @49, @"`": @50, @"backspace": @51, @"escape": @53, @"esc": @53,
            @"win": @55, @"leftcmd": @55, @"leftcommand": @55, @"leftmeta": @55, @"leftwin": @55, @"lwin": @55, @"rightcmd": @54, @"rightcommand": @54, @"rightmeta": @54, @"rightwin": @54, @"rwin": @54,
            @"leftshift": @56, @"lshift": @56, @"rightshift": @60, @"rshift": @60, @"leftalt": @58, @"leftoption": @58, @"lalt": @58, @"rightalt": @61, @"rightoption": @61, @"ralt": @61,
            @"leftctrl": @59, @"leftcontrol": @59, @"lctrl": @59, @"lcontrol": @59, @"rightctrl": @62, @"rightcontrol": @62, @"rctrl": @62, @"rcontrol": @62, @"cmd": @55, @"command": @55, @"meta": @55, @"shift": @56, @"alt": @58, @"option": @58, @"ctrl": @59, @"control": @59,
            @"f1": @122, @"f2": @120, @"f3": @99, @"f4": @118, @"f5": @96, @"f6": @97, @"f7": @98, @"f8": @100, @"f9": @101, @"f10": @109,
            @"f11": @103, @"f12": @111, @"home": @115, @"pageup": @116, @"delete": @117, @"end": @119, @"pagedown": @121,
            @"arrowleft": @123, @"arrowright": @124, @"arrowdown": @125, @"arrowup": @126, @"left": @123, @"right": @124, @"down": @125, @"up": @126 };
    });
    NSNumber *code = [name isKindOfClass:NSString.class] ? codes[name.lowercaseString] : nil;
    *found = code != nil;
    return (CGKeyCode)code.unsignedShortValue;
}
static void axEnsureTreeReady(pid_t pid, AXUIElementRef window) {
    double now = CFAbsoluteTimeGetCurrent();
    NSNumber *last = axPreparedPids[@(pid)];
    if (!last || now - last.doubleValue > 5.0) {
        AXUIElementRef app = AXUIElementCreateApplication(pid);
        if (app) {
            AXUIElementSetAttributeValue(app, CFSTR("AXManualAccessibility"), kCFBooleanTrue);
            AXUIElementSetAttributeValue(app, CFSTR("AXEnhancedUserInterface"), kCFBooleanTrue);
            CFRelease(app);
        }
        axPreparedPids[@(pid)] = @(now);
    }
    NSMutableArray *queue = [NSMutableArray arrayWithObject:@{ @"element": (__bridge id)window, @"depth": @0 }];
    NSUInteger scanned = 0;
    while (queue.count && scanned < 120) {
        NSDictionary *item = queue.firstObject; [queue removeObjectAtIndex:0];
        AXUIElementRef el = (__bridge AXUIElementRef)item[@"element"];
        NSUInteger depth = [item[@"depth"] unsignedIntegerValue];
        scanned++;
        NSString *role = axRead(el, kAXRoleAttribute);
        NSString *title = axRead(el, kAXTitleAttribute);
        if ([role isKindOfClass:NSString.class] && [role isEqualToString:@"AXButton"]
            && [title isKindOfClass:NSString.class] && [title isEqualToString:@"开启读屏标签"]) {
            AXUIElementPerformAction(el, kAXPressAction);
            AX_INPUT_SLEEP(0.15);
            break;
        }
        if (depth >= 5) continue;
        id children = axRead(el, kAXChildrenAttribute);
        if ([children isKindOfClass:NSArray.class]) {
            for (id child in children) [queue addObject:@{ @"element": child, @"depth": @(depth + 1) }];
        }
    }
}
static AXUIElementRef axFindEditableInWindow(AXUIElementRef window, CGPoint nearPoint, BOOL hasPoint) {
    NSMutableArray *pending = [NSMutableArray arrayWithObject:@{ @"element": (__bridge id)window, @"depth": @0 }];
    id best = nil;
    double bestDist = 1e18;
    NSUInteger visited = 0;
    while (pending.count && visited < 2500) {
        visited++;
        NSDictionary *item = pending.lastObject; [pending removeLastObject];
        AXUIElementRef el = (__bridge AXUIElementRef)item[@"element"];
        NSUInteger depth = [item[@"depth"] unsignedIntegerValue];
        CGRect frame = CGRectNull;
        BOOL hasFrame = frameOf(el, &frame);
        if (depth >= 1 && (!hasFrame || frame.size.width <= 0 || frame.size.height <= 0)) continue;
        BOOL collapsedWrapper = frame.size.height <= 2 && frame.size.width > 40
            && nearPoint.x >= frame.origin.x - 96 && nearPoint.x <= CGRectGetMaxX(frame) + 96
            && nearPoint.y >= frame.origin.y - 96;
        if (hasPoint && depth >= 3 && !collapsedWrapper && !CGRectContainsPoint(CGRectInset(frame, -96, -96), nearPoint)) continue;
        NSString *role = axRead(el, kAXRoleAttribute);
        if ([role isKindOfClass:NSString.class] && [@[ @"AXTextArea", @"AXTextField", @"AXSearchField", @"AXComboBox" ] containsObject:role]
            && frame.size.width > 16 && frame.size.height > 8) {
            double dist = hasPoint ? hypot(CGRectGetMidX(frame) - nearPoint.x, CGRectGetMidY(frame) - nearPoint.y) : 0;
            if (hasPoint && CGRectContainsPoint(CGRectInset(frame, -16, -16), nearPoint)) dist = 0;
            if (!best || dist <= bestDist) {
                best = (__bridge id)el;
                bestDist = dist;
            }
        }
        if (depth >= 28) continue;
        id children = axRead(el, kAXChildrenAttribute);
        if ([children isKindOfClass:NSArray.class]) {
            for (id child in children) [pending addObject:@{ @"element": child, @"depth": @(depth + 1) }];
        }
    }
    return best ? (AXUIElementRef)CFRetain((__bridge CFTypeRef)best) : NULL;
}
static void axPrepareWindowFocus(AXUIElementRef window) {
    if (window) {
    }
}
static BOOL axPostMouseClickToPid(pid_t pid, CGWindowID windowId, CGPoint screenPoint, NSString *button, int clickCount) {
    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStatePrivate);
    if (src) CGEventSourceSetUserData(src, 0x4E4D5558ULL);
    BOOL right = [button isEqualToString:@"right"];
    BOOL middle = [button isEqualToString:@"middle"];
    CGMouseButton mouseButton = right ? kCGMouseButtonRight : middle ? kCGMouseButtonCenter : kCGMouseButtonLeft;
    CGEventType downType = right ? kCGEventRightMouseDown : middle ? kCGEventOtherMouseDown : kCGEventLeftMouseDown;
    CGEventType upType = right ? kCGEventRightMouseUp : middle ? kCGEventOtherMouseUp : kCGEventLeftMouseUp;
    CGEventRef move = CGEventCreateMouseEvent(src, kCGEventMouseMoved, screenPoint, mouseButton);
    if (move) {
        CGEventSetIntegerValueField(move, kCGEventSourceUserData, 0x4E4D5558LL);
        CGEventSetIntegerValueField(move, (CGEventField)91, windowId);
        CGEventSetIntegerValueField(move, (CGEventField)92, windowId);
        CGEventPostToPid(pid, move);
        CFRelease(move);
        AX_INPUT_SLEEP(0.01);
    }
    int total = MAX(1, MIN(3, clickCount));
    for (int c = 1; c <= total; c++) {
        CGEventRef down = CGEventCreateMouseEvent(src, downType, screenPoint, mouseButton);
        CGEventRef up = CGEventCreateMouseEvent(src, upType, screenPoint, mouseButton);
        if (!down || !up) {
            if (down) CFRelease(down);
            if (up) CFRelease(up);
            if (src) CFRelease(src);
            return NO;
        }
        CGEventSetIntegerValueField(down, kCGEventSourceUserData, 0x4E4D5558LL);
        CGEventSetIntegerValueField(up, kCGEventSourceUserData, 0x4E4D5558LL);
        CGEventSetIntegerValueField(down, kCGMouseEventClickState, c);
        CGEventSetIntegerValueField(up, kCGMouseEventClickState, c);
        CGEventSetIntegerValueField(down, (CGEventField)91, windowId);
        CGEventSetIntegerValueField(down, (CGEventField)92, windowId);
        CGEventSetIntegerValueField(up, (CGEventField)91, windowId);
        CGEventSetIntegerValueField(up, (CGEventField)92, windowId);
        @try { CGEventPostToPid(pid, down); AX_INPUT_SLEEP(0.02); }
        @finally { CGEventPostToPid(pid, up); }
        CFRelease(down);
        CFRelease(up);
        if (c < total) AX_INPUT_SLEEP(0.03);
    }
    if (src) CFRelease(src);
    return YES;
}
static void axBlurEditableIfNeeded(AXUIElementRef window, pid_t pid, NSString *targetKey) {
    if (targetKey && semanticTargets[targetKey]) {
        AXUIElementRef rem = (__bridge AXUIElementRef)semanticTargets[targetKey];
        NSString *remRole = axRead(rem, kAXRoleAttribute);
        if ([remRole isKindOfClass:NSString.class] && [@[ @"AXTextArea", @"AXTextField", @"AXSearchField", @"AXComboBox" ] containsObject:remRole]) {
            [semanticTargets removeObjectForKey:targetKey];
        }
    }
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    if (app) {
        id focused = axRead(app, kAXFocusedUIElementAttribute);
        CFRelease(app);
        if (focused && axBelongsToWindow((__bridge AXUIElementRef)focused, window, pid)) {
            NSString *role = axRead((__bridge AXUIElementRef)focused, kAXRoleAttribute);
            if ([role isKindOfClass:NSString.class] && [@[ @"AXTextArea", @"AXTextField", @"AXSearchField", @"AXComboBox" ] containsObject:role]) {
            }
        }
    }
    NSMutableArray *queue = [NSMutableArray arrayWithObject:@{ @"element": (__bridge id)window, @"depth": @0 }];
    NSUInteger scanned = 0;
    id bestWebArea = nil;
    while (queue.count && scanned < 120) {
        NSDictionary *item = queue.firstObject; [queue removeObjectAtIndex:0];
        AXUIElementRef el = (__bridge AXUIElementRef)item[@"element"];
        NSUInteger depth = [item[@"depth"] unsignedIntegerValue];
        scanned++;
        NSString *role = axRead(el, kAXRoleAttribute);
        if ([role isKindOfClass:NSString.class] && [role isEqualToString:@"AXWebArea"]) {
            bestWebArea = (__bridge id)el;
        }
        if (depth >= 9) continue;
        id children = axRead(el, kAXChildrenAttribute);
        if ([children isKindOfClass:NSArray.class]) {
            for (id child in children) [queue addObject:@{ @"element": child, @"depth": @(depth + 1) }];
        }
    }
    if (bestWebArea) {
        AX_INPUT_SLEEP(0.03);
    }
}
static BOOL axPostUnicodeToPid(pid_t pid, NSString *text, NXInputSession *session) {
    if (!text.length) return NO;
    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStatePrivate);
    if (src) CGEventSourceSetUserData(src, 0x4E4D5558ULL);
    NSUInteger offset = 0;
    @try {
    while (offset < text.length) {
        checkInput(session);
        NSUInteger len = MIN((NSUInteger)20, text.length - offset);
        if (offset + len < text.length && CFStringIsSurrogateHighCharacter([text characterAtIndex:offset + len - 1])) len++;
        UniChar buffer[24];
        [text getCharacters:buffer range:NSMakeRange(offset, len)];
        CGEventRef down = CGEventCreateKeyboardEvent(src, 0, true);
        CGEventRef up = CGEventCreateKeyboardEvent(src, 0, false);
        if (!down || !up) {
            if (down) CFRelease(down);
            if (up) CFRelease(up);
            return NO;
        }
        CGEventSetIntegerValueField(down, kCGEventSourceUserData, 0x4E4D5558LL);
        CGEventSetIntegerValueField(up, kCGEventSourceUserData, 0x4E4D5558LL);
        CGEventSetFlags(down, 0);
        CGEventSetFlags(up, 0);
        CGEventKeyboardSetUnicodeString(down, len, buffer);
        CGEventKeyboardSetUnicodeString(up, len, buffer);
        @try { CGEventPostToPid(pid, down); AX_INPUT_SLEEP(0.01); }
        @finally { CGEventPostToPid(pid, up); }
        CFRelease(down);
        CFRelease(up);
        offset += len;
        if (offset < text.length) AX_INPUT_SLEEP(0.01);
    }
    } @finally { if (src) CFRelease(src); }
    return YES;
}
static BOOL axPostKeyToPid(pid_t pid, CGKeyCode code, NSString *keyName) {
    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStatePrivate);
    if (src) CGEventSourceSetUserData(src, 0x4E4D5558ULL);
    CGEventRef down = CGEventCreateKeyboardEvent(src, code, true);
    CGEventRef up = CGEventCreateKeyboardEvent(src, code, false);
    if (!down || !up) {
        if (down) CFRelease(down);
        if (up) CFRelease(up);
        if (src) CFRelease(src);
        return NO;
    }
    CGEventSetIntegerValueField(down, kCGEventSourceUserData, 0x4E4D5558LL);
    CGEventSetIntegerValueField(up, kCGEventSourceUserData, 0x4E4D5558LL);
    CGEventSetFlags(down, 0);
    CGEventSetFlags(up, 0);
    if (keyName.length == 1) {
        UniChar ch = [keyName characterAtIndex:0];
        CGEventKeyboardSetUnicodeString(down, 1, &ch);
        CGEventKeyboardSetUnicodeString(up, 1, &ch);
    } else if ([keyName isEqualToString:@"space"]) {
        UniChar ch = ' ';
        CGEventKeyboardSetUnicodeString(down, 1, &ch);
        CGEventKeyboardSetUnicodeString(up, 1, &ch);
    } else if ([keyName isEqualToString:@"enter"] || [keyName isEqualToString:@"return"]) {
        UniChar ch = '\r';
        CGEventKeyboardSetUnicodeString(down, 1, &ch);
        CGEventKeyboardSetUnicodeString(up, 1, &ch);
    }
    @try { CGEventPostToPid(pid, down); AX_INPUT_SLEEP(0.025); }
    @finally { CGEventPostToPid(pid, up); }
    CFRelease(down);
    CFRelease(up);
    if (src) CFRelease(src);
    return YES;
}
// Search only this AX window's descendants. A system-wide hit test would select
// a covering window from another application. Bound both work and depth.
static AXUIElementRef axTargetAtPoint(AXUIElementRef window, CGPoint point, NXInputSession *session) {
    NSMutableArray *pending = [NSMutableArray arrayWithObject:@{ @"element": (__bridge id)window, @"depth": @0 }];
    id best = nil;
    NSUInteger bestDepth = 0, visited = 0;
    BOOL ambiguous = NO;
    CFAbsoluteTime end = CFAbsoluteTimeGetCurrent() + 1.5;
    while (pending.count) {
        checkInput(session);
        if (++visited > 2000 || CFAbsoluteTimeGetCurrent() > end) inputFailure(@"background_target_limit");
        NSDictionary *item = pending.lastObject; [pending removeLastObject];
        AXUIElementRef element = (__bridge AXUIElementRef)item[@"element"];
        NSUInteger depth = [item[@"depth"] unsignedIntegerValue];
        CGRect frame = CGRectNull;
        BOOL hasFrame = frameOf(element, &frame);
        BOOL inside = hasFrame && CGRectContainsPoint(frame, point);
        id enabled = axRead(element, kAXEnabledAttribute);
        if (inside && ![enabled isEqual:@NO] && (!best || depth > bestDepth)) {
            best = (__bridge id)element; bestDepth = depth; ambiguous = NO;
        } else if (inside && ![enabled isEqual:@NO] && depth == bestDepth && !CFEqual(element, (__bridge CFTypeRef)best)) {
            NSInteger newScore = axSemanticScore(element);
            NSInteger bestScore = axSemanticScore((__bridge AXUIElementRef)best);
            if (newScore > bestScore) {
                best = (__bridge id)element; ambiguous = NO;
            } else if (newScore == 0 && bestScore == 0) {
                ambiguous = YES;
            } else if (newScore == bestScore) {
                CGRect bestFrame = CGRectNull;
                if (frameOf((__bridge AXUIElementRef)best, &bestFrame)) {
                    double newArea = MAX(1.0, frame.size.width * frame.size.height);
                    double bestArea = MAX(1.0, bestFrame.size.width * bestFrame.size.height);
                    if (newArea < bestArea * 0.95) { best = (__bridge id)element; ambiguous = NO; }
                }
            }
        }
        if (depth >= 30) continue;
        if (depth >= 1 && (!hasFrame || frame.size.width <= 0 || frame.size.height <= 0)) continue;
        BOOL collapsedWrapper = frame.size.height <= 2 && frame.size.width > 40
            && point.x >= frame.origin.x - 24 && point.x <= CGRectGetMaxX(frame) + 24
            && point.y >= frame.origin.y - 24;
        if (depth >= 3 && !collapsedWrapper && !CGRectContainsPoint(CGRectInset(frame, -24, -24), point)) continue;
        id children = axRead(element, kAXChildrenAttribute);
        if ([children isKindOfClass:NSArray.class]) {
            if (pending.count + [children count] > 2000) inputFailure(@"background_target_limit");
            for (id child in children) [pending addObject:@{ @"element": child, @"depth": @(depth + 1) }];
        }
    }
    if (ambiguous) inputFailure(@"background_target_ambiguous");
    return best ? (AXUIElementRef)CFRetain((__bridge CFTypeRef)best) : NULL;
}
static NSDictionary *axDispatchResult(AXError error) {
    // CannotComplete may be reported after the app acted: no replay/fallback.
    if (error != kAXErrorSuccess) return @{ @"ok": @NO, @"error": error == kAXErrorCannotComplete ? @"computer_ax_action_unconfirmed" : @"background_unsupported" };
    return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"dispatched" };
}
static NSDictionary *axTrySemanticPointerOnAncestors(AXUIElementRef startTarget, AXUIElementRef window, pid_t pid, NSString *targetKey, CGPoint screenPoint, BOOL right) {
    CFStringRef action = right ? kAXShowMenuAction : kAXPressAction;
    AXUIElementRef current = (AXUIElementRef)CFRetain(startTarget);
    @try {
        for (NSUInteger depth = 0; depth < 40 && current; depth++) {
            NSString *role = [axRead(current, kAXRoleAttribute) isKindOfClass:NSString.class] ? axRead(current, kAXRoleAttribute) : nil;
            if (!right && axIsEditableRole(role) && axSettable(current, kAXSelectedTextAttribute)) {
                if (semanticTargets.count >= 128 && !semanticTargets[targetKey]) [semanticTargets removeObjectForKey:semanticTargets.allKeys.firstObject];
                semanticTargets[targetKey] = (__bridge id)current;
                semanticClickPoints[targetKey] = [NSValue valueWithPoint:NSPointFromCGPoint(screenPoint)];
                if (axHasAction(current, kAXPressAction)) AXUIElementPerformAction(current, kAXPressAction);
                return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"text_target_selected" };
            }
            if (axHasAction(current, action)) {
                if (semanticTargets.count >= 128 && !semanticTargets[targetKey]) [semanticTargets removeObjectForKey:semanticTargets.allKeys.firstObject];
                semanticTargets[targetKey] = (__bridge id)current;
                semanticClickPoints[targetKey] = [NSValue valueWithPoint:NSPointFromCGPoint(screenPoint)];
                return axDispatchResult(AXUIElementPerformAction(current, action));
            }
            if (!right && axSettable(current, kAXSelectedAttribute)) {
                return axDispatchResult(AXUIElementSetAttributeValue(current, kAXSelectedAttribute, kCFBooleanTrue));
            }
            if (CFEqual(current, window)) break;
            id parent = axRead(current, kAXParentAttribute);
            CFRelease(current); current = NULL;
            if (!parent || !axBelongsToWindow((__bridge AXUIElementRef)parent, window, pid)) break;
            current = (AXUIElementRef)CFRetain((__bridge CFTypeRef)parent);
        }
        return nil;
    } @finally {
        if (current) CFRelease(current);
    }
}
static CGEventFlags axModifier(CGKeyCode code) {
    if (code == 54 || code == 55) return kCGEventFlagMaskCommand;
    if (code == 56 || code == 60) return kCGEventFlagMaskShift;
    if (code == 58 || code == 61) return kCGEventFlagMaskAlternate;
    if (code == 59 || code == 62) return kCGEventFlagMaskControl;
    return 0;
}
static BOOL axCanPostKeysToWindow(pid_t pid, AXUIElementRef window) {
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    id focused = axRead(app, kAXFocusedWindowAttribute);
    id element = focused ? nil : axRead(app, kAXFocusedUIElementAttribute);
    CFRelease(app);
    return focused ? CFEqual((__bridge CFTypeRef)focused, window) : element && axBelongsToWindow((__bridge AXUIElementRef)element, window, pid);
}
static NSDictionary *axBackgroundKeys(NSDictionary *request, NXInputSession *session) {
    NSMutableArray<NSNumber *> *codes = [NSMutableArray array];
    NSArray *keys = request[@"keys"] ?: (request[@"key"] ? @[request[@"key"]] : @[]);
    for (id name in [(request[@"modifiers"] ?: @[]) arrayByAddingObjectsFromArray:keys]) {
        BOOL found = NO; CGKeyCode code = axKeyCode(name, &found);
        if (!found) inputFailure(@"key_unknown");
        if (![codes containsObject:@(code)]) [codes addObject:@(code)];
    }
    if (!codes.count || codes.count > 8) inputFailure(@"computer_input_invalid");
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
    @try {
        for (NSNumber *number in codes) {
            CGKeyCode code = number.unsignedShortValue;
            CGEventRef down = CGEventCreateKeyboardEvent(source, code, true), up = CGEventCreateKeyboardEvent(source, code, false);
            CGEventFlags modifier = axModifier(code);
            if (modifier) { if (down) CGEventSetType(down, kCGEventFlagsChanged); if (up) CGEventSetType(up, kCGEventFlagsChanged); }
            holdEvents(session, down, up, modifier);
        }
        waitInput(session, inputDuration(request, @"holdMs", 0, 0, 3000));
    } @finally {
        while (session.held.count) releaseLastInput(session);
        if (source) CFRelease(source);
    }
    return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"dispatched" };
}
static NSDictionary *axBackgroundPointer(NSDictionary *request, AXUIElementRef window, NXInputSession *session) {
    CGRect frame; CGPoint ratio;
    BOOL drag = [request[@"kind"] isEqual:@"drag"];
    if (!frameOf(window, &frame) || !ratioPoint(drag ? request[@"from"] : request, &ratio)) inputFailure(@"computer_input_invalid");
    CGPoint point = windowPoint(frame, ratio);
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
    @try {
        if (drag) {
            CGPoint end; if (!ratioPoint(request[@"to"], &end)) inputFailure(@"computer_input_invalid");
            end = windowPoint(frame, end);
            double duration = inputDuration(request, @"durationMs", 300, 50, 2000);
            holdEvents(session, CGEventCreateMouseEvent(source, kCGEventLeftMouseDown, point, kCGMouseButtonLeft),
                CGEventCreateMouseEvent(source, kCGEventLeftMouseUp, end, kCGMouseButtonLeft), 0);
            int steps = MAX(1, (int)(duration / 16));
            for (int i = 1; i <= steps; i++) {
                waitInput(session, duration / steps);
                CGPoint at = CGPointMake(point.x + (end.x - point.x) * i / steps, point.y + (end.y - point.y) * i / steps);
                CGEventRef event = CGEventCreateMouseEvent(source, kCGEventLeftMouseDragged, at, kCGMouseButtonLeft);
                if (!event) inputFailure(@"input_event_failed");
                postInputEvent(session, event); CFRelease(event);
            }
        } else {
            CGEventRef event;
            if ([request[@"kind"] isEqual:@"scroll"]) {
                NSString *direction = request[@"direction"]; int amount = MAX(1, MIN(10, [request[@"amount"] intValue]));
                BOOL horizontal = [direction isEqual:@"left"] || [direction isEqual:@"right"];
                int delta = ([direction isEqual:@"down"] || [direction isEqual:@"right"]) ? -amount : amount;
                event = CGEventCreateScrollWheelEvent(source, kCGScrollEventUnitLine, 2, horizontal ? 0 : delta, horizontal ? delta : 0);
                if (event) CGEventSetLocation(event, point);
            } else event = CGEventCreateMouseEvent(source, kCGEventMouseMoved, point, kCGMouseButtonLeft);
            if (!event) inputFailure(@"input_event_failed");
            postInputEvent(session, event); CFRelease(event);
        }
    } @finally {
        while (session.held.count) releaseLastInput(session);
        if (source) CFRelease(source);
    }
    return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"dispatched" };
}
static NSDictionary *semanticInput(NSDictionary *request, NXInputSession *session) {
    if (![request[@"delivery"] isEqual:@"semantic"]) return @{ @"ok": @NO, @"error": @"background_unsupported" };
    pid_t pid = [request[@"pid"] intValue];
    if (pid <= 0 || ![request[@"windowId"] isKindOfClass:NSNumber.class]) return @{ @"ok": @NO, @"error": @"computer_input_invalid" };
    if (!AXIsProcessTrusted()) return @{ @"ok": @NO, @"error": @"permission_required" };
    AXUIElementRef window = copyWindow(pid, [request[@"windowId"] unsignedIntValue]);
    if (!window) return @{ @"ok": @NO, @"error": @"window_not_found" };
    NSString *scope = [request[@"scope"] isKindOfClass:NSString.class] ? request[@"scope"] : @"";
    NSString *targetKey = [NSString stringWithFormat:@"%@:%d:%@", scope, pid, request[@"windowId"]];
    AXUIElementRef target = NULL;
    @try {
        checkInput(session);
        if ([request[@"op"] isEqual:@"pointer"]) {
            NSString *kind = request[@"kind"];
            if ([@[@"move", @"drag", @"scroll"] containsObject:kind]) return axBackgroundPointer(request, window, session);
            [semanticTargets removeObjectForKey:targetKey];
            [semanticClickPoints removeObjectForKey:targetKey];
            if (![@[ @"click", @"doubleClick", @"scroll" ] containsObject:kind]) return @{ @"ok": @NO, @"error": @"background_unsupported" };
            CGPoint ratio; CGRect frame;
            if (!ratioPoint(request, &ratio) || !frameOf(window, &frame)) return @{ @"ok": @NO, @"error": @"computer_input_invalid" };
            CGPoint screenPoint = CGPointMake(frame.origin.x + ratio.x * frame.size.width, frame.origin.y + ratio.y * frame.size.height);
            target = axTargetAtPoint(window, screenPoint, session);
            if (!target || !axBelongsToWindow(target, window, pid)) return @{ @"ok": @NO, @"error": @"background_target_unavailable" };
            if ([kind isEqual:@"scroll"]) {
                // AX page scrolling is semantically different from requested line
                // scrolling. Do not silently substitute one for the other.
                return @{ @"ok": @NO, @"error": @"background_unsupported" };
            }
            BOOL right = [request[@"button"] isEqual:@"right"];
            BOOL middle = [request[@"button"] isEqual:@"middle"];
            BOOL doubleClick = [kind isEqual:@"doubleClick"];
            if (!middle && !doubleClick) {
                NSDictionary *axRes = axTrySemanticPointerOnAncestors(target, window, pid, targetKey, screenPoint, right);
                if (axRes) return axRes;
            }
            axEnsureTreeReady(pid, window);
            if (!middle && !doubleClick) {
                CFRelease(target);
                target = axTargetAtPoint(window, screenPoint, session);
                if (target && axBelongsToWindow(target, window, pid)) {
                    NSDictionary *axRes = axTrySemanticPointerOnAncestors(target, window, pid, targetKey, screenPoint, right);
                    if (axRes) return axRes;
                }
            }
            CGWindowID wid = [request[@"windowId"] unsignedIntValue];
            NSString *btn = [request[@"button"] isKindOfClass:NSString.class] ? request[@"button"] : @"left";
            int count = doubleClick ? 2 : ([request[@"count"] isKindOfClass:NSNumber.class] ? [request[@"count"] intValue] : 1);
            semanticClickPoints[targetKey] = [NSValue valueWithPoint:NSPointFromCGPoint(screenPoint)];
            if (axPostMouseClickToPid(pid, wid, screenPoint, btn, count)) {
                return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"dispatched" };
            }
            return @{ @"ok": @NO, @"error": @"background_unsupported" };
        }
        if ([request[@"holdMs"] doubleValue] > 0 || [request[@"modifiers"] count] || [request[@"keys"] count]) {
            if (!axCanPostKeysToWindow(pid, window)) return @{ @"ok": @NO, @"error": @"background_target_unavailable" };
            return axBackgroundKeys(request, session);
        }
        BOOL modifierFound = NO; CGKeyCode modifierCode = axKeyCode(request[@"key"], &modifierFound);
        if (modifierFound && axModifier(modifierCode)) {
            if (!axCanPostKeysToWindow(pid, window)) return @{ @"ok": @NO, @"error": @"background_target_unavailable" };
            return axBackgroundKeys(request, session);
        }
        id remembered = semanticTargets[targetKey];
        if (remembered && axBelongsToWindow((__bridge AXUIElementRef)remembered, window, pid)) target = (AXUIElementRef)CFRetain((__bridge CFTypeRef)remembered);
        else {
            [semanticTargets removeObjectForKey:targetKey];
            AXUIElementRef application = AXUIElementCreateApplication(pid);
            id focused = axRead(application, kAXFocusedUIElementAttribute);
            CFRelease(application);
            if (focused && axBelongsToWindow((__bridge AXUIElementRef)focused, window, pid)) target = (AXUIElementRef)CFRetain((__bridge CFTypeRef)focused);
        }
        NSString *text = request[@"text"];
        if ([text isKindOfClass:NSString.class] && text.length > 0 && text.length <= 2000) {
            NSString *role = target ? axRead(target, kAXRoleAttribute) : nil;
            BOOL hasEditableTarget = target && (axSettable(target, kAXSelectedTextAttribute) || ([role isKindOfClass:NSString.class] && axIsEditableRole(role)));
            if (!hasEditableTarget && semanticClickPoints[targetKey]) {
                axEnsureTreeReady(pid, window);
                NSValue *ptVal = semanticClickPoints[targetKey];
                CGPoint nearPt = ptVal ? NSPointToCGPoint(ptVal.pointValue) : CGPointZero;
                AXUIElementRef editable = axFindEditableInWindow(window, nearPt, ptVal != nil);
                if (editable) {
                    if (target) CFRelease(target);
                    target = editable;
                    semanticTargets[targetKey] = (__bridge id)target;
                    role = axRead(target, kAXRoleAttribute);
                }
            }
            if (!target) {
                if (semanticClickPoints[targetKey]) {
                    axPrepareWindowFocus(window);
                    if (axCanPostKeysToWindow(pid, window) && axPostUnicodeToPid(pid, text, session)) {
                        return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"dispatched" };
                    }
                }
                return @{ @"ok": @NO, @"error": @"background_target_unavailable" };
            }
            if (!axSettable(target, kAXSelectedTextAttribute)) {
                axPrepareWindowFocus(window);
                if (axCanPostKeysToWindow(pid, window) && axPostUnicodeToPid(pid, text, session)) {
                    return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"dispatched" };
                }
                return @{ @"ok": @NO, @"error": @"background_unsupported" };
            }
            NSString *beforeVal = [axRead(target, kAXValueAttribute) isKindOfClass:NSString.class] ? axRead(target, kAXValueAttribute) : nil;
            AXError setErr = AXUIElementSetAttributeValue(target, kAXSelectedTextAttribute, (__bridge CFStringRef)text);
            if (setErr == kAXErrorSuccess && beforeVal != nil) {
                NSString *afterVal = [axRead(target, kAXValueAttribute) isKindOfClass:NSString.class] ? axRead(target, kAXValueAttribute) : nil;
                if (afterVal != nil && [afterVal isEqualToString:beforeVal]) {
                    axPrepareWindowFocus(window);
                    if (axHasAction(target, kAXPressAction)) AXUIElementPerformAction(target, kAXPressAction);
                    AX_INPUT_SLEEP(0.06);
                    if (axCanPostKeysToWindow(pid, window) && axPostUnicodeToPid(pid, text, session)) {
                        AX_INPUT_SLEEP(0.04);
                        return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"dispatched" };
                    }
                }
            }
            return axDispatchResult(setErr);
        }
        NSString *key = [request[@"key"] isKindOfClass:NSString.class] ? [request[@"key"] lowercaseString] : @"";
        CFStringRef action = [@[ @"enter", @"return" ] containsObject:key] ? kAXConfirmAction : [@[ @"escape", @"esc" ] containsObject:key] ? kAXCancelAction : NULL;
        if (target && action && axHasAction(target, action)) {
            return axDispatchResult(AXUIElementPerformAction(target, action));
        }
        BOOL foundCode = NO;
        CGKeyCode code = axKeyCode(key, &foundCode);
        if (foundCode) {
            axEnsureTreeReady(pid, window);
            axPrepareWindowFocus(window);
            if (![@[ @"enter", @"return", @"tab", @"backspace", @"delete", @"escape", @"esc", @"left", @"right", @"home", @"end" ] containsObject:key]) {
                axBlurEditableIfNeeded(window, pid, targetKey);
            } else if (target) {
                if (axHasAction(target, kAXPressAction)) AXUIElementPerformAction(target, kAXPressAction);
                AX_INPUT_SLEEP(0.08);
            }
            BOOL ok = axCanPostKeysToWindow(pid, window) && axPostKeyToPid(pid, code, key);
            AX_INPUT_SLEEP(([@[ @"enter", @"return" ] containsObject:key] ? 0.12 : 0.04));
            if (ok) {
                return @{ @"ok": @YES, @"delivery": @"background", @"effect": @"dispatched" };
            }
        }
        if (!target) return @{ @"ok": @NO, @"error": @"background_target_unavailable" };
        return @{ @"ok": @NO, @"error": @"background_unsupported" };
    } @finally { if (target) CFRelease(target); CFRelease(window); }
}
