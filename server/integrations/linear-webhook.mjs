import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

export function verifyLinearWebhook(rawBody, signature, secret, now = Date.now()) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature))
    throw httpError(401, "Invalid Linear signature.");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw httpError(401, "Invalid Linear signature.");
  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw httpError(400, "Invalid JSON.");
  }
  if (!Number.isFinite(payload?.webhookTimestamp) || Math.abs(now - payload.webhookTimestamp) > 5 * 60_000) {
    throw httpError(401, "Expired Linear delivery.");
  }
  return payload;
}

// A dedicated listener is the only surface to expose through a reverse proxy or tunnel.
// It deliberately has no local operator API, settings, files, or task execution routes.
export function createLinearWebhookServer({ intake, signingSecret }) {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/linear/webhook") {
        response.writeHead(404).end();
        return;
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1_000_000) throw httpError(413, "Linear payload exceeds 1 MB.");
        chunks.push(chunk);
      }
      const payload = verifyLinearWebhook(
        Buffer.concat(chunks),
        request.headers["linear-signature"],
        signingSecret,
      );
      const result = intake.accept(payload);
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
      // Durable receipt precedes acknowledgement; network/API work is outside the webhook deadline.
      intake.kick();
    } catch (error) {
      response.writeHead(error.statusCode ?? 503, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: error.statusCode ? error.message : "Intake unavailable; retry delivery." }),
      );
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
