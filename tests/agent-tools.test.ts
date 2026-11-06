import { describe, expect, it } from "vitest";
import { resolveSelection } from "@/lib/agent-tools";
import { parseVariantKey, sameVariant, variantKey, type VariantDimension } from "@/lib/channel3";

const dims: VariantDimension[] = [
  {
    name: "Color",
    values: [
      { label: "Black", exists: true, available: true, productId: null, thumbnailUrl: null },
      { label: "Silver", exists: true, available: false, productId: "p2", thumbnailUrl: null },
      { label: "Gold", exists: false, available: null, productId: null, thumbnailUrl: null },
    ],
  },
  {
    name: "Size",
    values: [{ label: "M", exists: true, available: true, productId: null, thumbnailUrl: null }],
  },
];

describe("resolveSelection", () => {
  it("canonicalises names and values case-insensitively", () => {
    expect(resolveSelection(dims, { color: "black", SIZE: "m" })).toEqual({
      selection: { Color: "Black", Size: "M" },
      problems: [],
    });
  });

  it("rejects unknown option names", () => {
    const r = resolveSelection(dims, { Material: "Leather" });
    expect(r.selection).toEqual({});
    expect(r.problems[0]).toMatch(/isn't an option/);
  });

  it("rejects values that don't exist on the product and lists valid ones", () => {
    const r = resolveSelection(dims, { Color: "Gold" });
    expect(r.problems[0]).toMatch(/Options: Black, Silver/);
  });

  it("allows an empty selection", () => {
    expect(resolveSelection(dims, {})).toEqual({ selection: {}, problems: [] });
  });
});

describe("variant keys", () => {
  it("are order-independent and round-trip", () => {
    const k = variantKey({ Size: "M", Color: "Black" });
    expect(k).toBe("Color=Black;Size=M");
    expect(parseVariantKey(k)).toEqual({ Color: "Black", Size: "M" });
  });

  it("are null for no selection", () => {
    expect(variantKey({})).toBeNull();
    expect(variantKey(null)).toBeNull();
  });

  it("compare case-insensitively, and null equals null", () => {
    expect(sameVariant("Color=Black", "color=black")).toBe(true);
    expect(sameVariant(null, null)).toBe(true);
    expect(sameVariant("Color=Black", "Color=White")).toBe(false);
    expect(sameVariant("Color=Black", null)).toBe(false);
  });
});
