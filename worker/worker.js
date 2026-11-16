/**
 * 宝箧印陀罗尼 · 全球共读 后端 Worker
 * 部署到 Cloudflare Workers + D1（免费额度）
 *
 * 功能：
 *   POST /track   —— 上报「访问/读经/离开」事件（含城市、经纬度、停留时长）
 *   GET  /stats   —— 返回公开聚合统计（各国访问次数、读经遍数、城市点）
 *   GET  /admin   —— 管理员精确视图（IP、城市、时长、在线人数，需密码）
 *
 * 国家定位：Cloudflare 免费请求头 CF-IPCountry
 * 城市定位：由前端浏览器 Geolocation API 上报（lat/lng/city），Worker 存明细
 */

// 管理员密码（通过环境变量 ADMIN_PASSWORD 配置，部署时用 wrangler secret put）
const ADMIN_PASSWORD = '84000stupa';  // 默认值；强烈建议用 secret 覆盖

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

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === '/stats' && request.method === 'GET') {
      return await handleStats(env);
    }

    if (path === '/admin' && request.method === 'GET') {
      return await handleAdmin(request, env);
    }

    if (path === '/track' && request.method === 'POST') {
      return await handleTrack(request, env);
    }

    return json({ error: 'Not found' }, 404);
  },
};

/**
 * 上报事件
 * 请求体：
 *   { type:'visit',    city?, lat?, lng? }              —— 进入页面（新建明细记录）
 *   { type:'recite',   count, vid? }                    —— 读经（累加遍数）
 *   { type:'leave',    vid, duration }                  —— 离开（回填停留时长）
 */
async function handleTrack(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }

  const type = body.type;
  if (!['visit', 'recite', 'leave'].includes(type)) {
    return json({ error: 'type must be visit / recite / leave' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const country = (request.headers.get('CF-IPCountry') || 'XX').toUpperCase();
  const now = Date.now();

  try {
    if (type === 'visit') {
      // 新建一条访问明细
      const city = String(body.city || '').slice(0, 60);
      const lat = body.lat != null ? Number(body.lat) : null;
      const lng = body.lng != null ? Number(body.lng) : null;
      const res = await env.DB.prepare(
        `INSERT INTO visits (ip, country, city, lat, lng, duration, recites, at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6)`
      ).bind(ip, country, city, lat, lng, now).run();

      const vid = res.meta && res.meta.last_row_id ? res.meta.last_row_id : null;

      // 国家聚合 visits +1
      await env.DB.prepare(
        `INSERT INTO countries (country, name, visits, recites, last_seen)
         VALUES (?1, ?1, 1, 0, ?2)
         ON CONFLICT(country) DO UPDATE SET visits = visits + 1, last_seen = ?2`
      ).bind(country, now).run();

      return json({ ok: true, vid, country, ip });

    } else if (type === 'recite') {
      const count = Math.max(1, Math.floor(Number(body.count) || 1));
      // 国家聚合 recites +count
      await env.DB.prepare(
        `INSERT INTO countries (country, name, visits, recites, last_seen)
         VALUES (?1, ?1, 0, ?2, ?3)
         ON CONFLICT(country) DO UPDATE SET recites = recites + ?2, last_seen = ?3`
      ).bind(country, count, now).run();

      // 若有明细 id，累加本次访问的读经遍数
      if (body.vid != null) {
        await env.DB.prepare(
          `UPDATE visits SET recites = recites + ?1, at = ?2 WHERE id = ?3`
        ).bind(count, now, Number(body.vid)).run();
      }
      return json({ ok: true, country });

    } else { // leave
      if (body.vid == null) return json({ ok: true, skipped: 'no vid' });
      const duration = Math.max(0, Math.floor(Number(body.duration) || 0));
      await env.DB.prepare(
        `UPDATE visits SET duration = ?1 WHERE id = ?2`
      ).bind(duration, Number(body.vid)).run();
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: 'DB error: ' + e.message }, 500);
  }
}

/**
 * 公开聚合统计：国家级 + 城市级
 */
async function handleStats(env) {
  try {
    const { results: countries } = await env.DB.prepare(
      `SELECT country, name, visits, recites, last_seen
       FROM countries WHERE visits > 0 OR recites > 0
       ORDER BY recites DESC, visits DESC`
    ).all();

    let totalVisits = 0, totalRecites = 0;
    countries.forEach(r => { totalVisits += r.visits; totalRecites += r.recites; });

    // 城市级聚合（有经纬度的访问，按城市去重计数）
    const { results: cityRows } = await env.DB.prepare(
      `SELECT city, lat, lng, COUNT(*) AS cnt, SUM(recites) AS rec
       FROM visits
       WHERE city != '' AND lat IS NOT NULL AND lng IS NOT NULL
       GROUP BY city, lat, lng
       ORDER BY rec DESC, cnt DESC
       LIMIT 200`
    ).all();

    return json({
      countries,
      cities: cityRows.map(c => ({ city: c.city, lat: c.lat, lng: c.lng, visits: c.cnt, recites: c.rec || 0 })),
      totalVisits,
      totalRecites,
      countryCount: countries.length,
      cityCount: cityRows.length,
      generatedAt: Date.now(),
    });
  } catch (e) {
    return json({ error: 'DB error: ' + e.message }, 500);
  }
}

/**
 * 管理员精确视图（需密码）
 *   GET /admin?pw=<密码>
 * 返回：精确 IP、城市、经纬度、停留时长、读经遍数、在线人数
 */
async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const pw = url.searchParams.get('pw') || '';

  const correct = (env.ADMIN_PASSWORD || ADMIN_PASSWORD);
  if (pw !== correct) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { results: visits } = await env.DB.prepare(
      `SELECT id, ip, country, city, lat, lng, duration, recites, at
       FROM visits ORDER BY at DESC LIMIT 200`
    ).all();

    // 在线人数：最近 5 分钟内有活动的访问
    const fiveMin = Date.now() - 5 * 60 * 1000;
    const { results: online } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM visits WHERE at >= ?1`
    ).bind(fiveMin).all();

    const { results: agg } = await env.DB.prepare(
      `SELECT
         COUNT(*) AS totalVisits,
         COALESCE(SUM(duration),0) AS totalDuration,
         COALESCE(SUM(recites),0) AS totalRecites
       FROM visits`
    ).all();

    return json({
      visits,
      online: online[0] ? online[0].n : 0,
      agg: agg[0] || { totalVisits: 0, totalDuration: 0, totalRecites: 0 },
      generatedAt: Date.now(),
    });
  } catch (e) {
    return json({ error: 'DB error: ' + e.message }, 500);
  }
}
