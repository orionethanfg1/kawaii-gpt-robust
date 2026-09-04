; Custom NSIS snippets for KawaiiGPT Robust
; Keep minimal — electron-builder merges this via nsis.include

!macro customHeader
  ; Optional branding hooks
!macroend

!macro customInstall
  ; After files are installed — reserved for future shortcuts / registry
!macroend

!macro customUnInstall
  ; Keep user data by default (deleteAppDataOnUninstall: false)
!macroend
