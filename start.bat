@echo off
title Beam - Wi-Fi file sharing
cd /d "%~dp0"
node server.js --open
pause
