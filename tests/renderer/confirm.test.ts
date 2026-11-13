import { describe, expect, test } from "bun:test";
import { createConfirmStore } from "../../src/renderer/src/lib/confirm";

const req = (itemName: string) => ({
  title: "Delete conversation",
  itemName,
  consequence: "It is removed permanently.",
});

describe("confirm store", () => {
  test("resolves true when confirmed, false when dismissed", async () => {
    const s = createConfirmStore();
    const a = s.request(req("Chat A"));
    expect(s.current()?.itemName).toBe("Chat A");
    s.settle(true);
    expect(await a).toBe(true);
    expect(s.current()).toBeNull();

    const b = s.request(req("Chat B"));
    s.settle(false);
    expect(await b).toBe(false);
  });

  test("overlapping requests queue in order and never lose a promise", async () => {
    const s = createConfirmStore();
    const a = s.request(req("A"));
    const b = s.request(req("B"));
    expect(s.current()?.itemName).toBe("A");
    s.settle(false);
    expect(s.current()?.itemName).toBe("B");
    s.settle(true);
    expect(await a).toBe(false);
    expect(await b).toBe(true);
  });

  test("subscribers are notified on request and settle", () => {
    const s = createConfirmStore();
    let n = 0;
    const off = s.subscribe(() => n++);
    void s.request(req("A"));
    s.settle(true);
    expect(n).toBe(2);
    off();
    void s.request(req("B"));
    expect(n).toBe(2);
  });

  test("the request carries the item name and consequence (FR-004)", () => {
    const s = createConfirmStore();
    void s.request(req("Quarterly notes"));
    expect(s.current()).toMatchObject({
      itemName: "Quarterly notes",
      consequence: "It is removed permanently.",
    });
  });
});
