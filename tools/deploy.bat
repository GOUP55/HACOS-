@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  HACOS LINE予約システム ワンクリックデプロイ
REM  GitHub main の最新ソースを本番Worker/KVに反映します
REM  （DEPLOY_KAISUKEN.md の手順を自動化したもの）
REM ============================================================

set WORKDIR=C:\Users\n9-f\hacos-deploy
set WORKER=C:\Users\n9-f\.line-harness\apps\worker
set RAW=https://raw.githubusercontent.com/goup55/HACOS-/main/line-reservation

if not exist "%WORKDIR%" mkdir "%WORKDIR%"

echo.
echo [1/5] GitHub main から最新ファイルを取得中...
curl -fsSL -o "%WORKDIR%\reserve.html" %RAW%/liff/reserve.html
if errorlevel 1 goto :err
curl -fsSL -o "%WORKDIR%\reservation-routes.js" %RAW%/src/reservation-routes.js
if errorlevel 1 goto :err

echo [2/5] 予約フォーム(reserve.html)をKVへアップロード中...
cd /d "%WORKER%"
call npx wrangler kv key put --binding=STATIC_KV "liff/reserve.html" --path="%WORKDIR%\reserve.html" --remote
if errorlevel 1 goto :err

echo [3/5] 現在のWorkerコードをバックアップ中 (reservation-routes.js.bak)...
copy /Y src\reservation-routes.js src\reservation-routes.js.bak >nul
if errorlevel 1 goto :err

echo [4/5] Workerコードをmainの最新版に置換中...
copy /Y "%WORKDIR%\reservation-routes.js" src\reservation-routes.js >nul
if errorlevel 1 goto :err

echo [5/5] デプロイ実行中 (pnpm run deploy)...
call pnpm run deploy
if errorlevel 1 goto :err

echo.
echo ============================================
echo  デプロイ完了！
echo  スマホのLINEアプリを完全終了して再起動し、
echo  予約フォームの表示を確認してください。
echo ============================================
goto :end

:err
echo.
echo ============================================
echo  エラーが発生したため中断しました。
echo  この画面のスクショをClaudeに送ってください。
echo  （失敗した手順より先には進んでいません）
echo ============================================

:end
echo.
pause
