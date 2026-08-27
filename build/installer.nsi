; MD编辑器 安装版（与绿色版并存，独立单文件安装包）
; 特性：安装目录可选（默认 Program Files，可自定义 Browse）+ 设置 .md 默认打开方式
;       + 关联范围（当前用户/所有用户）+ 快捷方式 + 卸载项
; 编译：node scripts/build-installer.js（由 makensis 执行，-DVERSION/-DARCH_SUFFIX/-DUNPACKED_NAME/-DSRCDIR 注入）

Unicode true
CRCCheck on
; 安装到 Program Files + 写 HKLM → 需管理员；一次提权即可
RequestExecutionLevel admin
AutoCloseWindow false

!ifndef SRCDIR
  !define SRCDIR "."
!endif
; NSIS File 指令不支持正斜杠，SRCDIR_B 为反斜杠版本
!searchreplace SRCDIR_B "${SRCDIR}" "/" "\"
Icon "${SRCDIR}/build/icon.ico"
; ARCH_SUFFIX：x64→64，ia32→32；决定输出文件名、程序安装子目录与注册表键（32/64 互不冲突）
!ifndef ARCH_SUFFIX
  !define ARCH_SUFFIX "x64"
!endif
!ifndef UNPACKED_NAME
  !define UNPACKED_NAME "win-unpacked"
!endif
; 输出主目录：默认 dist；隔离构建时由 build-installer.js 经 -DDIST_DIR 注入
!ifndef DIST_DIR
  !define DIST_DIR "dist"
!endif
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
; 默认安装目录由 build-installer.js 按架构注入（64→Program Files，32→Program Files (x86)），仍可在向导中自定义
!ifndef INSTALL_DIR
  !define INSTALL_DIR "$PROGRAMFILES\${APP_NAME}"
!endif

!define APP_NAME "MD编辑器"
!define APP_EXEC "MD编辑器.exe"
!define APP_LNK "MD编辑器.lnk"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}${ARCH_SUFFIX}"
!define CLASS_KEY "${APP_NAME}.md${ARCH_SUFFIX}"

Name "${APP_NAME} 安装版 ${VERSION}"
OutFile "${SRCDIR}/${DIST_DIR}/MD编辑器Setup-${ARCH_SUFFIX}.exe"
InstallDir "${INSTALL_DIR}"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
; 64 位写 64 位注册表视图；32 位用 32 位视图（默认可不设，32 位 NSIS 默认 32 位视图）
!ifdef IS_64
  !define REGVIEW_FLAG 64
!endif
SetCompressor /FINAL lzma

; ======= 现代 UI =======
!include "MUI2.nsh"
!define MUI_ICON "${SRCDIR}/build/icon.ico"
!define MUI_UNICON "${SRCDIR}/build/icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\MD编辑器.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即运行 ${APP_NAME}"
!define MUI_FINISHPAGE_RUN_CHECKED
!define MUI_LANGDLL_ALLLANGUAGES

Var ScopeMode      ; 0=当前用户(默认) 1=所有用户
Var ScopeRadioUser
Var ScopeRadioAll
Var OptDefaultOpen ; 1=设为 .md 默认打开
var OptDesktop     ; 1=创建桌面快捷方式

; ======= 自定义设置页：关联范围 + 默认打开 + 快捷方式 =======
Function ShowSettingsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 0u 100% 20u "$(MD_INST_TITLE)"
  Pop $0

  ${NSD_CreateGroupBox} 0u 20u 100% 60u "文件关联范围（影响 .md 默认打开方式）"
  Pop $0

  ${NSD_CreateRadioButton} 12u 34u 100% 14u "当前用户（推荐，无需管理员）"
  Pop $ScopeRadioUser
  ${NSD_CreateRadioButton} 12u 52u 100% 14u "所有用户"
  Pop $ScopeRadioAll
  ${If} $ScopeMode == 1
    ${NSD_Check} $ScopeRadioAll
  ${Else}
    ${NSD_Check} $ScopeRadioUser
  ${EndIf}

  ${NSD_CreateCheckBox} 0u 88u 100% 14u "将 ${APP_NAME} 设为 .md 文件的默认打开方式"
  Pop $OptDefaultOpen
  ${NSD_Check} $OptDefaultOpen

  ${NSD_CreateCheckBox} 0u 108u 100% 14u "创建桌面快捷方式"
  Pop $OptDesktop
  ${NSD_Check} $OptDesktop

  nsDialogs::Show
FunctionEnd

Function ValidateSettingsPage
  ${NSD_GetState} $OptDefaultOpen $0
  StrCpy $OptDefaultOpen $0
  ${NSD_GetState} $OptDesktop $0
  StrCpy $OptDesktop $0
  ${NSD_GetState} $ScopeRadioAll $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $ScopeMode 1
  ${Else}
    StrCpy $ScopeMode 0
  ${EndIf}
FunctionEnd

; ======= 页面顺序 =======
!insertmacro MUI_PAGE_DIRECTORY
Page custom ShowSettingsPage ValidateSettingsPage
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!define MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ======= 语言（须在 Page 宏之后声明） =======
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "TradChinese"
!insertmacro MUI_LANGUAGE "English"
LangString MD_INST_TITLE ${LANG_SIMPCHINESE} "MD编辑器 安装版（${VERSION}）"
LangString MD_INST_TITLE ${LANG_TRADCHINESE} "MD编辑器 安裝版（${VERSION}）"
LangString MD_INST_TITLE ${LANG_ENGLISH} "MD Editor Installer (${VERSION})"

