; electron-builder 26.15.3 setSpaceRequired omits the ARM64-only case.
; customHeader expands after common.nsh is loaded and before the stock size
; macro is inserted. Alias only its size value, never the APP_64 payload.
; Existing x64/ia32 or combined installers keep their original definitions.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !ifdef APP_ARM64_UNPACKED_SIZE
      !ifndef APP_64_UNPACKED_SIZE
        !ifndef APP_32_UNPACKED_SIZE
          !define APP_64_UNPACKED_SIZE ${APP_ARM64_UNPACKED_SIZE}
        !endif
      !endif
    !endif
  !endif
!macroend
