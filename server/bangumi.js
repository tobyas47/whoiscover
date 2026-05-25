// ============ Bangumi API 词库获取 ============
const BANGUMI_BASE = 'https://api.bgm.tv';

function getToken() {
  return process.env.BANGUMI_TOKEN || '';
}

/**
 * 从 Bangumi 搜索条目，返回名称列表
 * @param {object} opts - { keyword, type, year, month, tag, sort, limit }
 * @returns {Promise<string[]>}
 */
async function fetchBangumiWords(opts = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'whoiscover-game/1.0 (https://github.com/user/whoiscover)'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const { keyword = '', type, year, month, tag, sort = 'rank', limit = 50 } = opts;

  // Build filter
  const filter = {};
  if (type != null) filter.type = Array.isArray(type) ? type : [type];
  if (tag && tag.length > 0) filter.tag = Array.isArray(tag) ? tag : [tag];
  if (year) {
    const startDate = month
      ? `${year}-${String(month).padStart(2, '0')}-01`
      : `${year}-01-01`;
    const endDate = month
      ? `${year}-${String(month).padStart(2, '0')}-31`
      : `${year}-12-31`;
    filter.air_date = [`>=${startDate}`, `<=${endDate}`];
  }

  const body = { keyword: keyword || '', sort };
  if (Object.keys(filter).length > 0) body.filter = filter;

  const url = `${BANGUMI_BASE}/v0/search/subjects?limit=${limit}&offset=0`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error(`Bangumi API error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) return [];

    // 优先用中文名，没有则用原名，过滤过长的
    const names = data.data
      .map(s => (s.name_cn && s.name_cn.trim()) || s.name)
      .filter(n => n && n.length >= 2 && n.length <= 12);

    return names;
  } catch (err) {
    console.error('Bangumi fetch error:', err.message);
    return [];
  }
}

module.exports = { fetchBangumiWords };
