; NSIS installer hook — registers an explicit "Open with Omnidoc" entry in
; the Windows Explorer right-click context menu for both files and folders,
; independent of any extension-level file-association the installer already
; sets up via `bundle.fileAssociations`.
;
; Tauri's NSIS template runs the `NSIS_HOOK_POSTINSTALL` macro after the
; standard install steps and `NSIS_HOOK_PREUNINSTALL` before the uninstall
; steps, which is where we add / remove the registry entries below.
;
; Registry layout (all under HKEY_CURRENT_USER so no admin elevation is
; required and per-user installs stay isolated):
;
;   HKCU\Software\Classes\*\shell\OpenWithOmnidoc
;     MUIVerb            = "Open with Omnidoc"
;     Icon               = "<install>\omnidoc.exe,0"
;     \command
;       (default)        = "<install>\omnidoc.exe" "%1"
;
;   HKCU\Software\Classes\Directory\shell\OpenWithOmnidoc              (folder)
;   HKCU\Software\Classes\Directory\Background\shell\OpenWithOmnidoc   (folder bg)
;
; The %V vs %1 split matters:
;   * Files and directories supply the selected path as %1.
;   * Right-clicking *inside* a folder (the "Background" hive) only exposes
;     the folder path via %V, so that command uses %V.
;
; Paths written to the registry are quoted so spaces are preserved, and we
; strip them on uninstall with a single `DeleteRegKey` per hive — the
; sub-keys come with it.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Registering 'Open with Omnidoc' shell context menu entries"

  ; ── Files: HKCU\Software\Classes\*\shell\OpenWithOmnidoc ──────────────
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithOmnidoc" "MUIVerb" "Open with Omnidoc"
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithOmnidoc" "Icon" '"$INSTDIR\omnidoc.exe",0'
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithOmnidoc\command" "" '"$INSTDIR\omnidoc.exe" "%1"'

  ; ── Folders (right-click on the folder itself) ────────────────────────
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithOmnidoc" "MUIVerb" "Open with Omnidoc"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithOmnidoc" "Icon" '"$INSTDIR\omnidoc.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenWithOmnidoc\command" "" '"$INSTDIR\omnidoc.exe" "%1"'

  ; ── Folder background (right-click inside a folder) ───────────────────
  ; %V is the only placeholder that resolves on the Background hive.
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithOmnidoc" "MUIVerb" "Open with Omnidoc"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithOmnidoc" "Icon" '"$INSTDIR\omnidoc.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenWithOmnidoc\command" "" '"$INSTDIR\omnidoc.exe" "%V"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing 'Open with Omnidoc' shell context menu entries"
  DeleteRegKey HKCU "Software\Classes\*\shell\OpenWithOmnidoc"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenWithOmnidoc"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenWithOmnidoc"
!macroend
