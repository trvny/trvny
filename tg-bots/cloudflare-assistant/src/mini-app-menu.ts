export type TelegramMiniAppMenuButton = {
  type: "web_app";
  text: string;
  web_app: { url: string };
};

export function telegramMiniAppMenuButton(miniAppUrl: string): TelegramMiniAppMenuButton {
  const url = new URL(miniAppUrl);
  if (url.protocol !== "https:") throw new TypeError("Mini App URL must use HTTPS");
  return {
    type: "web_app",
    text: "Control Center",
    web_app: { url: url.toString() },
  };
}
