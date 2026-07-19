---
applyTo: "**/*.cs,**/*.csproj,**/*.sln,**/*.bicep,**/azure.yaml,**/host.json,**/local.settings.json,**/.github/workflows/*.yml,**/.github/workflows/*.yaml"
---

# Microsoft and Azure instructions

- Base important framework, Azure, .NET, GitHub Actions, PowerShell, and Windows decisions on current official Microsoft Learn documentation.
- Preserve the project's existing target framework, SDK pinning, nullable settings, analyzers, formatting, and package-management conventions.
- Do not upgrade target frameworks, SDKs, actions, or package families unless the task requires it.
- Keep credentials and connection strings out of the repository. Commit only safe example keys and placeholders.
- Treat `local.settings.json`, `.env`, publish profiles, certificates, access tokens, and service-principal credentials as private unless the repository explicitly contains sanitized examples.
- Prefer workload identity, managed identity, or short-lived credentials over embedded long-lived secrets where the platform supports them.
- For Azure infrastructure, keep resource names, scopes, regions, API versions, and deployment environments explicit.
- Validate Bicep, project files, workflows, and configuration with the repository's existing commands before proposing deployment.
- Do not create, deploy, delete, or reconfigure cloud resources unless explicitly requested and authorized.
- Report what was changed, what was validated locally, what requires cloud access, and which assumptions remain.
