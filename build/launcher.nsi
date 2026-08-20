; MD编辑器 自缓存单文件启动器
; 行为：首次运行把内嵌的完整程序解压到 %LOCALAPPDATA%\MD编辑器\app-<版本> 并启动；
;       之后每次启动检测缓存已存在则跳过解压直接启动（秒开）。
; 版本升级时自动清理所有旧版本缓存目录后重新解压。
; 编译：node scripts/build-launcher.js（由 makensis 执行，-DVERSION 注入版本号）

Unicode true
CRCCheck off
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
WindowIcon off
!ifndef SRCDIR
  !define SRCDIR "."
!endif
; NSIS File 指令不支持正斜杠，SRCDIR_B 为反斜杠版本（Icon/OutFile 正反均可）
!searchreplace SRCDIR_B "${SRCDIR}" "/" "\"
Icon "${SRCDIR}/build/icon.ico"
OutFile "${SRCDIR}/dist/MD编辑器.exe"
SetCompressor /FINAL lzma

!define APP_NAME "MD编辑器"
!define APP_EXEC "MD编辑器.exe"
!ifndef VERSION
  !define VERSION "0.0.0"
!endif

!include "FileFunc.nsh"

Name "${APP_NAME} ${VERSION}"

Section
  SetSilent silent
  StrCpy $INSTDIR "$LOCALAPPDATA\${APP_NAME}\app-${VERSION}"

  ; 缓存已存在 → 直接启动（秒开路径）
  IfFileExists "$INSTDIR\${APP_EXEC}" launch 0

  ; 首次运行（或版本升级）：清理所有 app-* 旧缓存目录
  StrCpy $0 "$LOCALAPPDATA\${APP_NAME}"
  FindFirst $1 $2 "$0\app-*"
  clean_loop:
    StrCmp $2 "" clean_done
    RMDir /r "$0\$2"
    FindNext $1 $2
    Goto clean_loop
  clean_done:
  FindClose $1

  ; 解压完整程序（一次性成本）
  SetOutPath $INSTDIR
  File /r "${SRCDIR_B}\dist\win-unpacked\*.*"

  launch:
  ; 透传命令行参数并等待退出（保持与官方 portable 一致的退出码语义）
  ${GetParameters} $R0
  ExecWait '"$INSTDIR\${APP_EXEC}" $R0' $0
  SetErrorLevel $0
SectionEnd
