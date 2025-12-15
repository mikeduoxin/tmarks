#!/usr/bin/env node

/**
 * 测试本地 D1 数据库连接
 * 直接检查 wrangler pages dev 使用的数据库
 */

import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// wrangler pages dev 使用的数据库哈希
const PAGES_DEV_DB_HASH = '4adc824f96ee9818ab334916539d155200ef3610b0bfe4796c6f36bffce15147'
const dbDir = join(__dirname, '..', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
const dbPath = join(dbDir, `${PAGES_DEV_DB_HASH}.sqlite`)

console.log('🔍 测试本地 D1 数据库连接...\n')

// 检查数据库文件是否存在
console.log('0. 检查数据库文件...')
if (!existsSync(dbPath)) {
  console.log('   ⚠️  数据库文件不存在')
  console.log('   路径:', dbPath)
  console.log('\n   请先启动一次服务器: pnpm cf:dev:no-proxy')
  process.exit(1)
} else {
  console.log('   ✅ 数据库文件存在')
  console.log('   路径:', dbPath)
}

try {
  // 测试 1: 检查数据库是否可读
  console.log('\n1. 检查数据库连接...')
  try {
    execSync(`sqlite3 "${dbPath}" "SELECT 1"`, {
      stdio: 'pipe',
      encoding: 'utf-8'
    })
    console.log('   ✅ 数据库连接成功')
  } catch (error) {
    console.log('   ❌ 数据库连接失败')
    console.log('   错误:', error.message)
    process.exit(1)
  }

  // 测试 2: 检查 users 表是否存在
  console.log('\n2. 检查 users 表是否存在...')
  try {
    const result = execSync(
      `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name='users';"`,
      { stdio: 'pipe', encoding: 'utf-8' }
    ).trim()
    
    if (result === 'users') {
      console.log('   ✅ users 表存在')
    } else {
      console.log('   ❌ users 表不存在')
      console.log('\n   请运行: pnpm db:migrate:local:no-proxy')
      process.exit(1)
    }
  } catch (error) {
    console.log('   ❌ 检查表失败')
    console.log('   错误:', error.message)
    console.log('\n   请运行: pnpm db:migrate:local:no-proxy')
    process.exit(1)
  }

  // 测试 3: 检查表结构
  console.log('\n3. 检查 users 表结构...')
  try {
    const result = execSync(
      `sqlite3 "${dbPath}" "PRAGMA table_info(users);"`,
      { stdio: 'pipe', encoding: 'utf-8' }
    )
    const columns = result.trim().split('\n').length
    console.log('   ✅ 表结构检查完成')
    console.log(`   列数量: ${columns}`)
  } catch (error) {
    console.log('   ⚠️  无法检查表结构:', error.message)
  }

  // 测试 4: 列出所有表
  console.log('\n4. 数据库中的所有表...')
  try {
    const result = execSync(
      `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name;"`,
      { stdio: 'pipe', encoding: 'utf-8' }
    )
    const tables = result.trim().split('\n').filter(t => t)
    console.log(`   表数量: ${tables.length}`)
    tables.forEach(t => console.log(`   - ${t}`))
  } catch (error) {
    console.log('   ⚠️  无法列出表:', error.message)
  }

  console.log('\n✅ 数据库连接测试通过！')
  console.log('   数据库已正确配置，可以启动后端服务器了。')
} catch (error) {
  console.error('❌ 测试失败:', error.message)
  process.exit(1)
}
