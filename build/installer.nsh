!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Optional "Open with Basil" Explorer context menu (Software\Classes\*\shell\...)
!define BASIL_CONTEXT_MENU_KEY "Software\Classes\*\shell\OpenWithBasil"

!ifndef BUILD_UNINSTALLER
  Var AddContextMenu
  Var StayInTray
  Var StartWithBoot
  Var ContextMenuCheckbox
  Var StayInTrayCheckbox
  Var StartWithBootCheckbox

  !macro customInit
    ; Defaults: offer all options (checked). Silent installs keep these defaults.
    StrCpy $AddContextMenu "1"
    StrCpy $StayInTray "1"
    StrCpy $StartWithBoot "1"
  !macroend

  !macro customPageAfterChangeDir
    Page custom SetupOptionsPageCreate SetupOptionsPageLeave
  !macroend

  Function SetupOptionsPageCreate
    ; Avoid MUI_HEADER_TEXT here: custom installer.nsh is included before MUI2 macros exist.
    ; MUI header controls: 1037 = title, 1038 = subtitle; 0x000C = WM_SETTEXT
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 0x000C 0 "STR:Optional customization"
    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 0x000C 0 "STR:Choose optional setup features for Basil."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 28u "Choose optional setup features for Basil. You can change tray and startup options later in Settings."
    Pop $0

    ${NSD_CreateCheckbox} 0 36u 100% 12u "Add $\"Open with Basil$\" to the context menu"
    Pop $ContextMenuCheckbox
    ${If} $AddContextMenu == "1"
      ${NSD_Check} $ContextMenuCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 0 56u 100% 12u "Stay in system tray"
    Pop $StayInTrayCheckbox
    ${If} $StayInTray == "1"
      ${NSD_Check} $StayInTrayCheckbox
    ${EndIf}

    ${NSD_CreateCheckbox} 0 76u 100% 12u "Start with boot"
    Pop $StartWithBootCheckbox
    ${If} $StartWithBoot == "1"
      ${NSD_Check} $StartWithBootCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function SetupOptionsPageLeave
    ${NSD_GetState} $ContextMenuCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $AddContextMenu "1"
    ${Else}
      StrCpy $AddContextMenu "0"
    ${EndIf}

    ${NSD_GetState} $StayInTrayCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $StayInTray "1"
    ${Else}
      StrCpy $StayInTray "0"
    ${EndIf}

    ${NSD_GetState} $StartWithBootCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $StartWithBoot "1"
    ${Else}
      StrCpy $StartWithBoot "0"
    ${EndIf}
  FunctionEnd

  !macro customInstall
    ${if} $AddContextMenu == "1"
      WriteRegStr SHELL_CONTEXT "${BASIL_CONTEXT_MENU_KEY}" "" "Open with Basil"
      WriteRegStr SHELL_CONTEXT "${BASIL_CONTEXT_MENU_KEY}" "Icon" "$appExe,0"
      WriteRegStr SHELL_CONTEXT "${BASIL_CONTEXT_MENU_KEY}\command" "" '"$appExe" "%1"'
      System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
    ${else}
      DeleteRegKey SHELL_CONTEXT "${BASIL_CONTEXT_MENU_KEY}"
      System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
    ${endIf}

    ; One-shot options consumed on first app launch into ~/.basil/preferences.json
    CreateDirectory "$PROFILE\.basil"
    FileOpen $0 "$PROFILE\.basil\setup-options.json" w
    ${If} $0 != ""
      FileWrite $0 "{"
      ${If} $StayInTray == "1"
        FileWrite $0 '"stayInTray":true,'
      ${Else}
        FileWrite $0 '"stayInTray":false,'
      ${EndIf}
      ${If} $StartWithBoot == "1"
        FileWrite $0 '"startWithBoot":true'
      ${Else}
        FileWrite $0 '"startWithBoot":false'
      ${EndIf}
      FileWrite $0 "}"
      FileClose $0
    ${EndIf}

    ; Register login item immediately so boot works even before first interactive launch.
    ; Key name must match LOGIN_ITEM_NAME in electron/main.ts ("basil").
    ${If} $StartWithBoot == "1"
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "basil" '"$appExe" --hidden'
    ${Else}
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "basil"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Basil"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.basil.editor"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Basil"
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Electron"
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "${BASIL_CONTEXT_MENU_KEY}"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Basil"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "basil"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.basil.editor"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Basil"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Electron"
  Delete "$PROFILE\.basil\setup-options.json"
!macroend
