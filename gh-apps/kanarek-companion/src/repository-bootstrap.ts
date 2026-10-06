import {
  createInstallationClient,
  repositoryInstallationId,
} from './github-app.ts';

const SETTINGS_REPOSITORY = 'trvny/.github';
const SETTINGS_EVENT = 'repository-created';

interface RepositoryBootstrapEnv {
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
}

export interface RepositoryWebhookMetadata {
  action: string | null;
  event: string | null;
  repository: string | null;
}

export function repositoryCreated(
  metadata: RepositoryWebhookMetadata,
): metadata is RepositoryWebhookMetadata & { repository: string } {
  return (
    metadata.event === 'repository' &&
    metadata.action === 'created' &&
    typeof metadata.repository === 'string'
  );
}

export async function dispatchRepositorySettingsBootstrap(
  repository: string,
  env: RepositoryBootstrapEnv,
  fetcher: typeof fetch,
): Promise<void> {
  const installationId = await repositoryInstallationId(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    SETTINGS_REPOSITORY,
    fetcher,
  );
  const client = await createInstallationClient(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    installationId,
    fetcher,
  );
  if (client.permissions.contents !== 'write') {
    throw new Error('repository_bootstrap_contents_write_required');
  }

  await client.void(
    '/repos/trvny/.github/dispatches',
    'dispatch_repository_settings_bootstrap',
    {
      method: 'POST',
      body: JSON.stringify({
        event_type: SETTINGS_EVENT,
        client_payload: { repository },
      }),
    },
  );
}
