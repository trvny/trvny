// What GitHub answers for the operator's own GPTomek App user token.
export const OPERATOR_USER_ID = 120686325;
export const OPERATOR_APP_ID = 4524407;

export function operatorInstallations(...appIds: number[]): Response {
  const ids = appIds.length ? appIds : [OPERATOR_APP_ID];
  return Response.json({
    total_count: ids.length,
    installations: ids.map((app_id, index) => ({ id: index + 1, app_id })),
  });
}
