const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function buildUpstreamBaseUrl() {
  const raw = process.env.BACKEND_API_ORIGIN ?? "";
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return null;
  }
}

function toForwardHeaders(incomingHeaders = {}) {
  const headers = {};

  for (const [key, value] of Object.entries(incomingHeaders)) {
    const normalizedKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedKey)) {
      continue;
    }
    if (value == null) {
      continue;
    }
    headers[key] = value;
  }

  return headers;
}

exports.handler = async (event) => {
  const upstreamOrigin = buildUpstreamBaseUrl();
  if (!upstreamOrigin) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        detail:
          "Missing or invalid BACKEND_API_ORIGIN. Set it to your backend origin, e.g. https://your-api.onrender.com",
      }),
    };
  }

  const splat = event.path.replace(/^\/.netlify\/functions\/api\/?/, "");
  const upstreamUrl = new URL(`/api/${splat}`, upstreamOrigin);

  if (event.rawQuery) {
    upstreamUrl.search = event.rawQuery;
  }

  const method = event.httpMethod ?? "GET";
  const body = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
    : undefined;

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers: toForwardHeaders(event.headers),
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });

  const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
  const responseHeaders = {};
  upstreamResponse.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      responseHeaders[key] = value;
    }
  });

  return {
    statusCode: upstreamResponse.status,
    headers: responseHeaders,
    body: responseBuffer.toString("base64"),
    isBase64Encoded: true,
  };
};