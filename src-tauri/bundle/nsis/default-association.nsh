; Tauri NSIS 安装钩子：增加"设为默认 MD 文件编辑器"选项
; 版权: MIT / 公共领域

; 定义全局变量保存复选框状态
Var GLOBAL SET_AS_DEFAULT_MD

; --------------------------
; 在安装目录选择页之后插入自定义选择页
; --------------------------
!macro NSIS_HOOK_PRE_INSTALL
  nsDialogs::Create 1018
  Pop $R0

  ; 欢迎文本和标题（使用 MUI 全局字体和颜色）
  ${NSD_CreateLabel} 0 0 100% 14u "勾选此项可将本程序设为 .md / .markdown / .mdown / .txt 文件的默认打开程序"
  Pop $R0

  ; 创建复选框（默认勾选）
  ${NSD_CreateCheckBox} 10u 18u 80% 12u "设为默认 MD 文件编辑器"
  Pop $R0
  ${NSD_SetState} $R0 ${BST_CHECKED} 1 ; 默认勾选

  ; 保存选中状态到变量
  GetFunctionAddress $R0 OnCheckDialog
  nsDialogs::OnClick $R0 $R0
  nsDialogs::Show
!macroend

!macroend

; --------------------------
; 复选框点击回调
; --------------------------
Function OnCheckDialog
  ${NSD_GetState} $R0 SET_AS_DEFAULT_MD
  Push $R0
  Pop $SET_AS_DEFAULT_MD
FunctionEnd

; --------------------------
; 安装后：如果勾选则注册文件关联
; --------------------------
!macro NSIS_HOOK_POST_INSTALL
  ${If} $SET_AS_DEFAULT_MD == ${BST_CHECKED}
    DetailPrint "注册 MD 文件关联..."
    ; 使用 NSIS 官方文件关联宏注册全部扩展名
    ; 第一个参数：关联扩展名；第二个参数：文件类型描述；第三个参数：应用程序命令行
    ${RegisterExtension} ".md" "Markdown Document" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${RegisterExtension} ".markdown" "Markdown Document" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${RegisterExtension} ".mdown" "Markdown Document" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${RegisterExtension} ".txt" "Text 文件" "$INSTDIR\${MAINBINARYNAME}.exe"
    DetailPrint "文件关联注册完成"
  ${EndIf}

  ; 卸载时移除关联（模板已经自动处理了卸载，不需要我们再做）
!macroend
