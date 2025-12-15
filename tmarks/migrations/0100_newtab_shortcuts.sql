-- ============================================================================
-- NewTab 快捷方式表
-- 用于存储浏览器新标签页的快捷方式数据
-- ============================================================================

-- NewTab 快捷方式分组表
CREATE TABLE IF NOT EXISTS newtab_groups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'Folder',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_newtab_groups_user ON newtab_groups(user_id, position);

-- NewTab 快捷方式文件夹表
CREATE TABLE IF NOT EXISTS newtab_folders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    group_id TEXT,
    name TEXT NOT NULL,
    icon TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES newtab_groups(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_newtab_folders_user ON newtab_folders(user_id, position);
CREATE INDEX IF NOT EXISTS idx_newtab_folders_group ON newtab_folders(group_id, position);

-- NewTab 快捷方式表
CREATE TABLE IF NOT EXISTS newtab_shortcuts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    group_id TEXT,
    folder_id TEXT,
    -- 基本信息
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    favicon TEXT,
    -- 排序和统计
    position INTEGER NOT NULL DEFAULT 0,
    click_count INTEGER NOT NULL DEFAULT 0,
    last_clicked_at TEXT,
    -- 关联 TMarks 书签（可选）
    bookmark_id TEXT,
    -- 时间戳
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES newtab_groups(id) ON DELETE SET NULL,
    FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE SET NULL,
    FOREIGN KEY (folder_id) REFERENCES newtab_folders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_newtab_shortcuts_user ON newtab_shortcuts(user_id, position);
CREATE INDEX IF NOT EXISTS idx_newtab_shortcuts_group ON newtab_shortcuts(group_id, position);
CREATE INDEX IF NOT EXISTS idx_newtab_shortcuts_bookmark ON newtab_shortcuts(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_newtab_shortcuts_folder ON newtab_shortcuts(folder_id, position);

-- NewTab 用户设置表
CREATE TABLE IF NOT EXISTS newtab_settings (
    user_id TEXT PRIMARY KEY,
    -- 显示设置
    columns INTEGER NOT NULL DEFAULT 6,
    style TEXT NOT NULL DEFAULT 'card',
    show_title INTEGER NOT NULL DEFAULT 1,
    -- 背景设置
    background_type TEXT NOT NULL DEFAULT 'gradient',
    background_value TEXT,
    background_blur INTEGER NOT NULL DEFAULT 0,
    background_dim INTEGER NOT NULL DEFAULT 20,
    -- 功能开关
    show_search INTEGER NOT NULL DEFAULT 1,
    show_clock INTEGER NOT NULL DEFAULT 1,
    show_weather INTEGER NOT NULL DEFAULT 0,
    show_todo INTEGER NOT NULL DEFAULT 0,
    show_hot_search INTEGER NOT NULL DEFAULT 0,
    show_pinned_bookmarks INTEGER NOT NULL DEFAULT 1,
    -- 搜索引擎
    search_engine TEXT NOT NULL DEFAULT 'google',
    -- 组件网格模式
    use_widget_grid INTEGER NOT NULL DEFAULT 0,
    -- 时间戳
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- NewTab 网格组件表（新版组件系统）
CREATE TABLE IF NOT EXISTS newtab_grid_items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    group_id TEXT,
    -- 组件类型: shortcut, weather, clock, todo, notes, hotsearch, poetry
    type TEXT NOT NULL,
    -- 组件尺寸: 1x1, 2x1, 1x2, 2x2, 2x3, 2x4
    size TEXT NOT NULL DEFAULT '1x1',
    -- 排序位置
    position INTEGER NOT NULL DEFAULT 0,
    -- 快捷方式数据（仅 type='shortcut' 时使用）
    shortcut_url TEXT,
    shortcut_title TEXT,
    shortcut_favicon TEXT,
    -- 组件配置（JSON 格式）
    config TEXT,
    -- 时间戳
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES newtab_groups(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_newtab_grid_items_user ON newtab_grid_items(user_id, position);
CREATE INDEX IF NOT EXISTS idx_newtab_grid_items_group ON newtab_grid_items(group_id, position);

-- ============================================================================
-- 置顶书签排序支持
-- ============================================================================

-- 注意：pin_order 列已在 0100_d1_console.sql 中添加
-- 这里只需要创建索引（如果尚未创建）

-- 创建置顶书签排序索引（使用 IF NOT EXISTS 确保安全）
CREATE INDEX IF NOT EXISTS idx_bookmarks_pin_order ON bookmarks(user_id, is_pinned, pin_order);

-- 记录迁移版本
INSERT OR IGNORE INTO schema_migrations (version) VALUES ('0100');
