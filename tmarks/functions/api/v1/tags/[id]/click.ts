/**
 * 用户 API - 标签点击计数
 * 路径: /api/v1/tags/:id/click
 * 认证: JWT Token
 */

import type { PagesFunction } from '@cloudflare/workers-types'
import type { Env, RouteParams } from '../../../../lib/types'
import { success, notFound, internalError } from '../../../../lib/response'
import { requireAuth, AuthContext } from '../../../../middleware/auth'

// PATCH /api/v1/tags/:id/click - 增加标签点击计数
export const onRequestPatch: PagesFunction<Env, RouteParams, AuthContext>[] = [
  requireAuth,
  async (context) => {
    const userId = context.data.user_id
    const tagId = context.params.id

    try {
      // 检查标签是否存在
      const existing = await context.env.DB.prepare(
        'SELECT id FROM tags WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
      )
        .bind(tagId, userId)
        .first()

      if (!existing) {
        return notFound('Tag not found')
      }

      const now = new Date().toISOString()

      // 增加点击计数并更新最后点击时间
      await context.env.DB.prepare(
        `UPDATE tags 
         SET click_count = click_count + 1, 
             last_clicked_at = ?,
             updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
        .bind(now, now, tagId, userId)
        .run()

      return success({ message: 'Click count incremented' })
    } catch (error) {
      console.error('Increment tag click count error:', error)
      return internalError('Failed to increment click count')
    }
  },
]

