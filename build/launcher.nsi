; MD编辑器 自缓存单文件启动器
; 行为：每次启动先校验缓存目录（%LOCALAPPDATA%\MD编辑器\app-<版本>）是否与当前版本匹配且完整：
;   校验项 = 主程序存在 + resources\app.asar 存在 + 版本标记 .cache-ok-<版本> 存在
;   （标记在解压完成后最后创建 → 存在即代表解压完整；文件名内嵌版本号 → 目录名对但内容是旧版本也能识别）
;   校验通过 → 跳过解压直接启动（秒开）；失败（首次/升级/解压中断/缓存损坏/版本错配）
;   → 清理所有 app-* 缓存目录，按当前版本重新解压后再启动，防止缓存问题导致程序运行失败。
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
; 版本标记文件：解压完成后最后创建，存在 = 缓存完整且与当前版本匹配
!define CACHE_MARKER ".cache-ok-${VERSION}"

!include "FileFunc.nsh"

Name "${APP_NAME} ${VERSION}"

Section
  SetSilent silent
  StrCpy $INSTDIR "$LOCALAPPDATA\${APP_NAME}\app-${VERSION}"

  ; ---- 缓存有效性校验：版本匹配 + 完整性（三项全过才直启，任一失败 → 重建）----
  IfFileExists "$INSTDIR\${APP_EXEC}" 0 rebuild
  IfFileExists "$INSTDIR\resources\app.asar" 0 rebuild
  IfFileExists "$INSTDIR\${CACHE_MARKER}" launch rebuild

  ; 缓存缺失 / 不完整 / 版本不匹配 → 清理所有 app-* 缓存目录（含当前目录）后重建
  rebuild:
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

  ; 最后创建版本标记（解压被中断则无标记 → 下次启动自动重建）
  FileOpen $0 "$INSTDIR\${CACHE_MARKER}" w
  FileClose $0

  launch:
  ; 透传命令行参数并等待退出（保持与官方 portable 一致的退出码语义）
  ${GetParameters} $R0
  ExecWait '"$INSTDIR\${APP_EXEC}" $R0' $0
  SetErrorLevel $0
SectionEnd
