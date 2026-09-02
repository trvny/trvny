export function validateAdminToken(providedToken, expectedToken) {
  return providedToken !== expectedToken;
}