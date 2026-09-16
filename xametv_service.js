// XameTV catalogue service
//
// Uses GitHub-hosted iptv-org source data instead of the
// iptv-org GitHub Pages API, because raw.githubusercontent.com
// is reachable from the XamePage environment.
//
// Existing XameTV Flutter UI can consume the returned objects
// without modification.

const https = require('https');

const RAW_IPTV =
  'https://raw.githubusercontent.com/iptv-org/iptv/master';

const RAW_DB =
  'https://raw.githubusercontent.com/iptv-org/database/master';

const GITHUB_API =
  'https://api.github.com/repos/iptv-org/iptv/contents/streams';

const CACHE_TTL = 6 * 60 * 60 * 1000;

const MAX_CONCURRENT = 8;

let cache = {
  expiresAt: 0,
  channels: null,
};

function getText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'XamePage-XameTV/1.0',
        ...headers,
      },
    }, res => {
      let body = '';

      res.setEncoding('utf8');

      res.on('data', chunk => {
        body += chunk;
      });

      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }

        resolve(body);
      });
    });

    req.setTimeout(30000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });

    req.on('error', reject);
  });
}

async function getJson(url) {
  const body = await getText(url, {
    Accept: 'application/vnd.github+json',
  });

  return JSON.parse(body);
}

function parseCsvLine(line) {
  const result = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      result.push(value);
      value = '';
    } else {
      value += ch;
    }
  }

  result.push(value);
  return result;
}

function parseCsv(content) {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);

  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });

    return row;
  });
}

function categoryName(categories) {
  const values = Array.isArray(categories)
    ? categories
    : String(categories || '')
        .split(';')
        .map(v => v.trim())
        .filter(Boolean);

  const map = {
    news: 'News',
    sports: 'Sports',
    movies: 'Movies',
    entertainment: 'Entertainment',
    music: 'Music',
    kids: 'Kids',
    animation: 'Kids',
    series: 'Series',
    documentary: 'Documentary',
  };

  for (const category of values) {
    if (map[String(category).toLowerCase()]) {
      return map[String(category).toLowerCase()];
    }
  }

  return 'General';
}

function parseExtInf(line) {
  const attributes = {};

  const attrRegex = /([\w-]+)="([^"]*)"/g;
  let match;

  while ((match = attrRegex.exec(line)) !== null) {
    attributes[match[1]] = match[2];
  }

  const comma = line.indexOf(',');

  const title = comma >= 0
    ? line.slice(comma + 1).trim()
    : '';

  return {
    title,
    attributes,
  };
}

function parseM3u(content, countryCode, channelMap) {
  const result = [];

  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line.startsWith('#EXTINF')) continue;

    const info = parseExtInf(line);

    let url = '';

    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();

      if (!candidate) continue;

      if (candidate.startsWith('#')) {
        // Preserve EXT-X directives but keep searching for the URL.
        continue;
      }

      url = candidate;
      break;
    }

    if (!/^https?:\/\//i.test(url)) continue;

    const tvgId =
      info.attributes['tvg-id'] ||
      '';

    // tvg-id commonly looks like:
    // ChannelsTV.ng@SD
    //
    // Remove the feed suffix so it can be matched against
    // database/data/channels.csv.
    const channelId = tvgId
      ? tvgId.split('@')[0]
      : '';

    const metadata = channelId
      ? channelMap.get(channelId)
      : null;

    const name =
      info.title ||
      (metadata && metadata.name) ||
      channelId ||
      'Unknown Channel';

    const country =
      (metadata && metadata.country) ||
      countryCode ||
      '';

    const categories =
      metadata && metadata.categories
        ? metadata.categories
        : '';

    const logo =
      info.attributes['tvg-logo'] ||
      '';

    const language =
      info.attributes['tvg-language'] ||
      '';

    const referrer =
      info.attributes['http-referrer'] ||
      '';

    result.push({
      name,
      category: categoryName(categories),
      streamUrl: url,
      logo,
      country: country.toUpperCase(),
      language,

      channelId: channelId || null,
      feed: null,
      quality: null,
      referrer: referrer || null,
      userAgent: null,
      label: null,
    });
  }

  return result;
}

async function mapWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    while (true) {
      const index = next++;

      if (index >= items.length) return;

      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        results[index] = null;
        console.warn(
          `XameTV source failed: ${items[index].name || items[index]}:`,
          err.message
        );
      }
    }
  }

  const workers = [];

  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(runner());
  }

  await Promise.all(workers);

  return results;
}

async function getStreamFiles() {
  const entries = await getJson(GITHUB_API);

  return entries
    .filter(entry =>
      entry &&
      entry.type === 'file' &&
      /\.m3u$/i.test(entry.name)
    )
    .map(entry => ({
      name: entry.name,
      url: entry.download_url ||
        `${RAW_IPTV}/streams/${entry.name}`,
    }));
}

async function loadCatalogue(force = false) {
  if (
    !force &&
    cache.channels &&
    Date.now() < cache.expiresAt
  ) {
    return cache.channels;
  }

  console.log('XameTV: loading channel database...');

  const channelsCsv = await getText(
    `${RAW_DB}/data/channels.csv`
  );

  const channelRows = parseCsv(channelsCsv);

  const channelMap = new Map();

  for (const row of channelRows) {
    if (!row.id) continue;

    channelMap.set(row.id, {
      id: row.id,
      name: row.name || '',
      country: row.country || '',
      categories: row.categories || '',
      isNsfw: String(row.is_nsfw).toUpperCase() === 'TRUE',
      closed: Boolean(row.closed),
    });
  }

  console.log(
    `XameTV: channel database loaded (${channelMap.size} channels)`
  );

  const files = await getStreamFiles();

  console.log(
    `XameTV: discovered ${files.length} stream playlists`
  );

  const parsed = await mapWithConcurrency(
    files,
    async file => {
      const match = /^([^.]+)\.m3u$/i.exec(file.name);

      const countryCode = match
        ? match[1].toUpperCase()
        : '';

      const content = await getText(file.url);

      return parseM3u(
        content,
        countryCode,
        channelMap
      );
    },
    MAX_CONCURRENT
  );

  const result = [];

  for (const list of parsed) {
    if (!Array.isArray(list)) continue;

    for (const channel of list) {
      if (!channel) continue;

      const metadata =
        channel.channelId
          ? channelMap.get(channel.channelId)
          : null;

      if (metadata && metadata.isNsfw) continue;
      if (metadata && metadata.closed) continue;

      result.push(channel);
    }
  }

  // Remove exact duplicate stream entries.
  const seen = new Set();
  const unique = [];

  for (const channel of result) {
    const key =
      `${channel.channelId || ''}|${channel.streamUrl}`;

    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(channel);
  }

  console.log(
    `XameTV: usable HTTP streams = ${unique.length}`
  );

  cache = {
    expiresAt: Date.now() + CACHE_TTL,
    channels: unique,
  };

  return unique;
}

module.exports = {
  loadCatalogue,

  clearCache() {
    cache = {
      expiresAt: 0,
      channels: null,
    };
  },
};
