import assert from "node:assert/strict";
import { test } from "node:test";
import { focusCommentElement } from "../app/lib/qa-visual/comment-navigation";

test("scrolls directly to the selected comment and briefly highlights an image reference", () => {
  const scrolls: ScrollIntoViewOptions[] = [];
  const animations: { frames: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  const animation = {} as Animation;
  const element = {
    scrollIntoView(options: ScrollIntoViewOptions) { scrolls.push(options); },
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      animations.push({ frames, options });
      return animation;
    },
  } as unknown as HTMLElement;
  assert.equal(focusCommentElement(element, true), animation);
  assert.deepEqual(scrolls[0], { block: "center", inline: "nearest", behavior: "instant" });
  assert.equal(animations[0].options.duration, 850);
  assert.equal(animations[0].options.fill, undefined);
  assert.equal(focusCommentElement(element, false), undefined);
  assert.equal(animations.length, 1);
  focusCommentElement(element, true);
  assert.equal(animations.length, 2, "A second click must trigger a new highlight");
});
