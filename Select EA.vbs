Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName) & "\culling-desktop"
nodeModules = appDir & "\node_modules"
electronExe = nodeModules & "\electron\dist\electron.exe"
loaderHtml = appDir & "\loader.html"

' Se as dependencias nao existirem, exibe tela de carregamento amigavel
If Not fso.FolderExists(nodeModules) Or Not fso.FileExists(electronExe) Then
    ' Abre a tela de carregamento visual animada
    Set loaderProc = shell.Exec("mshta.exe """ & loaderHtml & """")
    
    ' Executa a instalacao em segundo plano sem janela preta
    shell.Run "cmd.exe /c cd /d """ & appDir & """ && npm install && npm run build", 0, True
    
    ' Fecha a tela de carregamento
    On Error Resume Next
    loaderProc.Terminate
    On Error GoTo 0
End If

' Se o dist nao existir, compila silenciosamente
If Not fso.FolderExists(appDir & "\dist") Then
    shell.Run "cmd.exe /c cd /d """ & appDir & """ && npm run build", 0, True
End If

' Inicia o Select EA diretamente pelo executavel nativo (Sem terminal, 100% silencioso)
If fso.FileExists(electronExe) Then
    shell.CurrentDirectory = appDir
    shell.Run """" & electronExe & """ .", 0, False
Else
    shell.Run "cmd.exe /c cd /d """ & appDir & """ && npx electron .", 0, False
End If
