@echo off
setlocal enabledelayedexpansion
title JARVIS Installer — OpenClaude + Claude CLI Setup
color 0A

echo ============================================================
echo   JARVIS Installer
echo   OpenClaude (local Ollama) + Claude (Anthropic official)
echo ============================================================
echo.

:: ---------------------------------------------------------------
:: 1. Check prerequisites
:: ---------------------------------------------------------------
echo [1/8] Checking prerequisites...

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)

where bun >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [WARN] Bun not found. Will install via npm...
    npm install -g bun
)

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python not found. Install from https://python.org
    pause & exit /b 1
)

echo       Node.js OK
echo       Python  OK

:: ---------------------------------------------------------------
:: 2. Determine install paths
:: ---------------------------------------------------------------
set "INSTALL_DIR=%~dp0"
set "OPENCLAUDE_DIR=%INSTALL_DIR%"
set "MCP_TOOLS_DIR=%INSTALL_DIR%..\openclaude-mcp-tools"
set "BIN_DIR=%USERPROFILE%\bin"
set "CLAUDE_DIR=%USERPROFILE%\.claude"
set "HOOKS_DIR=%CLAUDE_DIR%\hooks"

echo.
echo [2/8] Install paths:
echo       OpenClaude:  %OPENCLAUDE_DIR%
echo       MCP Tools:   %MCP_TOOLS_DIR%
echo       CLI Bin:     %BIN_DIR%
echo       Config:      %CLAUDE_DIR%

:: ---------------------------------------------------------------
:: 3. Build OpenClaude
:: ---------------------------------------------------------------
echo.
echo [3/8] Building OpenClaude...
cd /d "%OPENCLAUDE_DIR%"
if not exist "node_modules" (
    call bun install
)
call bun run build
if not exist "dist\cli.mjs" (
    echo [ERROR] Build failed — dist\cli.mjs not found.
    pause & exit /b 1
)
echo       Build OK

:: ---------------------------------------------------------------
:: 4. Install MCP tools Python dependencies
:: ---------------------------------------------------------------
echo.
echo [4/8] Installing MCP tools Python dependencies...
cd /d "%MCP_TOOLS_DIR%"
pip install -r requirements.txt --quiet
echo       MCP tools OK

:: ---------------------------------------------------------------
:: 5. Create bin directory and wrapper scripts
:: ---------------------------------------------------------------
echo.
echo [5/8] Creating CLI wrappers in %BIN_DIR%...
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

:: --- openclaude.ps1 ---
(
echo param(
echo   [Parameter(ValueFromRemainingArguments = $true^)]
echo   [string[]]$Params
echo ^)
echo.
echo $ErrorActionPreference = 'Stop'
echo.
echo # OpenClaude: local Ollama backend
echo $env:CLAUDE_CODE_USE_OPENAI = '1'
echo $env:OPENAI_BASE_URL = 'http://localhost:11434/v1'
echo $env:CLAUDE_CODE_USE_POWERSHELL_TOOL = '1'
echo $env:ENABLE_LSP_TOOL = '1'
echo $env:CLAUDE_CODE_VERIFY_PLAN = 'true'
echo.
echo # Default model — override with: openclaude ^<model^>
echo $model = $env:OPENAI_MODEL
echo if (-not $model^) { $model = 'qwen3-coder:30b-32k' }
echo.
echo $passArgs = @(^)
echo if ($Params.Count -gt 0^) {
echo   $first = $Params[0]
echo   if ($first -and -not $first.StartsWith('-'^)^) {
echo     $model = $first
echo     if ($Params.Count -gt 1^) { $passArgs = $Params[1..($Params.Count-1^)] }
echo   } else { $passArgs = $Params }
echo }
echo.
echo $env:OPENAI_MODEL = $model
echo.
echo # Guard: never run from system32
echo $cwd = (Get-Location^).Path
echo if ($cwd -like '*\system32*' -or $cwd -like '*\System32*'^) {
echo   Set-Location $env:USERPROFILE
echo }
echo.
echo $repo = '%OPENCLAUDE_DIR%'
echo $cli  = Join-Path $repo 'dist\cli.mjs'
echo.
echo if (-not (Test-Path $cli^)^) {
echo   Write-Error "OpenClaude build not found at $cli. Run: bun run build (in $repo^)"
echo }
echo.
echo $promptFile = Join-Path $env:USERPROFILE '.claude\local-model-prompt.md'
echo $mcpConfig  = Join-Path $env:USERPROFILE '.claude\mcp-playwright.json'
echo.
echo ^& node $cli `
echo   --dangerously-skip-permissions `
echo   --append-system-prompt-file $promptFile `
echo   --mcp-config $mcpConfig `
echo   @passArgs
echo exit $LASTEXITCODE
) > "%BIN_DIR%\openclaude.ps1"

