@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo       SELECT EA - Gerador de Atalho com Logomarca
echo ========================================================
echo.
echo Configurando atalhos dinamicos para este computador...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$shortcut = $ws.CreateShortcut(\"$desktop\Select EA.lnk\"); " ^
  "$target = Resolve-Path 'Select EA.exe'; " ^
  "if (-not (Test-Path $target)) { $target = Resolve-Path 'INICIAR_APP.bat' }; " ^
  "$shortcut.TargetPath = $target; " ^
  "$shortcut.WorkingDirectory = '%~dp0'; " ^
  "$icon = Resolve-Path 'Select EA.ico'; " ^
  "if (Test-Path $icon) { $shortcut.IconLocation = \"$icon,0\" }; " ^
  "$shortcut.Description = 'Select EA - Photo Culling Studio'; " ^
  "$shortcut.Save(); " ^
  "$folderShortcut = $ws.CreateShortcut('%~dp0Select EA.lnk'); " ^
  "$folderShortcut.TargetPath = $target; " ^
  "$folderShortcut.WorkingDirectory = '%~dp0'; " ^
  "if (Test-Path $icon) { $folderShortcut.IconLocation = \"$icon,0\" }; " ^
  "$folderShortcut.Save();"

echo.
echo Atalho criado com sucesso:
echo  [x] Na sua Area de Trabalho (Desktop)
echo  [x] Nesta pasta (Select EA.lnk)
echo.
echo Agora voce pode abrir o aplicativo direto pelo atalho com o icone oficial!
echo ========================================================
echo.
pause
