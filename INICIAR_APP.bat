@echo off
rem Inicia o Select EA de forma silenciosa sem manter terminal aberto
cd /d "%~dp0"
start "" wscript.exe "%~dp0Select EA.vbs"
exit
