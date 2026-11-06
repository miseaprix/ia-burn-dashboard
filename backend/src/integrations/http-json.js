import https from 'node:https';
import http from 'node:http';
// Dedicated TLS options per request: no global changes affecting personal calls.
export function getJson(
  url,
  { headers = {}, insecure = false, timeout = 5000, maxBytes = 1048576 } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        reject(new Error('Provider request failed'));
      }
    };
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.get(
      target,
      { headers, rejectUnauthorized: !insecure },
      (res) => {
        if (res.statusCode !== 200) {
          const error = new Error(`Provider returned HTTP ${res.statusCode}`);
          error.status = res.statusCode;
          error.retryAfter = res.headers['retry-after'];
          settled = true;
          res.resume();
          reject(error);
          return;
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            fail();
            res.destroy();
            req.destroy();
          } else chunks.push(chunk);
        });
        res.on('error', fail);
        res.on('end', () => {
          if (settled) return;
          settled = true;
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('Invalid provider response'));
          }
        });
      },
    );
    const timer = setTimeout(() => {
      fail();
      req.destroy();
    }, timeout);
    req.on('close', () => clearTimeout(timer));
    req.on('error', fail);
  });
}
