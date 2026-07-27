// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractBacklinkExcerpt } from "./backlinkExcerpt";

function para(text: string) {
  return { data: { text } };
}

const LINK = '<wiki-link data-page-title="The Extended Mind">the extended mind</wiki-link>';

describe("extractBacklinkExcerpt", () => {
  it("splits the sentence around a mid-sentence link", () => {
    const blocks = [
      para(
        `The strongest version of this is ${LINK} thesis, which goes further.`
      ),
    ];
    const ex = extractBacklinkExcerpt(blocks, "The Extended Mind");
    expect(ex).not.toBeNull();
    expect(ex!.before).toBe("The strongest version of this is ");
    expect(ex!.link).toBe("the extended mind");
    expect(ex!.after).toBe(" thesis, which goes further.");
  });

  it("handles links at the start and end of a block", () => {
    const start = extractBacklinkExcerpt(
      [para(`${LINK} is where it begins.`)],
      "The Extended Mind"
    );
    expect(start!.before).toBe("");
    expect(start!.after).toBe(" is where it begins.");

    const end = extractBacklinkExcerpt(
      [para(`It all ends with ${LINK}`)],
      "The Extended Mind"
    );
    expect(end!.before).toBe("It all ends with ");
    expect(end!.after).toBe("");
  });

  it("matches by link text when data-page-title differs in case", () => {
    const blocks = [
      para('See <wiki-link data-page-title="the extended mind">The Extended Mind</wiki-link> here.'),
    ];
    expect(extractBacklinkExcerpt(blocks, "The Extended Mind")).not.toBeNull();
  });

  it("uses the first matching occurrence across blocks", () => {
    const blocks = [
      para("No links in this one."),
      para(`First mention of ${LINK} wins.`),
      para(`Second mention of ${LINK} is ignored.`),
    ];
    const ex = extractBacklinkExcerpt(blocks, "The Extended Mind");
    expect(ex!.before).toContain("First mention");
  });

  it("returns null when nothing links to the target", () => {
    expect(
      extractBacklinkExcerpt(
        [para('Links to <wiki-link data-page-title="Other">Other</wiki-link>.')],
        "The Extended Mind"
      )
    ).toBeNull();
    expect(extractBacklinkExcerpt([para("plain text")], "X")).toBeNull();
    expect(extractBacklinkExcerpt(undefined, "X")).toBeNull();
    expect(extractBacklinkExcerpt([{ data: {} }], "X")).toBeNull();
  });

  it("starts after the previous sentence boundary", () => {
    const blocks = [
      para(
        `This is a fairly long opening sentence that ends here. Then we cite ${LINK} in the second one.`
      ),
    ];
    const ex = extractBacklinkExcerpt(blocks, "The Extended Mind");
    expect(ex!.before).toBe("Then we cite ");
    expect(ex!.after).toBe(" in the second one.");
  });

  it("clamps very long sides with ellipses at word boundaries", () => {
    const longBefore = "word ".repeat(60);
    const longAfter = "tail ".repeat(60);
    const ex = extractBacklinkExcerpt(
      [para(`${longBefore}${LINK} ${longAfter}`)],
      "The Extended Mind"
    );
    expect(ex!.before.startsWith("…")).toBe(true);
    expect(ex!.before.length).toBeLessThanOrEqual(72);
    expect(ex!.after.endsWith("…")).toBe(true);
    expect(ex!.after.length).toBeLessThanOrEqual(72);
  });

  it("strips markup inside surrounding text", () => {
    const blocks = [
      para(`Bold <b>claims</b> about ${LINK} and <i>more</i>.`),
    ];
    const ex = extractBacklinkExcerpt(blocks, "The Extended Mind");
    expect(ex!.before).toBe("Bold claims about ");
    expect(ex!.after).toBe(" and more.");
  });
});
