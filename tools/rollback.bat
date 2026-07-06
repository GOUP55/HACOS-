@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  HACOS LINE予約システム ロールバック（元に戻す）
REM  deploy.bat が作ったバックアップ(.bak)でWorkerを戻します
REM  ※予約フォーム(KV)は戻しません。フォームも戻す必要が
REM    ある場合はClaudeに「旧reserve.htmlをください」と伝える
REM ============================================================

set WORKER=C:\Users\n9-f\.line-harness\apps\worker

cd /d "%WORKER%"

if not exist src\reservation-routes.js.bak (
  echo バックアップ(src\reservation-routes.js.bak)が見つかりません。中断します。
  goto :end
)

echo [1/2] バックアップからWorkerコードを復元中...
copy /Y src\reservation-routes.js.bak src\reservation-routes.js >nul
if errorlevel 1 goto :err

echo [2/2] デプロイ実行中 (pnpm run deploy)...
call pnpm run deploy
if errorlevel 1 goto :err

echo.
echo  ロールバック完了。1つ前のWorkerコードに戻りました。
goto :end

:err
echo.
echo  エラーが発生しました。この画面のスクショをClaudeに送ってください。

:end
echo.
pause
