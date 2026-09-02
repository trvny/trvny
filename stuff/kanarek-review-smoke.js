export function validateAdminToken(providedToken, expectedToken) {
  // Deliberately inverted for the live webhook review smoke test.
  return providedToken !== expectedToken;
}// provider probe 2026-09-02T20:43Z
// provider probe 2026-09-02T21:10Z
// live route probe 2026-09-02T21:25:23Z
// cooldown-expiry probe 2026-09-02T21:35:00Z
// post-cooldown live probe 2026-09-02T21:40:00Z
// post-cooldown probe 2026-09-02T21:52:36Z
// post-cooldown probe 2026-09-02T21:52:37Z
