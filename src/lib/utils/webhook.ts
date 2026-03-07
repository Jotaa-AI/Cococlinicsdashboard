export function assertWebhookSecret(request: { headers: Headers }) {
  const expectedSecret = process.env.WEBHOOK_SECRET;
  const headerSecret = request.headers.get("x-webhook-secret");
  const authorization = request.headers.get("authorization");
  const bearerSecret = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : null;
  const receivedSecret = headerSecret || bearerSecret;

  if (!expectedSecret || !receivedSecret || receivedSecret !== expectedSecret) {
    return false;
  }
  return true;
}
