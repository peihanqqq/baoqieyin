/**
 * 宝箧印陀罗尼 · 全球共读 后端 Worker
 * 部署到 Cloudflare Workers + D1（免费额度）
 *
 * 功能：
 *   POST /track  —— 上报一次「访问」或「读经」事件（前端埋点调用）
 *   GET  /stats  —— 返回聚合统计（各国访问次数、读经遍数）
 *
 * 国家定位：用 Cloudflare 免费请求头 CF-IPCountry（无需第三方库）
 */

// D1 数据库绑定名（在 Cloudflare 后台创建 D1 后，把 binding 命名为 DB）
// 表结构见 schema.sql

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 统计接口
    if (path === '/stats' && request.method === 'GET') {
      return await handleStats(env);
    }

    // 上报接口
    if (path === '/track' && request.method === 'POST') {
      return await handleTrack(request, env);
    }

    return json({ error: 'Not found' }, 404);
  },
};

/**
 * 上报一次事件
 * 请求体：{ type: 'visit' | 'recite', count?: number }
 *   type='visit'  访问事件（页面打开一次）
 *   type='recite' 读经事件（count=本次诵读遍数）
 */
async function handleTrack(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const type = body.type;
  if (type !== 'visit' && type !== 'recite') {
    return json({ error: 'type must be visit or recite' }, 400);
  }

  // 真实 IP（Cloudflare 免费提供）
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  // 国家代码（Cloudflare 免费提供，如 'CN', 'US', 'JP'）
  const country = (request.headers.get('CF-IPCountry') || 'XX').toUpperCase();

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    if (type === 'visit') {
      // 访问事件：countries 表 visits +1
      await env.DB.prepare(
        `INSERT INTO countries (country, name, visits, recites, last_seen)
         VALUES (?1, ?2, 1, 0, ?3)
         ON CONFLICT(country) DO UPDATE SET
           visits = visits + 1,
           last_seen = ?3`
      ).bind(country, country, now).run();
    } else {
      // 读经事件：recites + count
      const count = Math.max(1, Math.floor(Number(body.count) || 1));
      await env.DB.prepare(
        `INSERT INTO countries (country, name, visits, recites, last_seen)
         VALUES (?1, ?2, 0, ?4, ?3)
         ON CONFLICT(country) DO UPDATE SET
           recites = recites + ?4,
           last_seen = ?3`
      ).bind(country, country, now, count).run();
    }

    return json({ ok: true, country, ip });
  } catch (e) {
    return json({ error: 'DB error: ' + e.message }, 500);
  }
}

/**
 * 返回聚合统计
 */
async function handleStats(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT country, name, visits, recites, last_seen
       FROM countries
       WHERE visits > 0 OR recites > 0
       ORDER BY recites DESC, visits DESC`
    ).all();

    // 汇总
    let totalVisits = 0;
    let totalRecites = 0;
    results.forEach(r => {
      totalVisits += r.visits;
      totalRecites += r.recites;
    });

    return json({
      countries: results,
      totalVisits,
      totalRecites,
      countryCount: results.length,
      generatedAt: Date.now(),
    });
  } catch (e) {
    return json({ error: 'DB error: ' + e.message }, 500);
  }
}
