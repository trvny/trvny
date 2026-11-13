// Frozen routing for behavior tests. Decoupled from wrangler.jsonc on purpose:
// operators reorder queues and swap models there without touching tests.
// Live config validity (shape, known providers, no duplicates) is config.test.ts.
export const testRouting = {
  "providerOrders": {
    "quip": [
      "vercel",
      "aihubmix",
      "ollama",
      "orcarouter",
      "groq",
      "openrouter",
      "huggingface-publicai",
      "gemini-standard"
    ],
    "review": [
      "openrouter",
      "aihubmix",
      "orcarouter",
      "groq",
      "vercel",
      "ollama",
      "huggingface-publicai",
      "gemini-standard"
    ],
    "judge": [
      "orcarouter",
      "openrouter",
      "vercel",
      "groq",
      "aihubmix",
      "ollama",
      "huggingface-publicai",
      "gemini-standard"
    ],
    "shitpost": [
      "aihubmix",
      "openrouter",
      "gemini-standard",
      "vercel",
      "orcarouter",
      "groq",
      "ollama",
      "huggingface-publicai"
    ],
    "general": [
      "aihubmix",
      "orcarouter",
      "openrouter",
      "ollama",
      "groq",
      "vercel",
      "huggingface-publicai",
      "gemini-standard"
    ]
  },
  "taskModels": {
    "aihubmix": {
      "quip": [
        "xiaomi-mimo-v2.6-flash-free",
        "nemotron-3.5-lightning-free",
        "coding-glm-5.3-flash-free",
        "gemma-4-31b-it-free"
      ],
      "review": [
        "coding-glm-5.3-free",
        "coding-kimi-k3-free",
        "xiaomi-mimo-v2.6-pro-free",
        "north-mini-code-free",
        "coding-minimax-m3-free",
        "ernie-5.5-flash-preview-free"
      ],
      "judge": [
        "xiaomi-mimo-v2.6-pro-free",
        "coding-glm-5.3-free",
        "coding-kimi-k3-free",
        "north-mini-code-free"
      ],
      "shitpost": [
        "coding-minimax-m3-free",
        "coding-glm-5.3-free",
        "coding-kimi-k3-free",
        "xiaomi-mimo-v2.6-pro-free",
        "ernie-5.5-flash-preview-free"
      ],
      "general": [
        "coding-kimi-k3-free",
        "coding-glm-5.3-free",
        "xiaomi-mimo-v2.6-pro-free",
        "coding-minimax-m3-free",
        "north-mini-code-free",
        "ernie-5.5-flash-preview-free",
        "nemotron-3-ultra-550b-a55b-free",
        "nemotron-3.5-lightning-free",
        "nemotron-3.5-super-vl-free",
        "xiaomi-mimo-v2.6-flash-free",
        "coding-glm-5.3-flash-free",
        "gemma-4-31b-it-free",
        "particle-1-free",
        "flint-v1.0-free",
        "agents-a1-free",
        "dots-3-note-preview-free",
        "lfm-2.5-2.6b-free",
        "kimi-for-coding-free"
      ]
    },
    "orcarouter": {
      "quip": [
        "z-ai/glm-5.3-flash-free",
        "tencent/hy3-free",
        "deepseek/deepseek-v4.1-flash-free"
      ],
      "review": [
        "deepseek/deepseek-v4.1-flash-free",
        "z-ai/glm-5.3-flash-free",
        "tencent/hy4-preview-free"
      ],
      "judge": [
        "z-ai/glm-5.3-flash-free",
        "deepseek/deepseek-v4.1-flash-free",
        "tencent/hy4-preview-free"
      ],
      "shitpost": [
        "tencent/hy4-preview-free",
        "deepseek/deepseek-v4.1-flash-free",
        "z-ai/glm-5.3-flash-free"
      ],
      "general": [
        "deepseek/deepseek-v4.1-flash-free",
        "z-ai/glm-5.3-flash-free",
        "tencent/hy4-preview-free",
        "tencent/hy3-free"
      ]
    },
    "openrouter": {
      "quip": [
        "nvidia/nemotron-3.5-lightning:free",
        "thinkingmachines/inkling-2-small:free",
        "cohere/north-mini-code:free",
        "openrouter/free"
      ],
      "review": [
        "cohere/north-mini-code:free",
        "baidu/ernie-5.5-flash-preview:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "nvidia/nemotron-3.5-super-vl:free",
        "openrouter/free"
      ],
      "judge": [
        "cohere/north-mini-code:free",
        "baidu/ernie-5.5-flash-preview:free",
        "openrouter/free",
        "nvidia/nemotron-3-ultra-550b-a55b:free"
      ],
      "shitpost": [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "baidu/ernie-5.5-flash-preview:free",
        "openrouter/free",
        "cohere/north-mini-code:free"
      ],
      "general": [
        "cohere/north-mini-code:free",
        "baidu/ernie-5.5-flash-preview:free",
        "nvidia/nemotron-3.5-lightning:free",
        "thinkingmachines/inkling-2-small:free",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "nvidia/nemotron-3.5-super-vl:free",
        "particle-ai/particle-1:free",
        "recursive/flint-v1.0:free",
        "dots-studio/dots-3-note-preview:free",
        "openrouter/free"
      ]
    },
    "vercel": {
      "quip": [
        "inclusionai/ling-3.1-flash-free",
        "poolside/laguna-s-2.1-free",
        "alibaba/qwen3.8-omni-flash"
      ],
      "review": [
        "tencent/hy3",
        "alibaba/qwen3.8-omni-flash",
        "poolside/laguna-s-2.1-free",
        "inclusionai/ling-3.1-flash-free"
      ],
      "judge": [
        "alibaba/qwen3.8-omni-flash",
        "tencent/hy3",
        "poolside/laguna-s-2.1-free",
        "inclusionai/ling-3.1-flash-free"
      ],
      "shitpost": [
        "alibaba/qwen3.8-omni-flash",
        "inclusionai/ling-3.1-flash-free",
        "tencent/hy3"
      ],
      "general": [
        "tencent/hy3",
        "alibaba/qwen3.8-omni-flash",
        "alibaba/qwen3-coder-30b-a3b",
        "inclusionai/ling-3.1-flash-free",
        "poolside/laguna-s-2.1-free",
        "nvidia/nemotron-3.5-lightning-free"
      ]
    },
    "ollama": {
      "general": [
        "gpt-oss:120b",
        "gpt-oss:20b"
      ]
    }
  },
  "decisionModels": {
    "aihubmix": [
      "decision-model-preview",
      "mammoth-1-free",
      "elephant-1-free",
      "span-01-lite-free"
    ],
    "openrouter": [
      "inception/mercury-decide:free",
      "baseten/mammoth-1:free",
      "baseten/elephant-1:free",
      "respan/span-01-lite:free"
    ],
    "qwencloud": [
      "decision-model-preview"
    ],
    "vercel": [
      "convaiinnovations/laya-free"
    ]
  }
} as {
  providerOrders: Record<string, string[]>;
  taskModels: Record<string, Record<string, string[]>>;
  decisionModels: Record<string, string[]>;
};

export const testVars = {
  "KANAREK_REVIEW_HUGGINGFACE_MODEL": "speakleash/Bielik-11B-v3.0-Instruct:publicai",
  "KANAREK_REVIEW_GROQ_MODEL": "openai/gpt-oss-120b",
  "KANAREK_REVIEW_GEMINI_MODEL": "gemini-3.8-flash",
  "KANAREK_REVIEW_DEEPSEEK_MODEL": "deepseek-flash",
  "KANAREK_REVIEW_PAID_PROVIDER_ORDER": "xai,deepseek,gemini-flex",
  "KANAREK_REVIEW_WORKERS_AI_MODEL": "@cf/zai-org/glm-4.7-flash"
} as const;
