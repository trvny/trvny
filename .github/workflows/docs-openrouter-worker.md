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
      model:
        description: OpenRouter fallback model
        required: true
        type: choice
        options:
          - nvidia/nemotron-3-ultra-550b-a55b:free
          - nvidia/nemotron-3.5-lightning:free
          - openrouter/free
      request_id:
        description: Correlation id for orchestrated runs
        required: false
        type: string
        default: manual

run-name: Documentation worker · ${{ inputs.target_repo }} · OpenRouter · ${{ inputs.model }} · ${{ inputs.request_id }}

concurrency:
  group: gh-aw-docs-${{ inputs.target_repo }}

engine:
  id: copilot
  bare: true
  env:
    COPILOT_PROVIDER_BASE_URL: "https://openrouter.ai/api/v1"
    COPILOT_PROVIDER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    COPILOT_MODEL: ${{ inputs.model }}
    COPILOT_PROVIDER_TYPE: openai
    COPILOT_PROVIDER_WIRE_API: completions
model: ${{ inputs.model }}

models:
  providers:
    github-copilot:
      models:
        "nvidia/nemotron-3-ultra-550b-a55b:free":
          cost:
            input: "0e0"
            output: "0e0"
        "nvidia/nemotron-3.5-lightning:free":
          cost:
            input: "0e0"
            output: "0e0"
        "openrouter/free":
          cost:
            input: "0e0"
            output: "0e0"

max-turns: 8

network:
  allowed:
    - defaults
    - openrouter.ai

permissions:
  contents: read

inlined-imports: true

imports:
  - shared/docs-worker-common.md
---

# Documentation Worker

Follow the imported shared documentation-worker procedure exactly.
