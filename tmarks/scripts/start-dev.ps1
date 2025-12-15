# 启动开发服务器的 PowerShell 脚本
# 解决代理环境变量格式问题

# 检查并修复代理环境变量
$proxyVars = @('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy')
$needsFix = $false

foreach ($var in $proxyVars) {
    $value = [Environment]::GetEnvironmentVariable($var, 'User')
    if ($value -and $value -notmatch '^https?://') {
        Write-Host "检测到格式不正确的代理变量: $var = $value" -ForegroundColor Yellow
        Write-Host "修复为: http://$value" -ForegroundColor Green
        [Environment]::SetEnvironmentVariable($var, "http://$value", 'User')
        $needsFix = $true
    }
}

if ($needsFix) {
    Write-Host "`n已修复代理环境变量。请重新打开终端或运行以下命令刷新环境变量：" -ForegroundColor Cyan
    Write-Host '$env:HTTP_PROXY = "http://127.0.0.1:10808"' -ForegroundColor Yellow
    Write-Host '$env:HTTPS_PROXY = "http://127.0.0.1:10808"' -ForegroundColor Yellow
    Write-Host "`n或者临时禁用代理运行 Wrangler：" -ForegroundColor Cyan
    Write-Host '$env:HTTP_PROXY = ""; $env:HTTPS_PROXY = ""; pnpm cf:dev' -ForegroundColor Yellow
    exit
}

# 启动 Wrangler 开发服务器
Write-Host "启动 Wrangler 开发服务器..." -ForegroundColor Green
pnpm cf:dev

