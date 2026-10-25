#import <Foundation/Foundation.h>
#include <stdio.h>
#include <string.h>

int main(int argc, const char * argv[]) {
  @autoreleasepool {
    if (argc >= 2 && strcmp(argv[1], "--version") == 0) {
      puts("1.1.0");
      return 0;
    }
    if (argc >= 2 && strcmp(argv[1], "--help") == 0) {
      puts("Usage: trash <path> [...]");
      return 0;
    }
    if (argc < 2) {
      fprintf(stderr, "Specify one or more paths\n");
      return 1;
    }
    NSFileManager *fileManager = [NSFileManager defaultManager];
    int exitCode = 0;
    for (int i = 1; i < argc; i++) {
      NSString *rawPath = [NSString stringWithUTF8String:argv[i]];
      if (!rawPath || rawPath.length == 0) {
        continue;
      }
      NSURL *url = [NSURL fileURLWithPath:rawPath];
      NSError *error = nil;
      if (![fileManager trashItemAtURL:url resultingItemURL:nil error:&error]) {
        const char *description = error.localizedDescription.UTF8String;
        fprintf(stderr, "%s\n", description ? description : "Failed to move item to Trash");
        exitCode = 1;
      }
    }
    return exitCode;
  }
}
