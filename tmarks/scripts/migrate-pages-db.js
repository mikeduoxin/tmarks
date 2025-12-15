#!/usr/bin/env node

/**
 * 直接迁移 wrangler pages dev 使用的本地数据库
 * 
 * 这个脚本直接使用 sqlite3 对 pages dev 创建的数据库执行迁移 SQL，
 * 避免了 wrangler d1 execute 和 wrangler pages dev 使用不同数据库的问题。
 */

import { execSync } from 'child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const dbDir = join(__dirname, '..', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
const migrationsDir = join(__dirname, '..', 'migrations')

// wrangler pages dev --d1 DB=tmarks-prod-db 创建的数据库哈希
// 这是基于绑定名称 "DB" 和数据库名称 "tmarks-prod-db" 计算的
const PAGES_DEV_DB_HASH = '4adc824f96ee9818ab334916539d155200ef3610b0bfe4796c6f36bffce15147'

console.log('🔄 迁移 Pages Dev 本地数据库...\n')

// 检查数据库目录
if (!existsSync(dbDir)) {
  console.log('⚠️  数据库目录不存在，将在首次启动 pages dev 时创建')
  console.log('   请先运行: pnpm cf:dev:no-proxy')
  console.log('   然后再运行此迁移脚本')
  process.exit(0)
}

// 查找 pages dev 使用的数据库
const dbPath = join(dbDir, `${PAGES_DEV_DB_HASH}.sqlite`)

if (!existsSync(dbPath)) {
  console.log('⚠️  Pages Dev 数据库不存在')
  console.log('   请先运行: pnpm cf:dev:no-proxy (启动后立即停止)')
  console.log('   然后再运行此迁移脚本')
  process.exit(0)
}

console.log(`📁 数据库路径: ${dbPath}`)

// 检查是否已有 users 表
try {
  const result = execSync(
    `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name='users';"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
  
  if (result === 'users') {
    console.log('✅ 数据库已包含 users 表，无需迁移')
    process.exit(0)
  }
} catch (error) {
  // 继续迁移
}

// 获取迁移文件
const migrationFiles = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql') && /^\d{4}_/.test(f))
  .sort()

if (migrationFiles.length === 0) {
  console.log('❌ 没有找到迁移文件')
  process.exit(1)
}

console.log(`\n📋 迁移文件: ${migrationFiles.join(', ')}\n`)

// 执行迁移
for (const file of migrationFiles) {
  const filePath = join(migrationsDir, file)
  const sql = readFileSync(filePath, 'utf-8')
  
  // 跳过空文件或只有注释的文件
  const hasContent = sql.split('\n').some(line => {
    const trimmed = line.trim()
    return trimmed && !trimmed.startsWith('--')
  })
  
  if (!hasContent) {
    console.log(`⏭️  跳过空文件: ${file}`)
    continue
  }
  
  console.log(`📝 执行: ${file}`)
  
  try {
    // 将 SQL 写入临时文件然后执行（处理复杂 SQL）
    const tempSqlFile = join(__dirname, '..', '.temp-migration.sql')
    writeFileSync(tempSqlFile, sql)
    
    execSync(`sqlite3 "${dbPath}" < "${tempSqlFile}"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    })
    
    // 删除临时文件
    unlinkSync(tempSqlFile)
    
    console.log(`   ✅ 成功`)
  } catch (error) {
    // 检查是否是"表已存在"错误（可以忽略）
    if (error.message.includes('already exists') || 
        error.message.includes('duplicate column')) {
      console.log(`   ⚠️  部分已存在，继续...`)
    } else {
      console.log(`   ❌ 失败: ${error.message}`)
      // 不退出，继续尝试其他迁移
    }
  }
}

// 验证迁移结果
console.log('\n🔍 验证迁移结果...')
try {
  const tables = execSync(
    `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim().split('\n').filter(t => t && !t.startsWith('_'))
  
  console.log(`   表数量: ${tables.length}`)
  
  if (tables.includes('users')) {
    console.log('   ✅ users 表存在')
  } else {
    console.log('   ❌ users 表不存在')
    process.exit(1)
  }
} catch (error) {
  console.log(`   ❌ 验证失败: ${error.message}`)
  process.exit(1)
}

console.log('\n✅ 迁移完成！')

