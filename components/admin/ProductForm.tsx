"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export type ProductFormValues = {
  title: string;
  categoryId: string;
  gender: "boy" | "girl" | "unisex";
  ageGroup: string;
  basePrice: string;
  publishNow: boolean;
  sizes: { size: string; stockQty: string }[];
};

type Category = { id: string; name: string };

const GENDERS: ProductFormValues["gender"][] = ["boy", "girl", "unisex"];

export function ProductForm({
  categories,
  defaultValues,
  submitLabel,
}: {
  categories: Category[];
  defaultValues?: Partial<ProductFormValues>;
  submitLabel: string;
}) {
  const [gender, setGender] = useState<ProductFormValues["gender"]>(
    defaultValues?.gender ?? "unisex",
  );
  const [sizes, setSizes] = useState<{ size: string; stockQty: string }[]>(
    defaultValues?.sizes ?? [{ size: "", stockQty: "0" }],
  );

  function addSizeRow() {
    setSizes((prev) => [...prev, { size: "", stockQty: "0" }]);
  }

  function removeSizeRow(index: number) {
    setSizes((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSizeRow(index: number, key: "size" | "stockQty", value: string) {
    setSizes((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  return (
    <Card className="max-w-xl space-y-5 p-5">
      <input type="hidden" name="gender" value={gender} />
      <input type="hidden" name="sizesJson" value={JSON.stringify(sizes)} />

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium text-ink">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          defaultValue={defaultValues?.title}
          className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
        />
      </div>

      <div>
        <label htmlFor="categoryId" className="mb-1 block text-sm font-medium text-ink">
          Category
        </label>
        <select
          id="categoryId"
          name="categoryId"
          required
          defaultValue={defaultValues?.categoryId}
          className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
        >
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-ink">Gender</span>
        <div className="flex gap-2">
          {GENDERS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(g)}
              className={`rounded-card px-4 py-2 text-sm font-medium capitalize ${
                gender === g ? "bg-brand text-on-brand" : "bg-tint text-brand"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="ageGroup" className="mb-1 block text-sm font-medium text-ink">
          Age range
        </label>
        <input
          id="ageGroup"
          name="ageGroup"
          required
          placeholder="e.g. 2-4Y"
          defaultValue={defaultValues?.ageGroup}
          className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
        />
      </div>

      <div>
        <label htmlFor="basePrice" className="mb-1 block text-sm font-medium text-ink">
          Price (₹)
        </label>
        <input
          id="basePrice"
          name="basePrice"
          type="number"
          min="0"
          step="1"
          required
          defaultValue={defaultValues?.basePrice}
          className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
        />
      </div>

      <div>
        <label htmlFor="photos" className="mb-1 block text-sm font-medium text-ink">
          Photos
        </label>
        <input
          id="photos"
          name="photos"
          type="file"
          accept="image/*"
          multiple
          className="w-full text-sm text-ink"
        />
        <p className="mt-1 text-xs text-ink-muted">First photo becomes the cover image.</p>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-ink">Sizes &amp; stock</span>
        <div className="space-y-2">
          {sizes.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                placeholder="Size, e.g. 2-3Y"
                value={row.size}
                onChange={(e) => updateSizeRow(i, "size", e.target.value)}
                className="flex-1 rounded-card border border-ink/15 px-3 py-2 text-sm text-ink"
              />
              <input
                type="number"
                min="0"
                placeholder="Stock"
                value={row.stockQty}
                onChange={(e) => updateSizeRow(i, "stockQty", e.target.value)}
                className="w-24 rounded-card border border-ink/15 px-3 py-2 text-sm text-ink"
              />
              {sizes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSizeRow(i)}
                  className="text-sm text-accent"
                  aria-label="Remove size"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addSizeRow} className="mt-2 text-sm font-medium text-brand">
          + Add another size
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="publishNow"
          defaultChecked={defaultValues?.publishNow ?? true}
        />
        Publish immediately (unchecked = save as draft)
      </label>

      <Button type="submit" className="w-full">
        {submitLabel}
      </Button>
    </Card>
  );
}
