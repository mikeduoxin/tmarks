#!/usr/bin/env node

/**
 * 确保本地数据库已迁移
 * 在启动 wrangler pages dev 之前运行此脚本
 * 
 * 直接操作 wrangler pages dev 使用的数据库，避免双数据库问题
 */

import { execSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 清除代理环境变量
const env = { ...process.env }
delete env.HTTP_PROXY
delete env.HTTPS_PROXY
delete env.http_proxy
delete env.https_proxy

console.log('🔍 检查本地数据库迁移状态...\n')

const dbDir = join(__dirname, '..', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
const migrationsDir = join(__dirname, '..', 'migrations')

// wrangler pages dev --d1 DB=tmarks-prod-db 创建的数据库哈希
const PAGES_DEV_DB_HASH = '4adc824f96ee9818ab334916539d155200ef3610b0bfe4796c6f36bffce15147'
const dbPath = join(dbDir, `${PAGES_DEV_DB_HASH}.sqlite`)

// 检查数据库是否存在
if (!existsSync(dbPath)) {
  console.log('⚠️  数据库文件不存在，将在 pages dev 启动时自动创建')
  console.log('   首次启动后需要重启服务器以应用迁移\n')
  console.log('✅ 数据库迁移检查完成')
  process.exit(0)
}

console.log(`📁 数据库: ${dbPath}`)

// 检查是否已有 users 表
let hasUsersTable = false
try {
  const result = execSync(
    `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name='users';"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
  
  hasUsersTable = result === 'users'
} catch (error) {
  // 数据库可能是新创建的
}

if (hasUsersTable) {
  console.log('✅ users 表存在，数据库已正确迁移\n')
  console.log('✅ 数据库迁移检查完成，可以启动服务器了')
  process.exit(0)
}

// 需要执行迁移
console.log('⚠️  users 表不存在，执行迁移...\n')

// 获取迁移文件
const migrationFiles = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql') && /^\d{4}_/.test(f))
  .sort()

if (migrationFiles.length === 0) {
  console.log('❌ 没有找到迁移文件')
  process.exit(1)
}

// 执行迁移
for (const file of migrationFiles) {
  const filePath = join(migrationsDir, file)
  const sql = readFileSync(filePath, 'utf-8')
  
  // 跳过空文件
  const hasContent = sql.split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed && !trimmed.startsWith('--')
  })
  
  if (!hasContent) {
    continue
  }
  
  console.log(`📝 执行: ${file}`)
  
  try {
    const tempSqlFile = join(__dirname, '..', '.temp-migration.sql')
    writeFileSync(tempSqlFile, sql)
    
    execSync(`sqlite3 "${dbPath}" < "${tempSqlFile}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    })
    
    unlinkSync(tempSqlFile)
    console.log(`   ✅ 成功`)
  } catch (error) {
    if (error.message.includes('already exists') || 
        error.message.includes('duplicate column')) {
      console.log(`   ⚠️  部分已存在，继续...`)
    } else {
      console.log(`   ⚠️  警告: ${error.message.substring(0, 100)}`)
    }
  }
}

// 验证
try {
  const result = execSync(
    `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name='users';"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
  
  if (result === 'users') {
    console.log('\n✅ 迁移完成，users 表已创建')
  } else {
    console.log('\n❌ 迁移失败，users 表未创建')
    process.exit(1)
  }
} catch (error) {
  console.log('\n❌ 验证失败:', error.message)
  process.exit(1)
}

console.log('\n✅ 数据库迁移检查完成，可以启动服务器了')
