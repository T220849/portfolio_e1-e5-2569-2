const http = require("node:http");

const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 16 * 1024;
const wifiStatuses = new Map();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function validateWifiStatus(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "JSON body must be an object";
  }
  if (typeof data.deviceId !== "string" || data.deviceId.trim().length === 0) {
    return "deviceId is required";
  }
  if (data.deviceId.length > 100) {
    return "deviceId must be 100 characters or fewer";
  }
  if (typeof data.connected !== "boolean") {
    return "connected must be a boolean";
  }
  if (data.ssid !== undefined && (typeof data.ssid !== "string" || data.ssid.length >  SSID_MAX_LENGTH)) {
    return `ssid must be a string of ${SSID_MAX_LENGTH} characters or fewer`;
  }
  if (data.ip !== undefined && (typeof data.ip !== "string" || data.ip.length > 45)) {
    return "ip must be a string of 45 characters or fewer";
  }
  if (data.rssi !== undefined && (!Number.isInteger(data.rssi) || data.rssi < -127 || data.rssi > 0)) {
    return "rssi must be an integer between -127 and 0";
  }
  return null;
}

const SSID_MAX_LENGTH = 32;

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/wifi/status") {
    try {
      const data = await readJson(request);
      const validationError = validateWifiStatus(data);
      if (validationError) {
        return sendJson(response, 400, { error: validationError });
      }

      const status = {
        deviceId: data.deviceId.trim(),
        connected: data.connected,
        ...(data.ssid !== undefined && { ssid: data.ssid }),
        ...(data.ip !== undefined && { ip: data.ip }),
        ...(data.rssi !== undefined && { rssi: data.rssi }),
        updatedAt: new Date().toISOString(),
      };

      wifiStatuses.set(status.deviceId, status);
      return sendJson(response, 200, { ok: true, status });
    } catch (error) {
      return sendJson(response, error.statusCode || 500, {
        error: error.statusCode ? error.message : "Internal server error",
      });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/wifi/status") {
    const deviceId = url.searchParams.get("deviceId");
    if (!deviceId) {
      return sendJson(response, 400, { error: "deviceId query parameter is required" });
    }

