# Pet Dispatcher

Provider-agnostic MCP control plane and local worker concept for delegating bounded development tasks to a trusted machine without exposing an unrestricted host shell.

The maintained design and implementation plan lives in [`agent-dispatcher-concept.md`](./agent-dispatcher-concept.md).

The direct local-tool path for ChatGPT and other remote assistants is defined in [`interactive-tool-bridge.md`](./interactive-tool-bridge.md). It is intended to replace the need to run Desktop Commander in parallel by providing workspace-confined filesystem access, process execution and host-tool adapters through the same dispatcher policy engine.

Current status: **planning; local-only Phase 1 MVP next**.