; ======= 写入/删除注册表与快捷方式的工具宏 =======
!macro RegisterAssociations ROOT
  ; 类名 + 图标 + 打开命令
  WriteRegStr ${ROOT} "Software\Classes\${CLASS_KEY}" "" "${APP_NAME} Markdown 文档"
  WriteRegStr ${ROOT} "Software\Classes\${CLASS_KEY}\DefaultIcon" "" "$INSTDIR\${APP_EXEC},0"
  WriteRegStr ${ROOT} "Software\Classes\${CLASS_KEY}\shell\open\command" "" '"$INSTDIR\${APP_EXEC}" "%1"'
  ; .md 扩展名指向该类
  WriteRegStr ${ROOT} "Software\Classes\.md" "" "${CLASS_KEY}"
  ; 让"打开方式"列表出现（应用注册）
  WriteRegStr ${ROOT} "Software\Classes\Applications\${APP_EXEC}\shell\open\command" "" '"$INSTDIR\${APP_EXEC}" "%1"'
  WriteRegStr ${ROOT} "Software\Classes\Applications\${APP_EXEC}" "FriendlyAppName" "${APP_NAME}"
!macroend

!macro UnregisterAssociations ROOT
  DeleteRegKey ${ROOT} "Software\Classes\${CLASS_KEY}"
  DeleteRegKey ${ROOT} "Software\Classes\Applications\${APP_EXEC}"
  ; 只有仍指向本类才清除 .md 关联，避免误删用户改换的程序
  ReadRegStr $0 ${ROOT} "Software\Classes\.md" ""
  ${If} $0 == "${CLASS_KEY}"
    DeleteRegValue ${ROOT} "Software\Classes\.md" ""
  ${EndIf}
!macroend

!macro CreateShortcuts
  CreateDirectory "$SMPROGRAMS\${APP_NAME}${ARCH_SUFFIX}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}${ARCH_SUFFIX}\${APP_LNK}" "$INSTDIR\${APP_EXEC}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}${ARCH_SUFFIX}\卸载 ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
  ${If} $OptDesktop == 1
    CreateShortcut "$DESKTOP\${APP_LNK}" "$INSTDIR\${APP_EXEC}"
  ${EndIf}
!macroend

!macro DeleteShortcuts
  Delete "$SMPROGRAMS\${APP_NAME}${ARCH_SUFFIX}\${APP_LNK}"
  Delete "$SMPROGRAMS\${APP_NAME}${ARCH_SUFFIX}\卸载 ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}${ARCH_SUFFIX}"
  Delete "$DESKTOP\${APP_LNK}"
!macroend

!macro RegisterUninstall ROOT
  WriteRegStr ${ROOT} "${UNINST_KEY}" "DisplayName" "${APP_NAME} ${VERSION} (${ARCH_SUFFIX}位)"
  WriteRegStr ${ROOT} "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr ${ROOT} "${UNINST_KEY}" "Publisher" "hanwu"
  WriteRegStr ${ROOT} "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXEC},0"
  WriteRegStr ${ROOT} "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr ${ROOT} "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD ${ROOT} "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD ${ROOT} "${UNINST_KEY}" "NoRepair" 1
!macroend

!macro UnregisterUninstall ROOT
  DeleteRegKey ${ROOT} "${UNINST_KEY}"
!macroend

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY
  ; 64 位安装写 64 位注册表视图
  !ifdef IS_64
    SetRegView 64
  !endif
  ${If} $ScopeMode == ""
    UserInfo::GetAccountType
    Pop $0
    ${If} $0 == "Admin"
      StrCpy $ScopeMode 1
    ${Else}
      StrCpy $ScopeMode 0
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.onInit
  ; 卸载时按安装架构切到对应注册表视图
  !ifdef IS_64
    SetRegView 64
  !endif
FunctionEnd

Section "安装"
  SetOutPath "$INSTDIR"
  ; 复制完整程序（electron + app）
  File /r "${SRCDIR_B}\${DIST_DIR}\${UNPACKED_NAME}\*.*"
  ; 写入卸载器
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 关联：按所选范围写入
  ${If} $OptDefaultOpen == 1
    ${If} $ScopeMode == 1
      !insertmacro RegisterAssociations HKLM
    ${Else}
      !insertmacro RegisterAssociations HKCU
    ${EndIf}
  ${EndIf}

  ; 卸载信息
  ${If} $ScopeMode == 1
    !insertmacro RegisterUninstall HKLM
  ${Else}
    !insertmacro RegisterUninstall HKCU
  ${EndIf}

  ; 快捷方式
  !insertmacro CreateShortcuts
SectionEnd

Section "Uninstall"
  ; 先结束可能仍在运行的程序，避免 RMDir 删除失败
  nsProcess::_KillProcess "${APP_EXEC}"
  Sleep 500
  ; 删除关联（同时清 HKCU/HKLM，避免残留）
  !insertmacro UnregisterAssociations HKCU
  !insertmacro UnregisterAssociations HKLM
  !insertmacro UnregisterUninstall HKCU
  !insertmacro UnregisterUninstall HKLM
  !insertmacro DeleteShortcuts
  ; 删除程序目录（带重试，处理文件句柄释放延迟）
  RMDir /r "$INSTDIR"
  IfFileExists "$INSTDIR" 0 skip_retry
  Sleep 800
  RMDir /r "$INSTDIR"
  skip_retry:
SectionEnd