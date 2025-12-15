#!/usr/bin/env node

/**
 * 诊断数据库问题
 * 检查 wrangler pages dev 和 wrangler d1 execute 使用的数据库是否一致
 */

import { execSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
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

console.log('🔍 诊断数据库配置问题...\n')

// 1. 检查数据库目录
const dbPath = join(__dirname, '..', '.wrangler', 'state', 'v3', 'd1')
console.log('1. 检查数据库目录...')
console.log('   路径:', dbPath)
if (existsSync(dbPath)) {
  console.log('   ✅ 数据库目录存在')
  try {
    const files = readdirSync(dbPath)
    console.log(`   📁 数据库文件数量: ${files.length}`)
    if (files.length > 0) {
      console.log('   文件列表:', files.slice(0, 5).join(', '), files.length > 5 ? '...' : '')
    }
  } catch (error) {
    console.log('   ⚠️  无法读取目录:', error.message)
  }
} else {
  console.log('   ❌ 数据库目录不存在')
  console.log('\n   请运行: pnpm db:migrate:local:no-proxy')
  process.exit(1)
}

// 2. 检查 users 表（使用 wrangler d1 execute）
console.log('\n2. 检查 users 表（通过 wrangler d1 execute）...')
try {
  const result = execSync(
    'wrangler d1 execute tmarks-prod-db --local --command="SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'users\'"',
    { stdio: 'pipe', encoding: 'utf-8', env }
  )
  if (result.includes('users')) {
    console.log('   ✅ users 表存在（通过 wrangler d1 execute）')
  } else {
    console.log('   ❌ users 表不存在（通过 wrangler d1 execute）')
    console.log('   输出:', result.substring(0, 200))
  }
} catch (error) {
  console.log('   ❌ 检查失败:', error.message)
}

// 3. 检查所有表
console.log('\n3. 检查所有表...')
try {
  const result = execSync(
    'wrangler d1 execute tmarks-prod-db --local --command="SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name"',
    { stdio: 'pipe', encoding: 'utf-8', env }
  )
  console.log('   表列表:')
  const lines = result.split('\n').filter(line => line.trim() && !line.includes('Executing'))
  lines.forEach(line => {
    if (line.trim()) {
      console.log(`     - ${line.trim()}`)
    }
  })
} catch (error) {
  console.log('   ⚠️  无法获取表列表:', error.message)
}

// 4. 检查 API 服务器状态
console.log('\n4. 检查 API 服务器状态...')
try {
  const response = await fetch('http://localhost:8787/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test', password: 'test12345' })
  })
  const responseText = await response.text()
  let responseData
  try {
    responseData = JSON.parse(responseText)
  } catch {
    responseData = responseText
  }
  
  if (response.status === 500 && 
      (responseData?.error?.message?.includes('users') || 
       responseData?.error?.message?.includes('数据库表'))) {
    console.log('   ⚠️  API 服务器返回数据库表未找到错误')
    console.log('   错误消息:', responseData?.error?.message || responseText.substring(0, 200))
    console.log('\n   💡 问题诊断:')
    console.log('      wrangler pages dev 使用的数据库与 wrangler d1 execute 使用的数据库不一致')
    console.log('\n   🔧 解决方案:')
    console.log('      1. 停止后端服务器（如果正在运行）')
    console.log('      2. 运行: pnpm db:migrate:local:no-proxy')
    console.log('      3. 重新启动后端服务器: pnpm cf:dev:no-proxy')
    console.log('      4. 等待服务器完全启动后再测试')
  } else if (response.status === 200 || response.status === 409) {
    console.log('   ✅ API 服务器正常运行（返回状态:', response.status, ')')
  } else {
    console.log('   ⚠️  API 服务器返回状态:', response.status)
    console.log('   响应:', responseText.substring(0, 200))
  }
} catch (error) {
  if (error.message.includes('ECONNREFUSED') || error.message.includes('Failed to fetch')) {
    console.log('   ℹ️  API 服务器未运行（这是正常的，如果服务器未启动）')
  } else {
    console.log('   ⚠️  无法连接到 API 服务器:', error.message)
  }
}

console.log('\n📝 总结:')
console.log('   如果 users 表通过 wrangler d1 execute 存在，但 API 返回表不存在，')
console.log('   说明 wrangler pages dev 使用的数据库与 wrangler d1 execute 使用的数据库不一致。')
console.log('   请确保在启动服务器之前运行: pnpm db:migrate:local:no-proxy')

