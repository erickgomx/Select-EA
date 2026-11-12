Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
portableExe = rootDir & "\Select EA.exe"
appDir = rootDir & "\culling-desktop"
unpackedExe = appDir & "\release\win-unpacked\Select EA.exe"
nodeModules = appDir & "\node_modules"
electronExe = nodeModules & "\electron\dist\electron.exe"

' 1. Se o executável portátil ou autônomo existir, roda direto (Zero dependências necessárias!)
If fso.FileExists(portableExe) Then
    shell.CurrentDirectory = rootDir
    shell.Run """" & portableExe & """", 1, False
    WScript.Quit
End If

If fso.FileExists(unpackedExe) Then
    shell.CurrentDirectory = fso.GetParentFolderName(unpackedExe)
    shell.Run """" & unpackedExe & """", 1, False
    WScript.Quit
End If

' 2. Se for execução local em modo dev com Electron
If fso.FileExists(electronExe) Then
    shell.CurrentDirectory = appDir
    shell.Run """" & electronExe & """ .", 0, False
    WScript.Quit
End If

' 3. Se não houver compilação nem dependências, tenta npx
shell.Run "cmd.exe /c cd /d """ & appDir & """ && npx electron .", 0, False
