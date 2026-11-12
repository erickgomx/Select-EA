@echo off
setlocal
cd /d "%~dp0"
title Select EA - Compilador de Pacote Autonomo
echo ========================================================
echo       SELECT EA - Compilador de Pacote Autonomo
echo ========================================================
echo.
echo [1/3] Acessando pasta do projeto...
cd culling-desktop

echo [2/3] Instalando dependencias e compilando o frontend...
call npm install
call npm run build

echo [3/3] Gerando executavel portatil 'Select EA.exe'...
call npm run electron:portable

echo.
if exist "release\Select-EA-Portable.exe" (
    copy /y "release\Select-EA-Portable.exe" "..\Select EA.exe"
    echo ========================================================
    echo  [OK] Sucesso! 'Select EA.exe' pronto na raiz da pasta!
    echo       Voce pode copia-lo para qualquer PC ou pendrive.
    echo ========================================================
) else (
    echo [!] Verifique as mensagens de erro acima.
)
echo.
pause
