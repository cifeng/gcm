@echo off
rem 一键启动 gcm GUI（双击即可，会自动打开浏览器）
cd /d %~dp0
node server.js
pause