:: --- openclaude.cmd ---
(
echo @echo off
echo setlocal
echo REM OpenClaude — local Ollama models
echo powershell -NoProfile -ExecutionPolicy Bypass -File "%%~dp0openclaude.ps1" %%*
echo exit /b %%ERRORLEVEL%%
) > "%BIN_DIR%\openclaude.cmd"

echo       openclaude.cmd + openclaude.ps1 created

:: ---------------------------------------------------------------
:: 6. Create config files in %USERPROFILE%\.claude
:: ---------------------------------------------------------------
echo.
echo [6/8] Creating config files in %CLAUDE_DIR%...
if not exist "%CLAUDE_DIR%" mkdir "%CLAUDE_DIR%"
if not exist "%HOOKS_DIR%" mkdir "%HOOKS_DIR%"

:: --- MCP config ---
(
echo {
echo   "mcpServers": {
echo     "playwright": {
echo       "command": "npx",
echo       "args": ["-y", "@playwright/mcp", "--browser", "chromium"],
echo       "cwd": "%USERPROFILE:\=\\%",
echo       "env": {
echo         "USERPROFILE": "%USERPROFILE:\=\\%",
echo         "HOME": "%USERPROFILE:\=\\%",
echo         "PLAYWRIGHT_BROWSERS_PATH": "%USERPROFILE:\=\\%\\AppData\\Local\\ms-playwright"
echo       }
echo     },
echo     "openclaude-tools": {
echo       "command": "python",
echo       "args": ["%MCP_TOOLS_DIR:\=\\%\\server.py"],
echo       "cwd": "%USERPROFILE:\=\\%"
echo     }
echo   }
echo }
) > "%CLAUDE_DIR%\mcp-playwright.json"
echo       mcp-playwright.json created

:: --- Local model prompt ---
if exist "%INSTALL_DIR%config\local-model-prompt.md" (
    copy /y "%INSTALL_DIR%config\local-model-prompt.md" "%CLAUDE_DIR%\local-model-prompt.md" >nul
    echo       local-model-prompt.md copied from config\
) else (
    if not exist "%CLAUDE_DIR%\local-model-prompt.md" (
        echo       [WARN] local-model-prompt.md not found. Copy it manually to %CLAUDE_DIR%\
    ) else (
        echo       local-model-prompt.md already exists
    )
)

:: --- Self-healing hook ---
if exist "%INSTALL_DIR%config\self-healing.js" (
    copy /y "%INSTALL_DIR%config\self-healing.js" "%HOOKS_DIR%\self-healing.js" >nul
    echo       self-healing.js copied from config\
) else (
    if not exist "%HOOKS_DIR%\self-healing.js" (
        echo       [WARN] self-healing.js not found. Copy it manually to %HOOKS_DIR%\
    ) else (
        echo       self-healing.js already exists
    )
)

:: ---------------------------------------------------------------
:: 7. Add bin to PATH if not already there
:: ---------------------------------------------------------------
echo.
echo [7/8] Checking PATH...
echo %PATH% | findstr /i /c:"%BIN_DIR%" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo       Adding %BIN_DIR% to user PATH...
    setx PATH "%BIN_DIR%;%PATH%" >nul 2>&1
    echo       PATH updated. Restart your terminal for changes to take effect.
) else (
    echo       %BIN_DIR% already in PATH
)

:: ---------------------------------------------------------------
:: 8. Verify installation
:: ---------------------------------------------------------------
echo.
echo [8/8] Verifying...
if exist "%BIN_DIR%\openclaude.cmd" (
    echo       [OK] openclaude command ready
) else (
    echo       [FAIL] openclaude.cmd not found
)

where claude >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo       [OK] claude (Anthropic CLI^) found in PATH
) else (
    echo       [INFO] claude (Anthropic CLI^) not found.
    echo              Install: npm install -g @anthropic-ai/claude-code
)

echo.
echo ============================================================
echo   Installation complete!
echo.
echo   Commands:
echo     openclaude        — OpenClaude with local Ollama
echo     openclaude qwen3  — OpenClaude with specific model
echo     claude            — Anthropic official Claude CLI
echo.
echo   Config: %CLAUDE_DIR%
echo   Bin:    %BIN_DIR%
echo ============================================================
echo.
pause
