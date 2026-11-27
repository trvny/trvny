import sourceHtml from '../../../site/index.html?raw';

export function stripRadioEnhancements(html) {
  return html.replace(/<!-- hub-radio:start -->[\s\S]*?<!-- hub-radio:end -->/g, '');
}

export const homeHtml = stripRadioEnhancements(sourceHtml);
const section = homeHtml.match(/<section id="radio"[\s\S]*?<\/section>/)?.[0];
if (!section) throw new Error('Missing canonical home radio panel');

export const radioPanel = section;
