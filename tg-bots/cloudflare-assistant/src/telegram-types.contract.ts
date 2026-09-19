import type { Update } from "@grammyjs/types";
import type { TelegramUpdate } from "./types";

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

type _LocalMatchesUpstream = Assert<IsAssignable<TelegramUpdate, Update>>;
type _UpstreamMatchesLocal = Assert<IsAssignable<Update, TelegramUpdate>>;
