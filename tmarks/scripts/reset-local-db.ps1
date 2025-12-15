# 重置本地 D1 数据库
# 删除本地数据库文件，然后重新运行迁移

Write-Host "🗑️  正在删除本地数据库..." -ForegroundColor Yellow

$dbPath = ".wrangler\state\v3\d1"

if (Test-Path $dbPath) {
    Remove-Item -Recurse -Force $dbPath
    Write-Host "✅ 已删除本地数据库" -ForegroundColor Green
} else {
    Write-Host "ℹ️  本地数据库不存在，无需删除" -ForegroundColor Cyan
}

Write-Host "`n🔄 正在重新运行迁移..." -ForegroundColor Blue
Write-Host "   运行: pnpm db:migrate:local:no-proxy" -ForegroundColor Gray
Write-Host ""

# 运行迁移
pnpm db:migrate:local:no-proxy

