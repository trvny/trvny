import {
  parseContactCommand,
  parseDiceCommand,
  parseLocationCommand,
  parsePollCommand,
  parseQuizCommand,
  parseRecallCommand,
  parseRememberCommand,
  parseReminderCancelCommand,
  parseReminderCommand,
  parseTopicCommand,
  parseVenueCommand,
  parseWatchCancelCommand,
  parseWatchCommand,
  type BotekContactRequest,
  type BotekLocationRequest,
  type BotekPollRequest,
  type BotekQuizRequest,
  type BotekReminderRequest,
  type BotekVenueRequest,
  type BotekWatchRequest,
  type TelegramDiceEmoji,
} from "./commands";
import {
  parseTaskCommand,
  parseTaskControlCommand,
  type BotekTaskControlRequest,
} from "./tasks";
import {
  definePredicateRoute,
  routeFirst,
  type PredicateRoute,
  type RouteDecision,
} from "./router";

export type OwnerCommand =
  | { kind: "start-help"; start: boolean }
  | { kind: "reset" }
  | { kind: "draft-usage" }
  | { kind: "status" }
  | { kind: "legion" }
  | { kind: "tasks" }
  | { kind: "reminder-usage" }
  | { kind: "reminder-create"; request: BotekReminderRequest | null }
  | { kind: "reminder-list" }
  | { kind: "reminder-cancel-usage" }
  | { kind: "reminder-cancel"; id: string | null }
  | { kind: "watch-usage" }
  | { kind: "watch-create"; request: BotekWatchRequest | null }
  | { kind: "watch-list" }
  | { kind: "watch-cancel-usage" }
  | { kind: "watch-cancel"; id: string | null }
  | { kind: "remember-usage" }
  | { kind: "remember"; memory: string | null }
  | { kind: "recall-usage" }
  | { kind: "recall"; query: string | null }
  | { kind: "memory-status" }
  | { kind: "location-usage" }
  | { kind: "location"; location: BotekLocationRequest | null }
  | { kind: "venue-usage" }
  | { kind: "venue"; venue: BotekVenueRequest | null }
  | { kind: "contact-usage" }
  | { kind: "contact"; contact: BotekContactRequest | null }
  | { kind: "sticker" }
  | { kind: "dice"; emoji: TelegramDiceEmoji | null }
  | { kind: "poll-usage" }
  | { kind: "poll"; poll: BotekPollRequest | null }
  | { kind: "quiz-usage" }
  | { kind: "quiz"; quiz: BotekQuizRequest | null }
  | { kind: "topic-usage" }
  | { kind: "topic"; name: string | null }
  | { kind: "task-control-usage"; action: "status" | "cancel" }
  | { kind: "task-control"; request: BotekTaskControlRequest | null }
  | { kind: "task-usage" }
  | { kind: "task"; request: { repo: string; goal: string } | null };

type TextRoute = PredicateRoute<string, OwnerCommand>;

function textRoute(
  name: string,
  match: (text: string) => OwnerCommand | undefined,
): TextRoute {
  return definePredicateRoute(name, match, (_text, command) => command);
}

