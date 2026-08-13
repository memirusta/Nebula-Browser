!macro NSIS_HOOK_POSTINSTALL

  ; HTTP ProgID
  WriteRegStr SHCTX \
    "Software\Classes\Nebula.Url.Http" \
    "" \
    "Nebula HTTP URL"

  WriteRegStr SHCTX \
    "Software\Classes\Nebula.Url.Http" \
    "URL Protocol" \
    ""

  WriteRegStr SHCTX \
    "Software\Classes\Nebula.Url.Http\DefaultIcon" \
    "" \
    "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"

  WriteRegStr SHCTX \
    "Software\Classes\Nebula.Url.Http\shell\open\command" \
    "" \
    "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""


  ; HTTPS ProgID
  WriteRegStr SHCTX \
    "Software\Classes\Nebula.Url.Https" \
    "" \
    "Nebula HTTPS URL"

  WriteRegStr SHCTX \
    "Software\Classes\Nebula.Url.Https" \
    "URL Protocol" \
    ""

  WriteRegStr SHCTX \
    "Software\Classes\Nebula.Url.Https\DefaultIcon" \
    "" \
    "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"

  WriteRegStr SHCTX \
    "Software\Classes\Nebula.Url.Https\shell\open\command" \
    "" \
    "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""


  ; Default Apps capabilities
  WriteRegStr SHCTX \
    "Software\Nebula\Capabilities" \
    "ApplicationName" \
    "Nebula"

  WriteRegStr SHCTX \
    "Software\Nebula\Capabilities" \
    "ApplicationDescription" \
    "Nebula Browser"

  WriteRegStr SHCTX \
    "Software\Nebula\Capabilities" \
    "ApplicationIcon" \
    "$INSTDIR\${MAINBINARYNAME}.exe,0"

  WriteRegStr SHCTX \
    "Software\Nebula\Capabilities\UrlAssociations" \
    "http" \
    "Nebula.Url.Http"

  WriteRegStr SHCTX \
    "Software\Nebula\Capabilities\UrlAssociations" \
    "https" \
    "Nebula.Url.Https"

  WriteRegStr SHCTX \
    "Software\RegisteredApplications" \
    "Nebula" \
    "Software\Nebula\Capabilities"

  ; Tell Explorer that association candidates changed.
  System::Call \
    'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

!macroend


!macro NSIS_HOOK_PREUNINSTALL

  DeleteRegValue SHCTX \
    "Software\RegisteredApplications" \
    "Nebula"

  DeleteRegKey SHCTX \
    "Software\Nebula"

  DeleteRegKey SHCTX \
    "Software\Classes\Nebula.Url.Http"

  DeleteRegKey SHCTX \
    "Software\Classes\Nebula.Url.Https"

  System::Call \
    'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

!macroend