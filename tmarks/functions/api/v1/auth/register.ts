import type { PagesFunction } from '@cloudflare/workers-types'
import type { Env } from '../../../lib/types'
import { badRequest, created, conflict, internalError } from '../../../lib/response'
import { isValidUsername, isValidPassword, isValidEmail, sanitizeString } from '../../../lib/validation'
import { hashPassword, generateUUID } from '../../../lib/crypto'

interface RegisterRequest {
  username: string
  password: string
  email?: string
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const db = context.env.DB

    // 检查数据库连接
    if (!db) {
      console.error('Database not available: DB binding is missing')
      return internalError('数据库未配置。请检查 wrangler.toml 中的 D1 绑定')
    }

    // 检查是否允许注册
    if (context.env.ALLOW_REGISTRATION !== 'true') {
      return badRequest('注册功能当前已禁用')
    }

    const body = await context.request.json() as RegisterRequest

    // 验证输入
    if (!body.username || !body.password) {
      return badRequest('用户名和密码为必填项')
    }

    if (!isValidUsername(body.username)) {
      return badRequest('用户名必须为 3-20 个字符，且只能包含字母、数字和下划线')
    }

    if (!isValidPassword(body.password)) {
      return badRequest('密码长度至少为 8 个字符')
    }

    if (body.email && !isValidEmail(body.email)) {
      return badRequest('邮箱格式无效')
    }

    const username = sanitizeString(body.username, 20)
    const email = body.email ? sanitizeString(body.email, 255) : null

    // 测试数据库连接和表是否存在
    try {
      // 先测试基本连接
      const testResult = await db.prepare('SELECT 1 as test').first()
      if (!testResult) {
        console.error('Database connection test returned no result')
        return internalError('数据库连接测试失败。请检查 D1 绑定配置。')
      }
      console.log('Database connection test passed')
      
      // 检查 users 表是否存在
      const tableCheck = await db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
      ).first()
      
