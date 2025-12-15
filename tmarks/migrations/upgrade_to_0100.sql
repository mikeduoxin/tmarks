-- ============================================================================
-- 升级到 0100 版本
-- 适用于已有 0001 版本数据库的增量迁移
-- 在 Cloudflare D1 控制台执行
-- ============================================================================

-- NewTab 快捷方式分组表
CREATE TABLE IF NOT EXISTS newtab_groups (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'Folder', position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS idx_newtab_groups_user ON newtab_groups(user_id, position);

-- NewTab 文件夹表
CREATE TABLE IF NOT EXISTS newtab_folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, group_id TEXT, name TEXT NOT NULL, icon TEXT, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (group_id) REFERENCES newtab_groups(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_newtab_folders_user ON newtab_folders(user_id, position);
CREATE INDEX IF NOT EXISTS idx_newtab_folders_group ON newtab_folders(group_id, position);

-- NewTab 快捷方式表
CREATE TABLE IF NOT EXISTS newtab_shortcuts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, group_id TEXT, folder_id TEXT, title TEXT NOT NULL, url TEXT NOT NULL, favicon TEXT, position INTEGER NOT NULL DEFAULT 0, click_count INTEGER NOT NULL DEFAULT 0, last_clicked_at TEXT, bookmark_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (group_id) REFERENCES newtab_groups(id) ON DELETE SET NULL, FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL, FOREIGN KEY (folder_id) REFERENCES newtab_folders(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_newtab_shortcuts_user ON newtab_shortcuts(user_id, position);
CREATE INDEX IF NOT EXISTS idx_newtab_shortcuts_group ON newtab_shortcuts(group_id, position);
CREATE INDEX IF NOT EXISTS idx_newtab_shortcuts_bookmark ON newtab_shortcuts(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_newtab_shortcuts_folder ON newtab_shortcuts(folder_id, position);

-- NewTab 设置表
CREATE TABLE IF NOT EXISTS newtab_settings (user_id TEXT PRIMARY KEY, columns INTEGER NOT NULL DEFAULT 6, style TEXT NOT NULL DEFAULT 'card', show_title INTEGER NOT NULL DEFAULT 1, background_type TEXT NOT NULL DEFAULT 'gradient', background_value TEXT, background_blur INTEGER NOT NULL DEFAULT 0, background_dim INTEGER NOT NULL DEFAULT 20, show_search INTEGER NOT NULL DEFAULT 1, show_clock INTEGER NOT NULL DEFAULT 1, show_weather INTEGER NOT NULL DEFAULT 0, show_todo INTEGER NOT NULL DEFAULT 0, show_hot_search INTEGER NOT NULL DEFAULT 0, show_pinned_bookmarks INTEGER NOT NULL DEFAULT 1, search_engine TEXT NOT NULL DEFAULT 'google', use_widget_grid INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);

-- NewTab 网格组件表
CREATE TABLE IF NOT EXISTS newtab_grid_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, group_id TEXT, type TEXT NOT NULL, size TEXT NOT NULL DEFAULT '1x1', position INTEGER NOT NULL DEFAULT 0, shortcut_url TEXT, shortcut_title TEXT, shortcut_favicon TEXT, config TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (group_id) REFERENCES newtab_groups(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS idx_newtab_grid_items_user ON newtab_grid_items(user_id, position);
CREATE INDEX IF NOT EXISTS idx_newtab_grid_items_group ON newtab_grid_items(group_id, position);

-- 添加 pin_order 列（如果不存在）
-- 注意：D1 不支持 IF NOT EXISTS 语法，如果列已存在会报错，可以忽略该错误
ALTER TABLE bookmarks ADD COLUMN pin_order INTEGER NOT NULL DEFAULT 0;

-- 创建置顶排序索引
CREATE INDEX IF NOT EXISTS idx_bookmarks_pin_order ON bookmarks(user_id, is_pinned, pin_order);

-- 记录迁移版本
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0100');

