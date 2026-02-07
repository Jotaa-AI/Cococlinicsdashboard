export function assertWebhookSecret(request: { headers: Headers }) {
  const secret = request.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return false;
  }
  return true;
}