const OWNER_COMMAND_ROUTES: readonly TextRoute[] = [
  textRoute("start-help", (text) => (
    text === "/start" || text.startsWith("/start ") || text === "/help"
      ? { kind: "start-help", start: text === "/start" || text.startsWith("/start ") }
      : undefined
  )),
  textRoute("reset", (text) => text === "/reset" ? { kind: "reset" } : undefined),
  textRoute("draft-usage", (text) => text === "/draft" ? { kind: "draft-usage" } : undefined),
  textRoute("status", (text) => text === "/status" ? { kind: "status" } : undefined),
  textRoute("legion", (text) => text === "/legion" ? { kind: "legion" } : undefined),
  textRoute("tasks", (text) => text === "/tasks" ? { kind: "tasks" } : undefined),

  textRoute("reminder-usage", (text) => text === "/remind" ? { kind: "reminder-usage" } : undefined),
  textRoute("reminder-create", (text) => text.startsWith("/remind ")
    ? { kind: "reminder-create", request: parseReminderCommand(text) }
    : undefined),
  textRoute("reminder-list", (text) => text === "/reminders" ? { kind: "reminder-list" } : undefined),
  textRoute("reminder-cancel-usage", (text) => text === "/remind_cancel"
    ? { kind: "reminder-cancel-usage" }
    : undefined),
  textRoute("reminder-cancel", (text) => text.startsWith("/remind_cancel ")
    ? { kind: "reminder-cancel", id: parseReminderCancelCommand(text) }
    : undefined),

  textRoute("watch-usage", (text) => text === "/watch" ? { kind: "watch-usage" } : undefined),
  textRoute("watch-create", (text) => text.startsWith("/watch ")
    ? { kind: "watch-create", request: parseWatchCommand(text) }
    : undefined),
  textRoute("watch-list", (text) => text === "/watches" ? { kind: "watch-list" } : undefined),
  textRoute("watch-cancel-usage", (text) => text === "/watch_cancel"
    ? { kind: "watch-cancel-usage" }
    : undefined),
  textRoute("watch-cancel", (text) => text.startsWith("/watch_cancel ")
    ? { kind: "watch-cancel", id: parseWatchCancelCommand(text) }
    : undefined),

  textRoute("remember-usage", (text) => text === "/remember" ? { kind: "remember-usage" } : undefined),
  textRoute("remember", (text) => text.startsWith("/remember ")
    ? { kind: "remember", memory: parseRememberCommand(text) }
    : undefined),
  textRoute("recall-usage", (text) => text === "/recall" ? { kind: "recall-usage" } : undefined),
  textRoute("recall", (text) => text.startsWith("/recall ")
    ? { kind: "recall", query: parseRecallCommand(text) }
    : undefined),
  textRoute("memory-status", (text) => text === "/memory_status" ? { kind: "memory-status" } : undefined),

  textRoute("location-usage", (text) => text === "/location" ? { kind: "location-usage" } : undefined),
  textRoute("location", (text) => text.startsWith("/location ")
    ? { kind: "location", location: parseLocationCommand(text) }
    : undefined),
  textRoute("venue-usage", (text) => text === "/venue" ? { kind: "venue-usage" } : undefined),
  textRoute("venue", (text) => text.startsWith("/venue ")
    ? { kind: "venue", venue: parseVenueCommand(text) }
    : undefined),
  textRoute("contact-usage", (text) => text === "/contact" ? { kind: "contact-usage" } : undefined),
  textRoute("contact", (text) => text.startsWith("/contact ")
    ? { kind: "contact", contact: parseContactCommand(text) }
    : undefined),
  textRoute("sticker", (text) => text === "/sticker" ? { kind: "sticker" } : undefined),
  textRoute("dice", (text) => text === "/dice" || text.startsWith("/dice ")
    ? { kind: "dice", emoji: parseDiceCommand(text) }
    : undefined),
  textRoute("poll-usage", (text) => text === "/poll" ? { kind: "poll-usage" } : undefined),
  textRoute("poll", (text) => text.startsWith("/poll ")
    ? { kind: "poll", poll: parsePollCommand(text) }
    : undefined),
  textRoute("quiz-usage", (text) => text === "/quiz" ? { kind: "quiz-usage" } : undefined),
  textRoute("quiz", (text) => text.startsWith("/quiz ")
    ? { kind: "quiz", quiz: parseQuizCommand(text) }
    : undefined),
  textRoute("topic-usage", (text) => text === "/topic" ? { kind: "topic-usage" } : undefined),
  textRoute("topic", (text) => text.startsWith("/topic ")
    ? { kind: "topic", name: parseTopicCommand(text) }
    : undefined),

  textRoute("task-control-usage", (text) => (
    text === "/task_status"
      ? { kind: "task-control-usage", action: "status" }
      : text === "/task_cancel"
        ? { kind: "task-control-usage", action: "cancel" }
        : undefined
  )),
  textRoute("task-control", (text) => text.startsWith("/task_status ") || text.startsWith("/task_cancel ")
    ? { kind: "task-control", request: parseTaskControlCommand(text) }
    : undefined),
  textRoute("task-usage", (text) => text === "/task" ? { kind: "task-usage" } : undefined),
  textRoute("task", (text) => text.startsWith("/task ")
    ? { kind: "task", request: parseTaskCommand(text) }
    : undefined),
];

export function routeOwnerCommand(text: string): Promise<RouteDecision<OwnerCommand>> {
  return routeFirst(text, OWNER_COMMAND_ROUTES);
}
