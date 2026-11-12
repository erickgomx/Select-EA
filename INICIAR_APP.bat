@echo off
rem Inicia o Select EA de forma direta e silenciosa
cd /d "%~dp0"
if exist "%~dp0Select EA.exe" (
    start "" "%~dp0Select EA.exe"
    exit
)
start "" wscript.exe "%~dp0Select EA.vbs"
exit
