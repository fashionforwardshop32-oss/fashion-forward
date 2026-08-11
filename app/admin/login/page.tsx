import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { signInAdmin } from "./actions";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center justify-center p-6">
      <Card className="w-full p-6">
        <h1 className="font-display text-2xl font-bold text-ink">Fashion Forward — Admin</h1>
        <p className="mt-1 text-sm text-ink-muted">Owner login only.</p>

        {error === "invalid" && (
          <p className="mt-4 rounded-card bg-accent/10 p-3 text-sm text-ink">
            Wrong email or password. Try again.
          </p>
        )}
        {error === "missing" && (
          <p className="mt-4 rounded-card bg-accent/10 p-3 text-sm text-ink">
            Enter both email and password.
          </p>
        )}

        <form action={signInAdmin} className="mt-5 space-y-3">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
            />
          </div>
          <Button type="submit" className="w-full">
            Log in
          </Button>
        </form>
      </Card>
    </main>
  );
}
