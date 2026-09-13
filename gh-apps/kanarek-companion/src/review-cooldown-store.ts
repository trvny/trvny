const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 30 * 60_000;
const MAX_WORKERS_AI_DAILY_NEURONS = 10_000;
const WORKERS_AI_BUDGET_STORAGE_KEY = 'workers-ai-neuron-budget';

type ProviderCooldown = {
  until: number;
  category: string;
};

type WorkersAiBudgetState = {
  day: string;
  reserved: number;
  pending?: Record<string, number>;
};

function validWorkersAiReservationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function normalizedWorkersAiPending(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const pending: Record<string, number> = {};
  for (const [id, neurons] of Object.entries(value)) {
    if (validWorkersAiReservationId(id) && Number.isInteger(neurons) && (neurons as number) >= 1) {
      pending[id] = neurons as number;
    }
  }
  return pending;
}

function normalizedWorkersAiBudget(
  value: WorkersAiBudgetState | undefined,
  day: string,
): { reserved: number; pending: Record<string, number> } {
  if (!value || value.day !== day) return { reserved: 0, pending: {} };
  return {
    reserved: Number.isInteger(value.reserved) ? Math.max(0, value.reserved) : 0,
    pending: normalizedWorkersAiPending(value.pending),
  };
}

const COOLDOWN_STORAGE_KEY = 'cooldown';

function validProviderCooldown(value: unknown): value is ProviderCooldown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cooldown = value as Partial<ProviderCooldown>;
  return (
    typeof cooldown.until === 'number' &&
    Number.isFinite(cooldown.until) &&
    typeof cooldown.category === 'string' &&
    cooldown.category.length > 0 &&
    cooldown.category.length <= 64
  );
}

function cooldownJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export class ReviewProviderCooldownStore {
  private readonly state: DurableObjectState;
  private queue: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  fetch(request: Request): Promise<Response> {
    return this.enqueue(() => this.handle(request));
  }

  async alarm(): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      if (validProviderCooldown(current) && current.until > Date.now()) {
        await this.state.storage.setAlarm(current.until);
        return;
      }
      await this.state.storage.delete(COOLDOWN_STORAGE_KEY);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async handle(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/active' && request.method === 'GET') {
      const current = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      if (!validProviderCooldown(current) || current.until <= Date.now()) {
        if (current !== undefined) {
          await this.state.storage.delete(COOLDOWN_STORAGE_KEY);
          await this.state.storage.deleteAlarm();
        }
        return cooldownJson({ active: false });
      }
      return cooldownJson({ active: true, ...current });
    }

    if (pathname === '/extend' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return cooldownJson({ error: 'invalid_json' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return cooldownJson({ error: 'invalid_cooldown' }, 400);
      }
      const input = body as { category?: unknown; durationMs?: unknown };
      if (
        typeof input.category !== 'string' ||
        !input.category ||
        input.category.length > 64 ||
        typeof input.durationMs !== 'number' ||
        !Number.isInteger(input.durationMs) ||
        input.durationMs < MIN_COOLDOWN_MS ||
        input.durationMs > MAX_COOLDOWN_MS
      ) {
        return cooldownJson({ error: 'invalid_cooldown' }, 400);
      }

      const candidate: ProviderCooldown = {
        until: Date.now() + input.durationMs,
        category: input.category,
      };
      const raw = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      const current = validProviderCooldown(raw) ? raw : null;
      const next = current && current.until >= candidate.until ? current : candidate;
      if (next === candidate) {
        await this.state.storage.put(COOLDOWN_STORAGE_KEY, candidate);
        await this.state.storage.setAlarm(candidate.until);
      }
      return cooldownJson({ ok: true, ...next });
    }

    if (pathname === '/reserve-neurons' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return cooldownJson({ error: 'invalid_json' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return cooldownJson({ error: 'invalid_budget_reservation' }, 400);
      }
      const input = body as {
        day?: unknown;
        neurons?: unknown;
        limit?: unknown;
        reservationId?: unknown;
      };
      if (
        typeof input.day !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
        typeof input.neurons !== 'number' ||
        !Number.isInteger(input.neurons) ||
        input.neurons < 1 ||
        typeof input.limit !== 'number' ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > MAX_WORKERS_AI_DAILY_NEURONS ||
        !validWorkersAiReservationId(input.reservationId)
      ) {
        return cooldownJson({ error: 'invalid_budget_reservation' }, 400);
      }
      const current = await this.state.storage.get<WorkersAiBudgetState>(
        WORKERS_AI_BUDGET_STORAGE_KEY,
      );
      const budget = normalizedWorkersAiBudget(current, input.day);
      const existing = budget.pending[input.reservationId];
      if (existing !== undefined) {
        if (existing !== input.neurons) {
          return cooldownJson({ error: 'reservation_conflict' }, 409);
        }
        return cooldownJson({
          allowed: true,
          day: input.day,
          reserved: budget.reserved,
          requested: input.neurons,
          reservationId: input.reservationId,
          limit: input.limit,
          deduplicated: true,
        });
      }
      if (budget.reserved + input.neurons > input.limit) {
        return cooldownJson({
          allowed: false,
          day: input.day,
          reserved: budget.reserved,
          requested: input.neurons,
          reservationId: input.reservationId,
          limit: input.limit,
        }, 429);
      }
      const next = budget.reserved + input.neurons;
      await this.state.storage.put(WORKERS_AI_BUDGET_STORAGE_KEY, {
        day: input.day,
        reserved: next,
        pending: { ...budget.pending, [input.reservationId]: input.neurons },
      } satisfies WorkersAiBudgetState);
      return cooldownJson({
        allowed: true,
        day: input.day,
        reserved: next,
        requested: input.neurons,
        reservationId: input.reservationId,
        limit: input.limit,
        deduplicated: false,
      });
    }

    if (pathname === '/settle-neurons' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return cooldownJson({ error: 'invalid_json' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return cooldownJson({ error: 'invalid_budget_settlement' }, 400);
      }
      const input = body as {
        day?: unknown;
        reservationId?: unknown;
        actualNeurons?: unknown;
      };
      if (
        typeof input.day !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
        !validWorkersAiReservationId(input.reservationId) ||
        typeof input.actualNeurons !== 'number' ||
        !Number.isInteger(input.actualNeurons) ||
        input.actualNeurons < 1 ||
        input.actualNeurons > MAX_WORKERS_AI_DAILY_NEURONS
      ) {
        return cooldownJson({ error: 'invalid_budget_settlement' }, 400);
      }
      const current = await this.state.storage.get<WorkersAiBudgetState>(
        WORKERS_AI_BUDGET_STORAGE_KEY,
      );
      const budget = normalizedWorkersAiBudget(current, input.day);
      const reservedNeurons = budget.pending[input.reservationId];
      if (reservedNeurons === undefined) {
        return cooldownJson({
          settled: false,
          missing: true,
          day: input.day,
          reserved: budget.reserved,
          reservationId: input.reservationId,
        });
      }
      const pending = { ...budget.pending };
      delete pending[input.reservationId];
      const next = Math.max(
        0,
        budget.reserved - reservedNeurons + input.actualNeurons,
      );
      await this.state.storage.put(WORKERS_AI_BUDGET_STORAGE_KEY, {
        day: input.day,
        reserved: next,
        ...(Object.keys(pending).length ? { pending } : {}),
      } satisfies WorkersAiBudgetState);
      return cooldownJson({
        settled: true,
        missing: false,
        day: input.day,
        reserved: next,
        reservationId: input.reservationId,
        reservedNeurons,
        actualNeurons: input.actualNeurons,
      });
    }

    if (pathname === '/neuron-budget' && request.method === 'GET') {
      const url = new URL(request.url);
      const day = url.searchParams.get('day');
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit && /^\d+$/.test(rawLimit) ? Number.parseInt(rawLimit, 10) : NaN;
      if (
        !day ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAX_WORKERS_AI_DAILY_NEURONS
      ) {
        return cooldownJson({ error: 'invalid_budget_query' }, 400);
      }
      const current = await this.state.storage.get<WorkersAiBudgetState>(
        WORKERS_AI_BUDGET_STORAGE_KEY,
      );
      const reserved = normalizedWorkersAiBudget(current, day).reserved;
      return cooldownJson({
        day,
        limit,
        reserved,
        remaining: Math.max(0, limit - reserved),
      });
    }

    return cooldownJson({ error: 'not_found' }, 404);
  }
}
