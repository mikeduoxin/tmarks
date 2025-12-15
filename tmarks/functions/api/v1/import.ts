/**
 * 导入 API 端点
 * 支持多种格式的书签数据导入
 */

import type { PagesFunction } from '@cloudflare/workers-types'
import type { Env, RouteParams } from '../../lib/types'
import { requireAuth, type AuthContext } from '../../middleware/auth'
import type {
  ImportFormat,
  ImportOptions,
  ImportResult,
  ImportData,
  ParsedBookmark,
  ParsedTag,
  ParsedTabGroup
} from '../../../shared/import-export-types'

import { createHtmlParser } from '../../lib/import-export/parsers/html-parser'
import { createJsonParser } from '../../lib/import-export/parsers/json-parser'
import { DEFAULT_IMPORT_OPTIONS } from '../../../shared/import-export-types'

interface ImportRequest {
  format: ImportFormat
  content: string
  options?: Partial<ImportOptions>
}

// 配置常量
const MAX_IMPORT_SIZE = 10 * 1024 * 1024 // 10MB
const IMPORT_TIMEOUT = 5 * 60 * 1000 // 5分钟

export const onRequestPost: PagesFunction<Env, RouteParams, AuthContext>[] = [
  requireAuth,
  async (context) => {
    try {
      const userId = context.data.user_id

      const { format, content, options: userOptions } = await context.request.json() as ImportRequest

      if (!content || !format) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: format and content' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // 检查文件大小
      const contentSize = new Blob([content]).size
      if (contentSize > MAX_IMPORT_SIZE) {
        return new Response(
          JSON.stringify({
            error: 'File too large',
            message: `Import file size (${(contentSize / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (${MAX_IMPORT_SIZE / 1024 / 1024}MB)`,
            suggestion: 'Please split your import file into smaller chunks or contact support for assistance.'
          }),
          { status: 413, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // 合并导入选项
      const options: ImportOptions = { ...DEFAULT_IMPORT_OPTIONS, ...userOptions }

      // 解析导入数据
      const importData = await parseImportData(format, content)

      // 验证数据
      const validation = await validateImportData(format, importData)
      if (!validation.valid) {
        return new Response(
          JSON.stringify({
            error: 'Validation failed',
            errors: validation.errors,
            warnings: validation.warnings
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // 执行导入（带超时保护）
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Import timeout - operation took too long')), IMPORT_TIMEOUT)
      })

      const result = await Promise.race([
        performImport(context.env.DB, userId, importData, options),
        timeoutPromise
      ])

      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )

    } catch (error) {
      console.error('Import error:', error)
      return new Response(
        JSON.stringify({
          error: 'Import failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }
]

/**
 * 解析导入数据
 */
async function parseImportData(format: ImportFormat, content: string) {
  switch (format) {
    case 'html': {
      const htmlParser = createHtmlParser()
      return await htmlParser.parse(content)
    }

    case 'json':
    case 'tmarks': {
      const jsonParser = createJsonParser()
      return await jsonParser.parse(content)
    }

    default:
      throw new Error(`Unsupported import format: ${format}`)
  }
}

/**
 * 验证导入数据
 */
async function validateImportData(format: ImportFormat, data: ImportData) {
  switch (format) {
    case 'html': {
      const htmlParser = createHtmlParser()
      return await htmlParser.validate(data)
    }

    case 'json':
    case 'tmarks': {
      const jsonParser = createJsonParser()
      return await jsonParser.validate(data)
    }

    default:
      return { valid: false, errors: [{ field: 'format', message: 'Unsupported format' }], warnings: [] }
  }
}

/**
 * 执行导入操作
 */
async function performImport(
  db: D1Database, 
  userId: string, 
  importData: ImportData, 
  options: ImportOptions
): Promise<ImportResult> {
  const result: ImportResult = {
    success: 0,
    failed: 0,
    skipped: 0,
    total: importData.bookmarks.length,
    errors: [],
    created_bookmarks: [],
    created_tags: [],
    created_tab_groups: [],
    tab_groups_success: 0,
    tab_groups_failed: 0
  }

  try {
    // 1. 创建标签
    if (options.create_missing_tags) {
      await createTags(db, userId, importData.tags, result, options)
    }

    // 2. 获取现有书签URL（用于去重）
    const existingUrls = options.skip_duplicates 
      ? await getExistingUrls(db, userId)
      : new Set<string>()

    // 3. 分批处理书签
    const batches = chunkArray(importData.bookmarks, options.batch_size)
    
    for (const batch of batches) {
      await processBatch(db, userId, batch, existingUrls, result, options)
    }

    // 4. 导入标签页组
    if (importData.tab_groups && importData.tab_groups.length > 0) {
      await importTabGroups(db, userId, importData.tab_groups, result, options)
    }

    return result

  } catch (error) {
    console.error('Import execution error:', error)
    throw error
  }
}

/**
 * 创建标签
 */
async function createTags(
  db: D1Database, 
  userId: string, 
  tags: ParsedTag[], 
  result: ImportResult,
  options: ImportOptions
) {
  // 获取现有标签
  const { results: existingTags } = await db.prepare(
    'SELECT name FROM tags WHERE user_id = ? AND deleted_at IS NULL'
  ).bind(userId).all()

  const existingTagNames = new Set((existingTags || []).map((tag: Record<string, unknown>) => String(tag.name)))

  // 创建新标签
  for (const tag of tags) {
    if (!existingTagNames.has(tag.name)) {
      try {
        const tagId = crypto.randomUUID()
        await db.prepare(`
          INSERT INTO tags (id, user_id, name, color, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `).bind(
          tagId,
          userId,
          tag.name,
          tag.color || options.default_tag_color
        ).run()

        result.created_tags.push(tagId)
      } catch (error) {
        console.error(`Failed to create tag: ${tag.name}`, error)
      }
    }
  }
}

/**
 * 获取现有书签URL
 */
async function getExistingUrls(db: D1Database, userId: string): Promise<Set<string>> {
  const { results: bookmarks } = await db.prepare(
    'SELECT url FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL'
  ).bind(userId).all()

  return new Set((bookmarks || []).map((bookmark: Record<string, unknown>) => String(bookmark.url)))
}

/**
 * 分批处理书签（优化版本 - 使用批量操作减少数据库查询）
 */
async function processBatch(
  db: D1Database,
  userId: string,
  bookmarks: ParsedBookmark[],
  existingUrls: Set<string>,
  result: ImportResult,
  options: ImportOptions
) {
  if (bookmarks.length === 0) return

  const now = new Date().toISOString()
  const bookmarkIds: string[] = []
  const bookmarkTagMap = new Map<string, string[]>() // bookmarkId -> tagNames
  const uncategorizedBookmarkIds: string[] = [] // 需要添加"未分类"标签的书签ID

  // 1. 批量查询所有书签URL的现有状态（分块处理以避免 SQLite 参数限制）
  const urls = bookmarks.map(b => b.url)
  const existingBookmarkMap = new Map<string, { id: string; deleted_at: string | null }>()
  
  // SQLite 默认支持最多 999 个参数，我们使用 500 作为安全限制
  const MAX_URLS_PER_QUERY = 500
  for (let i = 0; i < urls.length; i += MAX_URLS_PER_QUERY) {
    const urlChunk = urls.slice(i, i + MAX_URLS_PER_QUERY)
    const placeholders = urlChunk.map(() => '?').join(',')
    const { results: existingBookmarks } = await db
      .prepare(`SELECT id, url, deleted_at FROM bookmarks WHERE user_id = ? AND url IN (${placeholders})`)
      .bind(userId, ...urlChunk)
      .all<{ id: string; url: string; deleted_at: string | null }>()

    for (const existing of existingBookmarks || []) {
      existingBookmarkMap.set(existing.url, { id: existing.id, deleted_at: existing.deleted_at })
    }
  }

  // 2. 准备批量插入和更新的语句
  const insertStatements: D1PreparedStatement[] = []
  const updateStatements: D1PreparedStatement[] = []
  const processedBookmarks: Array<{ bookmark: ParsedBookmark; bookmarkId: string; index: number }> = []

  for (let i = 0; i < bookmarks.length; i++) {
    const bookmark = bookmarks[i]

    try {
      const existing = existingBookmarkMap.get(bookmark.url)

      if (existing) {
        if (!existing.deleted_at) {
          // URL已存在且未删除
          if (options.skip_duplicates) {
            result.skipped++
            continue
          } else {
            throw new Error(`Bookmark with URL already exists: ${bookmark.url}`)
          }
        }

        // 恢复已删除的书签
        const createdAt = options.preserve_timestamps && bookmark.created_at
          ? bookmark.created_at
          : now

        updateStatements.push(
          db.prepare(`
            UPDATE bookmarks
            SET title = ?, description = ?, cover_image = ?,
                is_archived = 0,
                deleted_at = NULL, updated_at = ?
            WHERE id = ?
          `).bind(
            bookmark.title,
            bookmark.description || null,
            bookmark.cover_image || null,
            now,
            existing.id
          )
        )

        processedBookmarks.push({ bookmark, bookmarkId: existing.id, index: i })
        bookmarkIds.push(existing.id)
      } else {
        // 创建新书签
        const bookmarkId = crypto.randomUUID()
        const createdAt = options.preserve_timestamps && bookmark.created_at
          ? bookmark.created_at
          : now

        insertStatements.push(
          db.prepare(`
            INSERT INTO bookmarks (
              id, user_id, title, url, description, cover_image,
              is_pinned, is_archived, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            bookmarkId,
            userId,
            bookmark.title,
            bookmark.url,
            bookmark.description || null,
            bookmark.cover_image || null,
            false, // 导入的书签默认不置顶
            false, // 导入的书签默认不归档
            createdAt,
            now
          )
        )

        processedBookmarks.push({ bookmark, bookmarkId, index: i })
        bookmarkIds.push(bookmarkId)
      }

      // 记录标签关联信息
      if (bookmark.tags.length > 0) {
        bookmarkTagMap.set(processedBookmarks[processedBookmarks.length - 1].bookmarkId, bookmark.tags)
      } else {
        uncategorizedBookmarkIds.push(processedBookmarks[processedBookmarks.length - 1].bookmarkId)
      }

    } catch (error) {
      result.failed++
      result.errors.push({
        index: i,
        item: bookmark,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: 'BOOKMARK_CREATION_FAILED'
      })
    }
  }

  // 3. 批量执行插入和更新
  try {
    if (insertStatements.length > 0) {
      await db.batch(insertStatements)
    }
    if (updateStatements.length > 0) {
      await db.batch(updateStatements)
    }
  } catch (error) {
    // 如果批量操作失败，记录所有书签为失败
    for (const { index, bookmark } of processedBookmarks) {
      result.failed++
      result.errors.push({
        index,
        item: bookmark,
        error: error instanceof Error ? error.message : 'Batch operation failed',
        code: 'BOOKMARK_CREATION_FAILED'
      })
    }
    return
  }

  // 4. 批量关联标签
  const { createOrLinkTags } = await import('../../lib/tags')
  
  // 获取或创建"未分类"标签
  let uncategorizedTagId: string | null = null
  if (uncategorizedBookmarkIds.length > 0) {
    const UNCATEGORIZED_TAG_NAME = '未分类'
    let uncategorizedTag = await db.prepare(
      'SELECT id FROM tags WHERE user_id = ? AND name = ? AND deleted_at IS NULL'
    ).bind(userId, UNCATEGORIZED_TAG_NAME).first<{ id: string }>()

    if (!uncategorizedTag) {
      uncategorizedTagId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO tags (id, user_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(uncategorizedTagId, userId, UNCATEGORIZED_TAG_NAME, '#9ca3af').run()
    } else {
      uncategorizedTagId = uncategorizedTag.id
    }
  }

  // 批量关联标签（使用 Promise.all 并行处理，但限制并发数）
  const tagLinkPromises: Promise<void>[] = []
  const maxConcurrent = Math.min(options.max_concurrent || 5, bookmarkTagMap.size)
  
  for (const [bookmarkId, tagNames] of bookmarkTagMap.entries()) {
    tagLinkPromises.push(
      createOrLinkTags(db, bookmarkId, tagNames, userId).catch(error => {
        console.error(`Failed to associate tags for bookmark ${bookmarkId}:`, error)
        // 不抛出错误，允许继续处理其他书签
      })
    )
  }

  // 批量关联"未分类"标签
  if (uncategorizedTagId && uncategorizedBookmarkIds.length > 0) {
    const uncategorizedLinkStatements = uncategorizedBookmarkIds.map(bookmarkId =>
      db.prepare(
        `INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at)
         VALUES (?, ?, ?, datetime('now'))`
      ).bind(bookmarkId, uncategorizedTagId, userId)
    )
    
    if (uncategorizedLinkStatements.length > 0) {
      tagLinkPromises.push(
        db.batch(uncategorizedLinkStatements).then(() => {}).catch(error => {
          console.error('Failed to link uncategorized tags:', error)
        })
      )
    }
  }

  // 限制并发执行标签关联
  if (tagLinkPromises.length > 0) {
    const chunks = []
    for (let i = 0; i < tagLinkPromises.length; i += maxConcurrent) {
      chunks.push(tagLinkPromises.slice(i, i + maxConcurrent))
    }
    for (const chunk of chunks) {
      await Promise.all(chunk)
    }
  }

  // 5. 更新结果
  result.created_bookmarks.push(...bookmarkIds)
  result.success += processedBookmarks.length
}

/**
 * 创建单个书签
 */
async function createBookmark(
  db: D1Database,
  userId: string,
  bookmark: ParsedBookmark,
  options: ImportOptions
): Promise<string | null> {
  try {
    // 检查URL是否已存在（包括已删除的）
    const existing = await db.prepare(
      'SELECT id, deleted_at FROM bookmarks WHERE user_id = ? AND url = ?'
    )
      .bind(userId, bookmark.url)
      .first<{ id: string; deleted_at: string | null }>()

    const now = new Date().toISOString()
    const createdAt = options.preserve_timestamps && bookmark.created_at
      ? bookmark.created_at
      : now

    if (existing) {
      if (!existing.deleted_at) {
        // URL已存在且未删除，跳过或抛出错误
        if (options.skip_duplicates) {
          console.log('Skipping duplicate URL:', bookmark.url)
          return null
        } else {
          throw new Error(`Bookmark with URL already exists: ${bookmark.url}`)
        }
      }

      // 恢复已删除的书签
      await db.prepare(
        `UPDATE bookmarks
         SET title = ?, description = ?, cover_image = ?,
             is_archived = 0,
             deleted_at = NULL, updated_at = ?
         WHERE id = ?`
      )
        .bind(
          bookmark.title,
          bookmark.description || null,
          bookmark.cover_image || null,
          now,
          existing.id
        )
        .run()

      return existing.id
    } else {
      // 创建新书签
      const bookmarkId = crypto.randomUUID()

      await db.prepare(`
        INSERT INTO bookmarks (
          id, user_id, title, url, description, cover_image,
          is_pinned, is_archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        bookmarkId,
        userId,
        bookmark.title,
        bookmark.url,
        bookmark.description || null,
        bookmark.cover_image || null,
        false, // 导入的书签默认不置顶
        false, // 导入的书签默认不归档
        createdAt,
        now
      ).run()

      return bookmarkId
    }

  } catch (error) {
    console.error('Failed to create bookmark:', bookmark.url, error)

    // 检查是否是UNIQUE约束错误
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      console.log('Duplicate URL detected via constraint:', bookmark.url)
      if (options.skip_duplicates) {
        return null // 跳过重复项
      }
    }

    throw error // 重新抛出错误让上层处理
  }
}

/**
 * 关联书签和标签
 * 使用优化的 createOrLinkTags 函数自动创建和链接标签
 */
async function associateBookmarkTags(
  db: D1Database,
  userId: string,
  bookmarkId: string,
  tagNames: string[]
) {
  // 导入 createOrLinkTags 函数
  const { createOrLinkTags } = await import('../../lib/tags')
  
  try {
    // 使用批量处理函数（自动创建不存在的标签并链接）
    await createOrLinkTags(db, bookmarkId, tagNames, userId)
  } catch (error) {
    console.error('Failed to associate tags:', error)
    throw error
  }
}

/**
 * 确保无标签书签有"未分类"标签
 */
async function ensureUncategorizedTag(
  db: D1Database,
  userId: string,
  bookmarkId: string
) {
  const UNCATEGORIZED_TAG_NAME = '未分类'

  try {
    // 检查"未分类"标签是否存在
    let uncategorizedTag = await db.prepare(
      'SELECT id FROM tags WHERE user_id = ? AND name = ? AND deleted_at IS NULL'
    ).bind(userId, UNCATEGORIZED_TAG_NAME).first<{ id: string }>()

    // 如果不存在,创建"未分类"标签
    if (!uncategorizedTag) {
      const tagId = crypto.randomUUID()
      await db.prepare(
        `INSERT INTO tags (id, user_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(tagId, userId, UNCATEGORIZED_TAG_NAME, '#9ca3af').run()

      uncategorizedTag = { id: tagId }
    }

    // 关联书签和"未分类"标签
    await db.prepare(
      `INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id, user_id, created_at)
       VALUES (?, ?, ?, datetime('now'))`
    ).bind(bookmarkId, uncategorizedTag.id, userId).run()

  } catch (error) {
    console.error('Failed to add uncategorized tag:', error)
    // 不抛出错误,允许书签创建成功
  }
}

/**
 * 导入标签页组
 */
async function importTabGroups(
  db: D1Database,
  userId: string,
  tabGroups: ParsedTabGroup[],
  result: ImportResult,
  options: ImportOptions
) {
  // 用于映射旧ID到新ID（处理父子关系）
  const idMapping = new Map<string, string>()

  // 先按层级排序，确保父组先创建
  const sortedGroups = [...tabGroups].sort((a, b) => {
    if (!a.parent_id && b.parent_id) return -1
    if (a.parent_id && !b.parent_id) return 1
    return a.position - b.position
  })

  for (const group of sortedGroups) {
    try {
      const now = new Date().toISOString()
      const createdAt = options.preserve_timestamps && group.created_at
        ? group.created_at
        : now
      const updatedAt = options.preserve_timestamps && group.updated_at
        ? group.updated_at
        : now

      // 生成新ID
      const newGroupId = crypto.randomUUID()
      
      // 如果有旧ID，记录映射
      if (group.id) {
        idMapping.set(group.id, newGroupId)
      }

      // 处理父ID映射
      let parentId: string | null = null
      if (group.parent_id) {
        parentId = idMapping.get(group.parent_id) || null
      }

      // 创建标签页组
      await db.prepare(`
        INSERT INTO tab_groups (
          id, user_id, title, parent_id, is_folder, position, color, tags,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        newGroupId,
        userId,
        group.title,
        parentId,
        group.is_folder ? 1 : 0,
        group.position,
        group.color || null,
        group.tags || null,
        createdAt,
        updatedAt
      ).run()

      result.created_tab_groups.push(newGroupId)

      // 导入标签页组项目
      if (group.items && group.items.length > 0) {
        for (const item of group.items) {
          try {
            const itemId = crypto.randomUUID()
            const itemCreatedAt = options.preserve_timestamps && item.created_at
              ? item.created_at
              : now

            await db.prepare(`
              INSERT INTO tab_group_items (
                id, group_id, user_id, title, url, favicon, position,
                is_pinned, is_todo, is_archived, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              itemId,
              newGroupId,
              userId,
              item.title,
              item.url,
              item.favicon || null,
              item.position,
              item.is_pinned ? 1 : 0,
              item.is_todo ? 1 : 0,
              item.is_archived ? 1 : 0,
              itemCreatedAt,
              now
            ).run()
          } catch (itemError) {
            console.error('Failed to create tab group item:', item.url, itemError)
            // 继续处理其他项目
          }
        }
      }

      result.tab_groups_success++

    } catch (error) {
      console.error('Failed to create tab group:', group.title, error)
      result.tab_groups_failed++
    }
  }
}

/**
 * 数组分块工具函数
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize))
  }
  return chunks
}

/**
 * 获取导入预览
 */
export const onRequestGet: PagesFunction<Env, RouteParams, AuthContext>[] = [
  requireAuth,
  async (context) => {
    try {
      const { searchParams } = new URL(context.request.url)
      const format = searchParams.get('format') as ImportFormat
      // const preview = searchParams.get('preview') === 'true' // 预留用于未来实现预览功能

      if (!format) {
        return new Response(
          JSON.stringify({ error: 'Missing format parameter' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // 返回支持的格式信息
      const formatInfo = {
        format,
        supported: ['html', 'json', 'tmarks'].includes(format),
        description: getFormatDescription(format),
        file_extensions: getFormatExtensions(format)
      }

      return new Response(
        JSON.stringify(formatInfo),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )

    } catch (error) {
      console.error('Import preview error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to get import preview' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }
]

function getFormatDescription(format: ImportFormat): string {
  switch (format) {
    case 'html':
      return 'Netscape bookmark format (exported from browsers)'
    case 'json':
      return 'Generic JSON bookmark format'
    case 'tmarks':
      return 'TMarks native export format'
    default:
      return 'Unknown format'
  }
}

function getFormatExtensions(format: ImportFormat): string[] {
  switch (format) {
    case 'html':
      return ['.html', '.htm']
    case 'json':
    case 'tmarks':
      return ['.json']
    default:
      return []
  }
}
