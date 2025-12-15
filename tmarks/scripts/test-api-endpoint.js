#!/usr/bin/env node

/**
 * 测试注册 API 端点
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const API_URL = 'http://localhost:8787/api/v1/auth/register'

// wrangler pages dev 使用的数据库哈希
const PAGES_DEV_DB_HASH = '4adc824f96ee9818ab334916539d155200ef3610b0bfe4796c6f36bffce15147'
const dbDir = join(__dirname, '..', '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
const dbPath = join(dbDir, `${PAGES_DEV_DB_HASH}.sqlite`)

console.log('🔍 测试注册 API 端点...\n')

// 检查数据库文件是否存在
console.log('0. 检查本地数据库...')
if (!existsSync(dbPath)) {
  console.log('   ⚠️  数据库文件不存在')
  console.log('   路径:', dbPath)
  console.log('\n   请先启动一次服务器: pnpm cf:dev:no-proxy')
  process.exit(1)
} else {
  console.log('   ✅ 数据库文件存在')
}

// 直接用 sqlite3 检查 users 表
console.log('\n1. 检查 users 表是否存在...')
try {
  const result = execSync(
    `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name='users';"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
  
  if (result === 'users') {
    console.log('   ✅ users 表存在')
  } else {
    console.log('   ⚠️  users 表不存在')
    console.log('\n   请运行: pnpm db:migrate:local:no-proxy')
    console.log('   然后重启后端服务器: pnpm cf:dev:no-proxy')
    process.exit(1)
  }
} catch (error) {
  console.log('   ⚠️  无法检查表')
  console.log('   错误:', error.message)
  console.log('\n   请运行: pnpm db:migrate:local:no-proxy')
  process.exit(1)
}

// 测试数据
const testData = {
  username: 'testuser_123',
  password: 'test12345',
  email: `test${Date.now()}@example.com`
}

console.log('\n2. 测试 API 端点...')
console.log('测试数据:', testData)
console.log('请求 URL:', API_URL)

try {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(testData)
  })

  const responseText = await response.text()
  let responseData
  try {
    responseData = JSON.parse(responseText)
  } catch {
    responseData = responseText
  }

  console.log('\n响应状态:', response.status, response.statusText)
  console.log('响应体:', JSON.stringify(responseData, null, 2))

  if (response.ok) {
    console.log('\n✅ API 端点测试成功！')
  } else {
    console.log('\n❌ API 端点返回错误')
    if (responseData?.error) {
      console.log('错误代码:', responseData.error.code)
      console.log('错误消息:', responseData.error.message)
      
      if (responseData.error.message?.includes('users') || 
          responseData.error.message?.includes('数据库表') ||
          responseData.error.message?.includes('table not found')) {
        console.log('\n⚠️  数据库表未找到错误！')
        console.log('解决方案：')
        console.log('  1. 停止后端服务器')
        console.log('  2. 运行: pnpm db:migrate:local:no-proxy')
        console.log('  3. 重新启动后端服务器: pnpm cf:dev:no-proxy')
      }
    }
    process.exit(1)
  }
} catch (error) {
  console.error('\n❌ 请求失败:', error.message)
  if (error.message.includes('ECONNREFUSED') || error.message.includes('Failed to fetch')) {
    console.log('\n⚠️  后端服务器未运行！')
    console.log('请先启动后端服务器: pnpm cf:dev:no-proxy')
  }
  process.exit(1)
}
