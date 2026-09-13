; The NSIS installer's two additions to electron-builder's template (issue
; 128), included through `nsis.include` in electron-builder.yml, in both the
; installer's and the uninstaller's build.
;
; The template's installApplicationFiles copies the running installer to
; $LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}, which NsisTarget.js defines as
; `<package name>-updater\installer.exe` (appInfo.updaterCacheDirName). That
; copy is for electron-updater's differential updates, and this app has no
; updater (A6-05), so it is about 160 MB kept for nothing, and the
; template's uninstaller never removes it. customInstall removes it straight
; after the copy (installSection.nsh inserts customInstall after
; installApplicationFiles), and customUnInstall removes it again, for an
; install made by an installer from before this file.
;
; The folder is derived from the template's own define rather than written
; here, and the build fails if the define stops having the shape this relies
; on, so a change in electron-builder cannot turn the removal into one of a
; folder that is not the updater cache.

!ifndef APP_INSTALLER_STORE_FILE
  !error "build/installer.nsh: electron-builder no longer defines APP_INSTALLER_STORE_FILE; check where its installer keeps a copy of itself (issue 128)"
!endif

!searchreplace LEGIBLE_UPDATER_DIR "${APP_INSTALLER_STORE_FILE}" "\installer.exe" ""

!if "${LEGIBLE_UPDATER_DIR}" == "${APP_INSTALLER_STORE_FILE}"
  !error "build/installer.nsh: APP_INSTALLER_STORE_FILE (${APP_INSTALLER_STORE_FILE}) no longer ends in \installer.exe (issue 128)"
!endif
!if "${LEGIBLE_UPDATER_DIR}" == ""
  !error "build/installer.nsh: APP_INSTALLER_STORE_FILE names no folder (issue 128)"
!endif

; One folder directly under $LOCALAPPDATA: no separator left in the name.
!searchreplace LEGIBLE_UPDATER_DIR_FLAT "${LEGIBLE_UPDATER_DIR}" '\' ''
!if "${LEGIBLE_UPDATER_DIR_FLAT}" != "${LEGIBLE_UPDATER_DIR}"
  !error "build/installer.nsh: ${LEGIBLE_UPDATER_DIR} is not a single folder name (issue 128)"
!endif
!searchreplace LEGIBLE_UPDATER_DIR_SLASH "${LEGIBLE_UPDATER_DIR}" '/' ''
!if "${LEGIBLE_UPDATER_DIR_SLASH}" != "${LEGIBLE_UPDATER_DIR}"
  !error "build/installer.nsh: ${LEGIBLE_UPDATER_DIR} is not a single folder name (issue 128)"
!endif

; And the updater cache's own suffix at its end.
!searchreplace LEGIBLE_UPDATER_DIR_TAIL "${LEGIBLE_UPDATER_DIR}|" "-updater|" ""
!if "${LEGIBLE_UPDATER_DIR_TAIL}" == "${LEGIBLE_UPDATER_DIR}|"
  !error "build/installer.nsh: ${LEGIBLE_UPDATER_DIR} does not end in -updater (issue 128)"
!endif

; The template writes the copy with the shell context set to the current
; user, even for a per-machine install ("electron always uses per user app
; data"), so it is removed the same way. Straight after a 160 MB copy a
; virus scanner can still hold the file, so the removal is tried up to
; three times a second apart, and a folder still there is said in the
; details rather than failing the install or the uninstall.
!macro legibleRemoveUpdaterCache
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}
  Push $R8
  StrCpy $R8 0
  ${Do}
    RMDir /r "$LOCALAPPDATA\${LEGIBLE_UPDATER_DIR}"
    IntOp $R8 $R8 + 1
    ${IfNot} ${FileExists} "$LOCALAPPDATA\${LEGIBLE_UPDATER_DIR}\*.*"
      ${ExitDo}
    ${EndIf}
    ${If} $R8 >= 3
      DetailPrint "Could not remove $LOCALAPPDATA\${LEGIBLE_UPDATER_DIR}, the installer's unused copy of itself"
      ${ExitDo}
    ${EndIf}
    Sleep 1000
  ${Loop}
  Pop $R8
  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
  ClearErrors
!macroend

!macro customInstall
  !insertmacro legibleRemoveUpdaterCache
!macroend

; Not when an installer runs this uninstaller to replace the version it
; belongs to (installUtil.nsh's uninstallOldVersion passes --updated): with
; an updater (A6-05) the installer running then could be the one in this
; folder. The new installer's customInstall removes the folder instead.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro legibleRemoveUpdaterCache
  ${endIf}
!macroend
