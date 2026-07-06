@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  回数券 月次レポート
REM  指定月の回数券予約を人ごとに集計します（現金照合用）
REM  cnt = その月の予約回数 / yen = cnt x 2000円
REM ============================================================

set WORKER=C:\Users\n9-f\.line-harness\apps\worker

set /p MONTH=対象月を入力 (例 2026-07 / 空Enterで今月):
if "%MONTH%"=="" for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM"') do set MONTH=%%i

echo.
echo === %MONTH% の回数券集計 ===
cd /d "%WORKER%"
call npx wrangler d1 execute line-harness --command "SELECT r.display_name AS name, COUNT(*) AS cnt, COUNT(*)*2000 AS yen FROM reservations r JOIN sessions s ON s.id = r.session_id WHERE r.category = '回数券' AND r.status = 'confirmed' AND s.date LIKE '%MONTH%%%' GROUP BY r.line_user_id ORDER BY cnt DESC" --remote

echo.
echo === %MONTH% の全区分の予約数（参考） ===
call npx wrangler d1 execute line-harness --command "SELECT r.category, COUNT(*) AS cnt FROM reservations r JOIN sessions s ON s.id = r.session_id WHERE r.status = 'confirmed' AND s.date LIKE '%MONTH%%%' GROUP BY r.category ORDER BY cnt DESC" --remote

echo.
pause
