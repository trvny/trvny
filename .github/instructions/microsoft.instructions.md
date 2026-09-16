---
applyTo: "**/*.cs,**/*.csproj,**/*.sln,**/*.bicep,**/azure.yaml,**/host.json,**/local.settings.json,**/.github/workflows/*azure*.yml,**/.github/workflows/*azure*.yaml,**/.github/workflows/*dotnet*.yml,**/.github/workflows/*dotnet*.yaml"
---

# Microsoft and Azure

- Base key .NET, Azure, PowerShell, Windows, and GitHub Actions decisions on current official Microsoft Learn docs.
- Preserve target framework, SDK pins, nullable settings, analyzers, formatting, and package-management conventions.
- Upgrade SDKs, target frameworks, package families, actions, or API versions only when the task requires it.
- Keep credentials, connection strings, publish profiles, certificates, access tokens, and service-principal secrets out of the repo.
- Prefer workload/managed identity or short-lived credentials when supported by platform and project.
- Specify Azure resource names, scopes, regions, API versions, and deployment environments.
- Before proposing deployment, validate project files, Bicep, and matching workflows with existing repo commands.
- Create, deploy, delete, or reconfigure cloud resources only when explicitly requested and authorized.
- Report local validation, cloud-only checks, and remaining assumptions.
