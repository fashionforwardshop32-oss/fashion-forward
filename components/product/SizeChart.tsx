const ROWS = [
  { age: "0-1Y", height: "50-76 cm", chest: "44-47 cm" },
  { age: "1-2Y", height: "77-86 cm", chest: "48-50 cm" },
  { age: "2-3Y", height: "87-96 cm", chest: "51-53 cm" },
  { age: "3-4Y", height: "97-104 cm", chest: "54-56 cm" },
  { age: "4-5Y", height: "105-110 cm", chest: "57-59 cm" },
  { age: "5-6Y", height: "111-116 cm", chest: "60-62 cm" },
  { age: "6-7Y", height: "117-122 cm", chest: "63-65 cm" },
  { age: "7-8Y", height: "123-128 cm", chest: "66-68 cm" },
  { age: "8-9Y", height: "129-134 cm", chest: "69-71 cm" },
];

export function SizeChart() {
  return (
    <details className="rounded-card border border-ink/10 bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">Size chart</summary>
      <table className="mt-3 w-full text-left text-sm">
        <thead>
          <tr className="text-ink-muted">
            <th className="py-1">Age</th>
            <th className="py-1">Height</th>
            <th className="py-1">Chest</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.age} className="border-t border-ink/10">
              <td className="py-1 text-ink">{row.age}</td>
              <td className="py-1 text-ink">{row.height}</td>
              <td className="py-1 text-ink">{row.chest}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-muted">General reference — runs true to size unless noted.</p>
    </details>
  );
}
