#!/usr/bin/env node

/**
 * 测试 D1 数据库绑定配置
 * 检查 wrangler.toml 和命令行参数是否正确
 */

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

console.log('🔍 检查 D1 数据库绑定配置...\n')

// 1. 检查 wrangler.toml
const wranglerTomlPath = join(__dirname, '..', 'wrangler.toml')
console.log('1. 检查 wrangler.toml 配置...')
try {
  const tomlContent = readFileSync(wranglerTomlPath, 'utf-8')
  
  console.log('   ✅ wrangler.toml 文件存在')
  
  // 简单检查关键配置
  if (tomlContent.includes('[[d1_databases]]')) {
    console.log('   ✅ D1 数据库配置存在')
    
    const hasBinding = tomlContent.includes('binding = "DB"')
    const hasDatabaseName = tomlContent.includes('database_name = "tmarks-prod-db"')
    
    if (hasBinding) {
      console.log('   ✅ binding = "DB"')
    } else {
      console.log('   ⚠️  警告: 未找到 binding = "DB"')
    }
    
    if (hasDatabaseName) {
      console.log('   ✅ database_name = "tmarks-prod-db"')
    } else {
      console.log('   ⚠️  警告: 未找到 database_name = "tmarks-prod-db"')
    }
    
    if (tomlContent.includes('database_id = "local"')) {
      console.log('   ⚠️  警告: database_id = "local" 可能不正确，建议移除')
    }
  } else {
    console.log('   ⚠️  警告: wrangler.toml 中没有找到 [[d1_databases]] 配置')
  }
} catch (error) {
  console.log('   ❌ 无法读取 wrangler.toml:', error.message)
}

// 2. 检查 package.json 中的命令
const packageJsonPath = join(__dirname, '..', 'package.json')
console.log('\n2. 检查 package.json 中的命令...')
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  const cfDevScript = packageJson.scripts['cf:dev']
  const cfDevNoProxyScript = packageJson.scripts['cf:dev:no-proxy']
  
  if (cfDevScript) {
    console.log('   ✅ cf:dev 脚本存在')
    if (cfDevScript.includes('--d1 DB=tmarks-prod-db')) {
      console.log('   ✅ 包含正确的 D1 绑定参数: --d1 DB=tmarks-prod-db')
    } else {
      console.log('   ⚠️  警告: cf:dev 脚本中可能缺少 D1 绑定参数')
      console.log('      当前命令:', cfDevScript)
    }
  }
  
  if (cfDevNoProxyScript) {
    console.log('   ✅ cf:dev:no-proxy 脚本存在')
    if (cfDevNoProxyScript.includes('--d1 DB=tmarks-prod-db')) {
      console.log('   ✅ 包含正确的 D1 绑定参数: --d1 DB=tmarks-prod-db')
    } else {
      console.log('   ⚠️  警告: cf:dev:no-proxy 脚本中可能缺少 D1 绑定参数')
    }
  }
} catch (error) {
  console.log('   ❌ 无法读取 package.json:', error.message)
}

// 3. 检查数据库文件
const dbPath = join(__dirname, '..', '.wrangler', 'state', 'v3', 'd1')
console.log('\n3. 检查本地数据库文件...')
if (existsSync(dbPath)) {
  console.log('   ✅ 数据库目录存在:', dbPath)
} else {
  console.log('   ⚠️  数据库目录不存在:', dbPath)
  console.log('      请运行: pnpm db:migrate:local:no-proxy')
}

console.log('\n📝 建议:')
console.log('   1. 确保 wrangler.toml 中的 D1 配置正确')
console.log('   2. 确保 package.json 中的命令包含 --d1 DB=tmarks-prod-db')
console.log('   3. 运行 pnpm db:migrate:local:no-proxy 确保数据库已迁移')
console.log('   4. 重启后端服务器（如果正在运行）')
console.log('   5. 如果问题仍然存在，尝试移除 wrangler.toml 中的 database_id')

