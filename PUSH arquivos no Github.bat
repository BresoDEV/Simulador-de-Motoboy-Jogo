@echo off
cd /d "%~dp0"
set COMMIT_MSG=Commit automatico em %date% às %time%
git add .
git commit -m "%COMMIT_MSG%"
git push
echo Operação concluída.
pause


