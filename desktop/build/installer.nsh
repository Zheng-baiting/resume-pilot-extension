!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.resume_pilot.desktop" "" "$INSTDIR\resources\native-host-manifest.json"
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.resume_pilot.desktop" "" "$INSTDIR\resources\native-host-manifest.json"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.resume_pilot.desktop"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.resume_pilot.desktop"
!macroend
