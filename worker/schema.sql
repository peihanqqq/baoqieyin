-- 宝箧印陀罗尼 · 全球共读 D1 数据库建表语句
-- 在 Cloudflare D1 控制台执行，或通过 wrangler d1 execute 执行

CREATE TABLE IF NOT EXISTS countries (
  country   TEXT PRIMARY KEY,          -- 国家代码（ISO 3166-1 alpha-2，如 CN/US/JP）
  name      TEXT NOT NULL,             -- 国家代码（暂用代码，前端可映射中文名）
  visits    INTEGER NOT NULL DEFAULT 0, -- 访问次数
  recites   INTEGER NOT NULL DEFAULT 0, -- 读经遍数
  last_seen INTEGER NOT NULL DEFAULT 0  -- 最后访问时间戳（毫秒）
);

-- 可选：索引（按读经遍数排序查询）
CREATE INDEX IF NOT EXISTS idx_countries_recites ON countries(recites DESC);
