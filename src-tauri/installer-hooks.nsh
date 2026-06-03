; "Open in Agni" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInAgni" "" "Open in Agni"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInAgni" "Icon" '"$INSTDIR\agni.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInAgni" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInAgni\command" "" '"$INSTDIR\agni.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInAgni" "" "Open in Agni"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInAgni" "Icon" '"$INSTDIR\agni.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInAgni" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInAgni\command" "" '"$INSTDIR\agni.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInAgni" "" "Open in Agni"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInAgni" "Icon" '"$INSTDIR\agni.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInAgni" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInAgni\command" "" '"$INSTDIR\agni.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInAgni"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInAgni"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInAgni"
!macroend