      if (!tableCheck) {
        console.error('Users table not found in database')
        return internalError('数据库表 "users" 未找到。请运行: pnpm db:migrate:local:no-proxy')
      }
      console.log('Users table exists')
    } catch (testError) {
      console.error('Database connection test failed:', testError)
      if (testError instanceof Error) {
        console.error('Error details:', {
          message: testError.message,
          stack: testError.stack,
          name: testError.name,
          dbType: typeof db,
          dbMethods: db ? Object.keys(db).slice(0, 10) : 'db is null/undefined'
        })
        if (/no such table/i.test(testError.message)) {
          return internalError('数据库表未找到。请运行: pnpm db:migrate:local:no-proxy')
        }
        if (/no such column/i.test(testError.message)) {
          return internalError('数据库架构不匹配。请运行: pnpm db:migrate:local:no-proxy')
        }
      }
      return internalError(`数据库连接失败: ${testError instanceof Error ? testError.message : '未知错误'}。请检查 D1 绑定配置并运行: pnpm db:migrate:local:no-proxy`)
    }

    // 检查用户名是否已存在
    let existingUser
    try {
      existingUser = await db.prepare(
        'SELECT id FROM users WHERE LOWER(username) = LOWER(?)'
      )
        .bind(username)
        .first()
    } catch (dbError) {
      console.error('Database query error (check username):', dbError)
      if (dbError instanceof Error) {
        if (/no such table/i.test(dbError.message)) {
          return internalError('数据库表未找到。请运行: pnpm db:migrate:local:no-proxy')
        }
        if (/no such column/i.test(dbError.message)) {
          return internalError('数据库架构不匹配。请运行: pnpm db:migrate:local:no-proxy')
        }
      }
      throw dbError
    }

    if (existingUser) {
      return conflict('用户名已存在')
    }

    // 检查邮箱是否已存在
    if (email) {
      const existingEmail = await db.prepare(
        'SELECT id FROM users WHERE LOWER(email) = LOWER(?)'
      )
        .bind(email)
        .first()

      if (existingEmail) {
        return conflict('邮箱已存在')
      }
    }

    // 哈希密码
    let passwordHash
    try {
      passwordHash = await hashPassword(body.password)
    } catch (hashError) {
      console.error('Password hashing error:', hashError)
      return internalError('密码处理失败。请重试。')
    }

    // 生成 UUID
    const userId = generateUUID()

    const now = new Date()
    const nowISO = now.toISOString()
    const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown'
    const userAgent = context.request.headers.get('User-Agent') || 'unknown'

    // 创建用户
    try {
      await db.prepare(
        `INSERT INTO users (id, username, email, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(userId, username, email, passwordHash, nowISO, nowISO)
        .run()
    } catch (dbError) {
      // 如果是唯一约束冲突，可能是并发注册导致的
      if (dbError instanceof Error && /UNIQUE constraint failed/i.test(dbError.message)) {
        // 检查是用户名还是邮箱冲突
        const checkUser = await db.prepare(
          'SELECT id FROM users WHERE LOWER(username) = LOWER(?)'
        )
          .bind(username)
          .first()
        
        if (checkUser) {
          return conflict('用户名已存在')
        }
        
        if (email) {
          const checkEmail = await db.prepare(
            'SELECT id FROM users WHERE LOWER(email) = LOWER(?)'
          )
            .bind(email)
            .first()
          
          if (checkEmail) {
            return conflict('邮箱已存在')
          }
        }
      }
      
      // 其他数据库错误，记录详细信息
      console.error('Database error during user creation:', dbError)
      throw dbError
    }

    // 创建默认偏好设置 (失败不影响注册，偏好设置可在后续使用时自动创建)
    try {
      await db.prepare(
        `INSERT INTO user_preferences (user_id, theme, page_size, view_mode, density, tag_layout, sort_by, updated_at)
         VALUES (?, 'light', 30, 'list', 'normal', 'grid', 'popular', ?)`
      )
        .bind(userId, nowISO)
        .run()
    } catch (error) {
      if (error instanceof Error && (/no such column: tag_layout/i.test(error.message) || /no such column: sort_by/i.test(error.message))) {
        // 尝试不包含 tag_layout 和 sort_by
        try {
          await db.prepare(
            `INSERT INTO user_preferences (user_id, theme, page_size, view_mode, density, updated_at)
             VALUES (?, 'light', 30, 'list', 'normal', ?)`
          )
            .bind(userId, nowISO)
            .run()
        } catch (fallbackError) {
          // 偏好设置创建失败不影响注册，只记录警告
          // 用户偏好设置会在首次访问偏好设置时自动创建
          console.warn('Failed to create user preferences during registration:', fallbackError)
        }
      } else {
        // 其他错误也不影响注册，只记录警告
        console.warn('Failed to create user preferences during registration:', error)
      }
    }

    // 记录审计日志 (失败不影响注册)
    try {
      await db.prepare(
        `INSERT INTO audit_logs (user_id, event_type, payload, ip, user_agent, created_at)
         VALUES (?, 'user.registered', ?, ?, ?, ?)`
      )
        .bind(
          userId,
          JSON.stringify({ username, email: email || null }),
          ip,
          userAgent,
          nowISO
        )
        .run()
    } catch (auditError) {
      // 审计日志失败不影响注册,只记录错误
      console.error('Failed to create audit log:', auditError)
    }

    return created({
      user: {
        id: userId,
        username,
        email: email || null,
        created_at: nowISO,
      },
    })
  } catch (error) {
    console.error('Register error:', error)
    
    // 提供更详细的错误信息
    if (error instanceof Error) {
      // 数据库相关错误
      if (/no such table/i.test(error.message)) {
        console.error('Database table not found. Error:', error.message)
        return internalError('数据库表未找到。请运行: pnpm db:migrate:local:no-proxy')
      }
      if (/no such column/i.test(error.message)) {
        console.error('Database schema mismatch. Error:', error.message)
        return internalError('数据库架构不匹配。请运行: pnpm db:migrate:local:no-proxy')
      }
      if (/UNIQUE constraint failed/i.test(error.message)) {
        return conflict('用户名或邮箱已存在')
      }
      
      // 记录详细错误信息（仅用于调试）
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      })
      
      // 返回更具体的错误信息
      return internalError(`注册失败: ${error.message}。请查看服务器日志获取详细信息。`)
    }
    
    // 未知错误类型
    console.error('Unknown error type:', typeof error, error)
    return internalError('注册失败。请查看服务器日志获取详细信息。')
  }
}
