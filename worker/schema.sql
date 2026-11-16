-- 宝箧印陀罗尼 · 全球共读 D1 数据库建表语句
-- 在 Cloudflare D1 控制台执行，或通过 wrangler d1 execute 执行

-- 国家聚合表：按国家累计（供公开热力图）
CREATE TABLE IF NOT EXISTS countries (
  country   TEXT PRIMARY KEY,           -- 国家代码（ISO 3166-1 alpha-2，如 CN/US/JP）
  name      TEXT NOT NULL,              -- 国家代码（前端映射中文名）
  visits    INTEGER NOT NULL DEFAULT 0, -- 访问次数
  recites   INTEGER NOT NULL DEFAULT 0, -- 读经遍数
  last_seen INTEGER NOT NULL DEFAULT 0  -- 最后访问时间戳（毫秒）
);

-- 索引：按读经遍数排序查询
CREATE INDEX IF NOT EXISTS idx_countries_recites ON countries(recites DESC);

-- 访问明细表：记录每次访问（供管理员精确视图 + 城市级定位 + 在线统计）
CREATE TABLE IF NOT EXISTS visits (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ip        TEXT NOT NULL,              -- 访问者 IP（仅管理员可见）
  country   TEXT NOT NULL DEFAULT 'XX', -- 国家代码
  city      TEXT NOT NULL DEFAULT '',   -- 城市名（浏览器定位，可为空）
  lat       REAL,                       -- 纬度（可为空）
  lng       REAL,                       -- 经度（可为空）
  duration  INTEGER NOT NULL DEFAULT 0, -- 停留时长（秒，离开时更新）
  recites   INTEGER NOT NULL DEFAULT 0, -- 本次访问期间读经遍数
  at        INTEGER NOT NULL            -- 进入时间戳（毫秒）
);

-- 索引：按时间查询在线人数与最近明细
CREATE INDEX IF NOT EXISTS idx_visits_at ON visits(at DESC);
