---
applyTo: "**/*.cs,**/*.csproj,**/*.sln,**/*.bicep,**/azure.yaml,**/host.json,**/local.settings.json,**/.github/workflows/*azure*.yml,**/.github/workflows/*azure*.yaml,**/.github/workflows/*dotnet*.yml,**/.github/workflows/*dotnet*.yaml"
---

# Microsoft and Azure instructions

- Base important .NET, Azure, PowerShell, Windows, and GitHub Actions decisions
  on current official Microsoft Learn documentation.
- Preserve the project's target framework, SDK pinning, nullable settings,
  analyzers, formatting, and package-management conventions.
- Do not upgrade SDKs, target frameworks, package families, actions, or API
  versions unless the task requires it.
- Keep credentials, connection strings, publish profiles, certificates, access
  tokens, and service-principal secrets out of the repository.
- Prefer workload identity, managed identity, or short-lived credentials where
  the platform and project support them.
- Keep Azure resource names, scopes, regions, API versions, and deployment
  environments explicit.
- Validate project files, Bicep, and matching workflows with existing
  repository commands before proposing deployment.
- Do not create, deploy, delete, or reconfigure cloud resources unless
  explicitly requested and authorized.
- Report local validation, cloud-only checks, and remaining assumptions.
