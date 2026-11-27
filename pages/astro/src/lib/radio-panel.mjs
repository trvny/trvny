import sourceHtml from '../legacy/home.html?raw';

export const homeHtml = sourceHtml;
export const radioPanel = homeHtml.match(/<section id="radio"[\s\S]*?<\/section>/)?.[0];
if (!radioPanel) throw new Error('Missing canonical home radio panel');
