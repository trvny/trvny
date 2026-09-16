export type InlineResultLimits = {
  plain: number;
  rich: number;
};

export function inlineResultContent(
  value: string,
  rich: boolean,
  limits: InlineResultLimits,
) {
  const answer = value.trim() || "Brak odpowiedzi.";
  return rich
    ? { rich_message: { markdown: answer.slice(0, limits.rich) } }
    : {
        message_text: answer.slice(0, limits.plain),
        link_preview_options: { is_disabled: true },
      };
}
