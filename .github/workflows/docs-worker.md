---
on:
  workflow_dispatch:
    inputs:
      target_repo:
        description: Target repository
        required: true
        type: choice
        options:
          - trvny/feedseek
          - trvny/kanarek
          - trvny/tvpi
          - trvny/wambridge
          - trvny/trvny
          - trvny/Autka
          - trvny/.ai
      request_id:
        description: Correlation id for orchestrated runs
        required: false
        type: string
        default: manual

run-name: Documentation worker · ${{ inputs.target_repo }} · Orca · ${{ inputs.request_id }}

concurrency:
  group: gh-aw-docs-${{ inputs.target_repo }}

engine:
  id: copilot
  bare: true
  env:
    COPILOT_PROVIDER_BASE_URL: "https://api.orcarouter.ai/v1"
    COPILOT_PROVIDER_API_KEY: ${{ secrets.ORCAROUTER_API_KEY }}
    COPILOT_MODEL: deepseek/deepseek-v4-flash-free
    COPILOT_PROVIDER_TYPE: openai
    COPILOT_PROVIDER_WIRE_API: completions
model: deepseek/deepseek-v4-flash-free

models:
  providers:
    github-copilot:
      models:
        "deepseek/deepseek-v4-flash-free":
          cost:
            input: "0e0"
            output: "0e0"

max-turns: 8

network:
  allowed:
    - defaults
    - api.orcarouter.ai

permissions:
  contents: read

inlined-imports: true

imports:
  - shared/docs-worker-common.md
---

# Documentation Worker

Follow the imported shared documentation-worker procedure exactly.
