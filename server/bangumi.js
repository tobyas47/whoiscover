// ============ Bangumi API 词库获取 ============
const BANGUMI_BASE = 'https://api.bgm.tv';

function getToken() {
  return process.env.BANGUMI_TOKEN || '';
}

/**
 * 从 Bangumi 搜索条目，返回名称列表
 * @param {object} opts - { keyword, type, year, yearEnd, month, tag, sort, limit, rankMax, ratingMin }
 * @returns {Promise<string[]>}
 */
async function fetchBangumiWords(opts = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'whoiscover-game/1.0 (https://github.com/user/whoiscover)'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const { keyword = '', type, year, yearEnd, month, tag, sort = 'rank', limit = 50, offset = 0, rankMax, rankMin, ratingMin, ratingMax, ratingCountMin, ratingCountMax, nsfw } = opts;

  const filter = {};
  if (type != null) filter.type = Array.isArray(type) ? type : [type];
  if (tag && tag.length > 0) filter.tag = Array.isArray(tag) ? tag : [tag];
  filter.nsfw = nsfw === true ? true : false;
  if (rankMax || rankMin) {
    const rankConds = [];
    if (rankMin) rankConds.push(`>=${rankMin}`);
    if (rankMax) rankConds.push(`<=${rankMax}`);
    filter.rank = rankConds;
  }
  const ratingConds = [];
  if (ratingMin) ratingConds.push(`>=${ratingMin}`);
  if (ratingMax) ratingConds.push(`<=${ratingMax}`);
  if (ratingConds.length > 0) filter.rating = ratingConds;
  const rcConds = [];
  if (ratingCountMin) rcConds.push(`>=${ratingCountMin}`);
  if (ratingCountMax) rcConds.push(`<=${ratingCountMax}`);
  if (rcConds.length > 0) filter.rating_count = rcConds;

  if (year || yearEnd) {
    const startYear = year ? parseInt(year) : null;
    const endYear = yearEnd ? parseInt(yearEnd) : startYear;
    const m = month ? parseInt(month) : null;

    const airDate = [];

    if (startYear) {
      const startStr = m
        ? `${startYear}-${String(m).padStart(2, '0')}-01`
        : `${startYear}-01-01`;
      airDate.push(`>=${startStr}`);
    }

    if (endYear) {
      if (m) {
        // end of the 3-month season quarter in endYear
        const nextM = (m + 3 > 12) ? m + 3 - 12 : m + 3;
        const nextY = (m + 3 > 12) ? endYear + 1 : endYear;
        airDate.push(`<${nextY}-${String(nextM).padStart(2, '0')}-01`);
      } else {
        airDate.push(`<=${endYear}-12-31`);
      }
    }

    if (airDate.length > 0) filter.air_date = airDate;
  }

  const body = { keyword: keyword || '', sort };
  if (Object.keys(filter).length > 0) body.filter = filter;

  const url = `${BANGUMI_BASE}/v0/search/subjects?limit=${limit}&offset=${offset}`;

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

    // 优先用中文名，没有则用原名，过滤过长的；同时保留封面图、年份、评分
    const subjects = data.data
      .map(s => {
        const name = (s.name_cn && s.name_cn.trim()) || s.name;
        const imageUrl = s.images?.large || s.images?.common || null;
        const year = s.date ? parseInt(s.date.slice(0, 4)) || null : null;
        const score = s.rating?.score || null;
        return {
          name,
          imageUrl: imageUrl && !imageUrl.includes('no_icon_subject') ? imageUrl : null,
          year,
          score,
        };
      })
      .filter(s => s.name && s.name.length >= 2 && s.name.length <= 30);

    return subjects;
  } catch (err) {
    console.error('Bangumi fetch error:', err.message);
    return [];
  }
}

module.exports = { fetchBangumiWords };
