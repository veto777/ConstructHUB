import { xSplitText, xWeightedLength } from "@shared/social-x";

export function XPreview({ text }: { text: string }) {
  const { main, reply } = xSplitText(text);
  return <span className="block space-y-1 text-sm" data-testid="x-preview">
    <span className="block whitespace-pre-wrap">{main}</span>
    {reply && <>
      <span className="block font-medium">Link moves to a reply</span>
      <span className="block whitespace-pre-wrap">{reply}</span>
      {xWeightedLength(reply) > 280 && <span role="alert">X link reply exceeds 280 weighted characters</span>}
    </>}
  </span>;
}
